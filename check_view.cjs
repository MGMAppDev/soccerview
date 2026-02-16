require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const res = await pool.query(`
      SELECT pg_get_viewdef('app_matches_feed') as view_def;
    `);
    if (res.rows[0]?.view_def) {
      const def = res.rows[0].view_def;
      console.log('=== CHECKING FOR deleted_at FILTER ===');
      if (def.includes('deleted_at')) {
        console.log('✓ FILTER FOUND: deleted_at clause is present');
      } else {
        console.log('✗ FILTER MISSING: deleted_at clause is NOT in the view!');
      }
      console.log('\nLast 400 chars of view:');
      console.log(def.substring(Math.max(0, def.length - 400)));
    } else {
      console.log('ERROR: View not found');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
