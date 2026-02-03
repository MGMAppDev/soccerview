-- ============================================================
-- SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1
-- Migration 005: Create Materialized Views (Layer 3)
--
-- Purpose: Denormalized "spreadsheets" that the app reads from
-- Pre-computed for instant access, refresh nightly + on-demand
-- ============================================================

-- ============================================================
-- VIEW 1: APP_TEAM_PROFILE
-- Everything about a team in one row
-- Used by: Team detail page
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS app_team_profile AS
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
    t.national_rank,
    t.state_rank,
    t.regional_rank,
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

    -- Embedded ALL matches (no limit for data integrity - app can paginate)
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
             COALESCE(l.name, tr.name) as event_name,
             CASE WHEN l.id IS NOT NULL THEN 'league' ELSE 'tournament' END as event_type
         FROM matches_v2 m
         JOIN teams_v2 ht ON m.home_team_id = ht.id
         JOIN teams_v2 at ON m.away_team_id = at.id
         LEFT JOIN leagues l ON m.league_id = l.id
         LEFT JOIN tournaments tr ON m.tournament_id = tr.id
         WHERE m.home_team_id = t.id OR m.away_team_id = t.id
         ORDER BY m.match_date DESC
         -- NO LIMIT: Include all matches for data integrity
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
LEFT JOIN clubs c ON t.club_id = c.id;

-- Indexes on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_team_profile_id ON app_team_profile (id);
CREATE INDEX IF NOT EXISTS idx_app_team_profile_rank ON app_team_profile (national_rank NULLS LAST, elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_app_team_profile_state_rank ON app_team_profile (state, elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_app_team_profile_filter ON app_team_profile (state, gender, birth_year);
CREATE INDEX IF NOT EXISTS idx_app_team_profile_club ON app_team_profile (club_id);
CREATE INDEX IF NOT EXISTS idx_app_team_profile_search ON app_team_profile USING GIN (to_tsvector('english', name || ' ' || COALESCE(club_name, '')));
CREATE INDEX IF NOT EXISTS idx_app_team_profile_with_matches ON app_team_profile (matches_played DESC) WHERE matches_played > 0;


-- ============================================================
-- VIEW 2: APP_MATCHES_FEED
-- Recent matches with team details embedded
-- Used by: Home page, Matches tab
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS app_matches_feed AS
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
    ht.age_group,
    ht.state
FROM matches_v2 m
JOIN teams_v2 ht ON m.home_team_id = ht.id
LEFT JOIN clubs hc ON ht.club_id = hc.id
JOIN teams_v2 at ON m.away_team_id = at.id
LEFT JOIN clubs ac ON at.club_id = ac.id
LEFT JOIN leagues l ON m.league_id = l.id
LEFT JOIN tournaments tr ON m.tournament_id = tr.id
LEFT JOIN venues v ON m.venue_id = v.id
ORDER BY m.match_date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_matches_feed_id ON app_matches_feed (id);
CREATE INDEX IF NOT EXISTS idx_app_matches_feed_date ON app_matches_feed (match_date DESC);
CREATE INDEX IF NOT EXISTS idx_app_matches_feed_filter ON app_matches_feed (state, gender, birth_year);


-- ============================================================
-- VIEW 3: APP_LEAGUE_STANDINGS
-- Pre-calculated standings per league
-- Used by: League detail page
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS app_league_standings AS
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
        t.age_group,
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
    JOIN matches_v2 m ON m.league_id = l.id
    JOIN teams_v2 t ON t.id = m.home_team_id OR t.id = m.away_team_id
    GROUP BY l.id, l.name, t.id, t.canonical_name, t.display_name, t.elo_rating, t.national_rank, t.gender, t.birth_year, t.age_group
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
    -- Form: Last 5 results as array ['W', 'W', 'D', 'L', 'W']
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

CREATE INDEX IF NOT EXISTS idx_app_league_standings_league ON app_league_standings (league_id, position);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_team ON app_league_standings (team_id);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_filter ON app_league_standings (league_id, gender, birth_year);


-- ============================================================
-- VIEW 4: APP_UPCOMING_SCHEDULE
-- Future games for all teams
-- Used by: Team schedule, venue schedule
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS app_upcoming_schedule AS
SELECT
    s.id,
    s.match_date,
    s.match_time,
    jsonb_build_object(
        'id', ht.id,
        'name', ht.canonical_name,
        'display_name', ht.display_name,
        'elo_rating', ht.elo_rating,
        'national_rank', ht.national_rank,
        'state', ht.state
    ) as home_team,
    jsonb_build_object(
        'id', at.id,
        'name', at.canonical_name,
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
    ht.age_group,
    ht.state
FROM schedules s
JOIN teams_v2 ht ON s.home_team_id = ht.id
JOIN teams_v2 at ON s.away_team_id = at.id
LEFT JOIN venues v ON s.venue_id = v.id
LEFT JOIN leagues l ON s.league_id = l.id
LEFT JOIN tournaments tr ON s.tournament_id = tr.id
WHERE s.match_date >= CURRENT_DATE
ORDER BY s.match_date ASC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_upcoming_schedule_id ON app_upcoming_schedule (id);
CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_date ON app_upcoming_schedule (match_date ASC);
CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_filter ON app_upcoming_schedule (state, gender, birth_year);


-- ============================================================
-- VIEW 5: APP_RANKINGS (for Rankings tab)
-- Pre-sorted ranking list
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS app_rankings AS
SELECT
    t.id,
    t.canonical_name as name,
    t.display_name,
    c.name as club_name,
    t.birth_year,
    t.gender,
    t.age_group,
    t.state,
    t.elo_rating,
    t.national_rank,
    t.state_rank,
    t.gotsport_rank,
    t.gotsport_points,
    t.matches_played,
    t.wins,
    t.losses,
    t.draws,
    -- Has match history flag
    CASE WHEN t.matches_played > 0 THEN TRUE ELSE FALSE END as has_matches
FROM teams_v2 t
LEFT JOIN clubs c ON t.club_id = c.id
ORDER BY t.national_rank ASC NULLS LAST, t.elo_rating DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_rankings_id ON app_rankings (id);
CREATE INDEX IF NOT EXISTS idx_app_rankings_rank ON app_rankings (national_rank ASC NULLS LAST, elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_app_rankings_filter ON app_rankings (state, gender, birth_year);
CREATE INDEX IF NOT EXISTS idx_app_rankings_with_matches ON app_rankings (national_rank ASC NULLS LAST) WHERE has_matches = TRUE;


-- ============================================================
-- REFRESH FUNCTION
-- ============================================================

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_app_views()
RETURNS void AS $$
BEGIN
    RAISE NOTICE 'Refreshing app_team_profile...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_team_profile;

    RAISE NOTICE 'Refreshing app_matches_feed...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_matches_feed;

    RAISE NOTICE 'Refreshing app_league_standings...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_league_standings;

    RAISE NOTICE 'Refreshing app_upcoming_schedule...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_upcoming_schedule;

    RAISE NOTICE 'Refreshing app_rankings...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_rankings;

    RAISE NOTICE 'All views refreshed successfully.';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_app_views IS 'Refreshes all app materialized views concurrently. Run nightly and after data updates.';


-- ============================================================
-- INDIVIDUAL REFRESH FUNCTIONS
-- For targeted refreshes after specific updates
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_team_profile(p_team_id UUID DEFAULT NULL)
RETURNS void AS $$
BEGIN
    -- Full refresh (CONCURRENTLY requires all rows)
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_team_profile;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_league_standings(p_league_id UUID DEFAULT NULL)
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_league_standings;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_rankings()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_rankings;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON MATERIALIZED VIEW app_team_profile IS 'Denormalized team data with embedded matches, schedule, and history. Single query for team detail page.';
COMMENT ON MATERIALIZED VIEW app_matches_feed IS 'Recent matches with all team data embedded. For home page and matches tab.';
COMMENT ON MATERIALIZED VIEW app_league_standings IS 'Pre-calculated league standings with form indicators.';
COMMENT ON MATERIALIZED VIEW app_upcoming_schedule IS 'Future games with venue and team data embedded.';
COMMENT ON MATERIALIZED VIEW app_rankings IS 'Pre-sorted rankings list for Rankings tab.';
