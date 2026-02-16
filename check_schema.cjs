require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    console.log('=== Checking app_team_profile columns ===\n');
    
    const res = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'app_team_profile'
      ORDER BY ordinal_position;
    `);
    
    console.log('Columns in app_team_profile:');
    res.rows.forEach(row => {
      console.log(`  - ${row.column_name} (${row.data_type})`);
    });
    
    console.log(`\nTotal: ${res.rows.length} columns`);
    
    // Check if updated_at exists in teams_v2
    console.log('\n=== Checking teams_v2 for updated_at ===\n');
    const teamsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'teams_v2' AND column_name = 'updated_at';
    `);
    
    if (teamsRes.rows.length > 0) {
      console.log('✓ teams_v2 HAS updated_at column');
    } else {
      console.log('✗ teams_v2 DOES NOT HAVE updated_at column');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
