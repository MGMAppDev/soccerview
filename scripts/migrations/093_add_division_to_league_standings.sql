-- =============================================================================
-- Migration 093: Add division/tier to app_league_standings
-- Session 91: Division/Tier Support for League Standings
--
-- Changes from 091:
--   1. Added m.division to CTE SELECT + GROUP BY
--   2. Added division to outer SELECT
--   3. Form subquery scoped to same division (IS NOT DISTINCT FROM)
--   4. Position now PARTITION BY league_id, gender, birth_year, division
--      (so Division 1 has #1-#N, Division 2 has separate #1-#N)
--   5. New index on (league_id, division) for division-filtered queries
--
-- NULL handling: Matches without division data (most GotSport) have
-- division IS NULL. These form a single group. UI only shows division
-- filter when non-NULL divisions exist for the selected league.
-- =============================================================================

DO $$
BEGIN

RAISE NOTICE 'Migration 093: Adding division to app_league_standings';

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
        m.division,
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
        AND m.deleted_at IS NULL
        AND m.home_score IS NOT NULL
        AND m.match_date >= (SELECT start_date FROM seasons WHERE is_current = true LIMIT 1)
        AND m.match_date <= (SELECT end_date FROM seasons WHERE is_current = true LIMIT 1)
    JOIN teams_v2 t ON t.id = m.home_team_id OR t.id = m.away_team_id
    GROUP BY l.id, l.name, t.id, t.canonical_name, t.display_name, t.elo_rating, t.national_rank, t.gender, t.birth_year, m.division
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
    division,
    played,
    wins,
    draws,
    losses,
    goals_for,
    goals_against,
    goals_for - goals_against as goal_difference,
    (wins * 3) + draws as points,
    -- Form: Last 5 completed match results (same division) as array
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
           AND m.deleted_at IS NULL
           AND m.home_score IS NOT NULL
           AND (m.division IS NOT DISTINCT FROM tls.division)
           AND m.match_date >= (SELECT start_date FROM seasons WHERE is_current = true LIMIT 1)
           AND m.match_date <= (SELECT end_date FROM seasons WHERE is_current = true LIMIT 1)
         ORDER BY m.match_date DESC
         LIMIT 5
     ) recent
    ) as form,
    ROW_NUMBER() OVER (
        PARTITION BY league_id, gender, birth_year, division
        ORDER BY (wins * 3) + draws DESC,
                 goals_for - goals_against DESC,
                 goals_for DESC
    ) as position
FROM team_league_stats tls;

-- Indexes for app_league_standings
CREATE INDEX IF NOT EXISTS idx_app_league_standings_league ON app_league_standings (league_id, position);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_team ON app_league_standings (team_id);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_filter ON app_league_standings (league_id, gender, birth_year, division);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_division ON app_league_standings (league_id, division);

RAISE NOTICE 'Migration 093 complete: app_league_standings now includes division column';

END $$;
