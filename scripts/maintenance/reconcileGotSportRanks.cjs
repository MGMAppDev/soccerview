/**
 * reconcileGotSportRanks.cjs
 *
 * UNIVERSAL Layer 2 fix for GotSport ranking disconnect.
 *
 * ROOT CAUSE: GotSport rankings were imported via a separate path that created
 * NEW team entries instead of updating existing teams with match data.
 *
 * SOLUTION: This script reconciles GotSport-ranked teams with match-having teams:
 * 1. Find teams with GotSport rank but 0 actual matches
 * 2. Fuzzy match to teams WITH matches (same birth_year + gender + similar name)
 * 3. Transfer GotSport rank to the team WITH matches
 * 4. Delete the orphaned GotSport-only team entries
 *
 * UNIVERSAL: Uses the same fuzzy matching logic as dataQualityEngine.js
 * FAST: Bulk SQL operations - processes thousands per minute
 *
 * Usage:
 *   node scripts/maintenance/reconcileGotSportRanks.cjs --dry-run
 *   node scripts/maintenance/reconcileGotSportRanks.cjs --execute
 *   node scripts/maintenance/reconcileGotSportRanks.cjs --stats
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const STATS_ONLY = args.includes('--stats');

// Module-level client for session variable persistence
let client = null;
const query = async (...args) => {
  if (client) return client.query(...args);
  return pool.query(...args);
};

async function showStats() {
  console.log('='.repeat(70));
  console.log('GOTSPORT RANKING DATA INTEGRITY REPORT');
  console.log('='.repeat(70));

  const stats = await query(`
    WITH team_match_counts AS (
      SELECT
        t.id,
        t.display_name,
        t.canonical_name,
        t.birth_year,
        t.gender,
        t.state,
        t.national_rank,
        t.state_rank,
        t.elo_rating,
        (SELECT COUNT(*) FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id) as actual_matches
      FROM teams_v2 t
    )
    SELECT
      COUNT(*) as total_teams,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as teams_with_gs_rank,
      COUNT(*) FILTER (WHERE actual_matches > 0) as teams_with_matches,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND actual_matches > 0) as gs_rank_and_matches,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND actual_matches = 0) as gs_rank_no_matches,
      COUNT(*) FILTER (WHERE national_rank IS NULL AND actual_matches > 0) as matches_no_gs_rank
    FROM team_match_counts
  `);

  const s = stats.rows[0];
  console.log(`
Total teams:                    ${parseInt(s.total_teams).toLocaleString()}
Teams with GotSport rank:       ${parseInt(s.teams_with_gs_rank).toLocaleString()}
Teams with matches:             ${parseInt(s.teams_with_matches).toLocaleString()}
GS rank WITH matches:           ${parseInt(s.gs_rank_and_matches).toLocaleString()} ✅
GS rank WITHOUT matches:        ${parseInt(s.gs_rank_no_matches).toLocaleString()} ⚠️  (orphaned)
Matches WITHOUT GS rank:        ${parseInt(s.matches_no_gs_rank).toLocaleString()}
`);

  // Show sample orphaned teams
  const orphaned = await query(`
    SELECT
      t.id,
      t.display_name,
      t.birth_year,
      t.gender,
      t.state,
      t.national_rank,
      t.state_rank
    FROM teams_v2 t
    WHERE t.national_rank IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id)
    ORDER BY t.national_rank ASC
    LIMIT 10
  `);

  console.log('Top 10 orphaned GotSport-ranked teams (rank but no matches):');
  orphaned.rows.forEach(r => {
    console.log(`  #${r.national_rank} ${r.display_name.substring(0, 50)}`);
    console.log(`    birth=${r.birth_year}, gender=${r.gender}, state=${r.state}`);
  });

  return s;
}

async function findMergeCandidates() {
  console.log('\nFinding merge candidates...');

  // Find orphaned GS-ranked teams that can be merged with match-having teams
  // Using similarity() for fuzzy name matching (same as dataQualityEngine)
  const candidates = await query(`
    WITH orphaned AS (
      SELECT
        t.id,
        t.display_name,
        t.canonical_name,
        t.birth_year,
        t.gender,
        t.state,
        t.national_rank,
        t.state_rank,
        regexp_replace(lower(t.canonical_name), '[^a-z0-9]', '', 'g') as norm_name
      FROM teams_v2 t
      WHERE t.national_rank IS NOT NULL
        AND t.birth_year IS NOT NULL
        AND t.gender IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id)
    ),
    with_matches AS (
      SELECT
        t.id,
        t.display_name,
        t.canonical_name,
        t.birth_year,
        t.gender,
        t.state,
        t.national_rank,
        t.elo_rating,
        (SELECT COUNT(*) FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id) as match_count,
        regexp_replace(lower(t.canonical_name), '[^a-z0-9]', '', 'g') as norm_name
      FROM teams_v2 t
      WHERE t.birth_year IS NOT NULL
        AND t.gender IS NOT NULL
        AND EXISTS (SELECT 1 FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id)
    )
    SELECT
      o.id as orphan_id,
      o.display_name as orphan_name,
      o.national_rank as orphan_gs_rank,
      o.state_rank as orphan_state_rank,
      w.id as target_id,
      w.display_name as target_name,
      w.match_count as target_matches,
      w.national_rank as target_gs_rank,
      w.elo_rating as target_elo,
      similarity(o.norm_name, w.norm_name) as name_similarity
    FROM orphaned o
    JOIN with_matches w ON
      o.birth_year = w.birth_year
      AND o.gender = w.gender
      AND similarity(o.norm_name, w.norm_name) > 0.6
    WHERE w.national_rank IS NULL  -- Only merge into teams that don't already have GS rank
    ORDER BY o.national_rank ASC, name_similarity DESC
  `);

  console.log(`Found ${candidates.rows.length} merge candidates\n`);

  // Deduplicate - one orphan can match multiple targets, pick best
  const seen = new Set();
  const dedupedCandidates = [];
  for (const c of candidates.rows) {
    if (!seen.has(c.orphan_id)) {
      seen.add(c.orphan_id);
      dedupedCandidates.push(c);
    }
  }

  console.log(`After deduplication: ${dedupedCandidates.length} unique merges\n`);
  return dedupedCandidates;
}

async function executeMerges(candidates, dryRun) {
  console.log('='.repeat(70));
  console.log(dryRun ? 'DRY RUN - Merge Preview' : 'EXECUTING Merges');
  console.log('='.repeat(70));

  if (candidates.length === 0) {
    console.log('No candidates to merge.');
    return { merged: 0 };
  }

  // Show samples
  console.log('\nSample merges (first 10):');
  candidates.slice(0, 10).forEach(c => {
    console.log(`  ORPHAN: #${c.orphan_gs_rank} ${c.orphan_name.substring(0, 45)}`);
    console.log(`  TARGET: ${c.target_name.substring(0, 45)} (${c.target_matches} matches)`);
    console.log(`    Similarity: ${(c.name_similarity * 100).toFixed(1)}%`);
    console.log('');
  });

  if (dryRun) {
    console.log(`\n[DRY RUN] Would merge ${candidates.length} orphaned GS-ranked teams`);
    return { wouldMerge: candidates.length };
  }

  // Execute bulk merge using arrays
  console.log('\nExecuting bulk merge...');

  const orphanIds = candidates.map(c => c.orphan_id);
  const targetIds = candidates.map(c => c.target_id);
  const gsRanks = candidates.map(c => c.orphan_gs_rank);
  const stateRanks = candidates.map(c => c.orphan_state_rank);

  // Step 1: Transfer GotSport ranks to target teams
  console.log('  Step 1: Transferring GotSport ranks to target teams...');
  await query(`
    WITH merge_data AS (
      SELECT
        unnest($1::uuid[]) as target_id,
        unnest($2::int[]) as gs_rank,
        unnest($3::int[]) as state_rank
    )
    UPDATE teams_v2 t
    SET
      national_rank = md.gs_rank,
      state_rank = md.state_rank,
      updated_at = NOW()
    FROM merge_data md
    WHERE t.id = md.target_id
  `, [targetIds, gsRanks, stateRanks]);

  // Step 2: Delete orphaned teams
  console.log('  Step 2: Deleting orphaned GS-only teams...');
  const deleteResult = await query(`
    DELETE FROM teams_v2
    WHERE id = ANY($1::uuid[])
  `, [orphanIds]);

  console.log(`\n✅ Merged ${deleteResult.rowCount} orphaned GS-ranked teams`);
  return { merged: deleteResult.rowCount };
}

async function main() {
  console.log('='.repeat(70));
  console.log('GOTSPORT RANKING RECONCILIATION');
  console.log('='.repeat(70));
  console.log(`Mode: ${STATS_ONLY ? 'STATS ONLY' : (DRY_RUN ? 'DRY RUN' : 'EXECUTE')}`);
  console.log('');

  const startTime = Date.now();

  // Acquire client and authorize for writes
  client = await pool.connect();
  await authorizePipelineWrite(client);

  try {
    // Always show stats first
    const stats = await showStats();

    if (STATS_ONLY) {
      return;
    }

    // Find merge candidates
    const candidates = await findMergeCandidates();

    // Execute merges
    const result = await executeMerges(candidates, DRY_RUN);

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('RECONCILIATION SUMMARY');
    console.log('='.repeat(70));
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log(JSON.stringify(result, null, 2));

    if (DRY_RUN) {
      console.log('\n⚠️  DRY RUN - No changes made. Use --execute to apply.');
    } else {
      console.log('\n✅ Reconciliation complete!');

      // Refresh views
      console.log('\nRefreshing materialized views...');
      try {
        await query('SELECT refresh_app_views()');
        console.log('Views refreshed.');
      } catch (err) {
        console.log(`View refresh failed: ${err.message}`);
      }
    }

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
