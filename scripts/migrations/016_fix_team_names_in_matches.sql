-- ============================================================
-- SOCCERVIEW DATABASE RESTRUCTURE - FIX
-- Migration 016: Fix team names in embedded match/schedule data
--
-- Issues Found (QC-003):
-- 1. Team names use canonical_name (lowercase) instead of display_name
-- 2. Match data missing league_id/tournament_id for UI grouping
--
-- Created: January 28, 2026 (Session 49 QC)
-- ============================================================

-- ============================================================
-- DROP AND RECREATE APP_TEAM_PROFILE VIEW
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS app_team_profile CASCADE;

CREATE MATERIALIZED VIEW app_team_profile AS
WITH elo_ranks AS (
    -- Pre-compute ELO ranks for teams with matches
    -- Partition by birth_year + gender to rank within same category
    SELECT
        t.id,
        ROW_NUMBER() OVER (
            PARTITION BY t.birth_year, t.gender
            ORDER BY t.elo_rating DESC NULLS LAST, t.id
        ) as elo_national_rank,
        ROW_NUMBER() OVER (
            PARTITION BY t.state, t.birth_year, t.gender
            ORDER BY t.elo_rating DESC NULLS LAST, t.id
        ) as elo_state_rank
    FROM teams_v2 t
    WHERE t.matches_played > 0
)
SELECT
    t.id,
    t.canonical_name as name,
    t.display_name,
    c.name as club_name,
    c.id as club_id,
    c.logo_url as club_logo_url,
    t.birth_year,
    t.gender,
    t.age_group,
    t.state,
    t.elo_rating,
    -- GotSport Rankings
    t.national_rank,
    t.state_rank,
    t.regional_rank,
    t.gotsport_rank,
    t.gotsport_points,
    -- ELO-based Rankings (SoccerView Power Rating)
    er.elo_national_rank,
    er.elo_state_rank,
    -- Stats
    t.wins,
    t.losses,
    t.draws,
    t.matches_played,
    t.goals_for,
    t.goals_against,
    t.goals_for - t.goals_against as goal_difference,
    t.known_aliases,

    -- Embedded recent matches (last 10)
    -- FIX: Use display_name instead of canonical_name for proper formatting
    -- FIX: Include league_id and tournament_id for UI grouping
    (SELECT COALESCE(jsonb_agg(match_data ORDER BY match_date DESC), '[]'::jsonb)
     FROM (
         SELECT
             m.id,
             m.match_date,
             m.home_score,
             m.away_score,
             m.home_team_id,
             m.away_team_id,
             ht.display_name as home_team_name,  -- FIX: was canonical_name
             at.display_name as away_team_name,  -- FIX: was canonical_name
             m.league_id,                         -- NEW: for grouping
             m.tournament_id,                     -- NEW: for grouping
             COALESCE(l.name, tr.name) as event_name,
             CASE WHEN l.id IS NOT NULL THEN 'league' ELSE 'tournament' END as event_type
         FROM matches_v2 m
         JOIN teams_v2 ht ON m.home_team_id = ht.id
         JOIN teams_v2 at ON m.away_team_id = at.id
         LEFT JOIN leagues l ON m.league_id = l.id
         LEFT JOIN tournaments tr ON m.tournament_id = tr.id
         WHERE m.home_team_id = t.id OR m.away_team_id = t.id
         ORDER BY m.match_date DESC
         LIMIT 10
     ) match_data
    ) as recent_matches,

    -- Embedded upcoming schedule (next 10)
    -- FIX: Use display_name instead of canonical_name for proper formatting
    -- FIX: Include league_id and tournament_id for UI grouping
    (SELECT COALESCE(jsonb_agg(schedule_data ORDER BY match_date ASC), '[]'::jsonb)
     FROM (
         SELECT
             s.id,
             s.match_date,
             s.match_time,
             s.home_team_id,
             s.away_team_id,
             ht.display_name as home_team_name,  -- FIX: was canonical_name
             at.display_name as away_team_name,  -- FIX: was canonical_name
             s.league_id,                         -- NEW: for grouping
             s.tournament_id,                     -- NEW: for grouping
             v.name as venue_name,
             v.city as venue_city,
             v.state as venue_state,
             s.field_name,
             COALESCE(l.name, tr.name) as event_name,
             CASE WHEN l.id IS NOT NULL THEN 'league' ELSE 'tournament' END as event_type
         FROM schedules s
         JOIN teams_v2 ht ON s.home_team_id = ht.id
         JOIN teams_v2 at ON s.away_team_id = at.id
         LEFT JOIN venues v ON s.venue_id = v.id
         LEFT JOIN leagues l ON s.league_id = l.id
         LEFT JOIN tournaments tr ON s.tournament_id = tr.id
         WHERE (s.home_team_id = t.id OR s.away_team_id = t.id)
           AND s.match_date >= CURRENT_DATE
         ORDER BY s.match_date ASC
         LIMIT 10
     ) schedule_data
    ) as upcoming_schedule,

    -- Embedded rank history (last 90 days for chart)
    (SELECT COALESCE(jsonb_agg(rh ORDER BY snapshot_date ASC), '[]'::jsonb)
     FROM (
         SELECT snapshot_date, elo_rating, national_rank, state_rank
         FROM rank_history_v2
         WHERE team_id = t.id
           AND snapshot_date >= CURRENT_DATE - INTERVAL '90 days'
         ORDER BY snapshot_date ASC
     ) rh
    ) as rank_history,

    -- Leagues this team plays in (for "League Standings" button)
    (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', l.id,
        'name', l.name
    )), '[]'::jsonb)
     FROM matches_v2 m
     JOIN leagues l ON m.league_id = l.id
     WHERE m.home_team_id = t.id OR m.away_team_id = t.id
    ) as leagues,

    t.updated_at

FROM teams_v2 t
LEFT JOIN clubs c ON t.club_id = c.id
LEFT JOIN elo_ranks er ON t.id = er.id;

-- Recreate indexes
CREATE UNIQUE INDEX idx_app_team_profile_id ON app_team_profile (id);
CREATE INDEX idx_app_team_profile_rank ON app_team_profile (national_rank NULLS LAST, elo_rating DESC);
CREATE INDEX idx_app_team_profile_elo_rank ON app_team_profile (elo_national_rank ASC NULLS LAST);
CREATE INDEX idx_app_team_profile_state_rank ON app_team_profile (state, elo_rating DESC);
CREATE INDEX idx_app_team_profile_filter ON app_team_profile (state, gender, birth_year);
CREATE INDEX idx_app_team_profile_club ON app_team_profile (club_id);
CREATE INDEX idx_app_team_profile_search ON app_team_profile USING GIN (to_tsvector('english', name || ' ' || COALESCE(club_name, '')));
CREATE INDEX idx_app_team_profile_with_matches ON app_team_profile (matches_played DESC) WHERE matches_played > 0;


-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON MATERIALIZED VIEW app_team_profile IS 'Team profile with display_name for matches (not canonical_name). Fixed Jan 28, 2026.';
