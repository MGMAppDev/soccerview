require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const res = await pool.query(`
      SELECT pg_get_viewdef('app_team_profile') as view_def;
    `);
    
    const def = res.rows[0].view_def;
    const lines = def.split('\n');
    
    console.log('=== Columns selected in app_team_profile view (first 30 SELECT columns) ===\n');
    
    let inSelect = false;
    let colCount = 0;
    for (let i = 0; i < lines.length && colCount < 35; i++) {
      const line = lines[i];
      if (!inSelect && line.includes('SELECT')) {
        inSelect = true;
      }
      if (inSelect) {
        console.log(line);
        if (line.includes('as ') && !line.trim().startsWith('--')) {
          colCount++;
        }
      }
      if (inSelect && line.includes('FROM')) {
        break;
      }
    }
    
    console.log('\n... (looking for updated_at in remaining columns)');
    const hasUpdatedAt = def.includes('updated_at');
    if (hasUpdatedAt) {
      console.log('\n✗ ISSUE FOUND: updated_at is referenced somewhere in the view');
      const idx = def.indexOf('updated_at');
      console.log('\nContext around updated_at:');
      console.log(def.substring(Math.max(0, idx-150), Math.min(def.length, idx+150)));
    } else {
      console.log('\n✓ updated_at is NOT in the view definition (view is missing the column)');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
