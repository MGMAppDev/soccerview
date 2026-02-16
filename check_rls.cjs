require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    console.log('=== Checking RLS on materialized views ===\n');
    
    const views = ['app_matches_feed', 'app_rankings', 'app_team_profile', 'app_league_standings', 'app_upcoming_schedule'];
    
    for (const view of views) {
      const res = await pool.query(`
        SELECT
          schemaname,
          matviewname,
          relrowsecurity
        FROM pg_matviews m
        JOIN pg_class c ON c.relname = m.matviewname
        WHERE m.matviewname = $1;
      `, [view]);
      
      if (res.rows.length > 0) {
        const row = res.rows[0];
        console.log(`${view}: RLS = ${row.relrowsecurity ? 'ENABLED' : 'DISABLED'}`);
      } else {
        console.log(`${view}: NOT FOUND`);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
