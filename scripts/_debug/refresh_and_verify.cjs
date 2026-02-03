require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function refresh() {
  const client = await pool.connect();

  console.log('Refreshing app_team_profile (non-concurrent)...');
  const start = Date.now();
  await client.query('REFRESH MATERIALIZED VIEW app_team_profile');
  console.log('Done in', ((Date.now() - start) / 1000).toFixed(1), 'seconds');

  // Verify
  const result = await client.query(`
    SELECT elo_rating, elo_national_rank, elo_state_rank, matches_played, wins, losses, draws
    FROM app_team_profile
    WHERE id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
  `);
  const t = result.rows[0];
  console.log('');
  console.log('VERIFIED - New values in view:');
  console.log('ELO:', t.elo_rating, '| Nat: #' + t.elo_national_rank, '| State: #' + t.elo_state_rank);
  console.log('Record:', t.matches_played + 'mp', t.wins + 'W-' + t.losses + 'L-' + t.draws + 'D');

  client.release();
  pool.end();
}

refresh().catch(console.error);
