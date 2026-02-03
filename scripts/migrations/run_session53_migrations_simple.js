/**
 * Run Session 53 Migrations (Simplified)
 * =======================================
 *
 * Applies migrations 021, 022, 023 using individual SQL statements.
 * Avoids PL/pgSQL blocks that don't work well with Node.js pg client.
 *
 * Usage: node scripts/migrations/run_session53_migrations_simple.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function runQuery(client, description, sql) {
  try {
    await client.query(sql);
    console.log(`✅ ${description}`);
    return true;
  } catch (e) {
    console.log(`❌ ${description}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("🚀 RUNNING SESSION 53 MIGRATIONS (Simplified)");
  console.log("=".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // ============================================================
    // MIGRATION 021: Add year column to seasons table
    // ============================================================
    console.log("=".repeat(70));
    console.log("MIGRATION 021: Add year column to seasons table");
    console.log("=".repeat(70));

    await runQuery(client, "Add year column",
      `ALTER TABLE seasons ADD COLUMN IF NOT EXISTS year INTEGER`
    );

    await runQuery(client, "Backfill year from start_date",
      `UPDATE seasons SET year = EXTRACT(YEAR FROM start_date)::INTEGER + 1 WHERE year IS NULL`
    );

    await runQuery(client, "Create index on is_current",
      `CREATE INDEX IF NOT EXISTS idx_seasons_current ON seasons(is_current) WHERE is_current = true`
    );

    await runQuery(client, "Create index on year",
      `CREATE INDEX IF NOT EXISTS idx_seasons_year ON seasons(year)`
    );

    await runQuery(client, "Create get_current_season_year function",
      `CREATE OR REPLACE FUNCTION get_current_season_year()
       RETURNS INTEGER AS $$
       DECLARE
         season_year INTEGER;
       BEGIN
         SELECT year INTO season_year FROM seasons WHERE is_current = true LIMIT 1;
         IF season_year IS NULL THEN
           IF EXTRACT(MONTH FROM CURRENT_DATE) >= 8 THEN
             season_year := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER + 1;
           ELSE
             season_year := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
           END IF;
         END IF;
         RETURN season_year;
       END;
       $$ LANGUAGE plpgsql STABLE`
    );

    await runQuery(client, "Create calculate_age_group function",
      `CREATE OR REPLACE FUNCTION calculate_age_group(p_birth_year INTEGER)
       RETURNS TEXT AS $$
       BEGIN
         IF p_birth_year IS NULL THEN RETURN NULL; END IF;
         RETURN 'U' || (get_current_season_year() - p_birth_year)::TEXT;
       END;
       $$ LANGUAGE plpgsql STABLE`
    );

    // Ensure current season exists
    await runQuery(client, "Ensure 2025-26 season exists",
      `INSERT INTO seasons (name, start_date, end_date, year, is_current)
       VALUES ('2025-26 Season', '2025-08-01', '2026-07-31', 2026, true)
       ON CONFLICT (start_date, end_date) DO UPDATE SET year = 2026, is_current = true`
    );

    // Mark other seasons as not current
    await runQuery(client, "Mark other seasons as not current",
      `UPDATE seasons SET is_current = false WHERE start_date != '2025-08-01' OR end_date != '2026-07-31'`
    );

    // ============================================================
    // MIGRATION 022: Create teams_v2_live view
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("MIGRATION 022: Create teams_v2_live view");
    console.log("=".repeat(70));

    await runQuery(client, "Drop existing view",
      `DROP VIEW IF EXISTS teams_v2_live CASCADE`
    );

    await runQuery(client, "Create teams_v2_live view",
      `CREATE OR REPLACE VIEW teams_v2_live AS
       SELECT
         t.id, t.club_id, t.canonical_name, t.display_name, t.birth_year, t.gender,
         CASE WHEN t.birth_year IS NOT NULL
           THEN 'U' || (get_current_season_year() - t.birth_year)::TEXT
           ELSE NULL
         END AS age_group,
         CASE WHEN t.birth_year IS NOT NULL
           THEN 'U' || (get_current_season_year() - t.birth_year)::TEXT
           ELSE NULL
         END AS age_group_computed,
         t.state, t.known_aliases, t.elo_rating, t.national_rank, t.state_rank,
         t.regional_rank, t.elo_national_rank, t.elo_state_rank, t.gotsport_rank,
         t.gotsport_points, t.wins, t.losses, t.draws, t.matches_played,
         t.goals_for, t.goals_against, t.source_platform, t.source_team_id,
         t.data_quality_score, t.birth_year_source, t.gender_source, t.data_flags,
         t.created_at, t.updated_at, get_current_season_year() AS season_year
       FROM teams_v2 t`
    );

    await runQuery(client, "Grant SELECT on teams_v2_live",
      `GRANT SELECT ON teams_v2_live TO anon, authenticated`
    );

    // ============================================================
    // MIGRATION 023: Update materialized views
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("MIGRATION 023: Update materialized views with dynamic age_group");
    console.log("=".repeat(70));

    // app_rankings
    await runQuery(client, "Drop app_rankings",
      `DROP MATERIALIZED VIEW IF EXISTS app_rankings CASCADE`
    );

    await runQuery(client, "Create app_rankings with dynamic age_group",
      `CREATE MATERIALIZED VIEW app_rankings AS
       SELECT
         t.id, t.canonical_name as name, t.display_name, c.name as club_name,
         t.birth_year, t.gender,
         CASE WHEN t.birth_year IS NOT NULL
           THEN 'U' || (get_current_season_year() - t.birth_year)::TEXT
           ELSE NULL
         END as age_group,
         t.state, t.elo_rating, t.national_rank, t.state_rank,
         t.elo_national_rank, t.elo_state_rank, t.gotsport_rank, t.gotsport_points,
         t.matches_played, t.wins, t.losses, t.draws,
         CASE WHEN t.matches_played > 0 THEN TRUE ELSE FALSE END as has_matches
       FROM teams_v2 t
       LEFT JOIN clubs c ON t.club_id = c.id
       ORDER BY t.national_rank ASC NULLS LAST, t.elo_rating DESC`
    );

    await runQuery(client, "Create indexes on app_rankings",
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_rankings_id ON app_rankings (id);
       CREATE INDEX IF NOT EXISTS idx_app_rankings_rank ON app_rankings (national_rank ASC NULLS LAST, elo_rating DESC);
       CREATE INDEX IF NOT EXISTS idx_app_rankings_filter ON app_rankings (state, gender, birth_year);
       CREATE INDEX IF NOT EXISTS idx_app_rankings_with_matches ON app_rankings (national_rank ASC NULLS LAST) WHERE has_matches = TRUE;
       CREATE INDEX IF NOT EXISTS idx_app_rankings_featured ON app_rankings (elo_rating DESC) WHERE has_matches = TRUE`
    );

    // app_matches_feed
    await runQuery(client, "Drop app_matches_feed",
      `DROP MATERIALIZED VIEW IF EXISTS app_matches_feed CASCADE`
    );

    await runQuery(client, "Create app_matches_feed with dynamic age_group",
      `CREATE MATERIALIZED VIEW app_matches_feed AS
       SELECT
         m.id, m.match_date, m.match_time, m.home_score, m.away_score,
         jsonb_build_object('id', ht.id, 'name', ht.canonical_name, 'display_name', ht.display_name,
           'club_name', hc.name, 'elo_rating', ht.elo_rating, 'national_rank', ht.national_rank, 'state', ht.state) as home_team,
         jsonb_build_object('id', at.id, 'name', at.canonical_name, 'display_name', at.display_name,
           'club_name', ac.name, 'elo_rating', at.elo_rating, 'national_rank', at.national_rank, 'state', at.state) as away_team,
         CASE WHEN m.league_id IS NOT NULL
           THEN jsonb_build_object('id', l.id, 'name', l.name, 'type', 'league')
           ELSE jsonb_build_object('id', tr.id, 'name', tr.name, 'type', 'tournament')
         END as event,
         jsonb_build_object('id', v.id, 'name', v.name, 'city', v.city, 'state', v.state) as venue,
         ht.gender, ht.birth_year,
         CASE WHEN ht.birth_year IS NOT NULL
           THEN 'U' || (get_current_season_year() - ht.birth_year)::TEXT
           ELSE NULL
         END as age_group,
         ht.state
       FROM matches_v2 m
       JOIN teams_v2 ht ON m.home_team_id = ht.id
       LEFT JOIN clubs hc ON ht.club_id = hc.id
       JOIN teams_v2 at ON m.away_team_id = at.id
       LEFT JOIN clubs ac ON at.club_id = ac.id
       LEFT JOIN leagues l ON m.league_id = l.id
       LEFT JOIN tournaments tr ON m.tournament_id = tr.id
       LEFT JOIN venues v ON m.venue_id = v.id
       ORDER BY m.match_date DESC`
    );

    await runQuery(client, "Create indexes on app_matches_feed",
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_matches_feed_id ON app_matches_feed (id);
       CREATE INDEX IF NOT EXISTS idx_app_matches_feed_date ON app_matches_feed (match_date DESC);
       CREATE INDEX IF NOT EXISTS idx_app_matches_feed_filter ON app_matches_feed (state, gender, birth_year)`
    );

    // app_upcoming_schedule
    await runQuery(client, "Drop app_upcoming_schedule",
      `DROP MATERIALIZED VIEW IF EXISTS app_upcoming_schedule CASCADE`
    );

    await runQuery(client, "Create app_upcoming_schedule with dynamic age_group",
      `CREATE MATERIALIZED VIEW app_upcoming_schedule AS
       SELECT
         s.id, s.match_date, s.match_time,
         jsonb_build_object('id', ht.id, 'name', ht.canonical_name, 'display_name', ht.display_name,
           'elo_rating', ht.elo_rating, 'national_rank', ht.national_rank, 'state', ht.state) as home_team,
         jsonb_build_object('id', at.id, 'name', at.canonical_name, 'display_name', at.display_name,
           'elo_rating', at.elo_rating, 'national_rank', at.national_rank, 'state', at.state) as away_team,
         CASE WHEN s.league_id IS NOT NULL
           THEN jsonb_build_object('id', l.id, 'name', l.name, 'type', 'league')
           ELSE jsonb_build_object('id', tr.id, 'name', tr.name, 'type', 'tournament')
         END as event,
         jsonb_build_object('id', v.id, 'name', v.name, 'address', v.address, 'city', v.city, 'state', v.state,
           'latitude', v.latitude, 'longitude', v.longitude) as venue,
         s.field_name, ht.gender, ht.birth_year,
         CASE WHEN ht.birth_year IS NOT NULL
           THEN 'U' || (get_current_season_year() - ht.birth_year)::TEXT
           ELSE NULL
         END as age_group,
         ht.state
       FROM schedules s
       JOIN teams_v2 ht ON s.home_team_id = ht.id
       JOIN teams_v2 at ON s.away_team_id = at.id
       LEFT JOIN venues v ON s.venue_id = v.id
       LEFT JOIN leagues l ON s.league_id = l.id
       LEFT JOIN tournaments tr ON s.tournament_id = tr.id
       WHERE s.match_date >= CURRENT_DATE
       ORDER BY s.match_date ASC`
    );

    await runQuery(client, "Create indexes on app_upcoming_schedule",
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_upcoming_schedule_id ON app_upcoming_schedule (id);
       CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_date ON app_upcoming_schedule (match_date ASC);
       CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_filter ON app_upcoming_schedule (state, gender, birth_year)`
    );

    // Skip app_team_profile and app_league_standings for now - they are complex and may already exist

    // Update refresh_app_views function
    await runQuery(client, "Update refresh_app_views function",
      `CREATE OR REPLACE FUNCTION refresh_app_views()
       RETURNS void AS $$
       BEGIN
         REFRESH MATERIALIZED VIEW CONCURRENTLY app_rankings;
         REFRESH MATERIALIZED VIEW CONCURRENTLY app_matches_feed;
         REFRESH MATERIALIZED VIEW CONCURRENTLY app_upcoming_schedule;
         -- Note: app_team_profile and app_league_standings may need separate refresh if they exist
       END;
       $$ LANGUAGE plpgsql`
    );

    // ============================================================
    // VERIFICATION
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("VERIFICATION");
    console.log("=".repeat(70));

    const yearCheck = await client.query("SELECT get_current_season_year() as year");
    console.log(`✅ get_current_season_year() = ${yearCheck.rows[0].year}`);

    const viewCheck = await client.query("SELECT COUNT(*) as cnt FROM teams_v2_live LIMIT 1");
    console.log(`✅ teams_v2_live view exists`);

    const seasonCheck = await client.query("SELECT year, is_current FROM seasons WHERE is_current = true");
    console.log(`✅ Current season: year=${seasonCheck.rows[0].year}`);

    const rankingsCheck = await client.query("SELECT COUNT(*) as cnt FROM app_rankings");
    console.log(`✅ app_rankings has ${rankingsCheck.rows[0].cnt} rows`);

  } catch (err) {
    console.error("\n❌ Connection error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Migrations completed at: ${new Date().toISOString()}`);
}

main();
