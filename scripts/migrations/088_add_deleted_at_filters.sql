-- =============================================================================
-- Migration 088: Add deleted_at IS NULL Filters to Materialized Views
-- =============================================================================
-- Session 88 QC Issue #4: Soft-deleted matches were included in materialized
-- views, causing duplicate entries and inflated stats.
--
-- Views modified:
--   1. app_team_profile - match subquery
--   2. app_matches_feed - main query
--   3. app_league_standings - stats query + form subquery
--
-- Views NOT modified (don't query matches_v2):
--   - app_rankings (reads teams_v2 only)
--   - app_upcoming_schedule (reads schedules table)
-- =============================================================================

DO $$ BEGIN

-- ============================================================
-- VIEW 2: APP_TEAM_PROFILE (Team detail page)
-- Added: AND m.deleted_at IS NULL to match subquery
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

-- Indexes for app_team_profile
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_team_profile_id ON app_team_profile (id);
CREATE INDEX IF NOT EXISTS idx_app_team_profile_name ON app_team_profile (name);
CREATE INDEX IF NOT EXISTS idx_app_team_profile_club ON app_team_profile (club_id);

RAISE NOTICE 'Recreated app_team_profile with deleted_at filter';

-- ============================================================
-- VIEW 3: APP_MATCHES_FEED (Home page, Matches tab)
-- Added: WHERE m.deleted_at IS NULL
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS app_matches_feed CASCADE;

CREATE MATERIALIZED VIEW app_matches_feed AS
SELECT
    m.id,
    m.match_date,
    m.match_time,
    m.home_score,
    m.away_score,
    jsonb_build_object(
        'id', ht.id,
        'name', ht.canonical_name,
        'display_name', ht.display_name,
        'club_name', hc.name,
        'elo_rating', ht.elo_rating,
        'national_rank', ht.national_rank,
        'state', ht.state
    ) as home_team,
    jsonb_build_object(
        'id', at.id,
        'name', at.canonical_name,
        'display_name', at.display_name,
        'club_name', ac.name,
        'elo_rating', at.elo_rating,
        'national_rank', at.national_rank,
        'state', at.state
    ) as away_team,
    CASE
        WHEN m.league_id IS NOT NULL THEN jsonb_build_object('id', l.id, 'name', l.name, 'type', 'league')
        ELSE jsonb_build_object('id', tr.id, 'name', tr.name, 'type', 'tournament')
    END as event,
    jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'city', v.city,
        'state', v.state
    ) as venue,
    ht.gender,
    ht.birth_year,
    CASE
        WHEN ht.birth_year IS NOT NULL
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
WHERE m.deleted_at IS NULL  -- Session 88: Exclude soft-deleted matches
ORDER BY m.match_date DESC;

-- Indexes for app_matches_feed
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_matches_feed_id ON app_matches_feed (id);
CREATE INDEX IF NOT EXISTS idx_app_matches_feed_date ON app_matches_feed (match_date DESC);
CREATE INDEX IF NOT EXISTS idx_app_matches_feed_filter ON app_matches_feed (state, gender, birth_year);

RAISE NOTICE 'Recreated app_matches_feed with deleted_at filter';

-- ============================================================
-- VIEW 4: APP_LEAGUE_STANDINGS (League detail page)
-- Added: AND m.deleted_at IS NULL in stats + form subquery
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS app_league_standings CASCADE;

CREATE MATERIALIZED VIEW app_league_standings AS
WITH team_league_stats AS (
    SELECT
        l.id as league_id,
        l.name as league_name,
        t.id as team_id,
        t.canonical_name as team_name,
        t.display_name,
        t.elo_rating,
        t.national_rank,
        t.gender,
        t.birth_year,
        CASE
            WHEN t.birth_year IS NOT NULL
            THEN 'U' || (get_current_season_year() - t.birth_year)::TEXT
            ELSE NULL
        END as age_group,
        COUNT(m.id) as played,
        SUM(CASE
            WHEN (m.home_team_id = t.id AND m.home_score > m.away_score)
              OR (m.away_team_id = t.id AND m.away_score > m.home_score)
            THEN 1 ELSE 0
        END) as wins,
        SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END) as draws,
        SUM(CASE
            WHEN (m.home_team_id = t.id AND m.home_score < m.away_score)
              OR (m.away_team_id = t.id AND m.away_score < m.home_score)
            THEN 1 ELSE 0
        END) as losses,
        SUM(CASE WHEN m.home_team_id = t.id THEN m.home_score ELSE m.away_score END) as goals_for,
        SUM(CASE WHEN m.home_team_id = t.id THEN m.away_score ELSE m.home_score END) as goals_against
    FROM leagues l
    JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL  -- Session 88: Exclude soft-deleted
    JOIN teams_v2 t ON t.id = m.home_team_id OR t.id = m.away_team_id
    GROUP BY l.id, l.name, t.id, t.canonical_name, t.display_name, t.elo_rating, t.national_rank, t.gender, t.birth_year
)
SELECT
    league_id,
    league_name,
    team_id,
    team_name,
    display_name,
    elo_rating,
    national_rank,
    gender,
    birth_year,
    age_group,
    played,
    wins,
    draws,
    losses,
    goals_for,
    goals_against,
    goals_for - goals_against as goal_difference,
    (wins * 3) + draws as points,
    -- Form: Last 5 results as array
    (SELECT array_agg(result ORDER BY match_date DESC)
     FROM (
         SELECT
             m.match_date,
             CASE
                 WHEN (m.home_team_id = tls.team_id AND m.home_score > m.away_score)
                   OR (m.away_team_id = tls.team_id AND m.away_score > m.home_score) THEN 'W'
                 WHEN m.home_score = m.away_score THEN 'D'
                 ELSE 'L'
             END as result
         FROM matches_v2 m
         WHERE m.league_id = tls.league_id
           AND (m.home_team_id = tls.team_id OR m.away_team_id = tls.team_id)
           AND m.deleted_at IS NULL  -- Session 88: Exclude soft-deleted
         ORDER BY m.match_date DESC
         LIMIT 5
     ) recent
    ) as form,
    ROW_NUMBER() OVER (
        PARTITION BY league_id
        ORDER BY (wins * 3) + draws DESC,
                 goals_for - goals_against DESC,
                 goals_for DESC
    ) as position
FROM team_league_stats tls;

-- Indexes for app_league_standings
CREATE INDEX IF NOT EXISTS idx_app_league_standings_league ON app_league_standings (league_id, position);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_team ON app_league_standings (team_id);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_filter ON app_league_standings (league_id, gender, birth_year);

RAISE NOTICE 'Recreated app_league_standings with deleted_at filter';

END $$;
