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
 * Detect teams with exact same (canonical_name, birth_year, gender)
 * These are definite duplicates - same team from different sources
 *
 * SESSION 87 FIX: Added gender to GROUP BY to prevent cross-gender merges.
 * Previously grouped by (canonical_name, birth_year) only, which caused
 * "Jackson SC 2015 Girls Gold" and "Jackson SC 2015 Boys Team 1" to be
 * incorrectly grouped together as duplicates.
 */
export async function detectExactDuplicates(client, options = {}) {
  const { limit = 500 } = options;

  const { rows } = await client.query(`
    SELECT
      canonical_name,
      birth_year,
      gender,
      COUNT(*) as count,
      array_agg(id ORDER BY matches_played DESC, created_at) as team_ids,
      array_agg(state) as states,
      array_agg(matches_played) as matches_played,
      array_agg(elo_rating) as elo_ratings
    FROM teams_v2
    WHERE canonical_name IS NOT NULL
      AND birth_year IS NOT NULL
      AND gender IS NOT NULL
    GROUP BY canonical_name, birth_year, gender
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT $1
  `, [limit]);

  return rows.map(r => ({
    type: 'exact_match',
    canonical_name: r.canonical_name,
    birth_year: r.birth_year,
    gender: r.gender,  // SESSION 87: Now grouped by gender, single value
    count: parseInt(r.count),
    team_ids: r.team_ids,
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
 * UNIVERSAL: Detect same-name teams with NULL metadata
 *
 * This catches duplicates that the strict fuzzy match misses because:
 * - One team has birth_year/gender, the other has NULL
 * - Teams have identical names but weren't matched due to NULL handling
 *
 * Strategy:
 * 1. Find teams with very high similarity (>= 0.98) ignoring NULL metadata
 * 2. Require at least one has non-NULL birth_year to avoid false positives
 * 3. Prefer keeping the team with more complete metadata
 */
export async function detectSameNameDuplicates(client, options = {}) {
  const { limit = 500, threshold = 0.98 } = options;

  const { rows } = await client.query(`
    SELECT
      t1.id as id1,
      t1.canonical_name as name1,
      t1.display_name as display1,
      t1.birth_year as birth_year1,
      t1.gender as gender1,
      t1.matches_played as matches1,
      t2.id as id2,
      t2.canonical_name as name2,
      t2.display_name as display2,
      t2.birth_year as birth_year2,
      t2.gender as gender2,
      t2.matches_played as matches2,
      similarity(t1.canonical_name, t2.canonical_name) as sim
    FROM teams_v2 t1
    JOIN teams_v2 t2 ON t1.id < t2.id
      AND similarity(t1.canonical_name, t2.canonical_name) >= $1
      -- At least one must have birth_year to validate age group match
      AND (t1.birth_year IS NOT NULL OR t2.birth_year IS NOT NULL)
      -- If both have birth_year, they must match (or differ by 1 year max)
      AND (t1.birth_year IS NULL OR t2.birth_year IS NULL OR ABS(t1.birth_year - t2.birth_year) <= 1)
      -- Exclude teams with 0 matches that were already merged (have merged_into in audit_log)
      AND (t1.matches_played > 0 OR t2.matches_played > 0)
    ORDER BY sim DESC, (t1.matches_played + t2.matches_played) DESC
    LIMIT $2
  `, [threshold, limit]);

  return rows.map(r => ({
    type: 'same_name_null_metadata',
    similarity: parseFloat(r.sim),
    team1: {
      id: r.id1,
      name: r.name1,
      display_name: r.display1,
      birth_year: r.birth_year1,
      gender: r.gender1,
      matches_played: r.matches1,
    },
    team2: {
      id: r.id2,
      name: r.name2,
      display_name: r.display2,
      birth_year: r.birth_year2,
      gender: r.gender2,
      matches_played: r.matches2,
    },
  }));
}

/**
 * Merge same-name duplicates with NULL metadata handling
 *
 * UNIVERSAL: Works for any data source, fixes NULL metadata during merge
 */
export async function mergeSameNameDuplicates(client, options = {}) {
  const { dryRun = true, verbose = false, limit = 500 } = options;

  console.log(`\n🔄 Merging same-name duplicates (NULL metadata handling)...`);

  const duplicates = await detectSameNameDuplicates(client, { limit });
  console.log(`   Found ${duplicates.length} same-name duplicate pairs`);

  if (duplicates.length === 0) {
    return { merged: 0, matchesMoved: 0, metadataFixed: 0 };
  }

  const stats = { merged: 0, matchesMoved: 0, metadataFixed: 0, errors: [] };

  for (const dup of duplicates) {
    const { team1, team2 } = dup;

    // Decide which to keep:
    // 1. Prefer team with more complete metadata (non-NULL birth_year + gender)
    // 2. Then prefer team with more matches
    // 3. Then prefer team with verbose name (contains "(U" for age group)

    const meta1Score = (team1.birth_year ? 2 : 0) + (team1.gender ? 1 : 0);
    const meta2Score = (team2.birth_year ? 2 : 0) + (team2.gender ? 1 : 0);

    let keepTeam, mergeTeam;
    if (meta1Score > meta2Score) {
      keepTeam = team1;
      mergeTeam = team2;
    } else if (meta2Score > meta1Score) {
      keepTeam = team2;
      mergeTeam = team1;
    } else if (team1.matches_played >= team2.matches_played) {
      keepTeam = team1;
      mergeTeam = team2;
    } else {
      keepTeam = team2;
      mergeTeam = team1;
    }

    if (verbose) {
      console.log(`\n   ${(dup.similarity * 100).toFixed(1)}% similar:`);
      console.log(`     Keep:  "${keepTeam.name}" (BY:${keepTeam.birth_year}, G:${keepTeam.gender}, ${keepTeam.matches_played} matches)`);
      console.log(`     Merge: "${mergeTeam.name}" (BY:${mergeTeam.birth_year}, G:${mergeTeam.gender}, ${mergeTeam.matches_played} matches)`);
    }

    if (dryRun) {
      stats.merged++;
      continue;
    }

    try {
      await client.query('BEGIN');

      // 1. First, fix NULL metadata on keep team if merge team has it
      if (!keepTeam.birth_year && mergeTeam.birth_year) {
        await client.query('UPDATE teams_v2 SET birth_year = $1 WHERE id = $2', [mergeTeam.birth_year, keepTeam.id]);
        stats.metadataFixed++;
      }
      if (!keepTeam.gender && mergeTeam.gender) {
        await client.query('UPDATE teams_v2 SET gender = $1 WHERE id = $2', [mergeTeam.gender, keepTeam.id]);
        stats.metadataFixed++;
      }

      // 2. SESSION 89 FIX: Soft-delete semantic duplicates BEFORE updating FK refs
      // If keepTeam already has a match with same (date, opponent), soft-delete the mergeTeam version
      const { rowCount: dupeHomeDeleted } = await client.query(`
        UPDATE matches_v2 m
        SET deleted_at = NOW(),
            deletion_reason = 'Semantic duplicate after same-name team merge into ' || $1::text
        WHERE m.home_team_id = $2
          AND m.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM matches_v2 existing
            WHERE existing.match_date = m.match_date
              AND existing.home_team_id = $1::uuid
              AND existing.away_team_id = m.away_team_id
              AND existing.deleted_at IS NULL
          )
      `, [keepTeam.id, mergeTeam.id]);

      const { rowCount: dupeAwayDeleted } = await client.query(`
        UPDATE matches_v2 m
        SET deleted_at = NOW(),
            deletion_reason = 'Semantic duplicate after same-name team merge into ' || $1::text
        WHERE m.away_team_id = $2
          AND m.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM matches_v2 existing
            WHERE existing.match_date = m.match_date
              AND existing.home_team_id = m.home_team_id
              AND existing.away_team_id = $1::uuid
              AND existing.deleted_at IS NULL
          )
      `, [keepTeam.id, mergeTeam.id]);

      // 3. Update remaining match references (only non-soft-deleted)
      const { rowCount: home } = await client.query(
        'UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2 AND deleted_at IS NULL',
        [keepTeam.id, mergeTeam.id]
      );
      const { rowCount: away } = await client.query(
        'UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2 AND deleted_at IS NULL',
        [keepTeam.id, mergeTeam.id]
      );

      stats.matchesMoved += home + away;

      // 4. Update matches_played count on keep team
      const { rows: count } = await client.query(
        'SELECT COUNT(*) as total FROM matches_v2 WHERE (home_team_id = $1 OR away_team_id = $1) AND deleted_at IS NULL',
        [keepTeam.id]
      );
      await client.query(
        'UPDATE teams_v2 SET matches_played = $1 WHERE id = $2',
        [parseInt(count[0].total), keepTeam.id]
      );

      // 5. Audit log
      await client.query(`
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
        VALUES ('teams_v2', $1, 'SAME_NAME_MERGE', $2, $3, 'teamDedup-sameName', NOW())
      `, [
        mergeTeam.id,
        JSON.stringify({ name: mergeTeam.name, birth_year: mergeTeam.birth_year, gender: mergeTeam.gender }),
        JSON.stringify({ merged_into: keepTeam.id, similarity: dup.similarity }),
      ]);

      // 6. SESSION 87 FIX: Delete FK references BEFORE deleting team
      await client.query('DELETE FROM canonical_teams WHERE team_v2_id = $1', [mergeTeam.id]);
      await client.query('DELETE FROM rank_history_v2 WHERE team_id = $1', [mergeTeam.id]);

      // 7. Hard delete merged team (now safe - no FK references)
      await client.query('DELETE FROM teams_v2 WHERE id = $1', [mergeTeam.id]);

      // 8. SELF-LEARNING: Update canonical registry for kept team
      const { rows: existingCanonical } = await client.query(
        'SELECT id, aliases FROM canonical_teams WHERE team_v2_id = $1',
        [keepTeam.id]
      );

      if (existingCanonical.length > 0) {
        const newAliases = [...new Set([...(existingCanonical[0].aliases || []), mergeTeam.name, mergeTeam.display_name].filter(Boolean))];
        await client.query(
          'UPDATE canonical_teams SET aliases = $1, updated_at = NOW() WHERE id = $2',
          [newAliases, existingCanonical[0].id]
        );
      }

      await client.query('COMMIT');
      stats.merged++;

    } catch (err) {
      await client.query('ROLLBACK');
      stats.errors.push({ keep: keepTeam.id, merge: mergeTeam.id, error: err.message });
      if (verbose) console.error(`   ⚠️ Error: ${err.message}`);
    }
  }

  console.log(`   ✅ Merged ${stats.merged} pairs, moved ${stats.matchesMoved} matches, fixed ${stats.metadataFixed} metadata`);
  if (stats.errors.length > 0) {
    console.log(`   ⚠️ ${stats.errors.length} errors`);
  }

  return stats;
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
    console.log(`  Merging: "${group.canonical_name}" (BY:${group.birth_year} ${group.gender})`);
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
    // SESSION 87 FIX: Handle internal matches (both teams in merge group)
    // These are intra-squad scrimmages where merging would violate different_teams_match constraint
    const allGroupIds = [decision.keepId, ...decision.deleteIds];
    const { rowCount: internalDeleted } = await client.query(`
      UPDATE matches_v2
      SET deleted_at = NOW(),
          deletion_reason = 'Intra-squad scrimmage - both teams merged to same entity'
      WHERE home_team_id = ANY($1::uuid[])
        AND away_team_id = ANY($1::uuid[])
        AND home_team_id != away_team_id
        AND deleted_at IS NULL
    `, [allGroupIds]);
    if (internalDeleted > 0 && verbose) {
      console.log(`    Soft-deleted ${internalDeleted} intra-squad matches`);
    }

    // SESSION 87 FIX: Handle semantic duplicates that would arise from merge
    // If match (date, keep_id, away) already exists, don't update match (date, delete_id, away)
    // Soft-delete the duplicate instead
    const { rowCount: dupeHomeDeleted } = await client.query(`
      UPDATE matches_v2 m
      SET deleted_at = NOW(),
          deletion_reason = 'Semantic duplicate after team merge'
      WHERE m.home_team_id = ANY($2::uuid[])
        AND m.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM matches_v2 existing
          WHERE existing.match_date = m.match_date
            AND existing.home_team_id = $1::uuid
            AND existing.away_team_id = m.away_team_id
            AND existing.deleted_at IS NULL
        )
    `, [decision.keepId, decision.deleteIds]);

    const { rowCount: dupeAwayDeleted } = await client.query(`
      UPDATE matches_v2 m
      SET deleted_at = NOW(),
          deletion_reason = 'Semantic duplicate after team merge'
      WHERE m.away_team_id = ANY($2::uuid[])
        AND m.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM matches_v2 existing
          WHERE existing.match_date = m.match_date
            AND existing.home_team_id = m.home_team_id
            AND existing.away_team_id = $1::uuid
            AND existing.deleted_at IS NULL
        )
    `, [decision.keepId, decision.deleteIds]);

    if ((dupeHomeDeleted + dupeAwayDeleted) > 0 && verbose) {
      console.log(`    Soft-deleted ${dupeHomeDeleted + dupeAwayDeleted} semantic duplicates`);
    }

    // 1. Update matches - change home_team_id references (only non-duplicates)
    const { rowCount: homeUpdated } = await client.query(`
      UPDATE matches_v2
      SET home_team_id = $1::uuid
      WHERE home_team_id = ANY($2::uuid[])
        AND deleted_at IS NULL
    `, [decision.keepId, decision.deleteIds]);

    // 2. Update matches - change away_team_id references (only non-duplicates)
    const { rowCount: awayUpdated } = await client.query(`
      UPDATE matches_v2
      SET away_team_id = $1::uuid
      WHERE away_team_id = ANY($2::uuid[])
        AND deleted_at IS NULL
    `, [decision.keepId, decision.deleteIds]);

    // 3. Update kept team's matches_played count
    const { rows: matchCount } = await client.query(`
      SELECT COUNT(*) as total FROM matches_v2
      WHERE (home_team_id = $1 OR away_team_id = $1) AND deleted_at IS NULL
    `, [decision.keepId]);

    await client.query(`
      UPDATE teams_v2
      SET matches_played = $1
      WHERE id = $2
    `, [parseInt(matchCount[0].total), decision.keepId]);

    // 4. Get deleted team names BEFORE deleting (for self-learning)
    const { rows: deletedTeams } = await client.query(`
      SELECT canonical_name, display_name FROM teams_v2 WHERE id = ANY($1::uuid[])
    `, [decision.deleteIds]);
    const mergedNames = deletedTeams.map(t => t.display_name || t.canonical_name);

    // 5. Log deletions to audit (cast $1 to text for jsonb_build_object)
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
      SELECT 'teams_v2', id, 'MERGE_DELETE',
        row_to_json(teams_v2),
        jsonb_build_object('merged_into', $1::text, 'reason', $2::text),
        'teamDedup', NOW()
      FROM teams_v2
      WHERE id = ANY($3::uuid[])
    `, [decision.keepId, decision.reason, decision.deleteIds]);

    // 6. SESSION 87 FIX: Delete FK references BEFORE deleting teams
    // canonical_teams has FK constraint to teams_v2, must delete first
    await client.query(`
      DELETE FROM canonical_teams WHERE team_v2_id = ANY($1::uuid[])
    `, [decision.deleteIds]);

    // 7. Delete from rank_history_v2 (also has FK to teams_v2)
    await client.query(`
      DELETE FROM rank_history_v2 WHERE team_id = ANY($1::uuid[])
    `, [decision.deleteIds]);

    // 8. Delete duplicate teams (now safe - no FK references)
    const { rowCount: deleted } = await client.query(`
      DELETE FROM teams_v2
      WHERE id = ANY($1::uuid[])
    `, [decision.deleteIds]);

    // 9. SELF-LEARNING: Add merged team names to canonical_teams registry
    if (mergedNames.length > 0) {
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

      // SESSION 89 FIX: Soft-delete semantic duplicates BEFORE updating FK refs
      await client.query(`
        UPDATE matches_v2 m
        SET deleted_at = NOW(),
            deletion_reason = 'Semantic duplicate after auto-merge team into ' || $1::text
        WHERE m.home_team_id = $2
          AND m.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM matches_v2 existing
            WHERE existing.match_date = m.match_date
              AND existing.home_team_id = $1::uuid
              AND existing.away_team_id = m.away_team_id
              AND existing.deleted_at IS NULL
          )
      `, [keepId, deleteId]);

      await client.query(`
        UPDATE matches_v2 m
        SET deleted_at = NOW(),
            deletion_reason = 'Semantic duplicate after auto-merge team into ' || $1::text
        WHERE m.away_team_id = $2
          AND m.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM matches_v2 existing
            WHERE existing.match_date = m.match_date
              AND existing.home_team_id = m.home_team_id
              AND existing.away_team_id = $1::uuid
              AND existing.deleted_at IS NULL
          )
      `, [keepId, deleteId]);

      // Update match references (only non-soft-deleted)
      const { rowCount: home } = await client.query(
        'UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2 AND deleted_at IS NULL',
        [keepId, deleteId]
      );
      const { rowCount: away } = await client.query(
        'UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2 AND deleted_at IS NULL',
        [keepId, deleteId]
      );

      // Update matches_played
      const { rows: count } = await client.query(
        'SELECT COUNT(*) as total FROM matches_v2 WHERE (home_team_id = $1 OR away_team_id = $1) AND deleted_at IS NULL',
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

      // SESSION 87 FIX: Delete FK references BEFORE deleting team
      await client.query('DELETE FROM canonical_teams WHERE team_v2_id = $1', [deleteId]);
      await client.query('DELETE FROM rank_history_v2 WHERE team_id = $1', [deleteId]);

      // Delete duplicate (now safe - no FK references)
      await client.query('DELETE FROM teams_v2 WHERE id = $1', [deleteId]);

      // SELF-LEARNING: Update canonical registry for kept team
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
        gender: g.gender,  // SESSION 87: Added gender
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
  const sameNameMerge = args.includes('--same-name');

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

    if (sameNameMerge) {
      // UNIVERSAL: Same-name duplicates with NULL metadata handling
      const stats = await mergeSameNameDuplicates(client, { dryRun, verbose });
      console.log('\n📊 SAME-NAME MERGE RESULTS:');
      console.log(`   Pairs ${dryRun ? 'would be ' : ''}merged: ${stats.merged}`);
      console.log(`   Matches ${dryRun ? 'would be ' : ''}moved: ${stats.matchesMoved}`);
      console.log(`   Metadata fixed: ${stats.metadataFixed}`);
      if (stats.errors && stats.errors.length > 0) {
        console.log(`   Errors: ${stats.errors.length}`);
      }
      if (dryRun) {
        console.log('\n⚠️  This was a DRY RUN. Use --execute to actually merge teams.');
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
