/**
 * Match Deduplication Module
 * ==========================
 *
 * Detects and resolves duplicate matches in matches_v2 using SEMANTIC grouping.
 *
 * IMPORTANT (Session 85): Uses SoccerView Team IDs as uniqueness anchor.
 * A match is uniquely identified by (match_date, home_team_id, away_team_id).
 * Scores are NOT part of the uniqueness key - this aligns with the schedules table
 * and the Universal SoccerView ID Architecture.
 *
 * Detection Method:
 * - Semantic Match - Same (date, home_team_id, away_team_id) regardless of scores
 *
 * Resolution Priority:
 * 1. Keep the one with actual scores (non-NULL) over scheduled (NULL)
 * 2. Keep the one linked to an event (league_id or tournament_id)
 * 3. Keep the earliest created one
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
 * Detect duplicate matches using SEMANTIC grouping
 * Returns groups of duplicate match IDs
 *
 * Session 85: Uses (date, home_team_id, away_team_id) - WITHOUT scores
 * This aligns with Universal SoccerView ID Architecture
 */
export async function detectDuplicates(client, options = {}) {
  const { limit = 10000, verbose = false } = options;
  const duplicateGroups = [];

  // SEMANTIC MATCH: Same date + teams (SoccerView IDs)
  // Scores are NOT part of uniqueness - this is the correct architecture
  if (verbose) console.log('  Checking semantic matches (date + team IDs)...');

  const { rows: semanticMatches } = await client.query(`
    SELECT
      match_date,
      home_team_id,
      away_team_id,
      COUNT(*) as count,
      array_agg(id ORDER BY
        CASE WHEN home_score IS NOT NULL AND away_score IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN league_id IS NOT NULL OR tournament_id IS NOT NULL THEN 0 ELSE 1 END,
        created_at
      ) as match_ids,
      array_agg(source_match_key ORDER BY
        CASE WHEN home_score IS NOT NULL AND away_score IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN league_id IS NOT NULL OR tournament_id IS NOT NULL THEN 0 ELSE 1 END,
        created_at
      ) as source_keys,
      array_agg(league_id ORDER BY
        CASE WHEN home_score IS NOT NULL AND away_score IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN league_id IS NOT NULL OR tournament_id IS NOT NULL THEN 0 ELSE 1 END,
        created_at
      ) as league_ids,
      array_agg(tournament_id ORDER BY
        CASE WHEN home_score IS NOT NULL AND away_score IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN league_id IS NOT NULL OR tournament_id IS NOT NULL THEN 0 ELSE 1 END,
        created_at
      ) as tournament_ids,
      array_agg(home_score ORDER BY
        CASE WHEN home_score IS NOT NULL AND away_score IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN league_id IS NOT NULL OR tournament_id IS NOT NULL THEN 0 ELSE 1 END,
        created_at
      ) as home_scores,
      array_agg(away_score ORDER BY
        CASE WHEN home_score IS NOT NULL AND away_score IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN league_id IS NOT NULL OR tournament_id IS NOT NULL THEN 0 ELSE 1 END,
        created_at
      ) as away_scores
    FROM matches_v2
    WHERE deleted_at IS NULL  -- Exclude soft-deleted matches (Session 86)
    GROUP BY match_date, home_team_id, away_team_id
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT $1
  `, [limit]);

  for (const row of semanticMatches) {
    duplicateGroups.push({
      type: 'semantic_match',
      match_date: row.match_date,
      home_team_id: row.home_team_id,
      away_team_id: row.away_team_id,
      count: parseInt(row.count),
      match_ids: row.match_ids,
      source_keys: row.source_keys,
      league_ids: row.league_ids,
      tournament_ids: row.tournament_ids,
      home_scores: row.home_scores,
      away_scores: row.away_scores,
    });
  }

  if (verbose) console.log(`  Found ${semanticMatches.length} semantic duplicate groups`);

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
 *
 * Session 85: Arrays are pre-sorted in the query by:
 * 1. Has scores (non-NULL) - completed matches preferred over scheduled
 * 2. Has event link (league_id or tournament_id) - linked matches preferred
 * 3. Created date (earliest)
 *
 * So we always keep index 0 (the "best" match).
 */
function chooseMatchToKeep(group) {
  const { match_ids, league_ids, tournament_ids, home_scores, away_scores } = group;

  // First element is already the best (sorted in query)
  const keepId = match_ids[0];
  const deleteIds = match_ids.slice(1);

  // Determine reason for logging
  let reason = 'earliest_created';
  if (home_scores && home_scores[0] !== null && away_scores && away_scores[0] !== null) {
    if (league_ids[0] || tournament_ids[0]) {
      reason = 'scored_and_linked';
    } else {
      reason = 'has_scores';
    }
  } else if (league_ids[0] || tournament_ids[0]) {
    reason = 'linked_to_event';
  }

  return {
    keepIndex: 0,
    keepId,
    deleteIds,
    reason,
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
        // Log to audit before soft delete
        await client.query(`
          INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by, changed_at)
          SELECT 'matches_v2', id, 'SOFT_DELETE', row_to_json(matches_v2), 'matchDedup', NOW()
          FROM matches_v2
          WHERE id = ANY($1)
        `, [decision.deleteIds]);

        // SOFT DELETE duplicates (Session 86: Use soft delete instead of hard delete)
        // This preserves data and allows recovery if needed
        const { rowCount } = await client.query(`
          UPDATE matches_v2
          SET deleted_at = NOW(),
              deletion_reason = 'Semantic duplicate of ' || $2
          WHERE id = ANY($1)
        `, [decision.deleteIds, decision.keepId]);

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
// REVERSE MATCH DETECTION (Session 88)
// ===========================================

/**
 * Detect reverse duplicate matches: same date, swapped home/away teams.
 * The semantic unique partial INDEX treats (date, A, B) and (date, B, A) as
 * different tuples, so cross-source data with teams in different positions
 * slips through.
 *
 * CONSERVATIVE: Only returns confirmed duplicates (score-consistent or
 * same-event scheduled). Skips pairs with different scores (legitimate
 * rematches / pool play).
 *
 * Universal: Works for ANY data source.
 */
export async function detectReverseMatches(client, options = {}) {
  const { limit = 10000, verbose = false } = options;

  if (verbose) console.log('  Checking reverse matches (date + swapped team IDs)...');

  const { rows: reversePairs } = await client.query(`
    SELECT
      a.id as id_a, b.id as id_b,
      a.match_date,
      a.home_score as a_home_score, a.away_score as a_away_score,
      b.home_score as b_home_score, b.away_score as b_away_score,
      a.league_id as a_league, b.league_id as b_league,
      a.tournament_id as a_tourn, b.tournament_id as b_tourn,
      a.source_match_key as a_key, b.source_match_key as b_key,
      a.created_at as a_created, b.created_at as b_created
    FROM matches_v2 a
    JOIN matches_v2 b ON a.match_date = b.match_date
      AND a.home_team_id = b.away_team_id
      AND a.away_team_id = b.home_team_id
      AND a.id < b.id
    WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
    ORDER BY a.match_date DESC
    LIMIT $1
  `, [limit]);

  // Filter to confirmed duplicates only (conservative)
  const confirmed = [];
  let skippedDifferent = 0;
  let skippedAmbiguous = 0;

  for (const pair of reversePairs) {
    const aHasScore = pair.a_home_score !== null && pair.a_away_score !== null;
    const bHasScore = pair.b_home_score !== null && pair.b_away_score !== null;
    const scoresConsistent = aHasScore && bHasScore &&
      pair.a_home_score === pair.b_away_score && pair.a_away_score === pair.b_home_score;
    const scoresDifferent = aHasScore && bHasScore && !scoresConsistent;

    if (scoresDifferent) { skippedDifferent++; continue; }

    const isLegacySwap = pair.a_key && pair.b_key &&
      pair.a_key.startsWith('legacy-') && pair.b_key.startsWith('legacy-');

    if (!aHasScore && !bHasScore && !isLegacySwap) {
      const sameEvent = (pair.a_league && pair.b_league && pair.a_league === pair.b_league) ||
                        (pair.a_tourn && pair.b_tourn && pair.a_tourn === pair.b_tourn);
      if (!sameEvent) { skippedAmbiguous++; continue; }
    }

    // Determine which to keep (same priority as semantic dedup)
    const aHasEvent = pair.a_league || pair.a_tourn;
    const bHasEvent = pair.b_league || pair.b_tourn;
    let keepId, deleteId, reason;

    if (aHasEvent && !bHasEvent) {
      keepId = pair.id_a; deleteId = pair.id_b; reason = 'linked_to_event';
    } else if (bHasEvent && !aHasEvent) {
      keepId = pair.id_b; deleteId = pair.id_a; reason = 'linked_to_event';
    } else if (aHasScore && !bHasScore) {
      keepId = pair.id_a; deleteId = pair.id_b; reason = 'has_scores';
    } else if (bHasScore && !aHasScore) {
      keepId = pair.id_b; deleteId = pair.id_a; reason = 'has_scores';
    } else {
      if (new Date(pair.a_created) <= new Date(pair.b_created)) {
        keepId = pair.id_a; deleteId = pair.id_b;
      } else {
        keepId = pair.id_b; deleteId = pair.id_a;
      }
      reason = 'earliest_created';
    }

    confirmed.push({
      type: 'reverse_match',
      match_date: pair.match_date,
      keepId, deleteId, reason,
      source_keys: [pair.a_key, pair.b_key],
    });
  }

  if (verbose) {
    console.log(`  Found ${reversePairs.length} reverse pairs total`);
    console.log(`  Confirmed duplicates: ${confirmed.length}`);
    console.log(`  Skipped (different scores): ${skippedDifferent}`);
    console.log(`  Skipped (ambiguous): ${skippedAmbiguous}`);
  }

  return confirmed;
}

/**
 * Resolve reverse duplicate matches by soft-deleting the inferior record.
 * Uses bulk SQL for performance.
 */
export async function resolveReverseMatches(reverseMatches, client, options = {}) {
  const { dryRun = true, verbose = false } = options;
  const BATCH_SIZE = 500;
  let totalDeleted = 0;

  if (dryRun) {
    return { deleted: reverseMatches.length, dryRun: true };
  }

  for (let i = 0; i < reverseMatches.length; i += BATCH_SIZE) {
    const batch = reverseMatches.slice(i, i + BATCH_SIZE);
    const deleteIds = batch.map(r => r.deleteId);
    const reasonCases = batch.map((r, idx) =>
      `WHEN id = $${idx + 1}::uuid THEN 'Reverse duplicate of ' || $${batch.length + idx + 1}::text`
    ).join(' ');
    const params = [...deleteIds, ...batch.map(r => r.keepId)];

    await client.query(`
      UPDATE matches_v2
      SET deleted_at = NOW(),
          deletion_reason = CASE ${reasonCases} END
      WHERE id = ANY($${params.length + 1}::uuid[]) AND deleted_at IS NULL
    `, [...params, deleteIds]);

    totalDeleted += batch.length;
    if (verbose) console.log(`  Batch: ${totalDeleted}/${reverseMatches.length}`);
  }

  return { deleted: totalDeleted, dryRun: false };
}

// ===========================================
// REPORTING
// ===========================================

/**
 * Generate a report of duplicate matches
 *
 * Session 85: Uses semantic grouping (date + team IDs) as the standard.
 * This aligns with Universal SoccerView ID Architecture.
 */
export async function generateReport(client) {
  const duplicates = await detectDuplicates(client, { verbose: false, limit: 10000 });
  const reverseMatches = await detectReverseMatches(client, { verbose: false, limit: 10000 });

  const report = {
    timestamp: new Date().toISOString(),
    description: 'Semantic + reverse duplicates',
    semanticDuplicates: {
      count: duplicates.length,
      totalExtra: duplicates.reduce((sum, g) => sum + g.count - 1, 0),
      samples: duplicates.slice(0, 5),
    },
    reverseDuplicates: {
      count: reverseMatches.length,
      samples: reverseMatches.slice(0, 5),
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

    console.log('\n🔧 Resolving semantic duplicates...');
    const stats = await resolveDuplicates(duplicates, client, { dryRun, verbose });

    console.log('\n📊 SEMANTIC RESULTS:');
    console.log(`   Groups processed: ${stats.groupsProcessed}`);
    console.log(`   Matches kept: ${stats.matchesKept}`);
    console.log(`   Matches ${dryRun ? 'would be ' : ''}deleted: ${stats.matchesDeleted}`);

    if (stats.errors.length > 0) {
      console.log(`   Errors: ${stats.errors.length}`);
    }

    // Session 88: Also detect and resolve reverse matches
    console.log('\n📋 Detecting reverse matches (swapped home/away)...');
    const reverseMatches = await detectReverseMatches(client, { verbose });
    console.log(`   Found ${reverseMatches.length} confirmed reverse duplicates`);

    if (reverseMatches.length > 0) {
      console.log('\n🔧 Resolving reverse duplicates...');
      const reverseStats = await resolveReverseMatches(reverseMatches, client, { dryRun, verbose });
      console.log(`   Reverse matches ${dryRun ? 'would be ' : ''}deleted: ${reverseStats.deleted}`);
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
