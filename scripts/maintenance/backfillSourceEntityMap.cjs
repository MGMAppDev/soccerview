/**
 * Backfill Source Entity Map
 * ==========================
 * Session 89: Populates source_entity_map from existing data.
 *
 * Heartland: Extracts team IDs from source_match_key pattern:
 *   heartland-{homeId}-{awayId}-{date}
 *
 * All sources: Extracts event IDs from matches_v2 linkage.
 *
 * Uses BULK SQL — single-pass INSERT...SELECT, no row-by-row loops.
 */

const projDir = 'c:\\Users\\MathieuMiles\\Projects\\soccerview';
require(projDir + '\\node_modules\\dotenv').config({ path: projDir + '\\.env' });
const { Pool } = require(projDir + '\\node_modules\\pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function backfill() {
  const client = await pool.connect();
  try {
    await client.query('SELECT authorize_pipeline_write()');
    console.log('Pipeline authorized\n');

    // ===================================================================
    // 1. HEARTLAND TEAM IDs
    // source_match_key format: heartland-{homeId}-{awayId}-{date}
    // Extract homeId/awayId and map to the team IDs in matches_v2
    // ===================================================================
    console.log('=== STEP 1: Heartland Team IDs ===');

    const heartlandTeams = await client.query(`
      INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
      SELECT DISTINCT 'team', 'heartland', source_team_id, team_id
      FROM (
        -- Extract home team IDs
        SELECT
          split_part(source_match_key, '-', 2) AS source_team_id,
          home_team_id AS team_id
        FROM matches_v2
        WHERE source_platform = 'heartland'
          AND deleted_at IS NULL
          AND source_match_key LIKE 'heartland-%'

        UNION

        -- Extract away team IDs
        SELECT
          split_part(source_match_key, '-', 3) AS source_team_id,
          away_team_id AS team_id
        FROM matches_v2
        WHERE source_platform = 'heartland'
          AND deleted_at IS NULL
          AND source_match_key LIKE 'heartland-%'
      ) heartland_ids
      WHERE source_team_id IS NOT NULL
        AND source_team_id != ''
        AND team_id IS NOT NULL
      ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
    `);
    console.log('  Heartland team mappings inserted: ' + heartlandTeams.rowCount);

    // ===================================================================
    // 2. EVENT IDs (leagues + tournaments) from all sources
    // ===================================================================
    console.log('\n=== STEP 2: Event IDs ===');

    // Leagues - map from leagues table (has source_platform + source_event_id)
    const leagueEvents = await client.query(`
      INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
      SELECT DISTINCT 'league', l.source_platform, l.source_event_id, l.id
      FROM leagues l
      WHERE l.source_platform IS NOT NULL
        AND l.source_event_id IS NOT NULL
      ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
    `);
    console.log('  League event mappings inserted: ' + leagueEvents.rowCount);

    // Tournaments - map from tournaments table (has source_platform + source_event_id)
    const tournEvents = await client.query(`
      INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
      SELECT DISTINCT 'tournament', t.source_platform, t.source_event_id, t.id
      FROM tournaments t
      WHERE t.source_platform IS NOT NULL
        AND t.source_event_id IS NOT NULL
      ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
    `);
    console.log('  Tournament event mappings inserted: ' + tournEvents.rowCount);

    // ===================================================================
    // 3. CLUB IDs from canonical_clubs
    // ===================================================================
    console.log('\n=== STEP 3: Club IDs ===');

    // Clubs don't have source_platform/source_club_id columns on canonical_clubs
    // Club source IDs will be populated by future adapters that emit club IDs
    console.log('  Club mappings: skipped (no source IDs on existing clubs - populated by future adapters)');

    // ===================================================================
    // SUMMARY
    // ===================================================================
    const summary = await client.query(`
      SELECT entity_type, source_platform, COUNT(*) as cnt
      FROM source_entity_map
      GROUP BY entity_type, source_platform
      ORDER BY entity_type, source_platform
    `);
    console.log('\n=== BACKFILL SUMMARY ===');
    summary.rows.forEach(r => {
      console.log('  ' + r.entity_type + ' / ' + r.source_platform + ': ' + r.cnt);
    });

    const total = await client.query('SELECT COUNT(*) FROM source_entity_map');
    console.log('\nTotal source_entity_map entries: ' + total.rows[0].count);

  } finally {
    client.release();
    await pool.end();
  }
}

backfill().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
