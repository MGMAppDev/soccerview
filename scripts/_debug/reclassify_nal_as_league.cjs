/**
 * Reclassify NAL 2025-2026 from tournament to league
 * Session 108: NAL is a year-round national league, not a tournament
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await pool.query('SELECT authorize_pipeline_write()');

  const nalTournId = '7aaf5793-71e6-463e-96e3-ed51f47b51b6';

  // Get tournament details
  const t = await pool.query(
    'SELECT id, name, state, source_platform, source_event_id FROM tournaments WHERE id = $1',
    [nalTournId]
  );
  if (t.rows.length === 0) {
    console.log('Tournament not found!');
    await pool.end();
    return;
  }
  const tourn = t.rows[0];
  console.log('Tournament:', tourn.name, '| state=' + tourn.state, '| source=' + tourn.source_event_id);

  // Get current season
  const season = await pool.query("SELECT id FROM seasons WHERE is_current = true LIMIT 1");
  const seasonId = season.rows[0].id;

  // Create league
  const ins = await pool.query(
    'INSERT INTO leagues (name, season_id, state, source_platform, source_event_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [tourn.name, seasonId, tourn.state, tourn.source_platform, tourn.source_event_id]
  );
  const leagueId = ins.rows[0].id;
  console.log('Created league:', leagueId);

  // Move matches from tournament to league
  const upd = await pool.query(
    'UPDATE matches_v2 SET league_id = $1, tournament_id = NULL WHERE tournament_id = $2 AND deleted_at IS NULL',
    [leagueId, nalTournId]
  );
  console.log('Reclassified', upd.rowCount, 'matches from tournament to league');

  // Update source_entity_map
  const sem = await pool.query(
    "UPDATE source_entity_map SET sv_id = $1, entity_type = 'league' WHERE sv_id = $2",
    [leagueId, nalTournId]
  );
  console.log('Updated', sem.rowCount, 'source_entity_map entries');

  console.log('\nDone. NAL 2025-2026 is now a league.');
  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
