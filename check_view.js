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
        const idx = def.indexOf('deleted_at');
        const context = def.substring(Math.max(0, idx-100), Math.min(def.length, idx+150));
        console.log('\nContext around deleted_at:');
        console.log(context);
      } else {
        console.log('✗ FILTER MISSING: deleted_at clause is NOT in the view!');
        console.log('\nFull view definition (last 500 chars):');
        console.log(def.substring(Math.max(0, def.length - 500)));
      }
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
