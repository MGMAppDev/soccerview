require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    console.log('=== Getting first row from app_team_profile ===\n');
    
    const res = await pool.query(`SELECT * FROM app_team_profile LIMIT 1;`);
    
    if (res.rows.length > 0) {
      const row = res.rows[0];
      console.log('Columns returned:');
      Object.keys(row).forEach(key => {
        const val = row[key];
        const typeStr = val === null ? 'NULL' : typeof val;
        console.log(`  - ${key}: ${typeStr}`);
      });
    } else {
      console.log('No rows found');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
  } finally {
    await pool.end();
  }
}

main();
