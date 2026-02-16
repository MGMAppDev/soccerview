require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    console.log('=== Testing fetchStats queries ===\n');
    
    // Get current season
    console.log('Query 1: Get current season...');
    const seasonRes = await pool.query(`
      SELECT start_date, end_date FROM seasons WHERE is_current = true LIMIT 1;
    `);
    const season = seasonRes.rows[0];
    console.log('Season:', season);
    
    const startDate = season?.start_date || '2025-08-01';
    const endDate = season?.end_date || '2026-07-31';
    console.log(`Using dates: ${startDate} to ${endDate}\n`);
    
    // Test team count
    console.log('Query 2: Count teams in app_rankings with has_matches=true...');
    const teamRes = await pool.query(`
      SELECT COUNT(*) as count FROM app_rankings WHERE has_matches = true;
    `);
    console.log(`Teams with matches: ${teamRes.rows[0].count}\n`);
    
    // Test match count
    console.log('Query 3: Count matches in app_matches_feed (direct)...');
    const matchRes = await pool.query(`
      SELECT COUNT(*) as count FROM app_matches_feed WHERE match_date >= $1 AND match_date <= $2;
    `, [startDate, endDate]);
    console.log(`Matches in date range: ${matchRes.rows[0].count}\n`);
    
    // Test last updated
    console.log('Query 4: Get last updated from app_team_profile...');
    const updateRes = await pool.query(`
      SELECT updated_at FROM app_team_profile WHERE updated_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1;
    `);
    console.log(`Last updated: ${updateRes.rows[0]?.updated_at || 'NULL'}\n`);
    
    console.log('✓ All queries work!');
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
  } finally {
    await pool.end();
  }
}

main();
