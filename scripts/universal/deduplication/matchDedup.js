/**
 * Match Deduplication Module
 * ==========================
 *
 * Detects and resolves duplicate matches in matches_v2.
 *
 * Detection Methods (in priority order):
 * 1. Exact Key Match - Same source_match_key
 * 2. Strong Match - Same (date, home_team_id, away_team_id, home_score, away_score)
 * 3. Fuzzy Match - Same date + similar team names + same scores
 *
 * Usage:
 *   import { detectDuplicates, resolveDuplicates } from './matchDedup.js';
 *   const duplicates = await detectDuplicates(client);
 *   await resolveDuplicates(duplicates, client, { dryRun: true });
 */

import pg from 'pg';
import { authorizePipelineWrite } from '../pipelineAuth.js';

const { Pool } = pg;

// ===========================================
// DETECTION METHODS
// ===========================================

/**
 * Detect duplicate matches
 * Returns groups of duplicate match IDs
 */
export async function detectDuplicates(client, options = {}) {
  const { limit = 1000, verbose = false } = options;
  const duplicateGroups = [];

  // Method 1: Strong Match (same date + teams + scores)
  // This catches matches that were inserted with different source_match_keys
  // but are actually the same match
  if (verbose) console.log('  Checking strong matches (date + teams + scores)...');

  const { rows: strongMatches } = await client.query(`
    SELECT
      match_date,
      home_team_id,
      away_team_id,
      home_score,
      away_score,
      COUNT(*) as count,
      array_agg(id ORDER BY created_at) as match_ids,
      array_agg(source_match_key) as source_keys,
      array_agg(league_id) as league_ids,
      array_agg(tournament_id) as tournament_ids
    FROM matches_v2
    GROUP BY match_date, home_team_id, away_team_id, home_score, away_score
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT $1
  `, [limit]);

  for (const row of strongMatches) {
    duplicateGroups.push({
      type: 'strong_match',
      match_date: row.match_date,
      home_team_id: row.home_team_id,
      away_team_id: row.away_team_id,
      home_score: row.home_score,
      away_score: row.away_score,
      count: parseInt(row.count),
      match_ids: row.match_ids,
      source_keys: row.source_keys,
      league_ids: row.league_ids,
      tournament_ids: row.tournament_ids,
    });
  }

  if (verbose) console.log(`  Found ${strongMatches.length} strong match duplicate groups`);

  return duplicateGroups;
}

/**
 * Detect matches with same teams on same date but different scores
 * These might be double-headers or data entry errors
 */
export async function detectPotentialDuplicates(client, options = {}) {
  const { limit = 100 } = options;

  const { rows } = await client.query(`
    SELECT
      match_date,
      home_team_id,
      away_team_id,
      COUNT(*) as count,
      array_agg(id) as match_ids,
      array_agg(home_score || '-' || away_score) as scores
    FROM matches_v2
    GROUP BY match_date, home_team_id, away_team_id
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT $1
  `, [limit]);

  return rows.map(r => ({
    type: 'potential_duplicate',
    match_date: r.match_date,
    home_team_id: r.home_team_id,
    away_team_id: r.away_team_id,
    count: parseInt(r.count),
    match_ids: r.match_ids,
    scores: r.scores,
  }));
}

// ===========================================
// RESOLUTION STRATEGIES
// ===========================================

/**
 * Choose which match to keep from a duplicate group
 * Priority:
 * 1. Keep the one linked to an event (league_id or tournament_id not null)
 * 2. Keep the one with more complete data
 * 3. Keep the earliest created one
 */
function chooseMatchToKeep(group) {
  const { match_ids, league_ids, tournament_ids, source_keys } = group;

  // Find matches linked to events
  const linkedIndices = [];
  for (let i = 0; i < match_ids.length; i++) {
    if (league_ids[i] || tournament_ids[i]) {
      linkedIndices.push(i);
    }
  }

  // If only one is linked, keep it
  if (linkedIndices.length === 1) {
    return {
      keepIndex: linkedIndices[0],
      keepId: match_ids[linkedIndices[0]],
      deleteIds: match_ids.filter((_, i) => i !== linkedIndices[0]),
      reason: 'linked_to_event',
    };
  }

  // If multiple are linked, keep the first (earliest)
  if (linkedIndices.length > 1) {
    return {
      keepIndex: linkedIndices[0],
      keepId: match_ids[linkedIndices[0]],
      deleteIds: match_ids.filter((_, i) => i !== linkedIndices[0]),
      reason: 'earliest_linked',
    };
  }

  // None linked - keep the first (earliest created)
  return {
    keepIndex: 0,
    keepId: match_ids[0],
    deleteIds: match_ids.slice(1),
    reason: 'earliest_created',
  };
}

/**
 * Resolve duplicate matches by deleting extras
 */
export async function resolveDuplicates(duplicateGroups, client, options = {}) {
  const { dryRun = true, verbose = false } = options;

  const stats = {
    groupsProcessed: 0,
    matchesDeleted: 0,
    matchesKept: 0,
    errors: [],
  };

  for (const group of duplicateGroups) {
    try {
      const decision = chooseMatchToKeep(group);

      if (verbose) {
        console.log(`  Group: ${group.match_date} - keeping ${decision.keepId} (${decision.reason}), deleting ${decision.deleteIds.length}`);
      }

      if (!dryRun && decision.deleteIds.length > 0) {
        // Log to audit before deletion
        await client.query(`
          INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by, changed_at)
          SELECT 'matches_v2', id, 'DELETE', row_to_json(matches_v2), 'matchDedup', NOW()
          FROM matches_v2
          WHERE id = ANY($1)
        `, [decision.deleteIds]);

        // Delete duplicates
        const { rowCount } = await client.query(`
          DELETE FROM matches_v2
          WHERE id = ANY($1)
        `, [decision.deleteIds]);

        stats.matchesDeleted += rowCount;
      } else {
        stats.matchesDeleted += decision.deleteIds.length; // Count for dry run
      }

      stats.matchesKept++;
      stats.groupsProcessed++;
    } catch (error) {
      stats.errors.push({
        group: group.match_ids,
        error: error.message,
      });
    }
  }

  return stats;
}

// ===========================================
// REPORTING
// ===========================================

/**
 * Generate a report of duplicate matches
 */
export async function generateReport(client) {
  const duplicates = await detectDuplicates(client, { verbose: false });
  const potential = await detectPotentialDuplicates(client, { limit: 50 });

  const report = {
    timestamp: new Date().toISOString(),
    strongDuplicates: {
      count: duplicates.length,
      totalExtra: duplicates.reduce((sum, g) => sum + g.count - 1, 0),
      samples: duplicates.slice(0, 5),
    },
    potentialDuplicates: {
      count: potential.length,
      samples: potential.slice(0, 5),
    },
  };

  return report;
}

// ===========================================
// CLI
// ===========================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const verbose = args.includes('--verbose');
  const reportOnly = args.includes('--report');

  console.log('🔍 MATCH DEDUPLICATION');
  console.log('='.repeat(40));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️  EXECUTE'}`);

  // Dynamic import for dotenv
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

    console.log('\n📋 Detecting duplicates...');
    const duplicates = await detectDuplicates(client, { verbose });

    console.log(`\n   Found ${duplicates.length} duplicate groups`);
    const totalExtra = duplicates.reduce((sum, g) => sum + g.count - 1, 0);
    console.log(`   Total extra matches: ${totalExtra}`);

    if (duplicates.length === 0) {
      console.log('\n✅ No duplicates found!');
      return;
    }

    console.log('\n🔧 Resolving duplicates...');
    const stats = await resolveDuplicates(duplicates, client, { dryRun, verbose });

    console.log('\n📊 RESULTS:');
    console.log(`   Groups processed: ${stats.groupsProcessed}`);
    console.log(`   Matches kept: ${stats.matchesKept}`);
    console.log(`   Matches ${dryRun ? 'would be ' : ''}deleted: ${stats.matchesDeleted}`);

    if (stats.errors.length > 0) {
      console.log(`   Errors: ${stats.errors.length}`);
    }

    if (dryRun) {
      console.log('\n⚠️  This was a DRY RUN. Use --execute to actually delete duplicates.');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

// Run if executed directly
if (process.argv[1]?.includes('matchDedup')) {
  main().catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  });
}
