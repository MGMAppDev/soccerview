require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const client = await pool.connect();
  try {
    // Check division values in matches_v2
    const { rows: divValues } = await client.query(`
      SELECT division, COUNT(*) as cnt
      FROM matches_v2
      WHERE deleted_at IS NULL
      GROUP BY division
      ORDER BY cnt DESC
      LIMIT 30
    `);
    console.log('=== Division values in matches_v2 (top 30) ===');
    divValues.forEach(r => console.log(`  ${r.division || 'NULL'}: ${r.cnt}`));
    
    const { rows: [stats] } = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE division IS NOT NULL) as with_div,
        COUNT(*) FILTER (WHERE division IS NULL) as null_div
      FROM matches_v2 WHERE deleted_at IS NULL
    `);
    console.log(`\n--- Stats ---`);
    console.log(`Total matches: ${stats.total}`);
    console.log(`With division: ${stats.with_div} (${((stats.with_div/stats.total)*100).toFixed(1)}%)`);
    console.log(`NULL division: ${stats.null_div} (${((stats.null_div/stats.total)*100).toFixed(1)}%)`);
    
    // Check league_standings divisions
    const { rows: lsDivs } = await client.query(`
      SELECT division, COUNT(*) as cnt
      FROM league_standings
      GROUP BY division
      ORDER BY cnt DESC
      LIMIT 20
    `);
    console.log(`\n=== Division values in league_standings (top 20) ===`);
    lsDivs.forEach(r => console.log(`  ${r.division || 'NULL'}: ${r.cnt}`));
    
    // Check leagues.divisions JSONB column
    const { rows: [leaguesStats] } = await client.query(`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE divisions IS NOT NULL) as with_div
      FROM leagues
    `);
    console.log(`\n=== leagues.divisions JSONB column ===`);
    console.log(`Total leagues: ${leaguesStats.total}, With divisions: ${leaguesStats.with_div}`);
    
    const { rows: leaguesDivs } = await client.query(`
      SELECT id, name, divisions FROM leagues WHERE divisions IS NOT NULL LIMIT 3
    `);
    if (leaguesDivs.length > 0) {
      console.log(`Sample:`)
      leaguesDivs.forEach(r => console.log(`  ${r.name}: ${JSON.stringify(r.divisions)}`));
    }
    
  } finally {
    client.release();
    await pool.end();
  }
})();
