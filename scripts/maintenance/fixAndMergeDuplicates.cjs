/**
 * Session 86: Fix NULL metadata then merge duplicate opponent teams
 *
 * Strategy:
 * 1. Fix NULL birth_year/gender to match the non-NULL team
 * 2. Merge teams (update match references)
 * 3. Delete semantic duplicate matches
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 300000,
});

// [keepId, mergeId, reason]
// We keep the team with better metadata (non-NULL birth_year/gender)
const MERGES = [
  // Sporting City MLSN-East: same name, gender mismatch (null vs M)
  ['cf589dcd-510e-4304-9407-243a7ff411b4', '53da77f9-44db-41d7-a4c4-9587c35a0951', 'keep M gender'],
  // OP Academy 2015B: birth_year 2015 vs NULL
  ['4a849821-e1be-4098-a635-643d97afc750', 'eac39902-c74e-4107-bece-2f1b0f8dcb3d', 'keep birth_year 2015'],
  // KC Fusion 15B Gold: both have 2015/M - keep one with "(U11 Boys)" in name
  ['0bebbd94-64b8-48d4-9139-191ab4c19971', 'c728c5c2-bfec-46db-8c9a-d88b1112ad75', 'both match, keep verbose name'],
  // Sporting City West vs East: SKIP - different divisions
  // Toca FC B2015 Premier: birth_year 2015 vs NULL
  ['785f3682-066b-42af-8982-7e4c4964afc8', '8d70002a-afce-48d4-aebf-7064a63ceb53', 'keep birth_year 2015'],
  // Sporting City MLS NEXT: gender M vs NULL
  ['ee8e8561-e71a-433d-9342-0baea815a500', '1b7fab07-a7f5-4bb2-a97d-95e2870e66ad', 'keep M gender, verbose name'],
  // Supra United: SKIP - different birth years (2012 vs 2015) - likely different teams
  // RFA 2015s: birth_year same, gender M vs NULL
  ['ef1c0bd7-c74b-4cc3-bcb1-724c5782520a', 'd0f7823b-0b50-4573-b4c1-6f18afc188f2', 'keep M gender, verbose name'],
];

async function fix() {
  console.log('=== SESSION 86: FIX AND MERGE DUPLICATE OPPONENT TEAMS ===\n');

  const client = await pool.connect();

  try {
    await authorizePipelineWrite(client);

    let teamsFixed = 0;
    let matchesUpdated = 0;
    let matchesDeleted = 0;

    for (const [keepId, mergeId, reason] of MERGES) {
      console.log(`\n--- Processing: ${reason} ---`);

      // Get team details
      const teams = await client.query(`
        SELECT id, display_name, birth_year, gender, matches_played
        FROM teams_v2
        WHERE id IN ($1, $2)
      `, [keepId, mergeId]);

      const keepTeam = teams.rows.find(t => t.id === keepId);
      const mergeTeam = teams.rows.find(t => t.id === mergeId);

      if (!keepTeam || !mergeTeam) {
        console.log('  ⚠️ Team not found, skipping');
        continue;
      }

      console.log(`  Keep:  "${keepTeam.display_name}" (${keepTeam.matches_played} matches)`);
      console.log(`         Birth: ${keepTeam.birth_year} | Gender: ${keepTeam.gender}`);
      console.log(`  Merge: "${mergeTeam.display_name}" (${mergeTeam.matches_played} matches)`);
      console.log(`         Birth: ${mergeTeam.birth_year} | Gender: ${mergeTeam.gender}`);

      await client.query('BEGIN');

      // 1. First, fix NULL metadata on the merge team if needed
      if (!mergeTeam.birth_year && keepTeam.birth_year) {
        await client.query(
          'UPDATE teams_v2 SET birth_year = $1 WHERE id = $2',
          [keepTeam.birth_year, mergeId]
        );
        console.log(`  Fixed birth_year on merge team: ${keepTeam.birth_year}`);
      }
      if (!mergeTeam.gender && keepTeam.gender) {
        await client.query(
          'UPDATE teams_v2 SET gender = $1 WHERE id = $2',
          [keepTeam.gender, mergeId]
        );
        console.log(`  Fixed gender on merge team: ${keepTeam.gender}`);
      }

      // 2. Update match references (mergeId -> keepId)
      const homeUpdate = await client.query(`
        UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2
      `, [keepId, mergeId]);
      const awayUpdate = await client.query(`
        UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2
      `, [keepId, mergeId]);

      const updated = homeUpdate.rowCount + awayUpdate.rowCount;
      matchesUpdated += updated;
      console.log(`  Updated ${updated} match references`);

      // 3. Delete semantic duplicates (same date + teams)
      const deleteDupes = await client.query(`
        WITH dupes AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY match_date, home_team_id, away_team_id
                   ORDER BY created_at ASC
                 ) as rn
          FROM matches_v2
          WHERE home_team_id = $1 OR away_team_id = $1
        )
        DELETE FROM matches_v2
        WHERE id IN (SELECT id FROM dupes WHERE rn > 1)
        RETURNING id
      `, [keepId]);

      if (deleteDupes.rowCount > 0) {
        matchesDeleted += deleteDupes.rowCount;
        console.log(`  Deleted ${deleteDupes.rowCount} duplicate matches`);
      }

      // 4. Soft-delete the merged team
      await client.query(`
        UPDATE teams_v2
        SET status = 'merged',
            merged_into = $1,
            merged_at = NOW(),
            merge_reason = 'Session 86: Opponent dedup'
        WHERE id = $2
      `, [keepId, mergeId]);

      teamsFixed++;

      await client.query('COMMIT');
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Teams merged: ${teamsFixed}`);
    console.log(`Match references updated: ${matchesUpdated}`);
    console.log(`Duplicate matches deleted: ${matchesDeleted}`);

    // Verify the Sporting BV team now
    console.log('\n=== VERIFICATION: SPORTING BV PRE-NAL 15 ===');
    const verify = await client.query(`
      SELECT COUNT(*) as match_count
      FROM matches_v2
      WHERE home_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
         OR away_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    `);
    console.log(`Match count: ${verify.rows[0].match_count}`);

    // Recalculate W-L-D
    const wld = await client.query(`
      SELECT
        SUM(CASE
          WHEN home_team_id = $1 AND home_score > away_score THEN 1
          WHEN away_team_id = $1 AND away_score > home_score THEN 1
          ELSE 0
        END) as wins,
        SUM(CASE
          WHEN home_team_id = $1 AND home_score < away_score THEN 1
          WHEN away_team_id = $1 AND away_score < home_score THEN 1
          ELSE 0
        END) as losses,
        SUM(CASE
          WHEN home_score = away_score AND home_score IS NOT NULL THEN 1
          ELSE 0
        END) as draws
      FROM matches_v2
      WHERE (home_team_id = $1 OR away_team_id = $1)
        AND home_score IS NOT NULL
    `, ['cc329f08-1f57-4a7b-923a-768b2138fa92']);

    const r = wld.rows[0];
    console.log(`Calculated W-L-D: ${r.wins}W-${r.losses}L-${r.draws}D`);

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
