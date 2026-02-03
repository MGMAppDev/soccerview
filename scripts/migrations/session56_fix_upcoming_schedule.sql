-- Session 56: Fix app_upcoming_schedule to include matches_v2 future matches
--
-- PROBLEM:
-- - app_upcoming_schedule only reads from `schedules` table (906 rows)
-- - But scrapers put scheduled games into `matches_v2` with 0-0 scores
-- - Result: 4,428 scheduled matches invisible in Upcoming section
--
-- SOLUTION:
-- Create a UNION view that includes:
-- 1. Original schedules table data
-- 2. Future matches from matches_v2 (where home_score=0 AND away_score=0)

-- Drop and recreate the view
DROP MATERIALIZED VIEW IF EXISTS app_upcoming_schedule;

CREATE MATERIALIZED VIEW app_upcoming_schedule AS
-- Part 1: From schedules table (original behavior)
SELECT
    s.id,
    s.match_date,
    s.match_time,
    jsonb_build_object(
        'id', ht.id,
        'name', COALESCE(ht.display_name, ht.name),
        'display_name', ht.display_name,
        'elo_rating', ht.elo_rating,
        'national_rank', ht.national_rank,
        'state', ht.state
    ) as home_team,
    jsonb_build_object(
        'id', at.id,
        'name', COALESCE(at.display_name, at.name),
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

-- Part 2: From matches_v2 (scheduled future matches with 0-0 scores)
SELECT
    m.id,
    m.match_date,
    m.match_time,
    jsonb_build_object(
        'id', ht.id,
        'name', COALESCE(ht.display_name, ht.name),
        'display_name', ht.display_name,
        'elo_rating', ht.elo_rating,
        'national_rank', ht.national_rank,
        'state', ht.state
    ) as home_team,
    jsonb_build_object(
        'id', at.id,
        'name', COALESCE(at.display_name, at.name),
        'display_name', at.display_name,
        'elo_rating', at.elo_rating,
        'national_rank', at.national_rank,
        'state', at.state
    ) as away_team,
    CASE
        WHEN m.league_id IS NOT NULL THEN jsonb_build_object('id', l.id, 'name', l.name, 'type', 'league')
        WHEN m.tournament_id IS NOT NULL THEN jsonb_build_object('id', tr.id, 'name', tr.name, 'type', 'tournament')
        ELSE jsonb_build_object('id', NULL, 'name', 'Scheduled Match', 'type', 'other')
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
  -- Exclude matches that might already be in schedules table to avoid duplicates
  AND NOT EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = m.id
  )

ORDER BY match_date ASC;

-- Recreate indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_upcoming_schedule_id ON app_upcoming_schedule (id);
CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_date ON app_upcoming_schedule (match_date ASC);
CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_filter ON app_upcoming_schedule (state, gender, birth_year);

-- Verify the fix
SELECT
    'Total upcoming matches' as metric,
    COUNT(*) as count
FROM app_upcoming_schedule
UNION ALL
SELECT
    'From matches_v2 (0-0 future)',
    COUNT(*)
FROM matches_v2
WHERE match_date >= CURRENT_DATE
  AND home_score = 0
  AND away_score = 0;
