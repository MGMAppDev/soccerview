/**
 * mergeDuplicateRankedTeams.cjs — Universal merge for same-name duplicate teams
 * ==============================================================================
 * Finds teams_v2 records that share the same display_name + birth_year + gender
 * but exist as multiple UUID records. Keeps the best record (most matches, then
 * best rank), transfers GotSport ranking data, re-points FKs, deletes the rest.
 *
 * Handles ALL duplicate patterns universally:
 *   - Orphan with rank + target with matches (canonical_name mismatch)
 *   - Both have rank data (keep best)
 *   - Both have 0 matches (keep the one with rank)
 *   - Both have matches (keep the one with most matches)
 *
 * Usage:
 *   node scripts/maintenance/mergeDuplicateRankedTeams.cjs              # Dry-run
 *   node scripts/maintenance/mergeDuplicateRankedTeams.cjs --dry-run    # Explicit
 *   node scripts/maintenance/mergeDuplicateRankedTeams.cjs --execute    # Apply merges
 *
 * Safe: dry-run by default, shows counts and samples before any changes.
 * Universal: works for ANY data source. No hardcoding.
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isDryRun = !isExecute;

  console.log('=== Merge Same-Name Duplicate Teams ===');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'EXECUTE (will merge data)'}\n`);

  const client = await pool.connect();

  try {
    // ---------------------------------------------------------------
    // Step 1: Diagnosis — find all same-name duplicate groups
    // ---------------------------------------------------------------
    console.log('--- Step 1: Find Duplicate Groups ---\n');

    const groupsQ = await client.query(`
      SELECT display_name, birth_year, gender, COUNT(*) as cnt
      FROM teams_v2
      GROUP BY display_name, birth_year, gender
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
    `);
    console.log(`Total duplicate groups (same display_name + birth_year + gender): ${groupsQ.rows.length}`);

    if (groupsQ.rows.length === 0) {
      console.log('\nNo duplicate groups found. Nothing to do.');
      return;
    }

    // For each group, identify keeper (most matches, then best rank, then earliest)
    // and losers (to be merged into keeper)
    const detailQ = await client.query(`
      WITH groups AS (
        SELECT display_name, birth_year, gender
        FROM teams_v2
        GROUP BY display_name, birth_year, gender
        HAVING COUNT(*) > 1
      ),
      ranked AS (
        SELECT t.id, t.display_name, t.birth_year, t.gender, t.state,
               t.matches_played, t.national_rank, t.state_rank, t.regional_rank,
               t.gotsport_rank, t.gotsport_points, t.elo_rating, t.canonical_name,
               ROW_NUMBER() OVER (
                 PARTITION BY t.display_name, t.birth_year, t.gender
                 ORDER BY t.matches_played DESC NULLS LAST,
                          t.national_rank ASC NULLS LAST,
                          t.elo_rating DESC NULLS LAST,
                          t.created_at ASC
               ) as rn
        FROM teams_v2 t
        JOIN groups g ON t.display_name = g.display_name
          AND t.birth_year IS NOT DISTINCT FROM g.birth_year
          AND t.gender IS NOT DISTINCT FROM g.gender
      )
      SELECT * FROM ranked ORDER BY display_name, birth_year, rn
    `);

    // Organize into groups
    const groups = new Map();
    detailQ.rows.forEach(r => {
      const key = `${r.display_name}|${r.birth_year}|${r.gender}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    // Stats
    let totalLosers = 0;
    let losersWithMatches = 0;
    let losersWithRank = 0;
    const stateCounts = {};

    for (const [, members] of groups) {
      const keeper = members[0]; // rn=1
      const losers = members.slice(1);
      totalLosers += losers.length;
      losers.forEach(l => {
        if (l.matches_played > 0) losersWithMatches++;
        if (l.national_rank) losersWithRank++;
        const st = keeper.state || 'NULL';
        stateCounts[st] = (stateCounts[st] || 0) + 1;
      });
    }

    console.log(`Duplicate groups: ${groups.size}`);
    console.log(`Records to merge (losers): ${totalLosers}`);
    console.log(`  - Losers with matches: ${losersWithMatches} (will re-point match FKs)`);
    console.log(`  - Losers with GS rank: ${losersWithRank} (will transfer rank to keeper)`);

    console.log('\nBy state (top 15):');
    Object.entries(stateCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([st, cnt]) => console.log(`  ${st}: ${cnt}`));

    // Sample groups
    console.log('\nSample merges (first 10):');
    let shown = 0;
    for (const [, members] of groups) {
      if (shown >= 10) break;
      const keeper = members[0];
      const losers = members.slice(1);
      console.log(`  KEEP: [${keeper.id.slice(0,8)}] "${keeper.display_name}" | mp=${keeper.matches_played} elo=${keeper.elo_rating} nat=${keeper.national_rank}`);
      losers.forEach(l => {
        console.log(`  DROP: [${l.id.slice(0,8)}] "${l.display_name}" | mp=${l.matches_played} elo=${l.elo_rating} nat=${l.national_rank}`);
      });
      console.log('');
      shown++;
    }

    if (isDryRun) {
      console.log('--- DRY RUN COMPLETE ---');
      console.log('Run with --execute to apply merges.');
      return;
    }

    // ---------------------------------------------------------------
    // Step 2: Execute merges in bulk SQL
    // ---------------------------------------------------------------
    console.log('\n--- Step 2: Executing Merges ---\n');

    await client.query('BEGIN');
    await authorizePipelineWrite(client);

    // Step 2a: Transfer GotSport rank data from losers to keepers
    // For each group, keeper gets the BEST (lowest) national_rank from any member
    const transferQ = await client.query(`
      WITH groups AS (
        SELECT display_name, birth_year, gender
        FROM teams_v2
        GROUP BY display_name, birth_year, gender
        HAVING COUNT(*) > 1
      ),
      ranked AS (
        SELECT t.id, t.display_name, t.birth_year, t.gender,
               t.matches_played, t.national_rank, t.state_rank, t.regional_rank,
               t.gotsport_rank, t.gotsport_points,
               ROW_NUMBER() OVER (
                 PARTITION BY t.display_name, t.birth_year, t.gender
                 ORDER BY t.matches_played DESC NULLS LAST,
                          t.national_rank ASC NULLS LAST,
                          t.elo_rating DESC NULLS LAST,
                          t.created_at ASC
               ) as rn
        FROM teams_v2 t
        JOIN groups g ON t.display_name = g.display_name
          AND t.birth_year IS NOT DISTINCT FROM g.birth_year
          AND t.gender IS NOT DISTINCT FROM g.gender
      ),
      best_rank AS (
        SELECT display_name, birth_year, gender,
               MIN(national_rank) as best_national_rank,
               MIN(state_rank) as best_state_rank,
               MIN(regional_rank) as best_regional_rank,
               MIN(gotsport_rank) as best_gotsport_rank,
               MAX(gotsport_points) as best_gotsport_points
        FROM ranked
        WHERE national_rank IS NOT NULL
        GROUP BY display_name, birth_year, gender
      )
      -- RANK PRESERVATION: LEAST keeps best (lowest) rank, GREATEST keeps best points
      -- PostgreSQL LEAST/GREATEST skip NULLs: LEAST(NULL, 4) = 4
      UPDATE teams_v2 t
      SET national_rank = LEAST(t.national_rank, br.best_national_rank),
          state_rank = LEAST(t.state_rank, br.best_state_rank),
          regional_rank = LEAST(t.regional_rank, br.best_regional_rank),
          gotsport_rank = LEAST(t.gotsport_rank, br.best_gotsport_rank),
          gotsport_points = GREATEST(t.gotsport_points, br.best_gotsport_points),
          updated_at = NOW()
      FROM ranked r
      JOIN best_rank br ON r.display_name = br.display_name
        AND r.birth_year IS NOT DISTINCT FROM br.birth_year
        AND r.gender IS NOT DISTINCT FROM br.gender
      WHERE t.id = r.id
        AND r.rn = 1
        AND br.best_national_rank IS NOT NULL
    `);
    console.log(`Transferred GotSport rank to ${transferQ.rowCount} keepers`);

    // Step 2b: Collect keeper/loser mapping
    const mappingQ = await client.query(`
      WITH groups AS (
        SELECT display_name, birth_year, gender
        FROM teams_v2
        GROUP BY display_name, birth_year, gender
        HAVING COUNT(*) > 1
      ),
      ranked AS (
        SELECT t.id, t.display_name, t.birth_year, t.gender,
               t.matches_played,
               ROW_NUMBER() OVER (
                 PARTITION BY t.display_name, t.birth_year, t.gender
                 ORDER BY t.matches_played DESC NULLS LAST,
                          t.national_rank ASC NULLS LAST,
                          t.elo_rating DESC NULLS LAST,
                          t.created_at ASC
               ) as rn
        FROM teams_v2 t
        JOIN groups g ON t.display_name = g.display_name
          AND t.birth_year IS NOT DISTINCT FROM g.birth_year
          AND t.gender IS NOT DISTINCT FROM g.gender
      ),
      keepers AS (
        SELECT id as keeper_id, display_name, birth_year, gender FROM ranked WHERE rn = 1
      )
      SELECT r.id as loser_id, k.keeper_id, r.display_name, r.matches_played as loser_matches
      FROM ranked r
      JOIN keepers k ON r.display_name = k.display_name
        AND r.birth_year IS NOT DISTINCT FROM k.birth_year
        AND r.gender IS NOT DISTINCT FROM k.gender
      WHERE r.rn > 1
    `);
    const loserIds = mappingQ.rows.map(r => r.loser_id);
    console.log(`Losers to clean up: ${loserIds.length}`);

    if (loserIds.length === 0) {
      await client.query('COMMIT');
      console.log('No losers to merge. Done.');
      return;
    }

    // Step 2c: Handle match FKs — comprehensive collision-safe approach
    // 1. Compute what each loser match's semantic key would be after re-pointing
    // 2. Rank ALL matches (existing + would-be-repointed) by semantic key
    // 3. Soft-delete non-winners
    // 4. Re-point survivors
    const BATCH_SIZE = 500;

    // Build full loser→keeper mapping table
    const mapValues = mappingQ.rows.map((r, idx) => `($${idx*2+1}::uuid, $${idx*2+2}::uuid)`).join(',');
    const mapParams = mappingQ.rows.flatMap(r => [r.loser_id, r.keeper_id]);

    // Create temp table for the mapping (avoids huge VALUES in multiple queries)
    await client.query('CREATE TEMP TABLE _merge_map (loser_id uuid, keeper_id uuid) ON COMMIT DROP');
    for (let i = 0; i < mappingQ.rows.length; i += BATCH_SIZE) {
      const batch = mappingQ.rows.slice(i, i + BATCH_SIZE);
      const vals = batch.map((r, idx) => `($${idx*2+1}::uuid, $${idx*2+2}::uuid)`).join(',');
      const params = batch.flatMap(r => [r.loser_id, r.keeper_id]);
      await client.query(`INSERT INTO _merge_map VALUES ${vals}`, params);
    }
    console.log('Built merge mapping table');

    // Soft-delete ALL loser matches that would collide after re-pointing
    // This handles: collisions with keeper's existing matches AND collisions between losers
    const preDelQ = await client.query(`
      WITH loser_matches AS (
        SELECT m.id, m.match_date, m.home_score, m.created_at,
               CASE WHEN mm_h.keeper_id IS NOT NULL THEN mm_h.keeper_id ELSE m.home_team_id END as new_home,
               CASE WHEN mm_a.keeper_id IS NOT NULL THEN mm_a.keeper_id ELSE m.away_team_id END as new_away
        FROM matches_v2 m
        LEFT JOIN _merge_map mm_h ON m.home_team_id = mm_h.loser_id
        LEFT JOIN _merge_map mm_a ON m.away_team_id = mm_a.loser_id
        WHERE m.deleted_at IS NULL
          AND (mm_h.loser_id IS NOT NULL OR mm_a.loser_id IS NOT NULL)
      ),
      all_post_merge AS (
        -- Loser matches with projected new keys
        SELECT id, match_date, new_home, new_away, home_score, created_at, TRUE as is_loser_match
        FROM loser_matches
        UNION ALL
        -- Existing non-loser matches (keeper's matches stay as-is)
        SELECT m.id, m.match_date, m.home_team_id, m.away_team_id, m.home_score, m.created_at, FALSE
        FROM matches_v2 m
        WHERE m.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM _merge_map mm WHERE m.home_team_id = mm.loser_id OR m.away_team_id = mm.loser_id)
      ),
      ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY match_date, new_home, new_away
                 ORDER BY
                   is_loser_match ASC,
                   CASE WHEN home_score IS NOT NULL THEN 0 ELSE 1 END,
                   created_at ASC
               ) as rn
        FROM all_post_merge
      )
      UPDATE matches_v2 m
      SET deleted_at = NOW(),
          deletion_reason = 'Semantic duplicate: team merge'
      FROM ranked r
      WHERE m.id = r.id AND r.rn > 1 AND m.deleted_at IS NULL
    `);
    console.log(`Soft-deleted ${preDelQ.rowCount} colliding/duplicate matches`);

    // Soft-delete "intra-squad" matches where both teams would become the same keeper
    const intraQ = await client.query(`
      UPDATE matches_v2 m
      SET deleted_at = NOW(),
          deletion_reason = 'Intra-squad match after team merge (home=away)'
      FROM _merge_map mm_h, _merge_map mm_a
      WHERE m.home_team_id = mm_h.loser_id
        AND m.away_team_id = mm_a.loser_id
        AND mm_h.keeper_id = mm_a.keeper_id
        AND m.deleted_at IS NULL
    `);
    if (intraQ.rowCount > 0) {
      console.log(`Soft-deleted ${intraQ.rowCount} intra-squad matches (both teams → same keeper)`);
    }

    // Also catch: one team is already the keeper, other team is a loser mapping to same keeper
    const intra2Q = await client.query(`
      UPDATE matches_v2 m
      SET deleted_at = NOW(),
          deletion_reason = 'Intra-squad match after team merge (home=away)'
      WHERE m.deleted_at IS NULL
        AND (
          (EXISTS (SELECT 1 FROM _merge_map mm WHERE m.home_team_id = mm.loser_id AND mm.keeper_id = m.away_team_id))
          OR
          (EXISTS (SELECT 1 FROM _merge_map mm WHERE m.away_team_id = mm.loser_id AND mm.keeper_id = m.home_team_id))
        )
    `);
    if (intra2Q.rowCount > 0) {
      console.log(`Soft-deleted ${intra2Q.rowCount} more intra-squad matches`);
    }

    // Now re-point surviving loser matches (no more collisions possible)
    let matchesRepointed = 0;
    const homeRpQ = await client.query(`
      UPDATE matches_v2 m
      SET home_team_id = mm.keeper_id
      FROM _merge_map mm
      WHERE m.home_team_id = mm.loser_id AND m.deleted_at IS NULL
    `);
    matchesRepointed += homeRpQ.rowCount;

    const awayRpQ = await client.query(`
      UPDATE matches_v2 m
      SET away_team_id = mm.keeper_id
      FROM _merge_map mm
      WHERE m.away_team_id = mm.loser_id AND m.deleted_at IS NULL
    `);
    matchesRepointed += awayRpQ.rowCount;
    console.log(`Re-pointed ${matchesRepointed} match FK references`);

    // Step 2e: Re-point source_entity_map
    const semRpQ = await client.query(`
      UPDATE source_entity_map sem
      SET sv_id = mm.keeper_id
      FROM _merge_map mm
      WHERE sem.sv_id = mm.loser_id AND sem.entity_type = 'team'
    `);
    console.log(`Re-pointed ${semRpQ.rowCount} source_entity_map entries`);

    // Step 2f: Re-point canonical_teams
    const ctRpQ = await client.query(`
      UPDATE canonical_teams ct
      SET team_v2_id = mm.keeper_id
      FROM _merge_map mm
      WHERE ct.team_v2_id = mm.loser_id
    `);
    console.log(`Re-pointed ${ctRpQ.rowCount} canonical_teams entries`);

    // Step 2g: Handle league_standings FK — delete conflicting, re-point rest
    const lsDelQ = await client.query(`
      DELETE FROM league_standings ls
      USING _merge_map mm
      WHERE ls.team_id = mm.loser_id
        AND EXISTS (
          SELECT 1 FROM league_standings existing
          WHERE existing.league_id = ls.league_id
            AND existing.team_id = mm.keeper_id
            AND existing.division IS NOT DISTINCT FROM ls.division
            AND existing.id != ls.id
        )
    `);
    if (lsDelQ.rowCount > 0) {
      console.log(`Deleted ${lsDelQ.rowCount} conflicting league_standings entries`);
    }

    const lsRpQ = await client.query(`
      UPDATE league_standings ls
      SET team_id = mm.keeper_id
      FROM _merge_map mm
      WHERE ls.team_id = mm.loser_id
    `);
    console.log(`Re-pointed ${lsRpQ.rowCount} league_standings entries`);

    // Step 2h: Delete rank_history_v2 for losers (FK constraint)
    const rhDeleteQ = await client.query(`
      DELETE FROM rank_history_v2
      WHERE team_id = ANY($1::uuid[])
    `, [loserIds]);
    console.log(`Deleted ${rhDeleteQ.rowCount} rank_history_v2 entries`);

    // Step 2h: Delete loser team records
    const deleteQ = await client.query(`
      DELETE FROM teams_v2
      WHERE id = ANY($1::uuid[])
    `, [loserIds]);
    console.log(`Deleted ${deleteQ.rowCount} duplicate team records`);

    await client.query('COMMIT');
    console.log('\nMerges committed.');

    // ---------------------------------------------------------------
    // Step 3: Verify and refresh
    // ---------------------------------------------------------------
    console.log('\n--- Step 3: Verification ---\n');

    const verifyQ = await client.query(`
      SELECT COUNT(*) as cnt FROM (
        SELECT display_name, birth_year, gender
        FROM teams_v2
        GROUP BY display_name, birth_year, gender
        HAVING COUNT(*) > 1
      ) sub
    `);
    console.log(`Remaining duplicate groups: ${verifyQ.rows[0].cnt}`);

    console.log('\nRefreshing app views...');
    await client.query('SELECT refresh_app_views()');
    console.log('Views refreshed.');

    // Quick KS U11 Boys check
    const ksCheckQ = await client.query(`
      SELECT display_name, COUNT(*) as cnt
      FROM app_rankings
      WHERE state = 'KS' AND birth_year = 2015 AND gender = 'M'
      GROUP BY display_name
      HAVING COUNT(*) > 1
      LIMIT 5
    `);
    if (ksCheckQ.rows.length === 0) {
      console.log('KS U11 Boys: No duplicate display_names in app_rankings');
    } else {
      console.log(`KS U11 Boys: ${ksCheckQ.rows.length} duplicates remaining:`);
      ksCheckQ.rows.forEach(r => console.log(`  "${r.display_name}": ${r.cnt}`));
    }

    console.log(`\n=== MERGE COMPLETE ===`);
    console.log(`Rank transfers: ${transferQ.rowCount}`);
    console.log(`Match FKs re-pointed: ${matchesRepointed}`);
    console.log(`Matches soft-deleted: ${preDelQ.rowCount + intraQ.rowCount + intra2Q.rowCount}`);
    console.log(`Teams deleted: ${deleteQ.rowCount}`);

  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
  } finally {
    client.release();
    await pool.end();
  }
}

main();
