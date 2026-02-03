/**
 * mergeCanonicalDuplicates.cjs
 *
 * V2 ARCHITECTURE COMPLIANT:
 * Uses canonical_teams registry to find and merge duplicate teams.
 *
 * Follows GUARDRAILS principle:
 * "Always use canonical_teams, canonical_events, canonical_clubs for deduplication"
 *
 * Only merges SIMPLE cases where:
 * - Same canonical_name + birth_year + gender
 * - Only ONE team has matches (safe to merge orphans into it)
 *
 * Usage:
 *   node scripts/maintenance/mergeCanonicalDuplicates.cjs --dry-run
 *   node scripts/maintenance/mergeCanonicalDuplicates.cjs --execute
 *   node scripts/maintenance/mergeCanonicalDuplicates.cjs --report-complex
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const REPORT_COMPLEX = args.includes('--report-complex');
const MERGE_COMPLEX = args.includes('--merge-complex');

async function findSimpleMerges() {
  console.log('=== V2-COMPLIANT CANONICAL DUPLICATE MERGE ===\n');

  // Find duplicate groups in canonical_teams
  const { rows: dupeGroups } = await pool.query(`
    SELECT
      canonical_name,
      birth_year,
      gender,
      array_agg(team_v2_id ORDER BY team_v2_id) as team_ids,
      COUNT(*) as count
    FROM canonical_teams
    WHERE birth_year IS NOT NULL AND gender IS NOT NULL
    GROUP BY canonical_name, birth_year, gender
    HAVING COUNT(*) > 1
  `);

  console.log(`Total duplicate groups: ${dupeGroups.length}`);

  const simpleMerges = [];
  const complexMerges = [];
  const noMatchGroups = [];

  for (const group of dupeGroups) {
    // Get match counts for each team
    const { rows } = await pool.query(`
      SELECT
        t.id,
        t.display_name,
        t.national_rank,
        t.state_rank,
        (SELECT COUNT(*) FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id) as match_count
      FROM teams_v2 t
      WHERE t.id = ANY($1)
      ORDER BY match_count DESC
    `, [group.team_ids]);

    const teamsWithMatches = rows.filter(r => parseInt(r.match_count) > 0);

    if (teamsWithMatches.length === 0) {
      // No teams have matches - pick first as canonical
      noMatchGroups.push({
        ...group,
        keepTeam: rows[0],
        mergeTeams: rows.slice(1)
      });
    } else if (teamsWithMatches.length === 1) {
      // Simple merge - only one has matches
      const keepTeam = teamsWithMatches[0];
      const mergeTeams = rows.filter(r => r.id !== keepTeam.id);
      simpleMerges.push({
        ...group,
        keepTeam,
        mergeTeams
      });
    } else {
      // Complex - multiple have matches, may be different clubs
      complexMerges.push({
        ...group,
        teams: rows
      });
    }
  }

  console.log(`\nSimple merges (ONE team has matches): ${simpleMerges.length}`);
  console.log(`Complex merges (MULTIPLE teams have matches): ${complexMerges.length}`);
  console.log(`No-match groups (pick first as canonical): ${noMatchGroups.length}`);

  return { simpleMerges, complexMerges, noMatchGroups };
}

async function executeSimpleMerges(simpleMerges, noMatchGroups) {
  if (DRY_RUN) {
    console.log('\n=== DRY RUN - SIMPLE MERGES ===\n');
    console.log('Sample merges (first 10):');
    simpleMerges.slice(0, 10).forEach((m, i) => {
      console.log(`\n${i + 1}. Keep: ${m.keepTeam.display_name} (${m.keepTeam.match_count} matches)`);
      m.mergeTeams.forEach(t => {
        console.log(`   Merge: ${t.display_name} (${t.match_count} matches, rank: #${t.national_rank || 'N/A'})`);
      });
    });

    const totalMerges = simpleMerges.reduce((sum, m) => sum + m.mergeTeams.length, 0) +
                        noMatchGroups.reduce((sum, m) => sum + m.mergeTeams.length, 0);
    console.log(`\n[DRY RUN] Would merge ${totalMerges} teams into ${simpleMerges.length + noMatchGroups.length} canonical teams`);
    return;
  }

  // Execute merges
  console.log('\n=== EXECUTING MERGES ===\n');

  // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes
  console.log('🔐 Authorizing pipeline writes...');
  await authorizePipelineWrite(pool);
  console.log('✅ Pipeline write authorization granted\n');

  let mergeCount = 0;
  let errorCount = 0;

  // Process simple merges
  const allMerges = [...simpleMerges, ...noMatchGroups];

  for (const merge of allMerges) {
    const keepId = merge.keepTeam.id;
    const mergeIds = merge.mergeTeams.map(t => t.id);

    try {
      // Transfer any matches from merged teams to keep team
      const { rowCount: homeUpdated } = await pool.query(`
        UPDATE matches_v2
        SET home_team_id = $1
        WHERE home_team_id = ANY($2)
      `, [keepId, mergeIds]);

      const { rowCount: awayUpdated } = await pool.query(`
        UPDATE matches_v2
        SET away_team_id = $1
        WHERE away_team_id = ANY($2)
      `, [keepId, mergeIds]);

      // Transfer GotSport rankings (keep highest)
      await pool.query(`
        UPDATE teams_v2 t
        SET
          national_rank = LEAST(t.national_rank, m.min_national_rank),
          state_rank = LEAST(t.state_rank, m.min_state_rank)
        FROM (
          SELECT
            COALESCE(MIN(national_rank), 99999) as min_national_rank,
            COALESCE(MIN(state_rank), 99999) as min_state_rank
          FROM teams_v2
          WHERE id = ANY($2)
          AND (national_rank IS NOT NULL OR state_rank IS NOT NULL)
        ) m
        WHERE t.id = $1
        AND (m.min_national_rank < 99999 OR m.min_state_rank < 99999)
      `, [keepId, mergeIds]);

      // Update canonical_teams to point all to keep team
      await pool.query(`
        UPDATE canonical_teams
        SET team_v2_id = $1
        WHERE team_v2_id = ANY($2)
      `, [keepId, mergeIds]);

      // Delete merged teams
      await pool.query(`
        DELETE FROM teams_v2
        WHERE id = ANY($1)
      `, [mergeIds]);

      mergeCount += mergeIds.length;

      if (mergeCount % 100 === 0) {
        console.log(`  Merged ${mergeCount} teams...`);
      }
    } catch (err) {
      console.error(`  Error merging ${merge.canonical_name}: ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n✅ Merged ${mergeCount} teams (${errorCount} errors)`);
}

async function reportComplexMerges(complexMerges) {
  console.log('\n=== COMPLEX MERGES (NEED MANUAL REVIEW) ===\n');
  console.log('These groups have MULTIPLE teams with matches - may be different clubs:\n');

  complexMerges.slice(0, 20).forEach((m, i) => {
    console.log(`${i + 1}. ${m.canonical_name} (${m.birth_year}, ${m.gender})`);
    m.teams.forEach(t => {
      console.log(`   - ${t.display_name} (${t.match_count} matches, rank: #${t.national_rank || 'N/A'})`);
    });
    console.log();
  });

  if (complexMerges.length > 20) {
    console.log(`... and ${complexMerges.length - 20} more groups`);
  }

  console.log('\nUse scripts/maintenance/mergeTeams.js to manually review and merge these.');
}

async function executeComplexMerges(complexMerges) {
  console.log('\n=== MERGING COMPLEX DUPLICATES ===\n');
  console.log('Keeping team with most matches, transferring match history from others.\n');

  if (DRY_RUN) {
    console.log('Sample complex merges (first 10):');
    complexMerges.slice(0, 10).forEach((m, i) => {
      const sorted = m.teams.sort((a, b) => parseInt(b.match_count) - parseInt(a.match_count));
      const keepTeam = sorted[0];
      const mergeTeams = sorted.slice(1);
      console.log(`\n${i + 1}. Keep: ${keepTeam.display_name} (${keepTeam.match_count} matches)`);
      mergeTeams.forEach(t => {
        console.log(`   Transfer from: ${t.display_name} (${t.match_count} matches)`);
      });
    });

    const totalTransfers = complexMerges.reduce((sum, m) => sum + m.teams.length - 1, 0);
    console.log(`\n[DRY RUN] Would merge ${totalTransfers} teams into ${complexMerges.length} canonical teams`);
    return;
  }

  // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes
  console.log('🔐 Authorizing pipeline writes...');
  await authorizePipelineWrite(pool);
  console.log('✅ Pipeline write authorization granted\n');

  let mergeCount = 0;
  let matchesTransferred = 0;
  let errorCount = 0;

  for (const group of complexMerges) {
    // Sort by match count - keep the one with most matches
    const sorted = group.teams.sort((a, b) => parseInt(b.match_count) - parseInt(a.match_count));
    const keepTeam = sorted[0];
    const mergeTeams = sorted.slice(1);
    const mergeIds = mergeTeams.map(t => t.id);

    try {
      // Transfer matches from merged teams to keep team
      const { rowCount: homeUpdated } = await pool.query(`
        UPDATE matches_v2
        SET home_team_id = $1
        WHERE home_team_id = ANY($2)
      `, [keepTeam.id, mergeIds]);

      const { rowCount: awayUpdated } = await pool.query(`
        UPDATE matches_v2
        SET away_team_id = $1
        WHERE away_team_id = ANY($2)
      `, [keepTeam.id, mergeIds]);

      matchesTransferred += homeUpdated + awayUpdated;

      // Transfer GotSport rankings (keep best)
      await pool.query(`
        UPDATE teams_v2 t
        SET
          national_rank = LEAST(t.national_rank, m.min_national_rank),
          state_rank = LEAST(t.state_rank, m.min_state_rank)
        FROM (
          SELECT
            COALESCE(MIN(national_rank), 99999) as min_national_rank,
            COALESCE(MIN(state_rank), 99999) as min_state_rank
          FROM teams_v2
          WHERE id = ANY($2)
          AND (national_rank IS NOT NULL OR state_rank IS NOT NULL)
        ) m
        WHERE t.id = $1
        AND (m.min_national_rank < 99999 OR m.min_state_rank < 99999)
      `, [keepTeam.id, mergeIds]);

      // Update canonical_teams to point all to keep team
      await pool.query(`
        UPDATE canonical_teams
        SET team_v2_id = $1
        WHERE team_v2_id = ANY($2)
      `, [keepTeam.id, mergeIds]);

      // Delete merged teams
      await pool.query(`
        DELETE FROM teams_v2
        WHERE id = ANY($1)
      `, [mergeIds]);

      mergeCount += mergeIds.length;

      if (mergeCount % 50 === 0) {
        console.log(`  Merged ${mergeCount} teams (${matchesTransferred} matches transferred)...`);
      }
    } catch (err) {
      console.error(`  Error merging ${group.canonical_name}: ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n✅ Merged ${mergeCount} teams, transferred ${matchesTransferred} matches (${errorCount} errors)`);
}

async function main() {
  try {
    const { simpleMerges, complexMerges, noMatchGroups } = await findSimpleMerges();

    if (REPORT_COMPLEX) {
      await reportComplexMerges(complexMerges);
    } else if (MERGE_COMPLEX) {
      await executeComplexMerges(complexMerges);
    } else {
      await executeSimpleMerges(simpleMerges, noMatchGroups);
    }

    await pool.end();
  } catch (err) {
    console.error('Fatal error:', err);
    await pool.end();
    process.exit(1);
  }
}

main();
