/**
 * Reclassify WYSA Fall 2025 from tournament to league + set state=WI
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await pool.query('SELECT authorize_pipeline_write()');

  // Only reclassify the league entries, not State Cup tournaments
  const leagueIds = [
    { id: '2b091eee-178d-4d2a-af95-99cfe9f14a1e', eventId: 'wysa-fall-2025' },
    { id: '2efe1da9-9217-4a56-a962-7ec1ff6d3ab8', eventId: 'wysa-spring-2025' },
  ];

  for (const { id: tId, eventId } of leagueIds) {
    const { rows: [t] } = await pool.query('SELECT * FROM tournaments WHERE id = $1', [tId]);
    if (!t) { console.log(`Tournament ${tId} not found`); continue; }

    await pool.query(`
      INSERT INTO leagues (id, name, state, region, season_id, source_event_id, source_platform)
      VALUES ($1, $2, 'WI', $3, $4, $5, 'playmetrics')
      ON CONFLICT (id) DO NOTHING
    `, [t.id, t.name, t.region, t.season_id, eventId]);

    const { rowCount } = await pool.query(`
      UPDATE matches_v2 SET league_id = $1, tournament_id = NULL
      WHERE tournament_id = $1 AND deleted_at IS NULL
    `, [tId]);

    await pool.query('DELETE FROM tournaments WHERE id = $1', [tId]);

    await pool.query(`
      INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
      VALUES ('league', 'playmetrics', $1, $2)
      ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
    `, [eventId, tId]);

    console.log(`Reclassified: ${t.name} -> league (state=WI), ${rowCount} matches re-pointed`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); process.exit(1); });
