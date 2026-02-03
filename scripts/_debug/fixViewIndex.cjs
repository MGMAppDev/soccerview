/**
 * fixViewIndex.cjs
 *
 * Creates unique index on app_league_standings to enable concurrent refresh.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('='.repeat(70));
  console.log('FIX VIEW INDEX FOR CONCURRENT REFRESH');
  console.log('='.repeat(70));

  // Get sample row to see columns
  const sample = await pool.query('SELECT * FROM app_league_standings LIMIT 1');
  console.log('\nColumns:', Object.keys(sample.rows[0] || {}).join(', '));

  // Check for duplicates on the unique key
  const dupes = await pool.query(`
    SELECT team_id, league_id, COUNT(*) as cnt
    FROM app_league_standings
    GROUP BY team_id, league_id
    HAVING COUNT(*) > 1
  `);
  console.log('Duplicates on (team_id, league_id):', dupes.rows.length);

  if (dupes.rows.length > 0) {
    console.log('ERROR: Cannot create unique index - duplicates exist!');
    dupes.rows.slice(0, 5).forEach(r => {
      console.log(`  team_id=${r.team_id}, league_id=${r.league_id}, count=${r.cnt}`);
    });
    await pool.end();
    return;
  }

  // Create unique index
  console.log('\nCreating unique index on (team_id, league_id)...');
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_league_standings_unique
    ON app_league_standings (team_id, league_id)
  `);
  console.log('Unique index created!');

  // Now try the non-concurrent refresh first to ensure it works
  console.log('\nRefreshing all views...');
  try {
    await pool.query('SELECT refresh_app_views()');
    console.log('All views refreshed successfully!');
  } catch (err) {
    console.log('refresh_app_views() failed:', err.message);
    console.log('\nTrying non-concurrent refresh on app_league_standings...');
    await pool.query('REFRESH MATERIALIZED VIEW app_league_standings');
    console.log('app_league_standings refreshed (non-concurrent)!');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
