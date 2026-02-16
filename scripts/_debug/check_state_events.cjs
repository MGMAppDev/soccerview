require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkStateEvents() {
  try {
    const states = ['DE', 'IA', 'MD', 'ND', 'WV'];

    for (const state of states) {
      console.log(`\n=== ${state} ===`);

      // Check leagues
      const leagues = await pool.query(`
        SELECT id, name, source_event_id, state
        FROM leagues
        WHERE state = $1 OR name ILIKE '%' || $1 || '%'
        ORDER BY name
        LIMIT 10
      `, [state]);

      if (leagues.rows.length > 0) {
        console.log('Leagues:');
        leagues.rows.forEach(l => {
          console.log(`  ${l.name} (source_event_id: ${l.source_event_id})`);
        });
      } else {
        console.log('No leagues found');
      }

      // Check tournaments
      const tournaments = await pool.query(`
        SELECT id, name, source_event_id, state
        FROM tournaments
        WHERE state = $1 OR name ILIKE '%' || $1 || '%'
        ORDER BY name
        LIMIT 10
      `, [state]);

      if (tournaments.rows.length > 0) {
        console.log('Tournaments:');
        tournaments.rows.forEach(t => {
          console.log(`  ${t.name} (source_event_id: ${t.source_event_id})`);
        });
      }
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkStateEvents();
