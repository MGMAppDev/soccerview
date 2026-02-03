-- ============================================================
-- SESSION 53: Foolproof Age Group Architecture
-- All migrations + data cleanup in one file
--
-- Run in: Supabase SQL Editor or psql
-- ============================================================

-- ============================================================
-- PART 1: Add year column to seasons table
-- ============================================================

ALTER TABLE seasons ADD COLUMN IF NOT EXISTS year INTEGER;

UPDATE seasons SET year = EXTRACT(YEAR FROM start_date)::INTEGER + 1 WHERE year IS NULL;

CREATE INDEX IF NOT EXISTS idx_seasons_current ON seasons(is_current) WHERE is_current = true;

-- Ensure 2025-26 season exists and is current
INSERT INTO seasons (name, start_date, end_date, year, is_current)
VALUES ('2025-26 Season', '2025-08-01', '2026-07-31', 2026, true)
ON CONFLICT (start_date, end_date) DO UPDATE SET year = 2026, is_current = true;

UPDATE seasons SET is_current = false
WHERE (start_date != '2025-08-01' OR end_date != '2026-07-31') AND is_current = true;

-- ============================================================
-- PART 2: Create helper function
-- ============================================================

CREATE OR REPLACE FUNCTION get_current_season_year()
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
$$ LANGUAGE plpgsql STABLE;

-- Test it
SELECT get_current_season_year() as season_year;

-- ============================================================
-- PART 3: Create teams_v2_live view
-- ============================================================

DROP VIEW IF EXISTS teams_v2_live CASCADE;

CREATE VIEW teams_v2_live AS
SELECT
  t.*,
  CASE WHEN t.birth_year IS NOT NULL
    THEN 'U' || (get_current_season_year() - t.birth_year)::TEXT
    ELSE NULL
  END AS age_group_computed,
  get_current_season_year() AS season_year
FROM teams_v2 t;

GRANT SELECT ON teams_v2_live TO anon, authenticated;

-- ============================================================
-- PART 4: Update materialized views (will take 1-2 minutes)
-- ============================================================

-- app_rankings
DROP MATERIALIZED VIEW IF EXISTS app_rankings CASCADE;

CREATE MATERIALIZED VIEW app_rankings AS
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
ORDER BY t.national_rank ASC NULLS LAST, t.elo_rating DESC;

CREATE UNIQUE INDEX idx_app_rankings_id ON app_rankings (id);
CREATE INDEX idx_app_rankings_filter ON app_rankings (state, gender, birth_year);
CREATE INDEX idx_app_rankings_featured ON app_rankings (elo_rating DESC) WHERE has_matches = TRUE;

-- app_matches_feed
DROP MATERIALIZED VIEW IF EXISTS app_matches_feed CASCADE;

CREATE MATERIALIZED VIEW app_matches_feed AS
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
ORDER BY m.match_date DESC;

CREATE UNIQUE INDEX idx_app_matches_feed_id ON app_matches_feed (id);
CREATE INDEX idx_app_matches_feed_date ON app_matches_feed (match_date DESC);
CREATE INDEX idx_app_matches_feed_filter ON app_matches_feed (state, gender, birth_year);

-- app_upcoming_schedule
DROP MATERIALIZED VIEW IF EXISTS app_upcoming_schedule CASCADE;

CREATE MATERIALIZED VIEW app_upcoming_schedule AS
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
ORDER BY s.match_date ASC;

CREATE UNIQUE INDEX idx_app_upcoming_schedule_id ON app_upcoming_schedule (id);
CREATE INDEX idx_app_upcoming_schedule_date ON app_upcoming_schedule (match_date ASC);
CREATE INDEX idx_app_upcoming_schedule_filter ON app_upcoming_schedule (state, gender, birth_year);

-- ============================================================
-- PART 5: Data cleanup - Fix NULL birth_years
-- ============================================================

-- Step 2: Fix NULL birth_years from 4-digit year in name
UPDATE teams_v2
SET birth_year = (regexp_match(display_name, '(20[01][0-9])'))[1]::int,
    birth_year_source = 'extracted_from_name',
    updated_at = NOW()
WHERE birth_year IS NULL
  AND display_name ~ '20[01][0-9]';

-- Step 3a: Fix NULL birth_years from 2-digit codes (14B, 15G)
UPDATE teams_v2
SET birth_year = 2000 + (regexp_match(display_name, '([01][0-9])[BG]'))[1]::int,
    birth_year_source = 'extracted_from_name',
    updated_at = NOW()
WHERE birth_year IS NULL
  AND display_name ~ '[01][0-9][BG]';

-- Step 3b: Fix NULL birth_years from 2-digit codes (B14, G15)
UPDATE teams_v2
SET birth_year = 2000 + (regexp_match(display_name, '[BG]([01][0-9])'))[1]::int,
    birth_year_source = 'extracted_from_name',
    updated_at = NOW()
WHERE birth_year IS NULL
  AND display_name ~ '[BG][01][0-9]';

-- Step 4: Back-calculate NULL birth_years from age group (U##)
UPDATE teams_v2
SET birth_year = get_current_season_year() - (regexp_match(display_name, 'U(\d+)'))[1]::int,
    birth_year_source = 'inferred_from_age_group',
    updated_at = NOW()
WHERE birth_year IS NULL
  AND display_name ~ 'U\d+';

-- Step 5: Fix non-conflicting mismatches
UPDATE teams_v2 t1
SET birth_year = (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int,
    birth_year_source = 'extracted_from_name',
    updated_at = NOW()
WHERE t1.display_name ~ '20[01][0-9]'
  AND t1.birth_year != (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int
  AND NOT EXISTS (
    SELECT 1 FROM teams_v2 t2
    WHERE t2.canonical_name = t1.canonical_name
      AND t2.birth_year = (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int
      AND t2.gender = t1.gender
      AND t2.state = t1.state
      AND t2.id != t1.id
  );

-- Step 6: Flag remaining conflicts
UPDATE teams_v2
SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"birth_year_conflict": true}'::jsonb,
    updated_at = NOW()
WHERE display_name ~ '20[01][0-9]'
  AND birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int
  AND (data_flags IS NULL OR NOT (data_flags ? 'birth_year_conflict'));

-- Step 7: Flag invalid birth_year range
UPDATE teams_v2
SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"invalid_birth_year": true}'::jsonb,
    updated_at = NOW()
WHERE birth_year IS NOT NULL
  AND (birth_year < get_current_season_year() - 19
       OR birth_year > get_current_season_year() - 7)
  AND (data_flags IS NULL OR NOT (data_flags ? 'invalid_birth_year'));

-- ============================================================
-- PART 6: Refresh views and audit
-- ============================================================

REFRESH MATERIALIZED VIEW app_rankings;
REFRESH MATERIALIZED VIEW app_matches_feed;
REFRESH MATERIALIZED VIEW app_upcoming_schedule;

-- Final audit
SELECT
  COUNT(*) FILTER (WHERE birth_year IS NULL) AS null_birth_year,
  COUNT(*) FILTER (WHERE data_flags->>'birth_year_conflict' = 'true') AS flagged_conflicts,
  COUNT(*) FILTER (WHERE data_flags->>'invalid_birth_year' = 'true') AS invalid_range,
  COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (data_flags IS NULL OR data_flags = '{}'::jsonb)) AS clean_teams,
  COUNT(*) AS total
FROM teams_v2;
