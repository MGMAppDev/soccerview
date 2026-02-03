/**
 * Pure SQL rank recalculation - NO JavaScript loops
 *
 * Strategy: Use LATERAL join to compute rank in a single query
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function recalculateRanks() {
  const startTime = Date.now();
  console.log('Recalculating ranks - PURE SQL approach...\n');

  // National ranks - using LATERAL for efficient counting
  console.log('Step 1: National ranks...');
  const natStart = Date.now();

  await pool.query(`
    UPDATE rank_history_v2 rh
    SET elo_national_rank = counts.rank
    FROM (
      SELECT
        rh2.id,
        (
          SELECT COUNT(*) + 1
          FROM teams_v2 t3
          WHERE t3.birth_year = t2.birth_year
            AND t3.gender = t2.gender
            AND t3.matches_played > 0
            AND t3.elo_rating > rh2.elo_rating
        ) as rank
      FROM rank_history_v2 rh2
      INNER JOIN teams_v2 t2 ON rh2.team_id = t2.id
      WHERE rh2.elo_rating IS NOT NULL
        AND t2.birth_year IS NOT NULL
        AND t2.gender IS NOT NULL
        AND t2.matches_played > 0
    ) counts
    WHERE rh.id = counts.id
  `);

  console.log('   Done in ' + ((Date.now() - natStart)/1000).toFixed(0) + 's');

  // State ranks
  console.log('Step 2: State ranks...');
  const stStart = Date.now();

  await pool.query(`
    UPDATE rank_history_v2 rh
    SET elo_state_rank = counts.rank
    FROM (
      SELECT
        rh2.id,
        (
          SELECT COUNT(*) + 1
          FROM teams_v2 t3
          WHERE t3.state = t2.state
            AND t3.birth_year = t2.birth_year
            AND t3.gender = t2.gender
            AND t3.matches_played > 0
            AND t3.elo_rating > rh2.elo_rating
        ) as rank
      FROM rank_history_v2 rh2
      INNER JOIN teams_v2 t2 ON rh2.team_id = t2.id
      WHERE rh2.elo_rating IS NOT NULL
        AND t2.birth_year IS NOT NULL
        AND t2.gender IS NOT NULL
        AND t2.state IS NOT NULL
        AND t2.matches_played > 0
    ) counts
    WHERE rh.id = counts.id
  `);

  console.log('   Done in ' + ((Date.now() - stStart)/1000).toFixed(0) + 's');

  // Verify
  console.log('\n--- Sporting BV Pre-NAL 15 ---');
  const v = await pool.query(`
    SELECT TO_CHAR(snapshot_date,'YYYY-MM-DD') as d, elo_rating as e, elo_national_rank as n, elo_state_rank as s
    FROM rank_history_v2 WHERE team_id='cc329f08-1f57-4a7b-923a-768b2138fa92' ORDER BY snapshot_date
  `);
  console.log('Date       | ELO  | Nat  | State');
  v.rows.forEach(r => console.log(r.d + ' | ' + Number(r.e).toFixed(0).padStart(4) + ' | ' + String(r.n||'-').padStart(4) + ' | ' + String(r.s||'-').padStart(4)));

  console.log('\nTotal: ' + ((Date.now()-startTime)/1000).toFixed(0) + 's');
  await pool.end();
}

recalculateRanks().catch(e => { console.error(e); pool.end(); });
