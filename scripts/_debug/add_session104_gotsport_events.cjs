/**
 * Session 104 — Add IL (NISL/SLYSA) + VA (VCSL/VPSL/TASL) GotSport Events
 *
 * Adds discovered event IDs to the leagues table so coreScraper can find them.
 * Pattern from Session 101 (add_wave2d_gotsport_events.cjs).
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const NEW_EVENTS = [
  // Illinois — NISL (Northern Illinois Soccer League) — 17,000 players, 1,300 teams
  { id: '44630', name: 'NISL NPL Fall 2025', type: 'league', state: 'IL' },
  { id: '40124', name: 'NISL NPL Spring 2025', type: 'league', state: 'IL' },
  { id: '44632', name: 'NISL Club & Conference Fall 2025', type: 'league', state: 'IL' },
  { id: '41112', name: 'NISL Club & Conference Spring 2025', type: 'league', state: 'IL' },
  { id: '45100', name: 'SLYSA IL Central Division Fall 2025', type: 'league', state: 'IL' },

  // Virginia — VCSL, VPSL NPL, TASL
  { id: '44587', name: 'Virginia Club Soccer League 2025-26', type: 'league', state: 'VA' },
  { id: '42891', name: 'VPSL NPL Fall 2025', type: 'league', state: 'VA' },
  { id: '41359', name: 'Tidewater Advanced Soccer League Spring 2025', type: 'league', state: 'VA' },
];

async function main() {
  console.log('=== Session 104: Adding IL + VA GotSport Events ===\n');

  let inserted = 0;
  let existing = 0;

  for (const ev of NEW_EVENTS) {
    // Check if already exists
    const { rows } = await pool.query(`
      SELECT 'league' as type, id, name FROM leagues WHERE source_event_id = $1
      UNION ALL
      SELECT 'tournament' as type, id, name FROM tournaments WHERE source_event_id = $1
    `, [`gotsport-${ev.id}`]);

    if (rows.length > 0) {
      console.log(`  EXISTS: ${ev.id} — ${rows[0].name} (${rows[0].type})`);
      existing++;
      continue;
    }

    // Insert as league
    const { rows: insertedRows } = await pool.query(`
      INSERT INTO leagues (name, source_event_id, state, season_id)
      VALUES ($1, $2, $3,
        (SELECT id FROM seasons WHERE is_current = true LIMIT 1))
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `, [ev.name, `gotsport-${ev.id}`, ev.state]);

    if (insertedRows.length > 0) {
      console.log(`  INSERTED: ${ev.id} — ${ev.name} (${ev.state}) → ${insertedRows[0].id}`);
      inserted++;
    } else {
      console.log(`  SKIPPED: ${ev.id} — ${ev.name} (conflict)`);
    }
  }

  console.log(`\n=== Summary: ${inserted} inserted, ${existing} already existed ===`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
