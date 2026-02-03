require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const result = await pool.query(`
    SELECT
      TO_CHAR(snapshot_date, 'YYYY-MM-DD') as date,
      elo_rating,
      elo_national_rank,
      elo_state_rank
    FROM rank_history_v2
    WHERE team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    ORDER BY snapshot_date
  `);

  console.log('Sporting BV Pre-NAL 15 Rank History:');
  console.log('Date       | ELO  | Nat Rank | State Rank');
  console.log('-'.repeat(45));
  result.rows.forEach(r => {
    const elo = Number(r.elo_rating).toFixed(0);
    const nat = r.elo_national_rank ? String(r.elo_national_rank).padStart(5) : '    -';
    const st = r.elo_state_rank ? String(r.elo_state_rank).padStart(5) : '    -';
    console.log(`${r.date} | ${elo.padStart(4)} | ${nat} | ${st}`);
  });

  // Count total records with ranks
  const countResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM rank_history_v2
    WHERE elo_national_rank IS NOT NULL
  `);
  console.log('\nTotal records with SoccerView ranks:', countResult.rows[0].count);

  await pool.end();
})();
