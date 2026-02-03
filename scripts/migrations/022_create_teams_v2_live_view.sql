-- ============================================================
-- SOCCERVIEW DATABASE - Migration 022
-- Create teams_v2_live view with dynamic age_group computation
--
-- Purpose: Provides a view that always computes age_group from
-- birth_year + current season year, rather than reading stored value
--
-- Created: January 28, 2026 (Session 53)
-- ============================================================

-- ============================================================
-- DROP existing view if it exists
-- ============================================================

DROP VIEW IF EXISTS teams_v2_live CASCADE;

-- ============================================================
-- CREATE teams_v2_live VIEW
--
-- This view includes all columns from teams_v2 plus:
-- - age_group_computed: dynamically calculated from birth_year + season
--
-- Use this view when you need guaranteed accurate age_group values
-- that automatically update when the season changes.
-- ============================================================

CREATE OR REPLACE VIEW teams_v2_live AS
SELECT
  t.id,
  t.club_id,
  t.canonical_name,
  t.display_name,
  t.birth_year,
  t.gender,
  -- Dynamic age_group calculation (replaces stored value)
  CASE
    WHEN t.birth_year IS NOT NULL
    THEN 'U' || (get_current_season_year() - t.birth_year)::TEXT
    ELSE NULL
  END AS age_group,
  -- Also expose as age_group_computed for clarity
  CASE
    WHEN t.birth_year IS NOT NULL
    THEN 'U' || (get_current_season_year() - t.birth_year)::TEXT
    ELSE NULL
  END AS age_group_computed,
  t.state,
  t.known_aliases,
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
  t.source_platform,
  t.source_team_id,
  t.data_quality_score,
  t.birth_year_source,
  t.gender_source,
  t.data_flags,
  t.created_at,
  t.updated_at,
  -- Include the season year for reference
  get_current_season_year() AS season_year
FROM teams_v2 t;

COMMENT ON VIEW teams_v2_live IS
  'Live view of teams_v2 with dynamically computed age_group. ' ||
  'Use this view instead of teams_v2 when accurate age_group is critical. ' ||
  'age_group is calculated as: U + (current_season_year - birth_year).';

-- ============================================================
-- GRANT appropriate permissions
-- ============================================================

-- Grant SELECT to anon and authenticated roles (standard Supabase)
GRANT SELECT ON teams_v2_live TO anon;
GRANT SELECT ON teams_v2_live TO authenticated;

-- ============================================================
-- TEST the view
-- ============================================================

DO $$
DECLARE
  v_count INTEGER;
  v_sample RECORD;
BEGIN
  -- Check view has data
  SELECT COUNT(*) INTO v_count FROM teams_v2_live;

  IF v_count = 0 THEN
    RAISE WARNING 'teams_v2_live view is empty (no teams in teams_v2)';
  ELSE
    RAISE NOTICE 'teams_v2_live view created with % rows', v_count;

    -- Sample row to verify age_group calculation
    SELECT id, display_name, birth_year, age_group, season_year
    INTO v_sample
    FROM teams_v2_live
    WHERE birth_year IS NOT NULL
    LIMIT 1;

    IF v_sample IS NOT NULL THEN
      RAISE NOTICE 'Sample: birth_year=% -> age_group=% (season %)',
        v_sample.birth_year, v_sample.age_group, v_sample.season_year;
    END IF;
  END IF;
END $$;

-- ============================================================
-- ROLLBACK (if needed):
-- DROP VIEW IF EXISTS teams_v2_live CASCADE;
-- ============================================================
