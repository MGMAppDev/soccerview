#!/usr/bin/env node
// Add Wave 2d GotSport event IDs to database for discovery
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const NEW_EVENTS = [
  // Maryland/Delaware
  { id: '44329', name: 'EDP League Fall 2025', type: 'league', state: 'MD' },
  { id: '44340', name: 'USYS NL South Atlantic 25-26 (15U-19U)', type: 'league', state: 'MD' },
  { id: '50581', name: 'USYS NL South Atlantic Fall 25 (13U-14U)', type: 'league', state: 'MD' },
  { id: '43268', name: 'CPSL NPL 2025-26', type: 'league', state: 'MD' },
  { id: '43667', name: 'ICSL Fall 2025', type: 'league', state: 'MD' },
  { id: '45707', name: 'Eastern Shore Premier League 2025-26', type: 'league', state: 'DE' },
  { id: '43731', name: 'Central League Soccer Fall 2025', type: 'league', state: 'DE' },
  // Iowa
  { id: '47441', name: 'Iowa Development League Fall 2025', type: 'league', state: 'IA' },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);

  for (const ev of NEW_EVENTS) {
    // Check if already exists in leagues or tournaments
    const { rows: existing } = await pool.query(`
      SELECT 'league' as type, id, name FROM leagues WHERE source_event_id = $1
      UNION
      SELECT 'tournament' as type, id, name FROM tournaments WHERE source_event_id = $1
    `, [`gotsport-${ev.id}`]);

    if (existing.length > 0) {
      console.log(`  EXISTS: ${ev.id} - ${ev.name} (${existing[0].type})`);
      continue;
    }

    if (!dryRun) {
      // Insert as a league or tournament based on ev.type
      const table = ev.type === 'league' ? 'leagues' : 'tournaments';
      await pool.query(`
        INSERT INTO ${table} (name, source_event_id, state, season_id)
        VALUES ($1, $2, $3,
          (SELECT id FROM seasons WHERE is_current = true LIMIT 1))
        ON CONFLICT DO NOTHING
      `, [ev.name, `gotsport-${ev.id}`, ev.state]);
      console.log(`  INSERTED: ${ev.id} - ${ev.name} (${ev.type})`);
    } else {
      console.log(`  WOULD INSERT: ${ev.id} - ${ev.name} (${ev.type})`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
