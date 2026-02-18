/**
 * Reclassify ISL event 49628 from tournament to league
 * Session 112
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT authorize_pipeline_write()');

    const tournamentId = '3ebe4814-5220-4fa4-ae93-5babd871df8f';
    const leagueName = 'Indiana Soccer League Spring 2026';
    const sourceEventId = 'gotsport-49628';

    // 1. Create league
    const { rows: [league] } = await client.query(
      `INSERT INTO leagues (name, source_event_id, season_id, state, region)
       VALUES ($1, $2, (SELECT id FROM seasons WHERE is_current = true), 'IN', 'Midwest')
       RETURNING id, name`,
      [leagueName, sourceEventId]
    );
    console.log('Created league:', league);

    // 2. Re-point matches from tournament to league
    const { rowCount } = await client.query(
      `UPDATE matches_v2 SET league_id = $1, tournament_id = NULL
       WHERE tournament_id = $2 AND deleted_at IS NULL`,
      [league.id, tournamentId]
    );
    console.log('Re-pointed', rowCount, 'matches to league');

    // 3. Register in source_entity_map
    await client.query(
      `INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
       VALUES ('league', 'gotsport', '49628', $1)
       ON CONFLICT DO NOTHING`,
      [league.id]
    );
    console.log('Registered in source_entity_map');

    // 4. Delete the generic tournament
    await client.query('DELETE FROM tournaments WHERE id = $1', [tournamentId]);
    console.log('Deleted generic tournament');

    await client.query('COMMIT');
    console.log('Done - ISL 49628 reclassified as league');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
