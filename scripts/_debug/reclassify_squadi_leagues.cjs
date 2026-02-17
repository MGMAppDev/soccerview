#!/usr/bin/env node
// Reclassify ACSL + NWAL from tournament → league (they are seasonal leagues, not tournaments)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const toReclassify = ['ACSL Fall 2025', 'ACSL Spring 2026', 'NWAL Fall 2025', 'NWAL Spring 2026'];

  // Authorize pipeline writes (bypass write protection trigger)
  await pool.query('SELECT authorize_pipeline_write()');

  for (const name of toReclassify) {
    const { rows: [t] } = await pool.query(
      'SELECT id, name, state, source_event_id FROM tournaments WHERE name = $1', [name]
    );
    if (!t) { console.log('NOT FOUND:', name); continue; }
    console.log('Reclassifying:', t.name, '(', t.id, ')');

    const srcEventId = t.source_event_id || ('squadi-' + name.toLowerCase().replace(/\s+/g, '-'));

    // Check if league already exists
    const { rows: existing } = await pool.query(
      'SELECT id FROM leagues WHERE name = $1', [t.name]
    );
    let l;
    if (existing.length > 0) {
      l = existing[0];
      console.log('  League already exists:', l.id);
    } else {
      const { rows: [created] } = await pool.query(
        'INSERT INTO leagues (name, state, source_event_id) VALUES ($1, $2, $3) RETURNING id',
        [t.name, t.state || 'AR', srcEventId]
      );
      l = created;
    }

    if (l) {
      // Move matches from tournament to league
      const { rowCount } = await pool.query(
        'UPDATE matches_v2 SET league_id = $1, tournament_id = NULL WHERE tournament_id = $2 AND deleted_at IS NULL',
        [l.id, t.id]
      );
      console.log('  Moved', rowCount, 'matches to league', l.id);

      // Update source_entity_map
      const { rowCount: semCount } = await pool.query(
        "UPDATE source_entity_map SET sv_id = $1, entity_type = 'league' WHERE sv_id = $2 AND entity_type = 'tournament'",
        [l.id, t.id]
      );
      console.log('  Updated', semCount, 'source_entity_map entries');

      // Delete tournament
      await pool.query('DELETE FROM tournaments WHERE id = $1', [t.id]);
      console.log('  Tournament deleted');
    } else {
      console.log('  League already exists for source_event_id:', srcEventId);
    }
  }

  // Verify final state
  const { rows } = await pool.query(`
    SELECT
      CASE
        WHEN m.league_id IS NOT NULL THEN 'league: ' || l.name
        WHEN m.tournament_id IS NOT NULL THEN 'tournament: ' || t.name
        ELSE 'unlinked'
      END as event_type,
      COUNT(*) as match_count
    FROM matches_v2 m
    LEFT JOIN leagues l ON m.league_id = l.id
    LEFT JOIN tournaments t ON m.tournament_id = t.id
    WHERE m.source_match_key LIKE 'squadi%' AND m.deleted_at IS NULL
    GROUP BY 1 ORDER BY 1
  `);
  console.log('\nFinal Squadi event linkage:');
  rows.forEach(r => console.log(' ', r.event_type, ':', r.match_count, 'matches'));

  await pool.end();
}
main();
