/**
 * Check if SportsAffinity leagues already have computed standings in app_league_standings
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Check SA leagues in app_league_standings
  const { rows: saStandings } = await pool.query(`
    SELECT als.league_name, COUNT(*) as teams, als.division
    FROM app_league_standings als
    JOIN leagues l ON l.id = als.league_id
    WHERE l.source_event_id LIKE 'sportsaffinity-%'
    GROUP BY als.league_name, als.division
    ORDER BY als.league_name, als.division
    LIMIT 25
  `);
  console.log('SportsAffinity leagues in app_league_standings:');
  if (saStandings.length === 0) {
    console.log('  NONE — computed path may not cover these');
  } else {
    saStandings.forEach(s => console.log(`  ${s.league_name} | ${s.division || 'no division'} | ${s.teams} teams`));
  }

  // Also check total by source platform
  const { rows: bySource } = await pool.query(`
    SELECT
      CASE
        WHEN l.source_event_id LIKE 'gotsport-%' THEN 'gotsport'
        WHEN l.source_event_id LIKE 'sincsports-%' THEN 'sincsports'
        WHEN l.source_event_id LIKE 'heartland-%' THEN 'heartland'
        WHEN l.source_event_id LIKE 'sportsaffinity-%' THEN 'sportsaffinity'
        WHEN l.source_event_id LIKE 'mlsnext-%' THEN 'mlsnext'
        WHEN l.source_event_id LIKE 'totalglobalsports-%' THEN 'tgs'
        WHEN l.source_event_id LIKE 'playmetrics-%' THEN 'playmetrics'
        WHEN l.source_event_id LIKE 'demosphere-%' THEN 'demosphere'
        WHEN l.source_event_id LIKE 'squadi-%' THEN 'squadi'
        ELSE 'other'
      END as platform,
      COUNT(DISTINCT als.league_id) as leagues,
      COUNT(*) as standings_rows
    FROM app_league_standings als
    JOIN leagues l ON l.id = als.league_id
    GROUP BY 1
    ORDER BY standings_rows DESC
  `);
  console.log('\napp_league_standings by platform:');
  bySource.forEach(s => console.log(`  ${s.platform}: ${s.leagues} leagues, ${s.standings_rows} standings rows`));

  // Check total SA leagues in DB
  const { rows: saLeagues } = await pool.query(`
    SELECT COUNT(*) as total FROM leagues WHERE source_event_id LIKE 'sportsaffinity-%'
  `);
  console.log('\nTotal SA leagues in DB:', saLeagues[0].total);

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
