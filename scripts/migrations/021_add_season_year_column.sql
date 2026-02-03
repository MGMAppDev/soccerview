-- ============================================================
-- SOCCERVIEW DATABASE - Migration 021
-- Add year column to seasons table for foolproof age_group calculation
--
-- Purpose: Single source of truth for season year
-- This enables dynamic age_group calculation without hardcoded years
--
-- Created: January 28, 2026 (Session 53)
-- ============================================================

-- ============================================================
-- STEP 1: Add year column to seasons table
-- ============================================================

ALTER TABLE seasons ADD COLUMN IF NOT EXISTS year INTEGER;

COMMENT ON COLUMN seasons.year IS 'The ending calendar year of the season (e.g., 2025-26 season = 2026). Used for age_group calculation.';

-- ============================================================
-- STEP 2: Backfill year from start_date for existing rows
-- Season year = start year + 1 (e.g., start 2025-08-01 = season 2026)
-- ============================================================

UPDATE seasons
SET year = EXTRACT(YEAR FROM start_date)::INTEGER + 1
WHERE year IS NULL;

-- ============================================================
-- STEP 3: Add constraint to ensure year is consistent with dates
-- ============================================================

ALTER TABLE seasons DROP CONSTRAINT IF EXISTS valid_season_year;
ALTER TABLE seasons ADD CONSTRAINT valid_season_year
  CHECK (year = EXTRACT(YEAR FROM start_date)::INTEGER + 1);

-- ============================================================
-- STEP 4: Ensure index exists for fast current season lookup
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_seasons_current
ON seasons(is_current) WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_seasons_year
ON seasons(year);

-- ============================================================
-- STEP 5: Create helper function to get current season year
-- This is the SINGLE SOURCE OF TRUTH for age_group calculations
-- ============================================================

CREATE OR REPLACE FUNCTION get_current_season_year()
RETURNS INTEGER AS $$
DECLARE
  season_year INTEGER;
BEGIN
  -- Try to get from seasons table
  SELECT year INTO season_year
  FROM seasons
  WHERE is_current = true
  LIMIT 1;

  -- Fallback calculation if no current season set
  IF season_year IS NULL THEN
    -- If after August 1, use next year; otherwise use current year
    IF EXTRACT(MONTH FROM CURRENT_DATE) >= 8 THEN
      season_year := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER + 1;
    ELSE
      season_year := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
    END IF;
  END IF;

  RETURN season_year;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_current_season_year IS
  'Returns the current season year (e.g., 2026 for 2025-26 season). ' ||
  'Used by materialized views for dynamic age_group calculation. ' ||
  'Reads from seasons table with fallback to date-based calculation.';

-- ============================================================
-- STEP 6: Create helper function for age_group calculation
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_age_group(p_birth_year INTEGER)
RETURNS TEXT AS $$
BEGIN
  IF p_birth_year IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN 'U' || (get_current_season_year() - p_birth_year)::TEXT;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_age_group IS
  'Calculates age group from birth year using current season year. ' ||
  'Formula: U + (season_year - birth_year). Example: 2013 in 2026 = U13.';

-- ============================================================
-- STEP 7: Ensure current season is set correctly
-- 2025-26 season: Aug 1, 2025 to Jul 31, 2026, year = 2026
-- ============================================================

-- First ensure at least one season exists
INSERT INTO seasons (name, start_date, end_date, year, is_current)
VALUES ('2025-26 Season', '2025-08-01', '2026-07-31', 2026, true)
ON CONFLICT (start_date, end_date) DO UPDATE
SET year = 2026, is_current = true;

-- Mark all other seasons as not current
UPDATE seasons
SET is_current = false
WHERE start_date != '2025-08-01' OR end_date != '2026-07-31';

-- ============================================================
-- STEP 8: Verify setup
-- ============================================================

DO $$
DECLARE
  v_year INTEGER;
  v_count INTEGER;
BEGIN
  -- Check function works
  v_year := get_current_season_year();
  IF v_year IS NULL OR v_year < 2020 OR v_year > 2050 THEN
    RAISE EXCEPTION 'get_current_season_year() returned invalid value: %', v_year;
  END IF;

  -- Check exactly one current season
  SELECT COUNT(*) INTO v_count FROM seasons WHERE is_current = true;
  IF v_count != 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 current season, found %', v_count;
  END IF;

  RAISE NOTICE 'Migration 021 complete. Current season year: %', v_year;
END $$;

-- ============================================================
-- ROLLBACK (if needed):
-- ALTER TABLE seasons DROP COLUMN year;
-- DROP FUNCTION IF EXISTS get_current_season_year();
-- DROP FUNCTION IF EXISTS calculate_age_group(INTEGER);
-- ============================================================
