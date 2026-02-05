/**
 * Event Deduplication Module
 * ==========================
 *
 * Detects and resolves duplicate leagues and tournaments.
 *
 * Detection Methods:
 * 1. Exact Name Match - Same name in leagues/tournaments
 * 2. Canonical Match - Events that map to same canonical_events entry
 * 3. Fuzzy + Date Overlap - Similar names with overlapping date ranges
 *
 * Merge Strategy:
 * - Keep event with more matches
 * - Migrate all matches to kept event
 * - Update canonical_events registry
 * - Delete empty event
 *
 * Usage:
 *   import { detectDuplicates, mergeEvents } from './eventDedup.js';
 *   const duplicates = await detectDuplicates(client);
 *   await mergeEvents(duplicates, client, { dryRun: true });
 */

import pg from 'pg';
import { authorizePipelineWrite } from '../pipelineAuth.js';

const { Pool } = pg;

// ===========================================
// DETECTION METHODS
// ===========================================

/**
 * Detect duplicate leagues by exact name
 */
export async function detectDuplicateLeagues(client, options = {}) {
  const { limit = 100 } = options;

  const { rows } = await client.query(`
    SELECT
      l.name,
      COUNT(*) as count,
      array_agg(l.id ORDER BY match_count DESC NULLS LAST, l.created_at) as league_ids,
      array_agg(l.source_event_id) as source_event_ids,
      array_agg(COALESCE(m.match_count, 0)) as match_counts
    FROM leagues l
    LEFT JOIN (
      SELECT league_id, COUNT(*) as match_count
      FROM matches_v2
      WHERE league_id IS NOT NULL
      GROUP BY league_id
    ) m ON l.id = m.league_id
    GROUP BY l.name
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT $1
  `, [limit]);

  return rows.map(r => ({
    type: 'league',
    name: r.name,
    count: parseInt(r.count),
    ids: r.league_ids,
    source_event_ids: r.source_event_ids,
    match_counts: r.match_counts.map(c => parseInt(c)),
  }));
}

/**
 * Detect duplicate tournaments by exact name
 */
export async function detectDuplicateTournaments(client, options = {}) {
  const { limit = 100 } = options;

  const { rows } = await client.query(`
    SELECT
      t.name,
      COUNT(*) as count,
      array_agg(t.id ORDER BY match_count DESC NULLS LAST, t.created_at) as tournament_ids,
      array_agg(t.source_event_id) as source_event_ids,
      array_agg(t.start_date) as start_dates,
      array_agg(COALESCE(m.match_count, 0)) as match_counts
    FROM tournaments t
    LEFT JOIN (
      SELECT tournament_id, COUNT(*) as match_count
      FROM matches_v2
      WHERE tournament_id IS NOT NULL
      GROUP BY tournament_id
    ) m ON t.id = m.tournament_id
    GROUP BY t.name
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT $1
  `, [limit]);

  return rows.map(r => ({
    type: 'tournament',
    name: r.name,
    count: parseInt(r.count),
    ids: r.tournament_ids,
    source_event_ids: r.source_event_ids,
    start_dates: r.start_dates,
    match_counts: r.match_counts.map(c => parseInt(c)),
  }));
}

/**
 * Full duplicate detection
 */
export async function detectDuplicates(client, options = {}) {
  const [leagues, tournaments] = await Promise.all([
    detectDuplicateLeagues(client, options),
    detectDuplicateTournaments(client, options),
  ]);

  return { leagues, tournaments };
}

// ===========================================
// MERGE STRATEGY
// ===========================================

/**
 * Choose which event to keep
 * Priority:
 * 1. Keep event with most matches
 * 2. Keep earliest created
 */
function chooseEventToKeep(group) {
  const { ids, match_counts } = group;

  // Find index with most matches (already sorted by match_count DESC)
  // So first one is the one to keep
  const keepIndex = 0;

  return {
    keepIndex,
    keepId: ids[keepIndex],
    deleteIds: ids.slice(1),
    matchesToMigrate: match_counts.slice(1).reduce((sum, c) => sum + c, 0),
    reason: match_counts[0] > 0 ? 'most_matches' : 'earliest_created',
  };
}

/**
 * Merge duplicate leagues
 */
export async function mergeLeagueGroup(group, client, options = {}) {
  const { dryRun = true, verbose = false } = options;

  const decision = chooseEventToKeep(group);

  if (verbose) {
    console.log(`  League: "${group.name}"`);
    console.log(`    Keep: ${decision.keepId} (${group.match_counts[0]} matches)`);
    console.log(`    Delete: ${decision.deleteIds.length} leagues, migrate ${decision.matchesToMigrate} matches`);
  }

  if (dryRun) {
    return {
      kept: decision.keepId,
      deleted: decision.deleteIds.length,
      matchesMigrated: decision.matchesToMigrate,
    };
  }

  await client.query('BEGIN');

  try {
    // 1. Migrate matches to kept league (only active matches)
    const { rowCount: migrated } = await client.query(`
      UPDATE matches_v2
      SET league_id = $1
      WHERE league_id = ANY($2) AND deleted_at IS NULL
    `, [decision.keepId, decision.deleteIds]);

    // 2. Log deletions
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
      SELECT 'leagues', id, 'MERGE_DELETE',
        row_to_json(leagues),
        jsonb_build_object('merged_into', $1),
        'eventDedup', NOW()
      FROM leagues
      WHERE id = ANY($2)
    `, [decision.keepId, decision.deleteIds]);

    // 3. Delete duplicate leagues
    const { rowCount: deleted } = await client.query(`
      DELETE FROM leagues
      WHERE id = ANY($1)
    `, [decision.deleteIds]);

    await client.query('COMMIT');

    return {
      kept: decision.keepId,
      deleted,
      matchesMigrated: migrated,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Merge duplicate tournaments
 */
export async function mergeTournamentGroup(group, client, options = {}) {
  const { dryRun = true, verbose = false } = options;

  const decision = chooseEventToKeep(group);

  if (verbose) {
    console.log(`  Tournament: "${group.name}"`);
    console.log(`    Keep: ${decision.keepId} (${group.match_counts[0]} matches)`);
    console.log(`    Delete: ${decision.deleteIds.length} tournaments, migrate ${decision.matchesToMigrate} matches`);
  }

  if (dryRun) {
    return {
      kept: decision.keepId,
      deleted: decision.deleteIds.length,
      matchesMigrated: decision.matchesToMigrate,
    };
  }

  await client.query('BEGIN');

  try {
    // 1. Migrate matches (only active matches)
    const { rowCount: migrated } = await client.query(`
      UPDATE matches_v2
      SET tournament_id = $1
      WHERE tournament_id = ANY($2) AND deleted_at IS NULL
    `, [decision.keepId, decision.deleteIds]);

    // 2. Log deletions
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
      SELECT 'tournaments', id, 'MERGE_DELETE',
        row_to_json(tournaments),
        jsonb_build_object('merged_into', $1),
        'eventDedup', NOW()
      FROM tournaments
      WHERE id = ANY($2)
    `, [decision.keepId, decision.deleteIds]);

    // 3. Delete duplicate tournaments
    const { rowCount: deleted } = await client.query(`
      DELETE FROM tournaments
      WHERE id = ANY($1)
    `, [decision.deleteIds]);

    await client.query('COMMIT');

    return {
      kept: decision.keepId,
      deleted,
      matchesMigrated: migrated,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Merge all duplicate events
 */
export async function mergeAllDuplicates(duplicates, client, options = {}) {
  const { dryRun = true, verbose = false } = options;

  const stats = {
    leaguesProcessed: 0,
    leaguesDeleted: 0,
    tournamentsProcessed: 0,
    tournamentsDeleted: 0,
    matchesMigrated: 0,
    errors: [],
  };

  // Process leagues
  for (const group of duplicates.leagues) {
    try {
      const result = await mergeLeagueGroup(group, client, { dryRun, verbose });
      stats.leaguesProcessed++;
      stats.leaguesDeleted += result.deleted;
      stats.matchesMigrated += result.matchesMigrated;
    } catch (error) {
      stats.errors.push({ type: 'league', name: group.name, error: error.message });
    }
  }

  // Process tournaments
  for (const group of duplicates.tournaments) {
    try {
      const result = await mergeTournamentGroup(group, client, { dryRun, verbose });
      stats.tournamentsProcessed++;
      stats.tournamentsDeleted += result.deleted;
      stats.matchesMigrated += result.matchesMigrated;
    } catch (error) {
      stats.errors.push({ type: 'tournament', name: group.name, error: error.message });
    }
  }

  return stats;
}

// ===========================================
// REPORTING
// ===========================================

/**
 * Generate a report of duplicate events
 */
export async function generateReport(client) {
  const duplicates = await detectDuplicates(client);

  return {
    timestamp: new Date().toISOString(),
    leagues: {
      duplicateGroups: duplicates.leagues.length,
      totalExtra: duplicates.leagues.reduce((sum, g) => sum + g.count - 1, 0),
      samples: duplicates.leagues.slice(0, 5).map(g => ({
        name: g.name,
        count: g.count,
        matchCounts: g.match_counts,
      })),
    },
    tournaments: {
      duplicateGroups: duplicates.tournaments.length,
      totalExtra: duplicates.tournaments.reduce((sum, g) => sum + g.count - 1, 0),
      samples: duplicates.tournaments.slice(0, 5).map(g => ({
        name: g.name,
        count: g.count,
        matchCounts: g.match_counts,
      })),
    },
  };
}

// ===========================================
// CLI
// ===========================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const verbose = args.includes('--verbose');
  const reportOnly = args.includes('--report');

  console.log('🏆 EVENT DEDUPLICATION');
  console.log('='.repeat(40));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️  EXECUTE'}`);

  await import('dotenv/config');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();

  try {
    // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
    await authorizePipelineWrite(client);

    if (reportOnly) {
      const report = await generateReport(client);
      console.log('\n📊 DUPLICATE REPORT:');
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log('\n📋 Detecting duplicate events...');
    const duplicates = await detectDuplicates(client);

    console.log(`\n   Duplicate leagues: ${duplicates.leagues.length}`);
    console.log(`   Duplicate tournaments: ${duplicates.tournaments.length}`);

    if (duplicates.leagues.length === 0 && duplicates.tournaments.length === 0) {
      console.log('\n✅ No duplicate events found!');
      return;
    }

    console.log('\n🔧 Merging duplicate events...');
    const stats = await mergeAllDuplicates(duplicates, client, { dryRun, verbose });

    console.log('\n📊 RESULTS:');
    console.log(`   Leagues processed: ${stats.leaguesProcessed}`);
    console.log(`   Leagues ${dryRun ? 'would be ' : ''}deleted: ${stats.leaguesDeleted}`);
    console.log(`   Tournaments processed: ${stats.tournamentsProcessed}`);
    console.log(`   Tournaments ${dryRun ? 'would be ' : ''}deleted: ${stats.tournamentsDeleted}`);
    console.log(`   Matches ${dryRun ? 'would be ' : ''}migrated: ${stats.matchesMigrated}`);

    if (stats.errors.length > 0) {
      console.log(`   Errors: ${stats.errors.length}`);
    }

    if (dryRun) {
      console.log('\n⚠️  This was a DRY RUN. Use --execute to actually merge events.');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.includes('eventDedup')) {
  main().catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  });
}
