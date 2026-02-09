/**
 * fixDataDisconnect.cjs
 *
 * Universal DATA-ONLY fix for the ranking/match disconnect issue.
 * OPTIMIZED FOR SPEED - processes thousands per minute using bulk SQL.
 *
 * ROOT CAUSES:
 * 1. 42,674 teams have incorrect stats (stored != actual from matches_v2)
 * 2. 25,674 teams have age group mismatches (birth_year vs display_name)
 * 3. 57,543 teams have GotSport rank but no matches (separate scraper sources)
 *
 * PHASES:
 * Phase 1: Recalculate team stats from matches_v2 (CRITICAL - fixes display issue)
 * Phase 2: Fix age group mismatches (ensures correct filter placement)
 * Phase 3: High-confidence duplicate merge (optional, slower)
 *
 * Usage:
 *   node scripts/maintenance/fixDataDisconnect.cjs --dry-run
 *   node scripts/maintenance/fixDataDisconnect.cjs --execute
 *   node scripts/maintenance/fixDataDisconnect.cjs --phase 1 --execute
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const PHASE_FILTER = args.includes('--phase')
  ? parseInt(args[args.indexOf('--phase') + 1])
  : null;

async function phase1_recalculateStats() {
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 1: RECALCULATE TEAM STATS FROM matches_v2 [BULK SQL]');
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Count mismatched teams first (fast)
  const countResult = await pool.query(`
    WITH actual_stats AS (
      SELECT
        team_id,
        COUNT(*) as matches,
        SUM(wins) as wins,
        SUM(losses) as losses,
        SUM(draws) as draws
      FROM (
        SELECT home_team_id as team_id,
          CASE WHEN home_score > away_score THEN 1 ELSE 0 END as wins,
          CASE WHEN home_score < away_score THEN 1 ELSE 0 END as losses,
          CASE WHEN home_score = away_score AND home_score IS NOT NULL THEN 1 ELSE 0 END as draws
        FROM matches_v2 WHERE home_score IS NOT NULL AND away_score IS NOT NULL
        UNION ALL
        SELECT away_team_id as team_id,
          CASE WHEN away_score > home_score THEN 1 ELSE 0 END as wins,
          CASE WHEN away_score < home_score THEN 1 ELSE 0 END as losses,
          CASE WHEN home_score = away_score AND away_score IS NOT NULL THEN 1 ELSE 0 END as draws
        FROM matches_v2 WHERE home_score IS NOT NULL AND away_score IS NOT NULL
      ) combined GROUP BY team_id
    )
    SELECT COUNT(*) as count
    FROM teams_v2 t
    LEFT JOIN actual_stats a ON t.id = a.team_id
    WHERE COALESCE(t.matches_played, 0) != COALESCE(a.matches, 0)
      OR COALESCE(t.wins, 0) != COALESCE(a.wins, 0)
      OR COALESCE(t.losses, 0) != COALESCE(a.losses, 0)
      OR COALESCE(t.draws, 0) != COALESCE(a.draws, 0)
  `);

  const count = parseInt(countResult.rows[0].count);
  console.log(`Found ${count.toLocaleString()} teams with incorrect stats`);

  if (count === 0) {
    console.log('No fixes needed');
    return { fixed: 0, durationMs: Date.now() - startTime };
  }

  if (DRY_RUN) {
    // Show samples
    const samples = await pool.query(`
      WITH actual_stats AS (
        SELECT team_id, COUNT(*) as matches, SUM(wins)::int as wins, SUM(losses)::int as losses, SUM(draws)::int as draws
        FROM (
          SELECT home_team_id as team_id,
            CASE WHEN home_score > away_score THEN 1 ELSE 0 END as wins,
            CASE WHEN home_score < away_score THEN 1 ELSE 0 END as losses,
            CASE WHEN home_score = away_score AND home_score IS NOT NULL THEN 1 ELSE 0 END as draws
          FROM matches_v2 WHERE home_score IS NOT NULL AND away_score IS NOT NULL
          UNION ALL
          SELECT away_team_id as team_id,
            CASE WHEN away_score > home_score THEN 1 ELSE 0 END as wins,
            CASE WHEN away_score < home_score THEN 1 ELSE 0 END as losses,
            CASE WHEN home_score = away_score AND away_score IS NOT NULL THEN 1 ELSE 0 END as draws
          FROM matches_v2 WHERE home_score IS NOT NULL AND away_score IS NOT NULL
        ) combined GROUP BY team_id
      )
      SELECT t.display_name, t.matches_played as stored_mp, t.wins as stored_w, t.losses as stored_l, t.draws as stored_d,
             COALESCE(a.matches, 0) as actual_mp, COALESCE(a.wins, 0) as actual_w, COALESCE(a.losses, 0) as actual_l, COALESCE(a.draws, 0) as actual_d
      FROM teams_v2 t LEFT JOIN actual_stats a ON t.id = a.team_id
      WHERE COALESCE(t.matches_played, 0) != COALESCE(a.matches, 0)
      LIMIT 5
    `);

    console.log('\nSamples:');
    samples.rows.forEach(r => {
      console.log(`  ${r.display_name.substring(0, 50)}`);
      console.log(`    Stored: ${r.stored_mp}mp, ${r.stored_w}W-${r.stored_l}L-${r.stored_d}D`);
      console.log(`    Actual: ${r.actual_mp}mp, ${r.actual_w}W-${r.actual_l}L-${r.actual_d}D`);
    });

    console.log(`\n[DRY RUN] Would fix ${count.toLocaleString()} teams`);
    return { wouldFix: count, durationMs: Date.now() - startTime };
  }

  // Execute SINGLE bulk update (no loops!)
  console.log('\nExecuting single bulk UPDATE...');
  const result = await pool.query(`
    WITH actual_stats AS (
      SELECT team_id, COUNT(*) as matches, SUM(wins)::int as wins, SUM(losses)::int as losses, SUM(draws)::int as draws
      FROM (
        SELECT home_team_id as team_id,
          CASE WHEN home_score > away_score THEN 1 ELSE 0 END as wins,
          CASE WHEN home_score < away_score THEN 1 ELSE 0 END as losses,
          CASE WHEN home_score = away_score AND home_score IS NOT NULL THEN 1 ELSE 0 END as draws
        FROM matches_v2 WHERE home_score IS NOT NULL AND away_score IS NOT NULL
        UNION ALL
        SELECT away_team_id as team_id,
          CASE WHEN away_score > home_score THEN 1 ELSE 0 END as wins,
          CASE WHEN away_score < home_score THEN 1 ELSE 0 END as losses,
          CASE WHEN home_score = away_score AND away_score IS NOT NULL THEN 1 ELSE 0 END as draws
        FROM matches_v2 WHERE home_score IS NOT NULL AND away_score IS NOT NULL
      ) combined GROUP BY team_id
    )
    UPDATE teams_v2 t SET
      matches_played = COALESCE(a.matches, 0),
      wins = COALESCE(a.wins, 0),
      losses = COALESCE(a.losses, 0),
      draws = COALESCE(a.draws, 0),
      updated_at = NOW()
    FROM actual_stats a
    WHERE t.id = a.team_id
      AND (COALESCE(t.matches_played, 0) != COALESCE(a.matches, 0)
        OR COALESCE(t.wins, 0) != COALESCE(a.wins, 0)
        OR COALESCE(t.losses, 0) != COALESCE(a.losses, 0)
        OR COALESCE(t.draws, 0) != COALESCE(a.draws, 0))
  `);

  const duration = Date.now() - startTime;
  const rate = Math.round(result.rowCount / (duration / 1000));
  console.log(`✅ Fixed ${result.rowCount.toLocaleString()} teams in ${(duration/1000).toFixed(1)}s (${rate.toLocaleString()} teams/sec)`);
  return { fixed: result.rowCount, durationMs: duration };
}

async function phase2_fixAgeGroups() {
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 2: FIX AGE GROUP MISMATCHES [BULK SQL]');
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Count mismatches (only those that won't create duplicates)
  const countResult = await pool.query(`
    WITH mismatched AS (
      SELECT
        t.id,
        t.canonical_name,
        t.gender,
        t.state,
        t.birth_year as current_birth_year,
        2026 - (regexp_match(t.display_name, '\\(U(\\d+)'))[1]::int as correct_birth_year
      FROM teams_v2 t
      WHERE t.birth_year IS NOT NULL
        AND t.display_name ~* '\\(U\\d+'
        AND (2026 - t.birth_year)::text != (regexp_match(t.display_name, '\\(U(\\d+)'))[1]
    )
    SELECT COUNT(*) as count
    FROM mismatched m
    WHERE NOT EXISTS (
      SELECT 1 FROM teams_v2 t2
      WHERE t2.canonical_name = m.canonical_name
        AND t2.birth_year = m.correct_birth_year
        AND t2.gender = m.gender
        AND t2.state = m.state
        AND t2.id != m.id
    )
  `);

  const count = parseInt(countResult.rows[0].count);
  console.log(`Found ${count.toLocaleString()} safe age group fixes (excludes duplicates)`);

  if (count === 0) {
    console.log('No safe fixes available');
    return { fixed: 0, durationMs: Date.now() - startTime };
  }

  if (DRY_RUN) {
    const samples = await pool.query(`
      WITH mismatched AS (
        SELECT
          t.id,
          t.display_name,
          t.canonical_name,
          t.gender,
          t.state,
          t.birth_year,
          2026 - (regexp_match(t.display_name, '\\(U(\\d+)'))[1]::int as correct_birth_year,
          (regexp_match(t.display_name, '\\(U(\\d+)'))[1] as display_age
        FROM teams_v2 t
        WHERE t.birth_year IS NOT NULL
          AND t.display_name ~* '\\(U\\d+'
          AND (2026 - t.birth_year)::text != (regexp_match(t.display_name, '\\(U(\\d+)'))[1]
      )
      SELECT m.display_name, m.birth_year, m.display_age, m.correct_birth_year
      FROM mismatched m
      WHERE NOT EXISTS (
        SELECT 1 FROM teams_v2 t2
        WHERE t2.canonical_name = m.canonical_name
          AND t2.birth_year = m.correct_birth_year
          AND t2.gender = m.gender
          AND t2.state = m.state
          AND t2.id != m.id
      )
      LIMIT 5
    `);

    console.log('\nSamples:');
    samples.rows.forEach(r => {
      console.log(`  ${r.display_name.substring(0, 55)}`);
      console.log(`    Current birth=${r.birth_year} (U${2026 - r.birth_year}), Display says U${r.display_age} → should be ${r.correct_birth_year}`);
    });

    console.log(`\n[DRY RUN] Would fix ${count.toLocaleString()} teams`);
    return { wouldFix: count, durationMs: Date.now() - startTime };
  }

  // Execute bulk update (only safe changes that won't violate unique constraint)
  console.log('\nExecuting bulk UPDATE (safe changes only)...');
  const result = await pool.query(`
    WITH mismatched AS (
      SELECT
        t.id,
        t.canonical_name,
        t.gender,
        t.state,
        2026 - (regexp_match(t.display_name, '\\(U(\\d+)'))[1]::int as correct_birth_year
      FROM teams_v2 t
      WHERE t.birth_year IS NOT NULL
        AND t.display_name ~* '\\(U\\d+'
        AND (2026 - t.birth_year)::text != (regexp_match(t.display_name, '\\(U(\\d+)'))[1]
    ),
    safe_updates AS (
      SELECT m.id, m.correct_birth_year
      FROM mismatched m
      WHERE NOT EXISTS (
        SELECT 1 FROM teams_v2 t2
        WHERE t2.canonical_name = m.canonical_name
          AND t2.birth_year = m.correct_birth_year
          AND t2.gender = m.gender
          AND t2.state = m.state
          AND t2.id != m.id
      )
    )
    UPDATE teams_v2 t SET
      birth_year = s.correct_birth_year,
      updated_at = NOW()
    FROM safe_updates s
    WHERE t.id = s.id
  `);

  const duration = Date.now() - startTime;
  const rate = result.rowCount > 0 ? Math.round(result.rowCount / (duration / 1000)) : 0;
  console.log(`✅ Fixed ${result.rowCount.toLocaleString()} teams in ${(duration/1000).toFixed(1)}s (${rate.toLocaleString()} teams/sec)`);
  return { fixed: result.rowCount, durationMs: duration };
}

async function phase3_mergeDuplicates() {
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 3: MERGE HIGH-CONFIDENCE DUPLICATES [TARGETED]');
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Only merge EXACT name matches with different IDs
  // This is much faster than similarity() and catches the most egregious dupes
  const duplicates = await pool.query(`
    WITH team_with_matches AS (
      SELECT DISTINCT
        t.id,
        t.display_name,
        t.birth_year,
        t.gender,
        t.gotsport_rank,
        t.national_rank,
        t.state_rank,
        regexp_replace(lower(t.display_name), '\\s+', '', 'g') as norm_name,
        (SELECT COUNT(*) FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id) as match_count
      FROM teams_v2 t
      WHERE t.birth_year IS NOT NULL AND t.gender IS NOT NULL
    )
    SELECT
      t1.id as keep_id, t1.display_name as keep_name, t1.match_count as keep_matches,
      t1.gotsport_rank as keep_gs, t1.national_rank as keep_nat,
      t2.id as merge_id, t2.display_name as merge_name, t2.match_count as merge_matches,
      t2.gotsport_rank as merge_gs, t2.national_rank as merge_nat
    FROM team_with_matches t1
    JOIN team_with_matches t2 ON
      t1.norm_name = t2.norm_name
      AND t1.birth_year = t2.birth_year
      AND t1.gender = t2.gender
      AND t1.id < t2.id
    WHERE t1.match_count > 0 AND t2.match_count = 0
      AND (t2.gotsport_rank IS NOT NULL OR t2.national_rank IS NOT NULL)
    LIMIT 5000
  `);

  const count = duplicates.rows.length;
  console.log(`Found ${count.toLocaleString()} exact-name duplicate pairs`);

  if (count === 0) {
    console.log('No duplicates to merge');
    return { merged: 0, durationMs: Date.now() - startTime };
  }

  if (DRY_RUN) {
    console.log('\nSamples:');
    duplicates.rows.slice(0, 5).forEach(r => {
      console.log(`  KEEP (${r.keep_matches}mp): ${r.keep_name.substring(0, 45)}`);
      console.log(`  MERGE (${r.merge_matches}mp): ${r.merge_name.substring(0, 45)} [GS:#${r.merge_nat}]`);
      console.log('');
    });

    console.log(`[DRY RUN] Would merge ${count.toLocaleString()} duplicate pairs`);
    return { wouldMerge: count, durationMs: Date.now() - startTime };
  }

  // Execute bulk merge
  console.log('\nExecuting bulk merge...');
  const keepIds = duplicates.rows.map(d => d.keep_id);
  const mergeIds = duplicates.rows.map(d => d.merge_id);

  // Step 1: Transfer GS ranks
  await pool.query(`
    WITH merge_map AS (
      SELECT unnest($1::uuid[]) as keep_id, unnest($2::uuid[]) as merge_id
    )
    -- RANK PRESERVATION: LEAST keeps best (lowest) rank
    UPDATE teams_v2 t SET
      gotsport_rank = LEAST(t.gotsport_rank, m2.gotsport_rank),
      national_rank = LEAST(t.national_rank, m2.national_rank),
      state_rank = LEAST(t.state_rank, m2.state_rank),
      updated_at = NOW()
    FROM merge_map mm JOIN teams_v2 m2 ON m2.id = mm.merge_id
    WHERE t.id = mm.keep_id
  `, [keepIds, mergeIds]);

  // Step 2: Delete merged teams
  const deleteResult = await pool.query(`DELETE FROM teams_v2 WHERE id = ANY($1::uuid[])`, [mergeIds]);

  const duration = Date.now() - startTime;
  const rate = Math.round(deleteResult.rowCount / (duration / 1000));
  console.log(`✅ Merged ${deleteResult.rowCount.toLocaleString()} teams in ${(duration/1000).toFixed(1)}s (${rate.toLocaleString()} teams/sec)`);
  return { merged: deleteResult.rowCount, durationMs: duration };
}

async function main() {
  console.log('='.repeat(70));
  console.log('DATA DISCONNECT FIX - ' + (DRY_RUN ? 'DRY RUN' : 'EXECUTING'));
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'LIVE EXECUTION'}`);
  if (PHASE_FILTER) console.log(`Running only Phase ${PHASE_FILTER}`);

  // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
  if (!DRY_RUN) {
    console.log('🔐 Authorizing pipeline writes...');
    await authorizePipelineWrite(pool);
    console.log('✅ Pipeline write authorization granted\n');
  }

  const results = {};
  const totalStart = Date.now();

  try {
    if (!PHASE_FILTER || PHASE_FILTER === 1) {
      results.phase1 = await phase1_recalculateStats();
    }

    if (!PHASE_FILTER || PHASE_FILTER === 2) {
      results.phase2 = await phase2_fixAgeGroups();
    }

    if (!PHASE_FILTER || PHASE_FILTER === 3) {
      results.phase3 = await phase3_mergeDuplicates();
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('FIX SUMMARY');
    console.log('='.repeat(70));
    console.log(JSON.stringify(results, null, 2));
    console.log(`\nTotal time: ${((Date.now() - totalStart) / 1000).toFixed(1)}s`);

    if (DRY_RUN) {
      console.log('\n⚠️  DRY RUN - No changes made. Use --execute to apply fixes.');
    } else {
      console.log('\n✅ All fixes applied successfully!');
      console.log('\nRefreshing materialized views...');
      await pool.query('SELECT refresh_app_views()');
      console.log('Views refreshed.');
    }

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
