-- Migration 060: Create staging_rejected table
-- Session 79 - V2 Architecture Enforcement
-- Purpose: Store rejected data that fails intake validation
--
-- This table mirrors staging_games structure but adds rejection metadata.
-- Invalid data is moved here instead of entering the pipeline.

-- Create staging_rejected table
CREATE TABLE IF NOT EXISTS staging_rejected (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Original staging_games columns
    match_date DATE,
    match_time TIME,
    home_team_name TEXT,
    away_team_name TEXT,
    home_score INTEGER,
    away_score INTEGER,
    event_name TEXT,
    event_id TEXT,
    venue_name TEXT,
    field_name TEXT,
    division TEXT,
    source_platform TEXT,
    source_match_key TEXT,
    raw_data JSONB,
    scraped_at TIMESTAMPTZ,

    -- Rejection metadata
    rejection_reason TEXT NOT NULL,           -- Human-readable reason
    rejection_code TEXT NOT NULL,             -- Machine-readable code (e.g., 'EMPTY_TEAM_NAME', 'INVALID_DATE')
    rejected_at TIMESTAMPTZ DEFAULT NOW(),
    original_staging_id UUID,                 -- FK to original staging_games record (if applicable)

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying rejections by reason/code
CREATE INDEX IF NOT EXISTS idx_staging_rejected_code ON staging_rejected(rejection_code);
CREATE INDEX IF NOT EXISTS idx_staging_rejected_date ON staging_rejected(rejected_at DESC);
CREATE INDEX IF NOT EXISTS idx_staging_rejected_platform ON staging_rejected(source_platform);

-- Comment for documentation
COMMENT ON TABLE staging_rejected IS 'Holds data that failed intake validation. Used by intakeValidator.js to audit and track rejected records.';

COMMENT ON COLUMN staging_rejected.rejection_code IS 'Machine-readable codes: EMPTY_HOME_TEAM, EMPTY_AWAY_TEAM, INVALID_DATE, FUTURE_DATE_2027, INVALID_BIRTH_YEAR, UNKNOWN_PLATFORM, SAME_TEAM';
