/**
 * fix_remaining_prefix.cjs — Force-fix remaining double-prefix teams
 * then merge the resulting duplicates with their clean counterparts.
 *
 * These teams were skipped by fixDoublePrefix.cjs because a clean-named
 * counterpart already exists. Since there's no unique constraint on
 * display_name, we can safely rename them (creating display_name duplicates),
 * then merge the duplicates.
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');

  console.log('=== Fix Remaining Double-Prefix Teams ===');
  console.log(`Mode: ${isExecute ? 'EXECUTE' : 'DRY RUN'}\n`);

  const client = await pool.connect();

  try {
    // Count remaining
    const countQ = await client.query(`
      SELECT COUNT(*) as cnt FROM teams_v2
      WHERE display_name ~* '^(.{3,30})\\s+\\1'
    `);
    console.log(`Remaining double-prefix teams: ${countQ.rows[0].cnt}\n`);

    if (!isExecute) {
      // Show samples
      const sampleQ = await client.query(`
        SELECT id, display_name,
               regexp_replace(display_name, '^(.{3,30})\\s+\\1', '\\1', 'i') as clean_name
        FROM teams_v2
        WHERE display_name ~* '^(.{3,30})\\s+\\1'
        LIMIT 10
      `);
      sampleQ.rows.forEach(r => {
        console.log(`  "${r.display_name}"`);
        console.log(`  → "${r.clean_name}"\n`);
      });
      console.log('--- DRY RUN COMPLETE. Use --execute to apply. ---');
      await pool.end();
      return;
    }

    await client.query('BEGIN');
    await authorizePipelineWrite(client);

    // Step 1: Rename all double-prefix display_names
    const renameQ = await client.query(`
      UPDATE teams_v2
      SET display_name = regexp_replace(display_name, '^(.{3,30})\\s+\\1', '\\1', 'i')
      WHERE display_name ~* '^(.{3,30})\\s+\\1'
    `);
    console.log(`Step 1: Renamed ${renameQ.rowCount} display_names`);

    // Fix canonical_names — delete collisions first, then rename rest
    const ctDelQ = await client.query(`
      DELETE FROM canonical_teams ct
      WHERE canonical_name ~* '^(.{3,30})\\s+\\1'
        AND EXISTS (
          SELECT 1 FROM canonical_teams ct2
          WHERE ct2.canonical_name = regexp_replace(ct.canonical_name, '^(.{3,30})\\s+\\1', '\\1', 'i')
            AND ct2.birth_year IS NOT DISTINCT FROM ct.birth_year
            AND ct2.gender IS NOT DISTINCT FROM ct.gender
            AND ct2.state IS NOT DISTINCT FROM ct.state
            AND ct2.id != ct.id
        )
    `);
    console.log(`Step 1b: Deleted ${ctDelQ.rowCount} colliding canonical_teams`);

    const renameCQ = await client.query(`
      UPDATE canonical_teams
      SET canonical_name = regexp_replace(canonical_name, '^(.{3,30})\\s+\\1', '\\1', 'i')
      WHERE canonical_name ~* '^(.{3,30})\\s+\\1'
    `);
    console.log(`Step 1c: Renamed ${renameCQ.rowCount} canonical_names`);

    // Step 2: Find newly-created duplicate groups
    const dupQ = await client.query(`
      SELECT display_name, birth_year, gender, COUNT(*) as cnt
      FROM teams_v2
      GROUP BY display_name, birth_year, gender
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
    `);
    console.log(`\nStep 2: Found ${dupQ.rows.length} duplicate groups to merge\n`);

    if (dupQ.rows.length === 0) {
      await client.query('COMMIT');
      console.log('No duplicates — done.');
      await pool.end();
      return;
    }

    // Step 3: Create temp merge map (same logic as mergeDuplicateRankedTeams.cjs)
    await client.query('DROP TABLE IF EXISTS _merge_map');
    await client.query(`
      CREATE TEMP TABLE _merge_map AS
      WITH ranked AS (
        SELECT id, display_name, birth_year, gender,
               matches_played, national_rank, elo_rating, created_at,
               ROW_NUMBER() OVER (
                 PARTITION BY display_name, birth_year, gender
                 ORDER BY matches_played DESC,
                          national_rank ASC NULLS LAST,
                          elo_rating DESC,
                          created_at ASC
               ) as rn
        FROM teams_v2
        WHERE EXISTS (
                SELECT 1 FROM (
                  SELECT display_name, birth_year, gender
                  FROM teams_v2
                  GROUP BY display_name, birth_year, gender
                  HAVING COUNT(*) > 1
                ) dg
                WHERE dg.display_name = teams_v2.display_name
                  AND dg.birth_year IS NOT DISTINCT FROM teams_v2.birth_year
                  AND dg.gender IS NOT DISTINCT FROM teams_v2.gender
              )
      )
      SELECT
        loser.id as loser_id,
        keeper.id as keeper_id
      FROM ranked loser
      JOIN ranked keeper
        ON keeper.display_name = loser.display_name
        AND keeper.birth_year IS NOT DISTINCT FROM loser.birth_year
        AND keeper.gender IS NOT DISTINCT FROM loser.gender
        AND keeper.rn = 1
      WHERE loser.rn > 1
    `);

    const mapCountQ = await client.query('SELECT COUNT(*) as cnt FROM _merge_map');
    console.log(`Merge map: ${mapCountQ.rows[0].cnt} losers → keepers`);

    // Step 4: Transfer GS rank to keepers (only fill NULLs)
    const transferQ = await client.query(`
      -- RANK PRESERVATION: LEAST keeps best (lowest) rank, GREATEST keeps best points
      UPDATE teams_v2 t
      SET national_rank = LEAST(t.national_rank, loser.national_rank),
          state_rank = LEAST(t.state_rank, loser.state_rank),
          regional_rank = LEAST(t.regional_rank, loser.regional_rank),
          gotsport_rank = LEAST(t.gotsport_rank, loser.gotsport_rank),
          gotsport_points = GREATEST(t.gotsport_points, loser.gotsport_points)
      FROM _merge_map mm
      JOIN teams_v2 loser ON loser.id = mm.loser_id
      WHERE t.id = mm.keeper_id
        AND (loser.national_rank IS NOT NULL OR loser.gotsport_rank IS NOT NULL)
    `);
    console.log(`Rank transfers: ${transferQ.rowCount}`);

    // Step 5: Soft-delete colliding matches
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
        SELECT id, match_date, new_home, new_away, home_score, created_at, TRUE as is_loser_match
        FROM loser_matches
        UNION ALL
        SELECT m.id, m.match_date, m.home_team_id, m.away_team_id, m.home_score, m.created_at, FALSE
        FROM matches_v2 m
        WHERE m.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM _merge_map mm WHERE m.home_team_id = mm.loser_id OR m.away_team_id = mm.loser_id)
      ),
      ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY match_date, new_home, new_away
                 ORDER BY is_loser_match ASC,
                   CASE WHEN home_score IS NOT NULL THEN 0 ELSE 1 END,
                   created_at ASC
               ) as rn
        FROM all_post_merge
      )
      UPDATE matches_v2 m
      SET deleted_at = NOW(), deletion_reason = 'Semantic duplicate: team merge (prefix fix)'
      FROM ranked r WHERE m.id = r.id AND r.rn > 1 AND m.deleted_at IS NULL
    `);
    console.log(`Colliding matches soft-deleted: ${preDelQ.rowCount}`);

    // Step 6: Soft-delete intra-squad matches
    const intraQ = await client.query(`
      UPDATE matches_v2 m
      SET deleted_at = NOW(),
          deletion_reason = 'Intra-squad match after team merge'
      FROM _merge_map mm_h, _merge_map mm_a
      WHERE m.home_team_id = mm_h.loser_id
        AND m.away_team_id = mm_a.loser_id
        AND mm_h.keeper_id = mm_a.keeper_id
        AND m.deleted_at IS NULL
    `);
    if (intraQ.rowCount > 0) console.log(`Intra-squad soft-deleted: ${intraQ.rowCount}`);

    const intra2Q = await client.query(`
      UPDATE matches_v2 m
      SET deleted_at = NOW(),
          deletion_reason = 'Intra-squad match after team merge'
      WHERE m.deleted_at IS NULL
        AND (
          (EXISTS (SELECT 1 FROM _merge_map mm WHERE m.home_team_id = mm.loser_id AND mm.keeper_id = m.away_team_id))
          OR
          (EXISTS (SELECT 1 FROM _merge_map mm WHERE m.away_team_id = mm.loser_id AND mm.keeper_id = m.home_team_id))
        )
    `);
    if (intra2Q.rowCount > 0) console.log(`Intra-squad (keeper) soft-deleted: ${intra2Q.rowCount}`);

    // Step 7: Re-point match FKs
    let matchesRepointed = 0;
    const homeRpQ = await client.query(`
      UPDATE matches_v2 m SET home_team_id = mm.keeper_id
      FROM _merge_map mm WHERE m.home_team_id = mm.loser_id AND m.deleted_at IS NULL
    `);
    matchesRepointed += homeRpQ.rowCount;
    const awayRpQ = await client.query(`
      UPDATE matches_v2 m SET away_team_id = mm.keeper_id
      FROM _merge_map mm WHERE m.away_team_id = mm.loser_id AND m.deleted_at IS NULL
    `);
    matchesRepointed += awayRpQ.rowCount;
    console.log(`Match FKs re-pointed: ${matchesRepointed}`);

    // Step 8: Re-point source_entity_map
    const semQ = await client.query(`
      UPDATE source_entity_map sem SET sv_id = mm.keeper_id
      FROM _merge_map mm WHERE sem.sv_id = mm.loser_id
    `);
    console.log(`source_entity_map re-pointed: ${semQ.rowCount}`);

    // Step 9: Re-point canonical_teams
    const ctQ = await client.query(`
      UPDATE canonical_teams ct SET team_v2_id = mm.keeper_id
      FROM _merge_map mm WHERE ct.team_v2_id = mm.loser_id
    `);
    console.log(`canonical_teams re-pointed: ${ctQ.rowCount}`);

    // Step 10: Handle league_standings
    await client.query(`
      DELETE FROM league_standings ls
      WHERE EXISTS (
        SELECT 1 FROM _merge_map mm
        WHERE ls.team_id = mm.loser_id
          AND EXISTS (
            SELECT 1 FROM league_standings ls2
            WHERE ls2.league_id = ls.league_id
              AND ls2.team_id = mm.keeper_id
              AND ls2.division IS NOT DISTINCT FROM ls.division
          )
      )
    `);
    const lsQ = await client.query(`
      UPDATE league_standings ls SET team_id = mm.keeper_id
      FROM _merge_map mm WHERE ls.team_id = mm.loser_id
    `);
    if (lsQ.rowCount > 0) console.log(`league_standings re-pointed: ${lsQ.rowCount}`);

    // Step 11: Delete rank_history_v2
    const rhQ = await client.query(`
      DELETE FROM rank_history_v2 rh
      WHERE EXISTS (SELECT 1 FROM _merge_map mm WHERE rh.team_id = mm.loser_id)
    `);
    console.log(`rank_history_v2 deleted: ${rhQ.rowCount}`);

    // Step 12: Delete loser teams
    const deleteQ = await client.query(`
      DELETE FROM teams_v2 t
      WHERE EXISTS (SELECT 1 FROM _merge_map mm WHERE t.id = mm.loser_id)
    `);
    console.log(`Teams deleted: ${deleteQ.rowCount}`);

    await client.query('DROP TABLE IF EXISTS _merge_map');
    await client.query('COMMIT');

    // Verify
    const verifyQ = await client.query(`
      SELECT COUNT(*) as cnt FROM teams_v2
      WHERE display_name ~* '^(.{3,30})\\s+\\1'
    `);
    console.log(`\nRemaining double-prefix: ${verifyQ.rows[0].cnt}`);

    const dupVerifyQ = await client.query(`
      SELECT COUNT(*) as cnt FROM (
        SELECT display_name, birth_year, gender
        FROM teams_v2
        GROUP BY display_name, birth_year, gender
        HAVING COUNT(*) > 1
      ) sub
    `);
    console.log(`Remaining duplicate groups: ${dupVerifyQ.rows[0].cnt}`);

    // Refresh views
    console.log('\nRefreshing views...');
    await client.query('SELECT refresh_app_views()');
    console.log('Views refreshed.');

    console.log('\n=== COMPLETE ===');

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
