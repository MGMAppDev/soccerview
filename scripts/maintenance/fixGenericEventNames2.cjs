/**
 * fixGenericEventNames2.cjs
 * Fix known generic GotSport event names with their real names.
 * These were identified by fetching the actual GotSport event pages.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const fixes = [
    { eventId: '48929', name: 'SOCAL State Cup 2026 - Youngers 2012-2019', state: 'CA' },
    { eventId: '50273', name: '2025-26 NorCal State Cup U13-U19 Knockout Stage', state: 'CA' },
    { eventId: '49142', name: '2026 Spring Thruway League', state: 'NY' },
    { eventId: '42340', name: '23rd Annual Dimitri Cup U8-U12 Weekend', state: 'FL' },
    { eventId: '45659', name: 'Florida Cup 2026 - US Club Soccer State Championship', state: 'FL' },
    { eventId: '47334', name: '2026 Region C Commissioners Cup', state: 'FL' },
    { eventId: '49167', name: '2026 Region A Commissioners Cup', state: 'FL' },
    { eventId: '49522', name: '2026 Sporting Jax Winter Invitational', state: 'FL' },
    { eventId: '49426', name: 'SFPL 2026 Spring Season', state: 'FL' },
  ];

  let updated = 0;
  for (const { eventId, name, state } of fixes) {
    // Fix in tournaments
    const r1 = await pool.query(
      `UPDATE tournaments SET name = $1, state = COALESCE(state, $3)
       WHERE source_event_id = $2
       AND (name LIKE 'GotSport Event%' OR name = 'GotSport')`,
      [name, eventId, state]
    );
    // Fix in leagues
    const r2 = await pool.query(
      `UPDATE leagues SET name = $1, state = COALESCE(state, $3)
       WHERE source_event_id = $2
       AND (name LIKE 'GotSport Event%' OR name = 'GotSport')`,
      [name, eventId, state]
    );
    const total = (r1.rowCount || 0) + (r2.rowCount || 0);
    if (total > 0) {
      console.log(`Fixed: ${eventId} -> ${name} (${total} rows)`);
      updated += total;
    }
  }

  // Count remaining generic
  const { rows } = await pool.query(
    "SELECT COUNT(*) as cnt FROM tournaments WHERE name LIKE 'GotSport Event%' OR name = 'GotSport'"
  );
  console.log(`\nTotal updated: ${updated}`);
  console.log(`Remaining generic tournament names: ${rows[0].cnt}`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
