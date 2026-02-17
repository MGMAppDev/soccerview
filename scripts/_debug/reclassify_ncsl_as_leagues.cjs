/**
 * Reclassify NCSL events from tournaments to leagues + set state=VA
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const tournamentIds = [
    '763fb7d2-0074-48ee-bc28-683bd204827b', // NCSL Travel Fall 2025
    'fc030b9a-7968-4037-8209-8b48fcd7fa15', // NCSL Travel Spring 2025
  ];

  // Authorize pipeline write
  await pool.query('SELECT authorize_pipeline_write()');

  for (const tId of tournamentIds) {
    const { rows: [t] } = await pool.query('SELECT * FROM tournaments WHERE id = $1', [tId]);
    if (!t) {
      console.log(`Tournament ${tId} not found (already reclassified?)`);
      continue;
    }

    const eventId = t.name.includes('Fall') ? '80738-fall2025' : '80738-spring2025';

    // Create league
    await pool.query(`
      INSERT INTO leagues (id, name, state, region, season_id, source_event_id, source_platform)
      VALUES ($1, $2, 'VA', $3, $4, $5, 'demosphere')
      ON CONFLICT (id) DO NOTHING
    `, [t.id, t.name, t.region, t.season_id, eventId]);

    // Re-point matches
    const { rowCount } = await pool.query(`
      UPDATE matches_v2
      SET league_id = $1, tournament_id = NULL
      WHERE tournament_id = $1 AND deleted_at IS NULL
    `, [tId]);

    // Delete tournament
    await pool.query('DELETE FROM tournaments WHERE id = $1', [tId]);

    // Register source_entity_map
    await pool.query(`
      INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
      VALUES ('league', 'demosphere', $1, $2)
      ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
    `, [eventId, tId]);

    console.log(`Reclassified: ${t.name} -> league (state=VA), ${rowCount} matches re-pointed`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); process.exit(1); });
