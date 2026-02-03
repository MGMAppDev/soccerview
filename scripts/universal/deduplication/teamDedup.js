/**
 * Team Deduplication Module
 * =========================
 *
 * Detects and resolves duplicate teams in teams_v2.
 *
 * Detection Methods:
 * 1. Exact Match - Same (canonical_name, birth_year)
 * 2. Fuzzy Match - Similar names (similarity > 0.90) with same birth_year + gender
 * 3. Canonical Registry - Teams that should map to same canonical_teams entry
 *
 * Merge Strategy:
 * - Keep team with more matches
 * - Update all match foreign keys to point to kept team
 * - Merge known_aliases arrays
 * - Delete duplicate team
 * - Update canonical_teams registry
 *
 * Usage:
 *   import { detectDuplicates, mergeTeams } from './teamDedup.js';
 *   const duplicates = await detectDuplicates(client);
 *   await mergeTeams(duplicates, client, { dryRun: true });
 */

import pg from 'pg';
import { authorizePipelineWrite } from '../pipelineAuth.js';

const { Pool } = pg;

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
  // Similarity >= 0.95 + same birth_year + same gender = AUTO-MERGE
  AUTO_MERGE_THRESHOLD: 0.95,
  // Similarity 0.85-0.95 = FLAG FOR REVIEW (don't auto-merge)
  REVIEW_THRESHOLD: 0.85,
  // Below 0.85 = IGNORE (not duplicates)
};

// ===========================================
// DETECTION METHODS
// ===========================================

/**
 * Detect teams with exact same (canonical_name, birth_year)
 * These are definite duplicates that differ only in gender/state
 */
export async function detectExactDuplicates(client, options = {}) {
  const { limit = 500 } = options;

  const { rows } = await client.query(`
    SELECT
      canonical_name,
      birth_year,
      COUNT(*) as count,
      array_agg(id ORDER BY matches_played DESC, created_at) as team_ids,
      array_agg(gender) as genders,
      array_agg(state) as states,
      array_agg(matches_played) as matches_played,
      array_agg(elo_rating) as elo_ratings
    FROM teams_v2
    WHERE canonical_name IS NOT NULL
    GROUP BY canonical_name, birth_year
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT $1
  `, [limit]);

  return rows.map(r => ({
    type: 'exact_match',
    canonical_name: r.canonical_name,
    birth_year: r.birth_year,
    count: parseInt(r.count),
    team_ids: r.team_ids,
    genders: r.genders,
    states: r.states,
    matches_played: r.matches_played,
    elo_ratings: r.elo_ratings,
  }));
}

/**
 * Detect teams with similar names using pg_trgm
 * Only checks teams with same birth_year and gender
 */
export async function detectFuzzyDuplicates(client, options = {}) {
  const { limit = 100, threshold = 0.90 } = options;

  // This query can be slow, so we limit it
  const { rows } = await client.query(`
    SELECT
      t1.id as id1,
      t1.canonical_name as name1,
      t1.birth_year as birth_year,
      t1.gender as gender,
      t1.matches_played as matches1,
      t2.id as id2,
      t2.canonical_name as name2,
      t2.matches_played as matches2,
      similarity(t1.canonical_name, t2.canonical_name) as sim
    FROM teams_v2 t1
    JOIN teams_v2 t2 ON t1.id < t2.id
      AND t1.birth_year = t2.birth_year
      AND t1.gender = t2.gender
      AND t1.birth_year IS NOT NULL
      AND similarity(t1.canonical_name, t2.canonical_name) > $1
      AND similarity(t1.canonical_name, t2.canonical_name) < 1.0
    ORDER BY sim DESC
    LIMIT $2
  `, [threshold, limit]);

  return rows.map(r => ({
    type: 'fuzzy_match',
    similarity: parseFloat(r.sim),
    birth_year: r.birth_year,
    gender: r.gender,
    team1: {
      id: r.id1,
      name: r.name1,
      matches_played: r.matches1,
    },
    team2: {
      id: r.id2,
      name: r.name2,
      matches_played: r.matches2,
    },
  }));
}

/**
 * Full duplicate detection
 */
export async function detectDuplicates(client, options = {}) {
  const { exactOnly = false, fuzzyThreshold = 0.90 } = options;

  const results = {
    exact: await detectExactDuplicates(client, options),
    fuzzy: exactOnly ? [] : await detectFuzzyDuplicates(client, { ...options, threshold: fuzzyThreshold }),
  };

  return results;
}

// ===========================================
// MERGE STRATEGY
// ===========================================

/**
 * Choose which team to keep from a duplicate group
 * Priority:
 * 1. Keep team with most matches
 * 2. Keep team with highest ELO (more accurate rating)
 * 3. Keep earliest created
 */
function chooseTeamToKeep(group) {
  const { team_ids, matches_played, elo_ratings } = group;

  // Find index with most matches
  let maxMatches = -1;
  let keepIndex = 0;

  for (let i = 0; i < team_ids.length; i++) {
    if (matches_played[i] > maxMatches) {
      maxMatches = matches_played[i];
      keepIndex = i;
    }
  }

  return {
    keepIndex,
    keepId: team_ids[keepIndex],
    deleteIds: team_ids.filter((_, i) => i !== keepIndex),
    reason: maxMatches > 0 ? 'most_matches' : 'earliest_created',
    matchesMerged: matches_played.reduce((sum, m, i) => i !== keepIndex ? sum + m : sum, 0),
  };
}

/**
 * Merge duplicate teams
 * - Updates all match references to point to kept team
 * - Deletes duplicate teams
 */
export async function mergeTeamGroup(group, client, options = {}) {
  const { dryRun = true, verbose = false } = options;

  const decision = chooseTeamToKeep(group);

  if (verbose) {
    console.log(`  Merging: "${group.canonical_name}" (BY: ${group.birth_year})`);
    console.log(`    Keep: ${decision.keepId} (${decision.reason})`);
    console.log(`    Delete: ${decision.deleteIds.length} teams`);
  }

  if (dryRun) {
    return {
      kept: decision.keepId,
      deleted: decision.deleteIds.length,
      matchesMoved: decision.matchesMerged,
    };
  }

  // Start transaction
  await client.query('BEGIN');

  try {
    // 1. Update matches - change home_team_id references
    const { rowCount: homeUpdated } = await client.query(`
      UPDATE matches_v2
      SET home_team_id = $1
      WHERE home_team_id = ANY($2)
    `, [decision.keepId, decision.deleteIds]);

    // 2. Update matches - change away_team_id references
    const { rowCount: awayUpdated } = await client.query(`
      UPDATE matches_v2
      SET away_team_id = $1
      WHERE away_team_id = ANY($2)
    `, [decision.keepId, decision.deleteIds]);

    // 3. Update kept team's matches_played count
    const { rows: matchCount } = await client.query(`
      SELECT COUNT(*) as total FROM matches_v2
      WHERE home_team_id = $1 OR away_team_id = $1
    `, [decision.keepId]);

    await client.query(`
      UPDATE teams_v2
      SET matches_played = $1
      WHERE id = $2
    `, [parseInt(matchCount[0].total), decision.keepId]);

    // 4. Log deletions to audit
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
      SELECT 'teams_v2', id, 'MERGE_DELETE',
        row_to_json(teams_v2),
        jsonb_build_object('merged_into', $1, 'reason', $2),
        'teamDedup', NOW()
      FROM teams_v2
      WHERE id = ANY($3)
    `, [decision.keepId, decision.reason, decision.deleteIds]);

    // 5. Delete duplicate teams
    const { rowCount: deleted } = await client.query(`
      DELETE FROM teams_v2
      WHERE id = ANY($1)
    `, [decision.deleteIds]);

    // 6. SELF-LEARNING: Add merged team names to canonical_teams registry
    // Get names of teams being deleted
    const { rows: deletedTeams } = await client.query(`
      SELECT canonical_name, display_name FROM teams_v2 WHERE id = ANY($1)
    `, [decision.deleteIds]);

    if (deletedTeams.length > 0) {
      const mergedNames = deletedTeams.map(t => t.display_name || t.canonical_name);

      // Check if canonical entry exists for kept team
      const { rows: existingCanonical } = await client.query(`
        SELECT id, aliases FROM canonical_teams WHERE team_v2_id = $1
      `, [decision.keepId]);

      if (existingCanonical.length > 0) {
        const currentAliases = existingCanonical[0].aliases || [];
        const newAliases = [...new Set([...currentAliases, ...mergedNames])];
        await client.query(`
          UPDATE canonical_teams SET aliases = $1, updated_at = NOW() WHERE id = $2
        `, [newAliases, existingCanonical[0].id]);
      } else {
        // Get kept team info to create canonical entry
        const { rows: keptTeam } = await client.query(`
          SELECT canonical_name, display_name, birth_year, gender, state
          FROM teams_v2 WHERE id = $1
        `, [decision.keepId]);

        if (keptTeam.length > 0) {
          await client.query(`
            INSERT INTO canonical_teams (
              canonical_name, birth_year, gender, state, aliases, team_v2_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING
          `, [
            keptTeam[0].display_name || keptTeam[0].canonical_name,
            keptTeam[0].birth_year,
            keptTeam[0].gender,
            keptTeam[0].state,
            mergedNames,
            decision.keepId
          ]);
        }
      }
    }

    await client.query('COMMIT');

    return {
      kept: decision.keepId,
      deleted,
      matchesMoved: homeUpdated + awayUpdated,
      aliasesAdded: deletedTeams.length,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Merge all duplicate team groups
 */
export async function mergeAllDuplicates(duplicates, client, options = {}) {
  const { dryRun = true, verbose = false } = options;

  const stats = {
    groupsProcessed: 0,
    teamsDeleted: 0,
    matchesMoved: 0,
    errors: [],
  };

  for (const group of duplicates.exact) {
    try {
      const result = await mergeTeamGroup(group, client, { dryRun, verbose });
      stats.groupsProcessed++;
      stats.teamsDeleted += result.deleted;
      stats.matchesMoved += result.matchesMoved;
    } catch (error) {
      stats.errors.push({
        group: group.canonical_name,
        error: error.message,
      });
    }
  }

  return stats;
}

// ===========================================
// AUTO-MERGE HIGH CONFIDENCE
// ===========================================

/**
 * Auto-merge fuzzy duplicates with very high confidence (>= 0.95)
 * These are near-certain duplicates that can be merged without human review
 */
export async function autoMergeHighConfidence(client, options = {}) {
  const { dryRun = true, verbose = false, limit = 100 } = options;

  console.log(`\n🔄 Auto-merging high-confidence duplicates (similarity >= ${CONFIG.AUTO_MERGE_THRESHOLD})...`);

  // Find high-confidence fuzzy matches
  const { rows: highConfidence } = await client.query(`
    SELECT
      t1.id as id1,
      t1.canonical_name as name1,
      t1.display_name as display1,
      t1.birth_year,
      t1.gender,
      t1.state,
      t1.matches_played as matches1,
      t2.id as id2,
      t2.canonical_name as name2,
      t2.display_name as display2,
      t2.matches_played as matches2,
      similarity(t1.canonical_name, t2.canonical_name) as sim
    FROM teams_v2 t1
    JOIN teams_v2 t2 ON t1.id < t2.id
      AND t1.birth_year = t2.birth_year
      AND t1.gender = t2.gender
      AND t1.birth_year IS NOT NULL
      AND similarity(t1.canonical_name, t2.canonical_name) >= $1
    ORDER BY sim DESC
    LIMIT $2
  `, [CONFIG.AUTO_MERGE_THRESHOLD, limit]);

  console.log(`   Found ${highConfidence.length} high-confidence pairs`);

  if (highConfidence.length === 0) {
    return { merged: 0, matchesMoved: 0, aliasesAdded: 0 };
  }

  const stats = { merged: 0, matchesMoved: 0, aliasesAdded: 0 };

  for (const pair of highConfidence) {
    // Keep team with more matches
    const keepId = pair.matches1 >= pair.matches2 ? pair.id1 : pair.id2;
    const deleteId = pair.matches1 >= pair.matches2 ? pair.id2 : pair.id1;
    const deleteName = pair.matches1 >= pair.matches2 ? pair.name2 : pair.name1;

    if (verbose) {
      console.log(`   Merging (${(pair.sim * 100).toFixed(1)}%): "${pair.name1}" + "${pair.name2}" → keep ${keepId.slice(0, 8)}`);
    }

    if (dryRun) {
      stats.merged++;
      continue;
    }

    try {
      await client.query('BEGIN');

      // Update match references
      const { rowCount: home } = await client.query(
        'UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2',
        [keepId, deleteId]
      );
      const { rowCount: away } = await client.query(
        'UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2',
        [keepId, deleteId]
      );

      // Update matches_played
      const { rows: count } = await client.query(
        'SELECT COUNT(*) as total FROM matches_v2 WHERE home_team_id = $1 OR away_team_id = $1',
        [keepId]
      );
      await client.query(
        'UPDATE teams_v2 SET matches_played = $1 WHERE id = $2',
        [parseInt(count[0].total), keepId]
      );

      // Audit log
      await client.query(`
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
        VALUES ('teams_v2', $1, 'AUTO_MERGE', $2, $3, 'teamDedup-auto', NOW())
      `, [deleteId, JSON.stringify({ name: deleteName }), JSON.stringify({ merged_into: keepId, similarity: pair.sim })]);

      // Delete duplicate
      await client.query('DELETE FROM teams_v2 WHERE id = $1', [deleteId]);

      // SELF-LEARNING: Update canonical registry
      const { rows: existingCanonical } = await client.query(
        'SELECT id, aliases FROM canonical_teams WHERE team_v2_id = $1',
        [keepId]
      );

      if (existingCanonical.length > 0) {
        const newAliases = [...new Set([...(existingCanonical[0].aliases || []), deleteName])];
        await client.query(
          'UPDATE canonical_teams SET aliases = $1, updated_at = NOW() WHERE id = $2',
          [newAliases, existingCanonical[0].id]
        );
        stats.aliasesAdded++;
      } else {
        await client.query(`
          INSERT INTO canonical_teams (canonical_name, birth_year, gender, state, aliases, team_v2_id)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING
        `, [pair.name1, pair.birth_year, pair.gender, pair.state, [deleteName], keepId]);
        stats.aliasesAdded++;
      }

      await client.query('COMMIT');

      stats.merged++;
      stats.matchesMoved += home + away;

    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`   ⚠️ Failed to merge ${pair.id1} + ${pair.id2}: ${err.message}`);
    }
  }

  console.log(`   ✅ Merged ${stats.merged} pairs, moved ${stats.matchesMoved} matches`);

  return stats;
}

/**
 * Detect duplicates that need human review (0.85 <= similarity < 0.95)
 */
export async function detectReviewCandidates(client, options = {}) {
  const { limit = 100 } = options;

  const { rows } = await client.query(`
    SELECT
      t1.id as id1,
      t1.canonical_name as name1,
      t1.birth_year,
      t1.gender,
      t1.matches_played as matches1,
      t2.id as id2,
      t2.canonical_name as name2,
      t2.matches_played as matches2,
      similarity(t1.canonical_name, t2.canonical_name) as sim
    FROM teams_v2 t1
    JOIN teams_v2 t2 ON t1.id < t2.id
      AND t1.birth_year = t2.birth_year
      AND t1.gender = t2.gender
      AND t1.birth_year IS NOT NULL
      AND similarity(t1.canonical_name, t2.canonical_name) >= $1
      AND similarity(t1.canonical_name, t2.canonical_name) < $2
    ORDER BY sim DESC
    LIMIT $3
  `, [CONFIG.REVIEW_THRESHOLD, CONFIG.AUTO_MERGE_THRESHOLD, limit]);

  return rows.map(r => ({
    similarity: parseFloat(r.sim),
    birth_year: r.birth_year,
    gender: r.gender,
    team1: { id: r.id1, name: r.name1, matches: r.matches1 },
    team2: { id: r.id2, name: r.name2, matches: r.matches2 },
  }));
}

// ===========================================
// REPORTING
// ===========================================

/**
 * Generate a report of duplicate teams
 */
export async function generateReport(client, options = {}) {
  const exact = await detectExactDuplicates(client, { limit: 100 });

  // Calculate totals
  const totalExtra = exact.reduce((sum, g) => sum + g.count - 1, 0);
  const totalMatchesAffected = exact.reduce((sum, g) =>
    sum + g.matches_played.reduce((s, m, i) => i > 0 ? s + m : s, 0), 0
  );

  return {
    timestamp: new Date().toISOString(),
    exactDuplicates: {
      groups: exact.length,
      totalExtraTeams: totalExtra,
      totalMatchesAffected,
      samples: exact.slice(0, 10).map(g => ({
        name: g.canonical_name,
        birth_year: g.birth_year,
        count: g.count,
        matches: g.matches_played,
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
  const autoMerge = args.includes('--auto-merge');
  const reviewCandidates = args.includes('--review-candidates');

  console.log('👥 TEAM DEDUPLICATION');
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

    if (reviewCandidates) {
      console.log('\n📋 Finding duplicates that need human review (0.85-0.95 similarity)...');
      const candidates = await detectReviewCandidates(client);
      console.log(`\n   Found ${candidates.length} candidates for review:\n`);
      for (const c of candidates.slice(0, 20)) {
        console.log(`   ${(c.similarity * 100).toFixed(1)}% | BY:${c.birth_year} ${c.gender} | "${c.team1.name}" vs "${c.team2.name}"`);
      }
      if (candidates.length > 20) {
        console.log(`   ... and ${candidates.length - 20} more`);
      }
      return;
    }

    if (autoMerge) {
      // High-confidence auto-merge (>= 0.95 similarity)
      const stats = await autoMergeHighConfidence(client, { dryRun, verbose });
      console.log('\n📊 AUTO-MERGE RESULTS:');
      console.log(`   Pairs ${dryRun ? 'would be ' : ''}merged: ${stats.merged}`);
      console.log(`   Matches ${dryRun ? 'would be ' : ''}moved: ${stats.matchesMoved}`);
      console.log(`   Aliases added to registry: ${stats.aliasesAdded}`);
      if (dryRun) {
        console.log('\n⚠️  This was a DRY RUN. Use --execute to actually merge teams.');
      }
      return;
    }

    // Default: exact match deduplication
    console.log('\n📋 Detecting duplicate teams...');
    const duplicates = await detectDuplicates(client, { exactOnly: true });

    console.log(`\n   Exact duplicate groups: ${duplicates.exact.length}`);
    const totalExtra = duplicates.exact.reduce((sum, g) => sum + g.count - 1, 0);
    console.log(`   Total extra teams: ${totalExtra}`);

    if (duplicates.exact.length === 0) {
      console.log('\n✅ No exact duplicates found!');
      return;
    }

    console.log('\n🔧 Merging duplicate teams...');
    const stats = await mergeAllDuplicates(duplicates, client, { dryRun, verbose });

    console.log('\n📊 RESULTS:');
    console.log(`   Groups processed: ${stats.groupsProcessed}`);
    console.log(`   Teams ${dryRun ? 'would be ' : ''}deleted: ${stats.teamsDeleted}`);
    console.log(`   Matches ${dryRun ? 'would be ' : ''}moved: ${stats.matchesMoved}`);

    if (stats.errors.length > 0) {
      console.log(`   Errors: ${stats.errors.length}`);
    }

    if (dryRun) {
      console.log('\n⚠️  This was a DRY RUN. Use --execute to actually merge teams.');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.includes('teamDedup')) {
  main().catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  });
}
