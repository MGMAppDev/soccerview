// Quick script to check staging validation issues
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // Get known source platforms
    const r1 = await pool.query(`
      SELECT DISTINCT source_platform, COUNT(*) as count
      FROM staging_games
      GROUP BY source_platform
      ORDER BY count DESC
    `);
    console.log('=== Known source platforms ===');
    r1.rows.forEach(p => console.log(`  ${p.source_platform}: ${p.count} records`));

    // Check for potential validation issues
    const r2 = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_name IS NULL OR trim(home_team_name) = '') as empty_home,
        COUNT(*) FILTER (WHERE away_team_name IS NULL OR trim(away_team_name) = '') as empty_away,
        COUNT(*) FILTER (WHERE match_date IS NULL) as null_date,
        COUNT(*) FILTER (WHERE match_date > '2027-01-01') as future_2027,
        COUNT(*) FILTER (WHERE home_team_name = away_team_name) as same_team,
        COUNT(*) FILTER (WHERE source_match_key LIKE '%' || chr(10) || '%') as newline_in_key
      FROM staging_games
      WHERE processed = false
    `);
    console.log('\n=== Validation issues in unprocessed staging ===');
    console.log(JSON.stringify(r2.rows[0], null, 2));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
