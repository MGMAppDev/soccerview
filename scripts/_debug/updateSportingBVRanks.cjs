require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  console.log('Updating Sporting BV ranks with CONSISTENT BASELINE...\n');

  // Update national ranks for this team
  console.log('Updating national ranks...');
  await pool.query(`
    UPDATE rank_history_v2 rh
    SET elo_national_rank = (
      SELECT COUNT(*) + 1
      FROM teams_v2 t2
      WHERE t2.birth_year = 2015
        AND t2.gender = 'M'
        AND t2.matches_played > 0
        AND t2.elo_rating > rh.elo_rating
    )
    WHERE rh.team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
      AND rh.elo_rating IS NOT NULL
  `);

  // Update state ranks
  console.log('Updating state ranks...');
  await pool.query(`
    UPDATE rank_history_v2 rh
    SET elo_state_rank = (
      SELECT COUNT(*) + 1
      FROM teams_v2 t2
      WHERE t2.state = 'KS'
        AND t2.birth_year = 2015
        AND t2.gender = 'M'
        AND t2.matches_played > 0
        AND t2.elo_rating > rh.elo_rating
    )
    WHERE rh.team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
      AND rh.elo_rating IS NOT NULL
  `);

  // Verify
  const v = await pool.query(`
    SELECT TO_CHAR(snapshot_date,'YYYY-MM-DD') as d, elo_rating as e, elo_national_rank as n, elo_state_rank as s
    FROM rank_history_v2 WHERE team_id='cc329f08-1f57-4a7b-923a-768b2138fa92' ORDER BY snapshot_date
  `);

  console.log('\n--- Sporting BV Pre-NAL 15 (CORRECT BASELINE) ---');
  console.log('Date       | ELO  | Nat Rank | State');
  console.log('-'.repeat(42));
  v.rows.forEach(r => {
    console.log(r.d + ' | ' + Number(r.e).toFixed(0).padStart(4) + ' | ' + String(r.n||'-').padStart(6) + ' | ' + String(r.s||'-').padStart(4));
  });

  // Compare with teams_v2 current
  const current = await pool.query(`
    SELECT elo_rating, elo_national_rank, elo_state_rank
    FROM teams_v2 WHERE id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
  `);
  console.log('\nCurrent teams_v2 (should match latest date above):');
  console.log('  ELO: ' + current.rows[0].elo_rating);
  console.log('  National: #' + current.rows[0].elo_national_rank);
  console.log('  State: #' + current.rows[0].elo_state_rank);

  await pool.end();
})();
