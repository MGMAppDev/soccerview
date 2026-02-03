/**
 * Fix League Standings Card
 *
 * Problem: League Standings card not showing on Team Details page
 * Root cause: The leagues JSON in app_team_profile doesn't include match_count,
 *             so the condition `matchCount >= 2` always evaluates false.
 *
 * Solution: Update app_team_profile view to include match_count per league
 *
 * Usage: node scripts/_debug/fix_league_standings_card.cjs
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('Updating app_team_profile view to include match_count per league...\n');

    // Drop existing materialized view
    await client.query('DROP MATERIALIZED VIEW IF EXISTS app_team_profile CASCADE');
    console.log('Dropped old materialized view');

    const viewSQL = `
      CREATE MATERIALIZED VIEW app_team_profile AS
      SELECT
        t.id,
        t.canonical_name AS name,
        t.display_name,
        c.name AS club_name,
        c.id AS club_id,
        c.logo_url AS club_logo_url,
        t.birth_year,
        t.gender,
        t.age_group,
        t.state,
        t.elo_rating,
        t.national_rank,
        t.state_rank,
        t.regional_rank,
        t.gotsport_rank,
        t.gotsport_points,
        t.elo_national_rank,
        t.elo_state_rank,
        t.wins,
        t.losses,
        t.draws,
        t.matches_played,
        t.goals_for,
        t.goals_against,
        t.goals_for - t.goals_against AS goal_difference,
        t.known_aliases,
        (
          SELECT COALESCE(jsonb_agg(match_data.* ORDER BY match_data.match_date DESC), '[]'::jsonb)
          FROM (
            SELECT
              m.id,
              m.match_date,
              m.home_score,
              m.away_score,
              m.home_team_id,
              m.away_team_id,
              m.league_id,
              m.tournament_id,
              ht.canonical_name AS home_team_name,
              at.canonical_name AS away_team_name,
              COALESCE(l.name, tr.name) AS event_name,
              CASE WHEN l.id IS NOT NULL THEN 'league' ELSE 'tournament' END AS event_type
            FROM matches_v2 m
            JOIN teams_v2 ht ON m.home_team_id = ht.id
            JOIN teams_v2 at ON m.away_team_id = at.id
            LEFT JOIN leagues l ON m.league_id = l.id
            LEFT JOIN tournaments tr ON m.tournament_id = tr.id
            WHERE m.home_team_id = t.id OR m.away_team_id = t.id
            ORDER BY m.match_date DESC
          ) match_data
        ) AS recent_matches,
        (
          SELECT COALESCE(jsonb_agg(schedule_data.* ORDER BY schedule_data.match_date), '[]'::jsonb)
          FROM (
            SELECT
              s.id,
              s.match_date,
              s.match_time,
              s.home_team_id,
              s.away_team_id,
              s.league_id,
              s.tournament_id,
              ht.canonical_name AS home_team_name,
              at.canonical_name AS away_team_name,
              v.name AS venue_name,
              v.city AS venue_city,
              v.state AS venue_state,
              s.field_name,
              COALESCE(l.name, tr.name) AS event_name,
              CASE WHEN l.id IS NOT NULL THEN 'league' ELSE 'tournament' END AS event_type
            FROM schedules s
            JOIN teams_v2 ht ON s.home_team_id = ht.id
            JOIN teams_v2 at ON s.away_team_id = at.id
            LEFT JOIN venues v ON s.venue_id = v.id
            LEFT JOIN leagues l ON s.league_id = l.id
            LEFT JOIN tournaments tr ON s.tournament_id = tr.id
            WHERE (s.home_team_id = t.id OR s.away_team_id = t.id)
              AND s.match_date >= CURRENT_DATE
            ORDER BY s.match_date
            LIMIT 10
          ) schedule_data
        ) AS upcoming_schedule,
        (
          SELECT COALESCE(jsonb_agg(rh.* ORDER BY rh.snapshot_date), '[]'::jsonb)
          FROM (
            SELECT snapshot_date, elo_rating, national_rank, state_rank
            FROM rank_history_v2
            WHERE team_id = t.id
              AND snapshot_date >= CURRENT_DATE - INTERVAL '90 days'
            ORDER BY snapshot_date
          ) rh
        ) AS rank_history,
        -- FIXED: Include match_count per league for League Standings card visibility
        (
          SELECT COALESCE(jsonb_agg(league_data ORDER BY league_data.match_count DESC), '[]'::jsonb)
          FROM (
            SELECT DISTINCT
              l.id,
              l.name,
              COUNT(m.id) AS match_count
            FROM matches_v2 m
            JOIN leagues l ON m.league_id = l.id
            WHERE m.home_team_id = t.id OR m.away_team_id = t.id
            GROUP BY l.id, l.name
          ) league_data
        ) AS leagues,
        t.updated_at
      FROM teams_v2 t
      LEFT JOIN clubs c ON t.club_id = c.id
    `;

    await client.query(viewSQL);
    console.log('✅ View updated successfully with match_count per league');

    // Create index for performance
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_team_profile_id ON app_team_profile(id)');
    console.log('✅ Index created');

    // Verify with test team (Sporting BV Pre-NAL 15)
    const { rows } = await client.query(`
      SELECT
        id,
        display_name,
        leagues,
        jsonb_array_length(leagues) as league_count
      FROM app_team_profile
      WHERE id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    `);

    console.log('\nVerification for Sporting BV Pre-NAL 15:');
    if (rows.length > 0) {
      console.log('  Team:', rows[0].display_name);
      console.log('  League count:', rows[0].league_count);
      console.log('  Leagues:', JSON.stringify(rows[0].leagues, null, 2));

      // Check if any league has >= 2 matches
      const leaguesWithEnoughMatches = rows[0].leagues?.filter(l => l.match_count >= 2) || [];
      console.log('\n  Leagues with 2+ matches:', leaguesWithEnoughMatches.length);
      if (leaguesWithEnoughMatches.length > 0) {
        console.log('  ✅ League Standings card SHOULD now show!');
      } else {
        console.log('  ⚠️ No leagues with 2+ matches - card may not show');
      }
    } else {
      console.log('  Team not found in view');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
