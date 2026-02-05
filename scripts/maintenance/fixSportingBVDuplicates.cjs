/**
 * Session 86: Fix double-counted matches by merging opponent team duplicates
 *
 * Root cause: Same opponent team exists as multiple entries in teams_v2.
 * Same match was recorded from different sources, each using different team ID.
 *
 * Solution:
 * 1. Merge duplicate opponent teams (keeping the one with more matches)
 * 2. Delete duplicate matches (same date + same teams after merge)
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 300000,
});

// Duplicate team pairs to merge [keepId, mergeId]
const TEAM_MERGES = [
  // Sporting City 15 Pre MLSN-East
  ['53da77f9-44db-41d7-a4c4-9587c35a0951', 'cf589dcd-510e-4304-9407-243a7ff411b4'],
  // OP Academy 2015B
  ['4a849821-e1be-4098-a635-643d97afc750', 'eac39902-c74e-4107-bece-2f1b0f8dcb3d'],
  // KC Fusion 15B Gold
  ['0bebbd94-64b8-48d4-9139-191ab4c19971', 'c728c5c2-bfec-46db-8c9a-d88b1112ad75'],
  // Sporting City 15 Pre MLSN-West vs MLSN-East - these may be different teams, skip
  // ['6344dce7-88d1-439e-8057-25175ed9d09d', '70ec772c-ce90-4059-8a4f-422ad6507937'],
  // Toca FC B2015 Premier
  ['785f3682-066b-42af-8982-7e4c4964afc8', '8d70002a-afce-48d4-aebf-7064a63ceb53'],
  // Sporting City 2015 Pre MLS NEXT - East
  ['1b7fab07-a7f5-4bb2-a97d-95e2870e66ad', 'ee8e8561-e71a-433d-9342-0baea815a500'],
  // Supra United FC - different age groups (U14 vs U11?), skip
  // ['171e556c-f4fc-424a-993c-4abb2caac514', '5bfbba9d-6fcc-4235-bfb3-4b4a19b94a18'],
  // RFA 2015s
  ['d0f7823b-0b50-4573-b4c1-6f18afc188f2', 'ef1c0bd7-c74b-4cc3-bcb1-724c5782520a'],
];

async function fix() {
  console.log('=== SESSION 86: FIX OPPONENT TEAM DUPLICATES ===\n');

  const client = await pool.connect();

  try {
    await authorizePipelineWrite(client);
    await client.query('BEGIN');

    let teamsUpdated = 0;
    let matchesUpdated = 0;
    let matchesDeleted = 0;

    for (const [keepId, mergeId] of TEAM_MERGES) {
      // Get team info
      const keepTeam = await client.query(
        'SELECT display_name, matches_played FROM teams_v2 WHERE id = $1',
        [keepId]
      );
      const mergeTeam = await client.query(
        'SELECT display_name, matches_played FROM teams_v2 WHERE id = $1',
        [mergeId]
      );

      if (keepTeam.rows.length === 0 || mergeTeam.rows.length === 0) {
        console.log(`Skipping: Team not found (keep: ${keepId}, merge: ${mergeId})`);
        continue;
      }

      console.log(`\nMerging: "${mergeTeam.rows[0].display_name}" (${mergeTeam.rows[0].matches_played} matches)`);
      console.log(`   Into: "${keepTeam.rows[0].display_name}" (${keepTeam.rows[0].matches_played} matches)`);

      // 1. Update matches: change mergeId -> keepId
      const homeUpdate = await client.query(`
        UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2
      `, [keepId, mergeId]);
      const awayUpdate = await client.query(`
        UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2
      `, [keepId, mergeId]);

      matchesUpdated += homeUpdate.rowCount + awayUpdate.rowCount;
      console.log(`   Updated ${homeUpdate.rowCount + awayUpdate.rowCount} match references`);

      // 2. Now delete duplicate matches (same date + same teams)
      const deleteDupes = await client.query(`
        WITH dupes AS (
          SELECT id, match_date, home_team_id, away_team_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY match_date, home_team_id, away_team_id
                   ORDER BY created_at ASC
                 ) as rn
          FROM matches_v2
          WHERE home_team_id = $1 OR away_team_id = $1
             OR home_team_id = $2 OR away_team_id = $2
        )
        DELETE FROM matches_v2
        WHERE id IN (SELECT id FROM dupes WHERE rn > 1)
        RETURNING id
      `, [keepId, mergeId]);

      if (deleteDupes.rowCount > 0) {
        matchesDeleted += deleteDupes.rowCount;
        console.log(`   Deleted ${deleteDupes.rowCount} duplicate matches`);
      }

      // 3. Soft-delete the merged team
      await client.query(`
        UPDATE teams_v2
        SET status = 'merged',
            merged_into = $1,
            merged_at = NOW(),
            merge_reason = 'Session 86: Opponent dedup for Sporting BV'
        WHERE id = $2
      `, [keepId, mergeId]);

      teamsUpdated++;
    }

    await client.query('COMMIT');

    console.log('\n=== SUMMARY ===');
    console.log(`Teams merged: ${teamsUpdated}`);
    console.log(`Match references updated: ${matchesUpdated}`);
    console.log(`Duplicate matches deleted: ${matchesDeleted}`);

    // Verify the Sporting BV team now
    console.log('\n=== VERIFICATION ===');
    const verify = await client.query(`
      SELECT COUNT(*) as match_count
      FROM matches_v2
      WHERE home_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
         OR away_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    `);
    console.log(`Sporting BV Pre-NAL 15 now has: ${verify.rows[0].match_count} matches`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

fix().catch(console.error);
