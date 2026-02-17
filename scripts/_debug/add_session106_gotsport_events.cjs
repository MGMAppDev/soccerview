/**
 * Session 106 — Add Girls Academy + USYS National League GotSport Events
 *
 * Registers all discovered event IDs in leagues/tournaments tables so
 * coreScraper can discover and scrape them.
 *
 * Girls Academy: 4 events (42137, 42138, 44874, 45530)
 * USYS NL Team Premier: 8 new events
 * USYS NL Club Premier 1: 7 new events
 * USYS NL Club Premier 2: 4 new events
 * USYS NL Winter Events: 2 events
 *
 * Pattern from Session 104 (add_session104_gotsport_events.cjs).
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const NEW_EVENTS = [
  // =============================================
  // Girls Academy (4 events)
  // =============================================
  { id: '42137', name: 'Girls Academy League 2025-26 (Tier 1)', type: 'league', state: 'XX', notes: 'GA main league, 12 conferences U13-U19' },
  { id: '42138', name: 'Girls Academy Aspire League 2025-26', type: 'league', state: 'XX', notes: 'GA Aspire tier, multiple regional conferences' },
  { id: '44874', name: 'Junior Girls Academy League (JGAL) 2025-26', type: 'league', state: 'XX', notes: 'U9-U10 age groups' },
  { id: '45530', name: 'Florida Girls Academy League 2025-26', type: 'league', state: 'FL', notes: 'FL-specific regional GA, U11-U12' },

  // =============================================
  // USYS National League — NL Team Premier (8 new conferences)
  // =============================================
  { id: '50925', name: 'USYS NL Team Desert 2025-26', type: 'league', state: 'XX', notes: 'NL Team Premier - Desert Conference' },
  { id: '50944', name: 'USYS NL Team Great Lakes 2025-26', type: 'league', state: 'XX', notes: 'NL Team Premier - Great Lakes Conference' },
  { id: '46789', name: 'USYS NL Team Mid Atlantic 2025-26', type: 'league', state: 'XX', notes: 'NL Team Premier - Mid Atlantic (P1+P2 combined)' },
  { id: '50933', name: 'USYS NL Team Mid South 2025-26', type: 'league', state: 'XX', notes: 'NL Team Premier - Mid South Conference' },
  { id: '50867', name: 'USYS NL Team Midwest 2025-26', type: 'league', state: 'XX', notes: 'NL Team Premier - Midwest Conference' },
  { id: '46794', name: 'USYS NL Team New England 2025-26', type: 'league', state: 'XX', notes: 'NL Team Premier - New England Conference' },
  { id: '46792', name: 'USYS NL Team North Atlantic 2025-26', type: 'league', state: 'XX', notes: 'NL Team Premier - North Atlantic Conference' },
  { id: '50910', name: 'USYS NL Team Piedmont 2025-26', type: 'league', state: 'XX', notes: 'NL Team Premier - Piedmont Conference' },

  // =============================================
  // USYS National League — NL Club Premier 1 (7 new conferences)
  // =============================================
  { id: '50936', name: 'USYS NL Club P1 Frontier 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 1 - Frontier Conference' },
  { id: '50937', name: 'USYS NL Club P1 Great Lakes 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 1 - Great Lakes Conference' },
  { id: '50938', name: 'USYS NL Club P1 Midwest 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 1 - Midwest Conference' },
  { id: '50939', name: 'USYS NL Club P1 Northeast 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 1 - Northeast Conference' },
  { id: '50940', name: 'USYS NL Club P1 Pacific 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 1 - Pacific Conference' },
  { id: '50941', name: 'USYS NL Club P1 Piedmont 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 1 - Piedmont Conference' },
  { id: '50942', name: 'USYS NL Club P1 Southeast 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 1 - Southeast Conference' },

  // =============================================
  // USYS National League — NL Club Premier 2 (4 new conferences)
  // =============================================
  { id: '50931', name: 'USYS NL Club P2 Desert 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 2 - Desert Conference' },
  { id: '50922', name: 'USYS NL Club P2 Great Lakes 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 2 - Great Lakes Conference' },
  { id: '50923', name: 'USYS NL Club P2 Midwest 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 2 - Midwest Conference' },
  { id: '51345', name: 'USYS NL Club P2 Piedmont 2025-26', type: 'league', state: 'XX', notes: 'NL Club Premier 2 - Piedmont Conference' },

  // =============================================
  // USYS NL Winter Events (2 events)
  // =============================================
  { id: '50935', name: 'USYS NL Winter Event Nov 2025', type: 'tournament', state: 'AZ', notes: 'Winter showcase event Mesa AZ Nov 25-26 2025' },
  { id: '50898', name: 'USYS NL Winter Event Jan 2026', type: 'tournament', state: 'XX', notes: 'Winter event Jan 2026' },
];

async function main() {
  console.log('=== Session 106: Adding Girls Academy + USYS NL GotSport Events ===\n');
  console.log(`Total events to register: ${NEW_EVENTS.length}\n`);

  let inserted = 0;
  let existing = 0;
  let errors = 0;

  const currentSeason = await pool.query(
    'SELECT id FROM seasons WHERE is_current = true LIMIT 1'
  );
  const seasonId = currentSeason.rows[0]?.id;
  console.log(`Current season ID: ${seasonId}\n`);

  for (const ev of NEW_EVENTS) {
    const sourceEventId = `gotsport-${ev.id}`;

    // Check if already exists in leagues or tournaments
    const { rows: existing_rows } = await pool.query(`
      SELECT 'league' as type, id, name FROM leagues WHERE source_event_id = $1
      UNION ALL
      SELECT 'tournament' as type, id, name FROM tournaments WHERE source_event_id = $1
    `, [sourceEventId]);

    if (existing_rows.length > 0) {
      console.log(`  EXISTS: ${ev.id} — ${existing_rows[0].name} (${existing_rows[0].type})`);
      existing++;
      continue;
    }

    try {
      if (ev.type === 'league') {
        const { rows: insertedRows } = await pool.query(`
          INSERT INTO leagues (name, source_event_id, state, season_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
          RETURNING id, name
        `, [ev.name, sourceEventId, ev.state, seasonId]);

        if (insertedRows.length > 0) {
          console.log(`  INSERTED league: ${ev.id} — ${ev.name} (${ev.state})`);
          inserted++;
        } else {
          console.log(`  SKIPPED (conflict): ${ev.id} — ${ev.name}`);
        }
      } else {
        // tournament
        const { rows: insertedRows } = await pool.query(`
          INSERT INTO tournaments (name, source_event_id, state, season_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
          RETURNING id, name
        `, [ev.name, sourceEventId, ev.state, seasonId]);

        if (insertedRows.length > 0) {
          console.log(`  INSERTED tournament: ${ev.id} — ${ev.name} (${ev.state})`);
          inserted++;
        } else {
          console.log(`  SKIPPED (conflict): ${ev.id} — ${ev.name}`);
        }
      }
    } catch (err) {
      console.error(`  ERROR: ${ev.id} — ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Already existed: ${existing}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total: ${NEW_EVENTS.length}`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
