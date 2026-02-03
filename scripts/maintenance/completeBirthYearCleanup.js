#!/usr/bin/env node
/**
 * completeBirthYearCleanup.js
 *
 * Optimized birth_year data cleanup using batch SQL operations:
 * - Phase 1: Merge duplicates (keep oldest, transfer matches)
 * - Phase 2: Batch update birth_years using window functions
 * - Phase 3: Refresh materialized views
 *
 * Usage: node scripts/maintenance/completeBirthYearCleanup.js [--dry-run]
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

dotenv.config();
const { Pool } = pg;

const DRY_RUN = process.argv.includes('--dry-run');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function phase1MergeDuplicates(client) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 1: Merge Duplicate Teams (SQL batch)');
  console.log('='.repeat(60));

  // Find groups where multiple teams want the same (canonical_name, birth_year, gender, state)
  // These are teams with DIFFERENT current birth_year but same extracted year from name
  const duplicateGroups = await client.query(`
    WITH extracted AS (
      SELECT
        id,
        display_name,
        canonical_name,
        gender,
        state,
        birth_year as current_by,
        (regexp_match(display_name, '(20[01][0-9])'))[1]::int as target_by,
        created_at
      FROM teams_v2
      WHERE display_name ~ '20[01][0-9]'
        AND birth_year IS NOT NULL
    ),
    conflict_groups AS (
      SELECT
        canonical_name,
        target_by,
        gender,
        COALESCE(state, '') as state,
        COUNT(*) as team_count,
        array_agg(id ORDER BY created_at) as team_ids,
        array_agg(current_by ORDER BY created_at) as birth_years
      FROM extracted
      GROUP BY canonical_name, target_by, gender, COALESCE(state, '')
      HAVING COUNT(*) > 1
    )
    SELECT * FROM conflict_groups
    ORDER BY canonical_name
  `);

  console.log(`\nDuplicate groups found: ${duplicateGroups.rows.length}`);

  if (duplicateGroups.rows.length === 0) {
    console.log('No duplicates to merge.');
    return { merged: 0, matchesMoved: 0 };
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Sample duplicate groups:');
    console.table(duplicateGroups.rows.slice(0, 10).map(r => ({
      canonical_name: r.canonical_name.substring(0, 40),
      target_by: r.target_by,
      team_count: r.team_count,
      birth_years: r.birth_years.join(',')
    })));

    // Count total duplicates
    const totalDuplicates = duplicateGroups.rows.reduce((sum, g) => sum + parseInt(g.team_count) - 1, 0);
    console.log(`\nTotal teams to merge: ${totalDuplicates}`);
    return { merged: 0, wouldMerge: totalDuplicates };
  }

  // For each group, keep the OLDEST team (first created), merge others into it
  let totalMerged = 0;
  let totalMatchesMoved = 0;
  let totalMatchesDeleted = 0;

  for (const group of duplicateGroups.rows) {
    const keepId = group.team_ids[0]; // Keep oldest
    const mergeIds = group.team_ids.slice(1); // Merge the rest

    // First, delete matches that would violate constraints after merge:

    // 1. Delete matches where BOTH teams are in this merge group (would become team vs self)
    const deleteSelfMatches = await client.query(`
      DELETE FROM matches_v2
      WHERE (home_team_id = $1 AND away_team_id = ANY($2))
         OR (away_team_id = $1 AND home_team_id = ANY($2))
         OR (home_team_id = ANY($2) AND away_team_id = ANY($2))
      RETURNING id
    `, [keepId, mergeIds]);

    // 2. Delete matches that would become duplicates after transfer
    const deleteHomeDupes = await client.query(`
      DELETE FROM matches_v2 m1
      WHERE m1.home_team_id = ANY($2)
        AND EXISTS (
          SELECT 1 FROM matches_v2 m2
          WHERE m2.home_team_id = $1
            AND m2.match_date = m1.match_date
            AND m2.away_team_id = m1.away_team_id
            AND m2.home_score = m1.home_score
            AND m2.away_score = m1.away_score
        )
      RETURNING id
    `, [keepId, mergeIds]);

    const deleteAwayDupes = await client.query(`
      DELETE FROM matches_v2 m1
      WHERE m1.away_team_id = ANY($2)
        AND EXISTS (
          SELECT 1 FROM matches_v2 m2
          WHERE m2.away_team_id = $1
            AND m2.match_date = m1.match_date
            AND m2.home_team_id = m1.home_team_id
            AND m2.home_score = m1.home_score
            AND m2.away_score = m1.away_score
        )
      RETURNING id
    `, [keepId, mergeIds]);

    totalMatchesDeleted += deleteSelfMatches.rowCount + deleteHomeDupes.rowCount + deleteAwayDupes.rowCount;

    // Now transfer remaining matches from merge candidates to the keeper
    const homeResult = await client.query(`
      UPDATE matches_v2
      SET home_team_id = $1
      WHERE home_team_id = ANY($2)
      RETURNING id
    `, [keepId, mergeIds]);

    const awayResult = await client.query(`
      UPDATE matches_v2
      SET away_team_id = $1
      WHERE away_team_id = ANY($2)
      RETURNING id
    `, [keepId, mergeIds]);

    totalMatchesMoved += homeResult.rowCount + awayResult.rowCount;

    // Delete the duplicate teams
    const deleteResult = await client.query(`
      DELETE FROM teams_v2 WHERE id = ANY($1) RETURNING id
    `, [mergeIds]);

    totalMerged += deleteResult.rowCount;
  }

  console.log(`\n✅ Phase 1 complete: ${totalMerged} duplicates merged, ${totalMatchesMoved} matches transferred, ${totalMatchesDeleted} duplicate matches deleted`);
  return { merged: totalMerged, matchesMoved: totalMatchesMoved, matchesDeleted: totalMatchesDeleted };
}

async function phase2MergeBlockers(client) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 2: Merge Blocking Teams');
  console.log('='.repeat(60));

  // Find teams where updating would conflict with an existing team
  // (the "blocker" has the birth_year we want to update to)
  const blockingPairs = await client.query(`
    WITH mismatched AS (
      SELECT
        t.id as wrong_id,
        t.display_name as wrong_name,
        t.birth_year as wrong_by,
        t.canonical_name,
        t.gender,
        t.state,
        (regexp_match(t.display_name, '(20[01][0-9])'))[1]::int as target_by
      FROM teams_v2 t
      WHERE t.display_name ~ '20[01][0-9]'
        AND t.birth_year IS NOT NULL
        AND t.birth_year != (regexp_match(t.display_name, '(20[01][0-9])'))[1]::int
    )
    SELECT
      m.wrong_id,
      m.wrong_name,
      m.wrong_by,
      m.target_by,
      blocker.id as blocker_id,
      blocker.display_name as blocker_name,
      blocker.birth_year as blocker_by
    FROM mismatched m
    JOIN teams_v2 blocker ON
      blocker.canonical_name = m.canonical_name
      AND blocker.gender = m.gender
      AND COALESCE(blocker.state, '') = COALESCE(m.state, '')
      AND blocker.birth_year = m.target_by
      AND blocker.id != m.wrong_id
    ORDER BY m.canonical_name
  `);

  console.log(`\nBlocking team pairs found: ${blockingPairs.rows.length}`);

  if (blockingPairs.rows.length === 0) {
    console.log('No blocking teams to merge.');
    return { merged: 0, matchesMoved: 0, matchesDeleted: 0 };
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Sample blocking pairs:');
    console.table(blockingPairs.rows.slice(0, 10).map(r => ({
      wrong: r.wrong_name.substring(0, 30),
      wrong_by: r.wrong_by,
      blocker: r.blocker_name.substring(0, 30),
      blocker_by: r.blocker_by,
      target: r.target_by
    })));
    return { merged: 0, wouldMerge: blockingPairs.rows.length };
  }

  // For each pair, merge the "wrong" team into the "blocker" (which has correct birth_year)
  let totalMerged = 0;
  let totalMatchesMoved = 0;
  let totalMatchesDeleted = 0;

  for (const pair of blockingPairs.rows) {
    const keepId = pair.blocker_id;
    const mergeId = pair.wrong_id;

    // Delete matches that would violate constraints
    const deleteSelfMatches = await client.query(`
      DELETE FROM matches_v2
      WHERE (home_team_id = $1 AND away_team_id = $2)
         OR (away_team_id = $1 AND home_team_id = $2)
      RETURNING id
    `, [keepId, mergeId]);

    const deleteHomeDupes = await client.query(`
      DELETE FROM matches_v2 m1
      WHERE m1.home_team_id = $2
        AND EXISTS (
          SELECT 1 FROM matches_v2 m2
          WHERE m2.home_team_id = $1
            AND m2.match_date = m1.match_date
            AND m2.away_team_id = m1.away_team_id
            AND m2.home_score = m1.home_score
            AND m2.away_score = m1.away_score
        )
      RETURNING id
    `, [keepId, mergeId]);

    const deleteAwayDupes = await client.query(`
      DELETE FROM matches_v2 m1
      WHERE m1.away_team_id = $2
        AND EXISTS (
          SELECT 1 FROM matches_v2 m2
          WHERE m2.away_team_id = $1
            AND m2.match_date = m1.match_date
            AND m2.home_team_id = m1.home_team_id
            AND m2.home_score = m1.home_score
            AND m2.away_score = m1.away_score
        )
      RETURNING id
    `, [keepId, mergeId]);

    totalMatchesDeleted += deleteSelfMatches.rowCount + deleteHomeDupes.rowCount + deleteAwayDupes.rowCount;

    // Transfer remaining matches
    const homeResult = await client.query(`
      UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2 RETURNING id
    `, [keepId, mergeId]);

    const awayResult = await client.query(`
      UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2 RETURNING id
    `, [keepId, mergeId]);

    totalMatchesMoved += homeResult.rowCount + awayResult.rowCount;

    // Delete the duplicate team
    await client.query(`DELETE FROM teams_v2 WHERE id = $1`, [mergeId]);
    totalMerged++;
  }

  console.log(`\n✅ Phase 2 complete: ${totalMerged} blocking teams merged, ${totalMatchesMoved} matches moved, ${totalMatchesDeleted} deleted`);
  return { merged: totalMerged, matchesMoved: totalMatchesMoved, matchesDeleted: totalMatchesDeleted };
}

async function phase3BatchUpdate(client) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 3: Batch Update Birth Years (SQL)');
  console.log('='.repeat(60));

  // Count mismatches
  const countResult = await client.query(`
    SELECT COUNT(*) as total
    FROM teams_v2
    WHERE display_name ~ '20[01][0-9]'
      AND birth_year IS NOT NULL
      AND birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int
  `);

  const totalToFix = parseInt(countResult.rows[0].total);
  console.log(`\nTeams with birth_year mismatch: ${totalToFix.toLocaleString()}`);

  if (totalToFix === 0) {
    console.log('No mismatches to fix.');
    return { updated: 0 };
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would update birth_year for these teams');

    const sample = await client.query(`
      SELECT LEFT(display_name, 50) as team, birth_year as current,
        (regexp_match(display_name, '(20[01][0-9])'))[1]::int as correct
      FROM teams_v2
      WHERE display_name ~ '20[01][0-9]'
        AND birth_year IS NOT NULL
        AND birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int
      LIMIT 10
    `);
    console.log('\nSample:');
    console.table(sample.rows);
    return { updated: 0, wouldUpdate: totalToFix };
  }

  // Single batch update - now safe because Phases 1&2 removed all blockers
  console.log('\nRunning batch update...');
  const updateResult = await client.query(`
    UPDATE teams_v2
    SET birth_year = (regexp_match(display_name, '(20[01][0-9])'))[1]::int
    WHERE display_name ~ '20[01][0-9]'
      AND birth_year IS NOT NULL
      AND birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int
    RETURNING id
  `);

  console.log(`\n✅ Phase 3 complete: ${updateResult.rowCount.toLocaleString()} teams updated`);
  return { updated: updateResult.rowCount };
}

async function phase4RefreshViews(client) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 4: Refresh Materialized Views');
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would call refresh_app_views()');
    return { refreshed: false };
  }

  console.log('\nRefreshing views...');
  const start = Date.now();
  await client.query('SELECT refresh_app_views()');
  const duration = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n✅ Phase 4 complete: Views refreshed in ${duration}s`);
  return { refreshed: true, durationSec: duration };
}

async function verifyResults(client) {
  console.log('\n' + '='.repeat(60));
  console.log('VERIFICATION');
  console.log('='.repeat(60));

  const stats = await client.query(`
    SELECT
      COUNT(*) as total_teams,
      COUNT(*) FILTER (WHERE birth_year IS NOT NULL) as has_birth_year,
      COUNT(*) FILTER (WHERE birth_year IS NULL) as null_birth_year,
      COUNT(*) FILTER (
        WHERE display_name ~ '20[01][0-9]'
          AND birth_year IS NOT NULL
          AND birth_year = (regexp_match(display_name, '(20[01][0-9])'))[1]::int
      ) as name_matches_birth_year,
      COUNT(*) FILTER (
        WHERE display_name ~ '20[01][0-9]'
          AND birth_year IS NOT NULL
          AND birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int
      ) as name_mismatch_birth_year
    FROM teams_v2
  `);

  const s = stats.rows[0];
  console.log(`
Total teams:                ${parseInt(s.total_teams).toLocaleString()}
Has birth_year:             ${parseInt(s.has_birth_year).toLocaleString()} (${(100 * s.has_birth_year / s.total_teams).toFixed(1)}%)
NULL birth_year:            ${parseInt(s.null_birth_year).toLocaleString()} (${(100 * s.null_birth_year / s.total_teams).toFixed(1)}%)
Name matches birth_year:    ${parseInt(s.name_matches_birth_year).toLocaleString()}
Name mismatches birth_year: ${parseInt(s.name_mismatch_birth_year).toLocaleString()}
`);

  return s;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       OPTIMIZED BIRTH YEAR CLEANUP (SQL Batch)             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
  }

  const client = await pool.connect();

  try {
    // Authorize writes to protected tables
    await authorizePipelineWrite(client);

    // Show initial state
    console.log('\n📊 INITIAL STATE:');
    await verifyResults(client);

    // Run phases
    const phase1 = await phase1MergeDuplicates(client);
    const phase2 = await phase2MergeBlockers(client);
    const phase3 = await phase3BatchUpdate(client);
    const phase4 = await phase4RefreshViews(client);

    // Show final state
    if (!DRY_RUN) {
      console.log('\n📊 FINAL STATE:');
      await verifyResults(client);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`
Phase 1 (Same-Target Dups): ${DRY_RUN ? `Would merge ${phase1.wouldMerge || 0}` : `${phase1.merged} merged, ${phase1.matchesMoved} matches moved`}
Phase 2 (Blocking Teams):   ${DRY_RUN ? `Would merge ${phase2.wouldMerge || 0}` : `${phase2.merged} merged, ${phase2.matchesMoved} matches moved`}
Phase 3 (Batch Update):     ${DRY_RUN ? `Would update ${phase3.wouldUpdate || 0}` : `${phase3.updated.toLocaleString()} teams`}
Phase 4 (Refresh Views):    ${DRY_RUN ? 'Would refresh' : `Completed in ${phase4.durationSec}s`}
`);

    if (DRY_RUN) {
      console.log('\n💡 Run without --dry-run to apply changes');
    } else {
      console.log('\n✅ Cleanup complete!');
    }

  } finally {
    client.release();
    pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
