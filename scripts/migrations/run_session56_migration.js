/**
 * Run Session 56 migration: Fix app_upcoming_schedule to include matches_v2 future matches
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(60));
  console.log("SESSION 56 MIGRATION: Fix app_upcoming_schedule");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000,
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");

    // Check current state (if view exists)
    let beforeCount = 0;
    try {
      const before = await client.query(`SELECT COUNT(*) as count FROM app_upcoming_schedule`);
      beforeCount = before.rows[0].count;
      console.log(`Before: ${beforeCount} rows in app_upcoming_schedule`);
    } catch (e) {
      console.log(`Before: View doesn't exist (will create)`);
    }

    // Drop existing view
    console.log("\nDropping existing view...");
    await client.query(`DROP MATERIALIZED VIEW IF EXISTS app_upcoming_schedule`);

    // Create new view with UNION
    console.log("Creating new view with UNION (schedules + matches_v2)...");
    await client.query(`
      CREATE MATERIALIZED VIEW app_upcoming_schedule AS
      -- Part 1: From schedules table (original behavior)
      SELECT
          s.id,
          s.match_date,
          s.match_time,
          jsonb_build_object(
              'id', ht.id,
              'name', COALESCE(ht.display_name, ht.canonical_name),
              'display_name', ht.display_name,
              'elo_rating', ht.elo_rating,
              'national_rank', ht.national_rank,
              'state', ht.state
          ) as home_team,
          jsonb_build_object(
              'id', at.id,
              'name', COALESCE(at.display_name, at.canonical_name),
              'display_name', at.display_name,
              'elo_rating', at.elo_rating,
              'national_rank', at.national_rank,
              'state', at.state
          ) as away_team,
          CASE
              WHEN s.league_id IS NOT NULL THEN jsonb_build_object('id', l.id, 'name', l.name, 'type', 'league')
              ELSE jsonb_build_object('id', tr.id, 'name', tr.name, 'type', 'tournament')
          END as event,
          jsonb_build_object(
              'id', v.id,
              'name', v.name,
              'address', v.address,
              'city', v.city,
              'state', v.state,
              'latitude', v.latitude,
              'longitude', v.longitude
          ) as venue,
          s.field_name,
          ht.gender,
          ht.birth_year,
          'U' || (EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER +
                 CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 8 THEN 1 ELSE 0 END
                 - ht.birth_year) as age_group,
          ht.state
      FROM schedules s
      JOIN teams_v2 ht ON s.home_team_id = ht.id
      JOIN teams_v2 at ON s.away_team_id = at.id
      LEFT JOIN venues v ON s.venue_id = v.id
      LEFT JOIN leagues l ON s.league_id = l.id
      LEFT JOIN tournaments tr ON s.tournament_id = tr.id
      WHERE s.match_date >= CURRENT_DATE

      UNION ALL

      -- Part 2: From matches_v2 (scheduled future matches WITH KNOWN EVENTS ONLY)
      -- Only include matches that are properly linked to a league or tournament
      -- Unlinked matches are excluded for data integrity
      SELECT
          m.id,
          m.match_date,
          m.match_time,
          jsonb_build_object(
              'id', ht.id,
              'name', COALESCE(ht.display_name, ht.canonical_name),
              'display_name', ht.display_name,
              'elo_rating', ht.elo_rating,
              'national_rank', ht.national_rank,
              'state', ht.state
          ) as home_team,
          jsonb_build_object(
              'id', at.id,
              'name', COALESCE(at.display_name, at.canonical_name),
              'display_name', at.display_name,
              'elo_rating', at.elo_rating,
              'national_rank', at.national_rank,
              'state', at.state
          ) as away_team,
          CASE
              WHEN m.league_id IS NOT NULL THEN jsonb_build_object('id', l.id, 'name', l.name, 'type', 'league')
              ELSE jsonb_build_object('id', tr.id, 'name', tr.name, 'type', 'tournament')
          END as event,
          NULL::jsonb as venue,
          NULL as field_name,
          ht.gender,
          ht.birth_year,
          'U' || (EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER +
                 CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 8 THEN 1 ELSE 0 END
                 - ht.birth_year) as age_group,
          ht.state
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      LEFT JOIN leagues l ON m.league_id = l.id
      LEFT JOIN tournaments tr ON m.tournament_id = tr.id
      WHERE m.match_date >= CURRENT_DATE
        AND m.home_score = 0
        AND m.away_score = 0
        -- CRITICAL: Only include matches with known events (league OR tournament linked)
        AND (m.league_id IS NOT NULL OR m.tournament_id IS NOT NULL)
        AND NOT EXISTS (
            SELECT 1 FROM schedules s
            WHERE s.id = m.id
        )

      ORDER BY match_date ASC
    `);

    // Create indexes
    console.log("Creating indexes...");
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_upcoming_schedule_id ON app_upcoming_schedule (id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_date ON app_upcoming_schedule (match_date ASC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_filter ON app_upcoming_schedule (state, gender, birth_year)`);

    // Check result
    const after = await client.query(`SELECT COUNT(*) as count FROM app_upcoming_schedule`);
    console.log(`\nAfter: ${after.rows[0].count} rows in app_upcoming_schedule`);
    console.log(`  Added: ${after.rows[0].count - beforeCount} scheduled matches from matches_v2`);

    // Sample verification
    const sample = await client.query(`
      SELECT match_date, event->>'name' as event_name, event->>'type' as event_type
      FROM app_upcoming_schedule
      WHERE event->>'type' = 'other'
      LIMIT 5
    `);

    if (sample.rows.length > 0) {
      console.log("\nSample of 'other' type matches (from unlinked matches_v2):");
      sample.rows.forEach(r => {
        console.log(`  ${r.match_date} - ${r.event_name}`);
      });
    }

    console.log("\n" + "=".repeat(60));
    console.log("MIGRATION COMPLETE!");
    console.log("=".repeat(60));

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
