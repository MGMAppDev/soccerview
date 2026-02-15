-- =============================================================================
-- Migration 098b: Fix App Bugs — Restore updated_at + League Stats RPC
-- =============================================================================
-- Session 98b fixes:
--   1. Restore t.updated_at to app_team_profile (dropped in migration 088)
--   2. Create get_league_stats() RPC to replace client-side row fetching
--      (PostgREST row limit was capping app_league_standings query)
-- =============================================================================

DO $$ BEGIN

-- ============================================================
-- FIX 1: Restore updated_at in app_team_profile
-- Migration 088 recreated this view but dropped t.updated_at.
-- fetchStats() in index.tsx queries this column → cascade failure.
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS app_team_profile CASCADE;

CREATE MATERIALIZED VIEW app_team_profile AS
SELECT
    t.id,
    t.canonical_name as name,
    t.display_name,
    c.name as club_name,
    c.id as club_id,
    c.logo_url as club_logo_url,
    t.birth_year,
    t.gender,
    CASE
        WHEN t.birth_year IS NOT NULL
        THEN 'U' || (get_current_season_year() - t.birth_year)::TEXT
        ELSE NULL
    END as age_group,
    t.state,
    t.elo_rating,
    t.national_rank,
    t.state_rank,
    t.regional_rank,
    t.elo_national_rank,
    t.elo_state_rank,
    t.gotsport_rank,
    t.gotsport_points,
    t.wins,
    t.losses,
    t.draws,
    t.matches_played,
    t.goals_for,
    t.goals_against,
    t.goals_for - t.goals_against as goal_difference,
    t.known_aliases,
    t.updated_at,  -- RESTORED: Was in migration 005, dropped in migration 088

    -- Embedded ALL matches (no limit for data integrity)
    (SELECT COALESCE(jsonb_agg(match_data ORDER BY match_date DESC), '[]'::jsonb)
     FROM (
         SELECT
             m.id,
             m.match_date,
             m.home_score,
             m.away_score,
             m.home_team_id,
             m.away_team_id,
             ht.canonical_name as home_team_name,
             at.canonical_name as away_team_name,
             m.league_id,
             m.tournament_id,
             COALESCE(l.name, tr.name) as event_name,
             CASE WHEN l.id IS NOT NULL THEN 'league' ELSE 'tournament' END as event_type
         FROM matches_v2 m
         JOIN teams_v2 ht ON m.home_team_id = ht.id
         JOIN teams_v2 at ON m.away_team_id = at.id
         LEFT JOIN leagues l ON m.league_id = l.id
         LEFT JOIN tournaments tr ON m.tournament_id = tr.id
         WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
           AND m.deleted_at IS NULL  -- Session 88: Exclude soft-deleted matches
         ORDER BY m.match_date DESC
     ) match_data
    ) as recent_matches,

    -- Embedded upcoming schedule (next 10)
    (SELECT COALESCE(jsonb_agg(schedule_data ORDER BY match_date ASC), '[]'::jsonb)
     FROM (
         SELECT
             s.id,
             s.match_date,
             s.match_time,
             s.home_team_id,
             s.away_team_id,
             ht.canonical_name as home_team_name,
             at.canonical_name as away_team_name,
             s.league_id,
             s.tournament_id,
             v.name as venue_name,
             v.city as venue_city,
             v.state as venue_state,
             COALESCE(l.name, tr.name) as event_name
         FROM schedules s
         JOIN teams_v2 ht ON s.home_team_id = ht.id
         JOIN teams_v2 at ON s.away_team_id = at.id
         LEFT JOIN venues v ON s.venue_id = v.id
         LEFT JOIN leagues l ON s.league_id = l.id
         LEFT JOIN tournaments tr ON s.tournament_id = tr.id
         WHERE (s.home_team_id = t.id OR s.away_team_id = t.id)
           AND s.match_date >= CURRENT_DATE
           AND (s.league_id IS NOT NULL OR s.tournament_id IS NOT NULL)
         ORDER BY s.match_date ASC
         LIMIT 10
     ) schedule_data
    ) as upcoming_schedule

FROM teams_v2 t
LEFT JOIN clubs c ON t.club_id = c.id;

-- Recreate unique index for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_app_team_profile_id ON app_team_profile (id);

RAISE NOTICE 'app_team_profile recreated with updated_at column restored';

END $$;

-- ============================================================
-- FIX 2: Create get_league_stats() RPC function
-- Replaces client-side fetching of 19,858+ rows from
-- app_league_standings. Returns ~98 aggregated rows instead.
-- PostgREST row limit was causing only 2 leagues to appear.
-- ============================================================

CREATE OR REPLACE FUNCTION get_league_stats()
RETURNS TABLE(
    league_id UUID,
    team_count BIGINT,
    match_count BIGINT
) AS $$
    SELECT
        league_id,
        COUNT(*) as team_count,
        COALESCE(SUM(played), 0) / 2 as match_count
    FROM app_league_standings
    GROUP BY league_id;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- Refresh the view
-- ============================================================
REFRESH MATERIALIZED VIEW app_team_profile;
