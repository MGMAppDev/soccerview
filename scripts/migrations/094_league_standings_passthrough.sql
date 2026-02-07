-- =============================================================================
-- Migration 094: League Standings Passthrough Architecture
-- Session 92: Scrape authoritative standings, display as-is
--
-- PROBLEM: The current app_league_standings view recomputes standings from
-- matches_v2 data. This required 7 iterative division inference passes,
-- produced 176 multi-division artifacts, and 5 NULL+division splits.
-- The league IS the authority on its own standings.
--
-- SOLUTION: New staging_standings + league_standings tables. The view becomes
-- a hybrid UNION ALL:
--   PART 1: Scraped authoritative standings (from league_standings table)
--   PART 2: Computed fallback (from matches_v2, same as 093 — for leagues
--           without scraped standings data)
--
-- When league_standings is empty (day 1), ALL leagues use the computed path
-- = zero behavior change. As we scrape standings for each source, leagues
-- graduate from computed → scraped automatically.
--
-- UNIVERSAL: Works for ANY league source. Heartland, HTGSports, GotSport,
-- SINC Sports, ECNL — all use the same tables and pipeline.
-- =============================================================================

DO $$
BEGIN

RAISE NOTICE 'Migration 094: League Standings Passthrough Architecture';

-- =========================================================================
-- STEP 1: Create staging_standings table (Layer 1)
-- =========================================================================

CREATE TABLE IF NOT EXISTS staging_standings (
    id BIGSERIAL PRIMARY KEY,
    league_source_id TEXT NOT NULL,          -- source's event/league identifier
    division TEXT,                            -- "Division 1", "Premier", NULL
    team_name TEXT NOT NULL,                 -- team name as published by source
    team_source_id TEXT,                     -- source's team identifier (for entity resolution)
    played INTEGER,                          -- GP
    wins INTEGER,
    losses INTEGER,
    draws INTEGER,                           -- some sources call this "ties"
    goals_for INTEGER,
    goals_against INTEGER,
    points INTEGER,                          -- as published by the league authority
    position INTEGER,                        -- rank as published (if available)
    red_cards INTEGER,                       -- some sources publish RC
    extra_data JSONB,                        -- any source-specific fields
    source_platform TEXT NOT NULL,           -- 'heartland', 'htgsports', 'gotsport'
    source_snapshot_date DATE NOT NULL,      -- when this standings snapshot was scraped
    season TEXT,                             -- 'Fall 2025', 'Spring 2026', etc.
    age_group TEXT,                          -- 'U-11', 'U-12', etc. (source format)
    gender TEXT,                             -- 'Boys', 'Girls' (source format)
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staging_standings_platform
    ON staging_standings (source_platform, processed);
CREATE INDEX IF NOT EXISTS idx_staging_standings_league
    ON staging_standings (league_source_id, source_platform);

RAISE NOTICE '  Created staging_standings table';

-- =========================================================================
-- STEP 2: Create league_standings table (Layer 2 — Production)
-- =========================================================================

CREATE TABLE IF NOT EXISTS league_standings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id),
    team_id UUID NOT NULL REFERENCES teams_v2(id),
    division TEXT,                            -- normalized: "Division 1", "Premier", etc.
    played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    goals_for INTEGER NOT NULL DEFAULT 0,
    goals_against INTEGER NOT NULL DEFAULT 0,
    goal_difference INTEGER GENERATED ALWAYS AS (goals_for - goals_against) STORED,
    points INTEGER NOT NULL DEFAULT 0,       -- as published by league authority
    position INTEGER,                        -- as published, or computed from points
    red_cards INTEGER,
    source_platform TEXT NOT NULL,
    snapshot_date DATE NOT NULL,             -- date standings were scraped
    season_id UUID REFERENCES seasons(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (league_id, team_id, division)    -- one entry per team per division per league
);

CREATE INDEX IF NOT EXISTS idx_league_standings_league
    ON league_standings (league_id, position);
CREATE INDEX IF NOT EXISTS idx_league_standings_team
    ON league_standings (team_id);
CREATE INDEX IF NOT EXISTS idx_league_standings_filter
    ON league_standings (league_id, division);
CREATE INDEX IF NOT EXISTS idx_league_standings_season
    ON league_standings (season_id);

RAISE NOTICE '  Created league_standings table';

-- =========================================================================
-- STEP 3: Redefine app_league_standings as hybrid UNION ALL view
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS app_league_standings CASCADE;

CREATE MATERIALIZED VIEW app_league_standings AS

-- =====================================================================
-- PART 1: Scraped authoritative standings (preferred when available)
-- Source: league_standings table (populated by standings scrapers)
-- =====================================================================
SELECT
    ls.league_id,
    l.name as league_name,
    ls.team_id,
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
    ls.division,
    ls.played,
    ls.wins,
    ls.draws,
    ls.losses,
    ls.goals_for,
    ls.goals_against,
    ls.goal_difference,
    ls.points,
    -- Form: computed from matches_v2 (standings sources don't publish this)
    (SELECT array_agg(result ORDER BY match_date DESC)
     FROM (
         SELECT
             m.match_date,
             CASE
                 WHEN (m.home_team_id = ls.team_id AND m.home_score > m.away_score)
                   OR (m.away_team_id = ls.team_id AND m.away_score > m.home_score) THEN 'W'
                 WHEN m.home_score = m.away_score THEN 'D'
                 ELSE 'L'
             END as result
         FROM matches_v2 m
         WHERE m.league_id = ls.league_id
           AND (m.home_team_id = ls.team_id OR m.away_team_id = ls.team_id)
           AND m.deleted_at IS NULL
           AND m.home_score IS NOT NULL
           AND m.match_date >= (SELECT start_date FROM seasons WHERE is_current = true LIMIT 1)
           AND m.match_date <= (SELECT end_date FROM seasons WHERE is_current = true LIMIT 1)
         ORDER BY m.match_date DESC
         LIMIT 5
     ) recent
    ) as form,
    ls.position
FROM league_standings ls
JOIN leagues l ON l.id = ls.league_id
JOIN teams_v2 t ON t.id = ls.team_id
JOIN seasons s ON s.id = ls.season_id AND s.is_current = true

UNION ALL

-- =====================================================================
-- PART 2: Computed fallback for leagues WITHOUT scraped standings
-- Source: matches_v2 (same CTE logic as migration 093)
-- Only used for leagues that have NO rows in league_standings
-- =====================================================================
SELECT
    computed.league_id,
    computed.league_name,
    computed.team_id,
    computed.team_name,
    computed.display_name,
    computed.elo_rating,
    computed.national_rank,
    computed.gender,
    computed.birth_year,
    computed.age_group,
    computed.division,
    computed.played,
    computed.wins,
    computed.draws,
    computed.losses,
    computed.goals_for,
    computed.goals_against,
    computed.goal_difference,
    computed.points,
    computed.form,
    computed.position
FROM (
    WITH scraped_league_ids AS (
        SELECT DISTINCT ls2.league_id
        FROM league_standings ls2
        JOIN seasons s2 ON s2.id = ls2.season_id AND s2.is_current = true
    ),
    team_league_stats AS (
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
        WHERE l.id NOT IN (SELECT league_id FROM scraped_league_ids)
        GROUP BY l.id, l.name, t.id, t.canonical_name, t.display_name,
                 t.elo_rating, t.national_rank, t.gender, t.birth_year, m.division
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
    FROM team_league_stats tls
) computed;

-- Indexes for app_league_standings (same as 093)
CREATE INDEX IF NOT EXISTS idx_app_league_standings_league ON app_league_standings (league_id, position);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_team ON app_league_standings (team_id);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_filter ON app_league_standings (league_id, gender, birth_year, division);
CREATE INDEX IF NOT EXISTS idx_app_league_standings_division ON app_league_standings (league_id, division);

RAISE NOTICE 'Migration 094 complete: Hybrid passthrough league standings';
RAISE NOTICE '  - staging_standings table created';
RAISE NOTICE '  - league_standings table created';
RAISE NOTICE '  - app_league_standings view = scraped UNION ALL computed fallback';

END $$;
