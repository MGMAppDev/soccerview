/**
 * checkEventGaps.cjs - Quick diagnostic to check for discoverable events
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  // Check event_registry_deprecated for events NOT in active scrape lists
  const { rows: er } = await pool.query(`
    SELECT COUNT(*) as total FROM event_registry_deprecated
  `);
  console.log('event_registry_deprecated:', parseInt(er[0].total).toLocaleString(), 'events');

  const { rows: leagues } = await pool.query('SELECT COUNT(*) as total FROM leagues');
  console.log('leagues:', parseInt(leagues[0].total).toLocaleString());

  const { rows: tournaments } = await pool.query('SELECT COUNT(*) as total FROM tournaments');
  console.log('tournaments:', parseInt(tournaments[0].total).toLocaleString());

  // Find event_registry events NOT already in leagues/tournaments
  const { rows: notInLeagues } = await pool.query(`
    SELECT COUNT(*) as cnt
    FROM event_registry_deprecated er
    WHERE NOT EXISTS (
      SELECT 1 FROM leagues l WHERE l.source_event_id = er.event_id::text
    )
    AND NOT EXISTS (
      SELECT 1 FROM tournaments t WHERE t.source_event_id = er.event_id::text
    )
  `);
  console.log('');
  console.log('Events in registry NOT in leagues/tournaments:', parseInt(notInLeagues[0].cnt).toLocaleString());

  // Sample of missing events with match counts
  const { rows: samples } = await pool.query(`
    SELECT er.event_id, er.event_name, er.source_type, er.match_count
    FROM event_registry_deprecated er
    WHERE NOT EXISTS (
      SELECT 1 FROM leagues l WHERE l.source_event_id = er.event_id::text
    )
    AND NOT EXISTS (
      SELECT 1 FROM tournaments t WHERE t.source_event_id = er.event_id::text
    )
    AND er.match_count > 100
    ORDER BY er.match_count DESC NULLS LAST
    LIMIT 10
  `);

  console.log('');
  console.log('Top missing events (by match count):');
  samples.forEach(s => console.log('  ' + s.event_id + ': ' + (s.event_name || 'Unknown').substring(0,50) + ' (' + (s.match_count || 0) + ' matches)'));

  await pool.end();
}

check().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
