require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    console.log('=== Checking materialized views existence ===\n');
    
    const res = await pool.query(`
      SELECT matviewname, schemaname
      FROM pg_matviews
      WHERE matviewname LIKE 'app_%'
      ORDER BY matviewname;
    `);
    
    console.log(`Found ${res.rows.length} materialized views:\n`);
    res.rows.forEach(row => {
      console.log(`  - ${row.matviewname} (schema: ${row.schemaname})`);
    });
    
    // Try to SELECT from each view
    console.log('\n=== Testing SELECT from each view ===\n');
    
    for (const row of res.rows) {
      try {
        const selectRes = await pool.query(`SELECT COUNT(*) as cnt FROM ${row.matviewname};`);
        console.log(`✓ ${row.matviewname}: ${selectRes.rows[0].cnt} rows`);
      } catch (err) {
        console.log(`✗ ${row.matviewname}: ERROR - ${err.message}`);
      }
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
