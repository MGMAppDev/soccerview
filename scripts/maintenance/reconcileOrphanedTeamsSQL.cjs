/**
 * reconcileOrphanedTeamsSQL.cjs
 *
 * FAST UNIVERSAL reconciliation using pure SQL.
 *
 * Uses V2 architecture: Matches orphaned teams via canonical_teams registry
 * using normalized names (canonical_name + birth_year + gender + state).
 *
 * FAST: Pure SQL operations - processes in seconds, not minutes.
 *
 * Usage:
 *   node scripts/maintenance/reconcileOrphanedTeamsSQL.cjs --stats
 *   node scripts/maintenance/reconcileOrphanedTeamsSQL.cjs --dry-run
 *   node scripts/maintenance/reconcileOrphanedTeamsSQL.cjs --execute
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
  console.log('ORPHANED TEAMS STATUS');
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Fast count using materialized counts
  const stats = await query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2) as total_teams,
      (SELECT COUNT(*) FROM canonical_teams) as canonical_count,
      (SELECT COUNT(*) FROM teams_v2 WHERE national_rank IS NOT NULL) as gs_ranked
  `);

  // Orphan count with LIMIT optimization
  const orphanCount = await query(`
    SELECT COUNT(*) FROM teams_v2 t
    WHERE t.national_rank IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM matches_v2 m
        WHERE m.home_team_id = t.id OR m.away_team_id = t.id
        LIMIT 1
      )
  `);

  const s = stats.rows[0];
  console.log(`
Total teams:           ${parseInt(s.total_teams).toLocaleString()}
Canonical registry:    ${parseInt(s.canonical_count).toLocaleString()}
GS-ranked teams:       ${parseInt(s.gs_ranked).toLocaleString()}
Orphaned (GS rank, no matches): ${parseInt(orphanCount.rows[0].count).toLocaleString()} ⚠️
Query time: ${((Date.now() - startTime) / 1000).toFixed(1)}s
`);
  return parseInt(orphanCount.rows[0].count);
}

async function findMatches() {
  console.log('='.repeat(70));
  console.log('FINDING MATCHES VIA CANONICAL REGISTRY');
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Find orphaned teams that can be matched to teams WITH matches
  // via the canonical_teams registry (exact match on canonical_name + birth_year + gender + state)
  const { rows: matches } = await query(`
    WITH orphaned AS (
      SELECT t.id, t.canonical_name, t.birth_year, t.gender, t.state,
             t.national_rank, t.state_rank, t.display_name
      FROM teams_v2 t
      WHERE t.national_rank IS NOT NULL
        AND t.birth_year IS NOT NULL
        AND t.gender IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1
        )
    ),
    with_matches AS (
      SELECT DISTINCT t.id, t.canonical_name, t.birth_year, t.gender, t.state
      FROM teams_v2 t
      WHERE EXISTS (
        SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1
      )
    )
    SELECT
      o.id as orphan_id,
      o.display_name as orphan_name,
      o.national_rank as orphan_gs_rank,
      o.state_rank as orphan_state_rank,
      wm.id as target_id
    FROM orphaned o
    JOIN with_matches wm ON
      o.canonical_name = wm.canonical_name
      AND o.birth_year = wm.birth_year
      AND o.gender = wm.gender
      AND (o.state = wm.state OR o.state IS NULL OR wm.state IS NULL)
    WHERE o.id != wm.id
    ORDER BY o.national_rank ASC
  `);

  console.log(`Found ${matches.length.toLocaleString()} exact matches in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  return matches;
}

async function executeMerges(matches, dryRun) {
  console.log('\n' + '='.repeat(70));
  console.log(dryRun ? 'MERGE PREVIEW (DRY RUN)' : 'EXECUTING MERGES');
  console.log('='.repeat(70));

  if (matches.length === 0) {
    console.log('No matches to merge.');
    return { merged: 0 };
  }

  // Show samples
  console.log('\nSample merges (first 10):');
  for (const m of matches.slice(0, 10)) {
    console.log(`  #${m.orphan_gs_rank}: ${m.orphan_name?.substring(0, 50)}`);
    console.log(`    → Target: ${m.target_id}`);
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Would merge ${matches.length.toLocaleString()} orphaned teams`);
    return { wouldMerge: matches.length };
  }

  const startTime = Date.now();

  // Dedupe - one orphan may match multiple targets
  const seenOrphans = new Set();
  const uniqueMatches = matches.filter(m => {
    if (seenOrphans.has(m.orphan_id)) return false;
    seenOrphans.add(m.orphan_id);
    return true;
  });

  console.log(`\nUnique matches after dedup: ${uniqueMatches.length.toLocaleString()}`);

  const orphanIds = uniqueMatches.map(m => m.orphan_id);
  const targetIds = uniqueMatches.map(m => m.target_id);
  const gsRanks = uniqueMatches.map(m => m.orphan_gs_rank);
  const stateRanks = uniqueMatches.map(m => m.orphan_state_rank);

  // Step 1: Transfer ranks
  console.log('Step 1: Transferring GotSport ranks to target teams...');
  await query(`
    WITH merge_data AS (
      SELECT
        unnest($1::uuid[]) as target_id,
        unnest($2::int[]) as gs_rank,
        unnest($3::int[]) as state_rank
    )
    UPDATE teams_v2 t
    SET
      national_rank = COALESCE(t.national_rank, md.gs_rank),
      state_rank = COALESCE(t.state_rank, md.state_rank),
      updated_at = NOW()
    FROM merge_data md
    WHERE t.id = md.target_id
  `, [targetIds, gsRanks, stateRanks]);

  // Step 2: Update canonical_teams to point to target
  console.log('Step 2: Updating canonical_teams registry...');
  await query(`
    WITH merge_data AS (
      SELECT
        unnest($1::uuid[]) as orphan_id,
        unnest($2::uuid[]) as target_id
    )
    UPDATE canonical_teams ct
    SET team_v2_id = md.target_id
    FROM merge_data md
    WHERE ct.team_v2_id = md.orphan_id
  `, [orphanIds, targetIds]);

  // Step 3: Delete orphaned teams
  console.log('Step 3: Deleting orphaned teams...');
  const deleteResult = await query(`
    DELETE FROM teams_v2 WHERE id = ANY($1::uuid[])
  `, [orphanIds]);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Merged ${deleteResult.rowCount} orphaned teams in ${duration}s`);

  return { merged: deleteResult.rowCount };
}

async function main() {
  console.log('='.repeat(70));
  console.log('UNIVERSAL ORPHAN RECONCILIATION (PURE SQL)');
  console.log('V2 Architecture: canonical_name + birth_year + gender + state matching');
  console.log('='.repeat(70));
  console.log(`Mode: ${STATS_ONLY ? 'STATS ONLY' : (DRY_RUN ? 'DRY RUN' : 'EXECUTE')}`);
  console.log('');

  // Acquire client and authorize for writes
  client = await pool.connect();
  await authorizePipelineWrite(client);

  try {
    const orphanCount = await showStats();

    if (STATS_ONLY) {
      return;
    }

    const matches = await findMatches();
    const result = await executeMerges(matches, DRY_RUN);

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(JSON.stringify(result, null, 2));

    if (!DRY_RUN) {
      console.log('\nAfter reconciliation:');
      await showStats();
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
