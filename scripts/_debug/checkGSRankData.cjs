/**
 * Check GotSport rank data in rank_history_v2
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  // Check GotSport rank captures by date
  const byDate = await pool.query(`
    SELECT
      snapshot_date::text,
      COUNT(*) as total_records,
      COUNT(national_rank) as with_gs_rank
    FROM rank_history_v2
    WHERE snapshot_date >= '2025-08-01'
    GROUP BY snapshot_date
    ORDER BY snapshot_date DESC
    LIMIT 30
  `);

  console.log('GotSport rank captures by date:');
  console.log('Date        | Total  | With GS');
  console.log('-'.repeat(35));
  for (const row of byDate.rows) {
    const total = row.total_records.toString().padStart(6);
    const gs = row.with_gs_rank.toString().padStart(6);
    console.log(`${row.snapshot_date} | ${total} | ${gs}`);
  }

  // Check overall GotSport data coverage
  const overall = await pool.query(`
    SELECT
      COUNT(DISTINCT snapshot_date) as dates_with_gs_data
    FROM rank_history_v2
    WHERE national_rank IS NOT NULL
  `);

  console.log('\nOverall GotSport data coverage:');
  console.log('Dates with GotSport rank data:', overall.rows[0].dates_with_gs_data);

  await pool.end();
}

check().catch(err => {
  console.error('Error:', err.message);
  pool.end();
  process.exit(1);
});
