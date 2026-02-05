/**
 * Session 86: BULK merge all exact-name duplicate teams
 *
 * FAST: Uses single SQL statements instead of row-by-row loops
 * Processes thousands of teams in seconds.
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 600000, // 10 minutes
});

async function bulkMerge(dryRun = true) {
  console.log('=== BULK MERGE DUPLICATE TEAMS ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️ EXECUTE'}\n`);

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    await authorizePipelineWrite(client);

    // Step 1: Count duplicates
    console.log('1. Counting exact display_name duplicates...');
    const countResult = await client.query(`
      SELECT COUNT(DISTINCT display_name) as groups,
             SUM(cnt - 1) as extra_teams
      FROM (
        SELECT display_name, COUNT(*) as cnt
        FROM teams_v2
        WHERE display_name IS NOT NULL
        GROUP BY display_name
        HAVING COUNT(*) > 1
      ) t
    `);
    console.log(`   Groups: ${countResult.rows[0].groups}`);
    console.log(`   Extra teams to merge: ${countResult.rows[0].extra_teams}\n`);

    if (parseInt(countResult.rows[0].groups) === 0) {
      console.log('✅ No duplicates found!');
      await pool.end();
      return;
    }

    if (dryRun) {
      console.log('⚠️ DRY RUN - Use --execute to proceed');
      await pool.end();
      return;
    }

    await client.query('BEGIN');

    // Step 2: Create temp table with keep/delete mapping
    console.log('2. Creating merge mapping...');
    await client.query(`
      CREATE TEMP TABLE team_merge_map AS
      WITH ranked AS (
        SELECT
          id,
          display_name,
          matches_played,
          birth_year,
          gender,
          ROW_NUMBER() OVER (
            PARTITION BY display_name
            ORDER BY matches_played DESC, created_at ASC
          ) as rn
        FROM teams_v2
        WHERE display_name IS NOT NULL
      ),
      duplicates AS (
        SELECT display_name
        FROM ranked
        GROUP BY display_name
        HAVING COUNT(*) > 1
      )
      SELECT
        r.id as delete_id,
        k.id as keep_id,
        r.display_name
      FROM ranked r
      JOIN duplicates d ON r.display_name = d.display_name
      JOIN ranked k ON r.display_name = k.display_name AND k.rn = 1
      WHERE r.rn > 1
    `);

    const mapCount = await client.query('SELECT COUNT(*) as cnt FROM team_merge_map');
    console.log(`   Teams to delete: ${mapCount.rows[0].cnt}`);

    // Step 3: Delete matches that would conflict BEFORE updating
    // These are matches where after remapping, we'd have duplicates
    console.log('3. Finding and deleting conflicting matches...');
    const conflictResult = await client.query(`
      WITH potential_conflicts AS (
        -- Matches that would have same semantic key after remap
        SELECT m1.id as delete_match_id
        FROM matches_v2 m1
        JOIN team_merge_map mm ON m1.home_team_id = mm.delete_id OR m1.away_team_id = mm.delete_id
        WHERE EXISTS (
          SELECT 1 FROM matches_v2 m2
          WHERE m2.match_date = m1.match_date
          AND m2.home_team_id = COALESCE(
            (SELECT keep_id FROM team_merge_map WHERE delete_id = m1.home_team_id),
            m1.home_team_id
          )
          AND m2.away_team_id = COALESCE(
            (SELECT keep_id FROM team_merge_map WHERE delete_id = m1.away_team_id),
            m1.away_team_id
          )
          AND m2.id != m1.id
        )
      )
      DELETE FROM matches_v2 WHERE id IN (SELECT delete_match_id FROM potential_conflicts)
    `);
    console.log(`   Deleted: ${conflictResult.rowCount} conflicting matches`);

    // Step 4-5: Update team references, deleting conflicts as we go
    // Process in batches to handle constraint conflicts
    console.log('4. Updating match references (with conflict handling)...');

    let totalHomeUpdated = 0;
    let totalAwayUpdated = 0;
    let totalDeleted = 0;

    // Process each team mapping individually to handle conflicts
    const { rows: mappings } = await client.query('SELECT delete_id, keep_id FROM team_merge_map');
    const batchSize = 100;

    for (let i = 0; i < mappings.length; i += batchSize) {
      const batch = mappings.slice(i, i + batchSize);

      for (const { delete_id, keep_id } of batch) {
        // Delete matches that would conflict after update
        const deleteConflicts = await client.query(`
          DELETE FROM matches_v2 m1
          WHERE (m1.home_team_id = $1 OR m1.away_team_id = $1)
          AND EXISTS (
            SELECT 1 FROM matches_v2 m2
            WHERE m2.match_date = m1.match_date
            AND m2.home_team_id = CASE WHEN m1.home_team_id = $1 THEN $2 ELSE m1.home_team_id END
            AND m2.away_team_id = CASE WHEN m1.away_team_id = $1 THEN $2 ELSE m1.away_team_id END
            AND m2.id != m1.id
          )
        `, [delete_id, keep_id]);
        totalDeleted += deleteConflicts.rowCount;

        // Now safe to update
        const homeUpd = await client.query(`
          UPDATE matches_v2 SET home_team_id = $2 WHERE home_team_id = $1
        `, [delete_id, keep_id]);
        totalHomeUpdated += homeUpd.rowCount;

        const awayUpd = await client.query(`
          UPDATE matches_v2 SET away_team_id = $2 WHERE away_team_id = $1
        `, [delete_id, keep_id]);
        totalAwayUpdated += awayUpd.rowCount;
      }

      if ((i + batchSize) % 1000 === 0) {
        console.log(`   Processed ${i + batchSize}/${mappings.length} teams...`);
      }
    }

    console.log(`   Home updates: ${totalHomeUpdated}`);
    console.log(`   Away updates: ${totalAwayUpdated}`);
    console.log(`   Conflicts deleted: ${totalDeleted}`);

    // Step 6: Final cleanup of any duplicates
    console.log('5. Final duplicate cleanup...');
    const dupeMatchResult = await client.query(`
      WITH dupes AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY match_date, home_team_id, away_team_id
                 ORDER BY created_at ASC
               ) as rn
        FROM matches_v2
      )
      DELETE FROM matches_v2
      WHERE id IN (SELECT id FROM dupes WHERE rn > 1)
    `);
    console.log(`   Deleted: ${dupeMatchResult.rowCount} duplicate matches`);

    // Step 6: Audit log deleted teams
    console.log('6. Logging to audit...');
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
      SELECT 'teams_v2', t.id, 'BULK_MERGE',
        row_to_json(t),
        jsonb_build_object('merged_into', mm.keep_id, 'display_name', mm.display_name),
        'bulkMergeDuplicateTeams', NOW()
      FROM teams_v2 t
      JOIN team_merge_map mm ON t.id = mm.delete_id
    `);

    // Step 7: Delete duplicate teams
    console.log('7. Deleting duplicate teams...');
    const deleteResult = await client.query(`
      DELETE FROM teams_v2
      WHERE id IN (SELECT delete_id FROM team_merge_map)
    `);
    console.log(`   Deleted: ${deleteResult.rowCount} teams`);

    // Step 8: Update matches_played on kept teams
    console.log('8. Updating match counts...');
    await client.query(`
      UPDATE teams_v2 t
      SET matches_played = COALESCE((
        SELECT COUNT(*)
        FROM matches_v2 m
        WHERE m.home_team_id = t.id OR m.away_team_id = t.id
      ), 0)
      WHERE t.id IN (SELECT DISTINCT keep_id FROM team_merge_map)
    `);

    await client.query('COMMIT');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n=== SUMMARY ===`);
    console.log(`Teams merged: ${deleteResult.rowCount}`);
    console.log(`Match references updated: ${homeResult.rowCount + awayResult.rowCount}`);
    console.log(`Duplicate matches deleted: ${dupeMatchResult.rowCount}`);
    console.log(`Elapsed: ${elapsed}s`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

bulkMerge(dryRun).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
