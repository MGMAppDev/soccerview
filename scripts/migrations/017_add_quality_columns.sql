-- ============================================================
-- SOCCERVIEW DATABASE RESTRUCTURE - INCLUSIVE MIGRATION
-- Migration 017: Add data quality metadata columns
--
-- Purpose: Enable inclusive data migration where NO data is excluded
-- Instead of excluding teams without birth_year/gender, we:
--   1. Include ALL teams
--   2. Add quality flags for incomplete data
--   3. Filter at query time, not at ingest
--
-- Created: January 28, 2026 (Session 49 - Data Strategy Redesign)
-- ============================================================

-- ============================================================
-- STEP 1: Add quality metadata columns to teams_v2
-- ============================================================

-- Data quality score (0-100)
-- +30 points: birth_year known (any source)
-- +30 points: gender known (any source)
-- +20 points: national_rank exists (GotSport ranking)
-- +10 points: matches_played > 0
-- +10 points: elo_rating != 1500 (has been rated)
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS data_quality_score INTEGER DEFAULT 0;

-- Birth year source tracking
-- 'parsed'   - Extracted from team name (e.g., "2015" from "Club 2015 Elite")
-- 'inferred' - Inferred from age group (e.g., "U11" → 2015 in 2026)
-- 'official' - From GotSport/source official data
-- 'unknown'  - Could not determine
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS birth_year_source VARCHAR(20) DEFAULT 'unknown';

-- Gender source tracking
-- 'parsed'   - Extracted from team name (e.g., "Boys", "Girls", "(B)", "(G)")
-- 'inferred' - Inferred from context (e.g., all opponents are same gender)
-- 'official' - From GotSport/source official data
-- 'unknown'  - Could not determine
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS gender_source VARCHAR(20) DEFAULT 'unknown';

-- Flexible flags for data quality issues
-- {
--   "needs_review": boolean,        // Flagged for manual review
--   "auto_merged": boolean,         // Result of deduplication
--   "name_mismatch": boolean,       // Display name differs from parsed
--   "year_mismatch": boolean,       // Birth year doesn't match age group
--   "potential_duplicate": string,  // ID of suspected duplicate team
--   "source_conflicts": string[]    // List of conflicting source data
-- }
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS data_flags JSONB DEFAULT '{}';


-- ============================================================
-- STEP 2: Remove NOT NULL constraints on birth_year and gender
-- These fields should be nullable to allow inclusive migration
-- ============================================================

-- Check if constraints exist and drop them
DO $$
BEGIN
    -- Remove NOT NULL from birth_year if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'teams_v2'
        AND column_name = 'birth_year'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE teams_v2 ALTER COLUMN birth_year DROP NOT NULL;
        RAISE NOTICE 'Dropped NOT NULL constraint from birth_year';
    END IF;

    -- Remove NOT NULL from gender if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'teams_v2'
        AND column_name = 'gender'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE teams_v2 ALTER COLUMN gender DROP NOT NULL;
        RAISE NOTICE 'Dropped NOT NULL constraint from gender';
    END IF;
END $$;


-- ============================================================
-- STEP 3: Add link_status to matches_v2
-- Tracks whether both teams are linked
-- ============================================================

ALTER TABLE matches_v2 ADD COLUMN IF NOT EXISTS link_status VARCHAR(20) DEFAULT 'unknown';
-- Values: 'full' (both teams linked), 'partial' (one team), 'unlinked' (neither)


-- ============================================================
-- STEP 4: Create indexes for quality-based queries
-- ============================================================

-- Index for quality filtering (common query pattern)
CREATE INDEX IF NOT EXISTS idx_teams_v2_quality
ON teams_v2 (data_quality_score DESC, matches_played DESC);

-- Index for finding incomplete data
CREATE INDEX IF NOT EXISTS idx_teams_v2_incomplete
ON teams_v2 (data_quality_score ASC)
WHERE data_quality_score < 50;

-- Index for finding teams needing review
CREATE INDEX IF NOT EXISTS idx_teams_v2_needs_review
ON teams_v2 ((data_flags->>'needs_review'))
WHERE data_flags->>'needs_review' = 'true';


-- ============================================================
-- STEP 5: Create function to calculate quality score
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_data_quality_score(
    p_birth_year INTEGER,
    p_birth_year_source VARCHAR,
    p_gender gender_type,
    p_gender_source VARCHAR,
    p_national_rank INTEGER,
    p_matches_played INTEGER,
    p_elo_rating NUMERIC
) RETURNS INTEGER AS $$
DECLARE
    score INTEGER := 0;
BEGIN
    -- +30 points for known birth_year
    IF p_birth_year IS NOT NULL AND p_birth_year_source != 'unknown' THEN
        score := score + 30;
    END IF;

    -- +30 points for known gender
    IF p_gender IS NOT NULL AND p_gender_source != 'unknown' THEN
        score := score + 30;
    END IF;

    -- +20 points for GotSport ranking
    IF p_national_rank IS NOT NULL THEN
        score := score + 20;
    END IF;

    -- +10 points for match history
    IF p_matches_played > 0 THEN
        score := score + 10;
    END IF;

    -- +10 points for ELO rating (not default)
    IF p_elo_rating IS NOT NULL AND p_elo_rating != 1500 THEN
        score := score + 10;
    END IF;

    RETURN score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================
-- STEP 6: Create trigger to auto-calculate quality score
-- ============================================================

CREATE OR REPLACE FUNCTION update_team_quality_score()
RETURNS TRIGGER AS $$
BEGIN
    NEW.data_quality_score := calculate_data_quality_score(
        NEW.birth_year,
        NEW.birth_year_source,
        NEW.gender,
        NEW.gender_source,
        NEW.national_rank,
        NEW.matches_played,
        NEW.elo_rating
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_teams_v2_quality_score ON teams_v2;
CREATE TRIGGER trg_teams_v2_quality_score
    BEFORE INSERT OR UPDATE ON teams_v2
    FOR EACH ROW
    EXECUTE FUNCTION update_team_quality_score();


-- ============================================================
-- STEP 7: Update existing teams with quality scores
-- ============================================================

UPDATE teams_v2
SET data_quality_score = calculate_data_quality_score(
    birth_year,
    COALESCE(birth_year_source, 'parsed'),  -- Assume existing data was parsed
    gender,
    COALESCE(gender_source, 'parsed'),       -- Assume existing data was parsed
    national_rank,
    matches_played,
    elo_rating
),
birth_year_source = CASE
    WHEN birth_year IS NOT NULL THEN 'parsed'
    ELSE 'unknown'
END,
gender_source = CASE
    WHEN gender IS NOT NULL THEN 'parsed'
    ELSE 'unknown'
END
WHERE birth_year_source IS NULL OR birth_year_source = 'unknown';


-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON COLUMN teams_v2.data_quality_score IS 'Data completeness score 0-100. Higher = more complete metadata.';
COMMENT ON COLUMN teams_v2.birth_year_source IS 'How birth_year was determined: parsed, inferred, official, unknown';
COMMENT ON COLUMN teams_v2.gender_source IS 'How gender was determined: parsed, inferred, official, unknown';
COMMENT ON COLUMN teams_v2.data_flags IS 'JSONB flags for data quality issues and review status';
COMMENT ON COLUMN matches_v2.link_status IS 'Team linking status: full, partial, unlinked';
COMMENT ON FUNCTION calculate_data_quality_score IS 'Calculates team data quality score (0-100) based on metadata completeness';


-- ============================================================
-- VERIFICATION
-- ============================================================

-- Show quality score distribution
SELECT
    CASE
        WHEN data_quality_score >= 80 THEN 'A: Complete (80-100)'
        WHEN data_quality_score >= 60 THEN 'B: Good (60-79)'
        WHEN data_quality_score >= 40 THEN 'C: Partial (40-59)'
        WHEN data_quality_score >= 20 THEN 'D: Minimal (20-39)'
        ELSE 'F: Incomplete (0-19)'
    END as quality_grade,
    COUNT(*) as team_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percentage
FROM teams_v2
GROUP BY 1
ORDER BY 1;
