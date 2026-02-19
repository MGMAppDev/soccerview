require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runQueries() {
  try {
    console.log('\n=== QUERY 1: staging_events state coverage ===');
    const q1 = await pool.query(`
      SELECT 
        COUNT(*) as total_staging_events,
        COUNT(state) as has_state,
        COUNT(*) - COUNT(state) as missing_state,
        ROUND(100.0 * COUNT(state) / NULLIF(COUNT(*), 0), 1) as pct_with_state
      FROM staging_events;
    `);
    console.log(JSON.stringify(q1.rows[0], null, 2));

    console.log('\n=== QUERY 2: staging_events state values breakdown ===');
    const q2 = await pool.query(`
      SELECT state, COUNT(*) as cnt 
      FROM staging_events 
      WHERE state IS NOT NULL 
      GROUP BY state 
      ORDER BY cnt DESC 
      LIMIT 30;
    `);
    console.log(JSON.stringify(q2.rows, null, 2));

    console.log('\n=== QUERY 3: leagues vs tournaments state coverage ===');
    const q3 = await pool.query(`
      SELECT 'leagues' as entity, 
        COUNT(*) as total,
        COUNT(state) as has_state,
        COUNT(*) - COUNT(state) as null_state
      FROM leagues
      UNION ALL
      SELECT 'tournaments', COUNT(*), COUNT(state), COUNT(*) - COUNT(state)
      FROM tournaments;
    `);
    console.log(JSON.stringify(q3.rows, null, 2));

    console.log('\n=== QUERY 4: Can we JOIN leagues to staging_events to get state? ===');
    const q4 = await pool.query(`
      SELECT 
        COUNT(*) as null_state_leagues,
        COUNT(se.state) as fixable_from_staging,
        COUNT(*) - COUNT(se.state) as unfixable
      FROM leagues l
      LEFT JOIN staging_events se ON l.source_event_id = se.source_event_id
      WHERE l.state IS NULL;
    `);
    console.log(JSON.stringify(q4.rows[0], null, 2));

    console.log('\n=== QUERY 4b: Same for tournaments ===');
    const q4b = await pool.query(`
      SELECT 
        COUNT(*) as null_state_tournaments,
        COUNT(se.state) as fixable_from_staging,
        COUNT(*) - COUNT(se.state) as unfixable
      FROM tournaments t
      LEFT JOIN staging_events se ON t.source_event_id = se.source_event_id
      WHERE t.state IS NULL;
    `);
    console.log(JSON.stringify(q4b.rows[0], null, 2));

    console.log('\n=== QUERY 5: staging_games venue/field coverage ===');
    const q5 = await pool.query(`
      SELECT 
        COUNT(*) as total_staging,
        COUNT(venue_name) as has_venue,
        COUNT(field_name) as has_field,
        ROUND(100.0 * COUNT(venue_name) / NULLIF(COUNT(*), 0), 1) as pct_venue,
        ROUND(100.0 * COUNT(field_name) / NULLIF(COUNT(*), 0), 1) as pct_field
      FROM staging_games;
    `);
    console.log(JSON.stringify(q5.rows[0], null, 2));

    console.log('\n=== QUERY 6: staging_games raw_data source coverage ===');
    const q6 = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN raw_data->>'source_home_team_id' IS NOT NULL THEN 1 END) as has_home_id,
        COUNT(CASE WHEN raw_data->>'source_away_team_id' IS NOT NULL THEN 1 END) as has_away_id,
        COUNT(CASE WHEN raw_data->>'event_state' IS NOT NULL THEN 1 END) as has_event_state
      FROM staging_games;
    `);
    console.log(JSON.stringify(q6.rows[0], null, 2));

    console.log('\n=== QUERY 7: teams_v2 source_platform/source_team_id coverage ===');
    const q7 = await pool.query(`
      SELECT
        COUNT(*) as total_teams,
        COUNT(source_platform) as has_source_platform,
        COUNT(source_team_id) as has_source_team_id,
        ROUND(100.0 * COUNT(source_platform) / NULLIF(COUNT(*), 0), 1) as pct_platform
      FROM teams_v2;
    `);
    console.log(JSON.stringify(q7.rows[0], null, 2));

    console.log('\n=== QUERY 8: leagues season_id coverage ===');
    const q8 = await pool.query(`
      SELECT
        COUNT(*) as total_leagues,
        COUNT(season_id) as has_season_id,
        COUNT(*) - COUNT(season_id) as missing_season_id
      FROM leagues;
    `);
    console.log(JSON.stringify(q8.rows[0], null, 2));

    console.log('\n=== QUERY 9: matches_v2 field_name/venue coverage ===');
    const q9 = await pool.query(`
      SELECT
        COUNT(*) as total_matches,
        COUNT(field_name) as has_field,
        COUNT(venue_id) as has_venue
      FROM matches_v2 WHERE deleted_at IS NULL;
    `);
    console.log(JSON.stringify(q9.rows[0], null, 2));

    console.log('\n=== QUERY 10: source_entity_map coverage for events ===');
    const q10 = await pool.query(`
      SELECT entity_type, COUNT(*) as cnt
      FROM source_entity_map
      WHERE entity_type IN ('league', 'tournament')
      GROUP BY entity_type;
    `);
    console.log(JSON.stringify(q10.rows, null, 2));

    console.log('\n=== QUERY 11: staging_events by source_platform ===');
    const q11 = await pool.query(`
      SELECT source_platform, COUNT(*) as events, COUNT(state) as has_state
      FROM staging_events
      GROUP BY source_platform
      ORDER BY events DESC;
    `);
    console.log(JSON.stringify(q11.rows, null, 2));

    console.log('\n=== QUERY 12: staging_games by source_platform (top 20) ===');
    const q12 = await pool.query(`
      SELECT source_platform, COUNT(*) as games, 
        COUNT(venue_name) as has_venue,
        COUNT(field_name) as has_field
      FROM staging_games
      GROUP BY source_platform
      ORDER BY games DESC
      LIMIT 20;
    `);
    console.log(JSON.stringify(q12.rows, null, 2));

    console.log('\n=== QUERY 13: staging_games unprocessed count ===');
    const q13 = await pool.query(`
      SELECT COUNT(*) as unprocessed FROM staging_games WHERE processed = false;
    `);
    console.log(JSON.stringify(q13.rows[0], null, 2));

    console.log('\n=== QUERY 14: staging_games/staging_events ratio ===');
    const q14 = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM staging_games) as total_games,
        (SELECT COUNT(*) FROM staging_events) as total_events,
        ROUND((SELECT COUNT(*) FROM staging_games)::numeric / 
              NULLIF((SELECT COUNT(*) FROM staging_events), 0), 1) as avg_games_per_event;
    `);
    console.log(JSON.stringify(q14.rows[0], null, 2));

  } catch (error) {
    console.error('Query error:', error.message);
  } finally {
    await pool.end();
  }
}

runQueries();
