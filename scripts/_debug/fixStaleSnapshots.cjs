require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fix() {
  // Delete the stale Jan 30/31 snapshots - captured before view refresh
  const deleteResult = await pool.query(`
    DELETE FROM rank_history_v2
    WHERE snapshot_date IN ('2026-01-30', '2026-01-31')
  `);
  console.log('Deleted stale snapshots:', deleteResult.rowCount, 'records');

  // Verify remaining data for Sporting BV
  const verifyResult = await pool.query(`
    SELECT snapshot_date, elo_national_rank, elo_state_rank, national_rank, state_rank
    FROM rank_history_v2
    WHERE team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    ORDER BY snapshot_date DESC
    LIMIT 10
  `);
  console.log('\nSporting BV rank history (most recent):');
  verifyResult.rows.forEach(r => {
    console.log(r.snapshot_date, '| SV:', r.elo_national_rank, '/', r.elo_state_rank, '| GS:', r.national_rank, '/', r.state_rank);
  });

  // Count total valid entries (with any rank data)
  const countResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM rank_history_v2
    WHERE elo_national_rank IS NOT NULL OR national_rank IS NOT NULL
  `);
  console.log('\nTotal entries with valid rank data:', countResult.rows[0].count);

  await pool.end();
}

fix().catch(err => {
  console.error(err);
  pool.end();
});
