-- ============================================================
-- SOCCERVIEW DATABASE RESTRUCTURE - PHASE 2
-- Bulk Matches Migration (Fast SQL approach)
--
-- This uses direct SQL INSERT ... SELECT for maximum speed
-- Run in Supabase SQL Editor or via psql
-- ============================================================

-- Step 1: Migrate past matches with scores
-- Only migrate matches where BOTH teams exist in teams_v2
INSERT INTO matches_v2 (
    id,
    match_date,
    match_time,
    home_team_id,
    away_team_id,
    home_score,
    away_score,
    league_id,
    tournament_id,
    source_platform,
    source_match_key
)
SELECT
    m.id,
    m.match_date,
    m.match_time,
    m.home_team_id,
    m.away_team_id,
    m.home_score,
    m.away_score,
    l.id as league_id,
    t.id as tournament_id,
    m.source_platform,
    m.source_match_key
FROM match_results m
-- Only linked matches
JOIN teams_v2 ht ON m.home_team_id = ht.id
JOIN teams_v2 at ON m.away_team_id = at.id
-- Optional league lookup
LEFT JOIN leagues l ON l.source_event_id = m.event_id
-- Optional tournament lookup
LEFT JOIN tournaments t ON t.source_event_id = m.event_id AND l.id IS NULL
WHERE m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL
  AND m.match_date IS NOT NULL
  AND m.match_date < CURRENT_DATE
  AND m.home_team_id != m.away_team_id  -- Filter out invalid matches
  AND NOT EXISTS (SELECT 1 FROM matches_v2 mv WHERE mv.id = m.id)
ON CONFLICT DO NOTHING;

-- Step 2: Migrate future games to schedules
INSERT INTO schedules (
    match_date,
    match_time,
    home_team_id,
    away_team_id,
    league_id,
    tournament_id,
    source_platform,
    source_match_key
)
SELECT
    m.match_date,
    m.match_time,
    m.home_team_id,
    m.away_team_id,
    l.id as league_id,
    t.id as tournament_id,
    m.source_platform,
    m.source_match_key
FROM match_results m
-- Only linked matches
JOIN teams_v2 ht ON m.home_team_id = ht.id
JOIN teams_v2 at ON m.away_team_id = at.id
-- Optional league lookup
LEFT JOIN leagues l ON l.source_event_id = m.event_id
-- Optional tournament lookup
LEFT JOIN tournaments t ON t.source_event_id = m.event_id AND l.id IS NULL
WHERE m.match_date IS NOT NULL
  AND m.match_date >= CURRENT_DATE
  AND m.home_team_id != m.away_team_id  -- Filter out invalid matches
ON CONFLICT DO NOTHING;

-- Step 3: Verify results
SELECT 'matches_v2' as table_name, COUNT(*) as count FROM matches_v2
UNION ALL
SELECT 'schedules' as table_name, COUNT(*) as count FROM schedules;
