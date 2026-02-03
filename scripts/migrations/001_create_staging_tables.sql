-- ============================================================
-- SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1
-- Migration 001: Create Staging Tables (Layer 1)
--
-- Purpose: Raw data landing zone for scrapers
-- No constraints - accepts everything
-- ============================================================

-- Staging: Raw team data from scrapers
CREATE TABLE IF NOT EXISTS staging_teams (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    raw_name TEXT NOT NULL,
    source_platform TEXT NOT NULL,  -- 'gotsport', 'heartland', 'htgsports'
    source_team_id TEXT,            -- ID from source system
    raw_data JSONB,                 -- Full raw data from scraper
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error_message TEXT
);

-- Staging: Raw match/schedule data from scrapers
CREATE TABLE IF NOT EXISTS staging_games (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_date DATE,
    match_time TIME,
    home_team_name TEXT,
    away_team_name TEXT,
    home_score INTEGER,             -- NULL for schedules (future games)
    away_score INTEGER,             -- NULL for schedules (future games)
    event_name TEXT,
    event_id TEXT,
    venue_name TEXT,
    field_name TEXT,
    division TEXT,                  -- Age group / division info
    source_platform TEXT NOT NULL,
    source_match_key TEXT,          -- Unique key from source for deduplication
    raw_data JSONB,
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error_message TEXT
);

-- Staging: Raw event data (leagues/tournaments)
CREATE TABLE IF NOT EXISTS staging_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_name TEXT NOT NULL,
    event_type TEXT,                -- 'league' or 'tournament'
    source_platform TEXT NOT NULL,
    source_event_id TEXT,
    start_date DATE,
    end_date DATE,
    state TEXT,
    region TEXT,
    raw_data JSONB,
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error_message TEXT
);

-- ============================================================
-- INDEXES FOR PROCESSING EFFICIENCY
-- These help the validation pipeline find unprocessed records
-- ============================================================

-- Index for finding unprocessed teams (partial index for efficiency)
CREATE INDEX IF NOT EXISTS idx_staging_teams_unprocessed
ON staging_teams (processed, scraped_at)
WHERE NOT processed;

-- Index for finding unprocessed games
CREATE INDEX IF NOT EXISTS idx_staging_games_unprocessed
ON staging_games (processed, scraped_at)
WHERE NOT processed;

-- Index for finding unprocessed events
CREATE INDEX IF NOT EXISTS idx_staging_events_unprocessed
ON staging_events (processed, scraped_at)
WHERE NOT processed;

-- Index for deduplication on source_match_key
CREATE INDEX IF NOT EXISTS idx_staging_games_source_key
ON staging_games (source_platform, source_match_key);

-- Index for deduplication on source_team_id
CREATE INDEX IF NOT EXISTS idx_staging_teams_source_id
ON staging_teams (source_platform, source_team_id);

-- Index for deduplication on source_event_id
CREATE INDEX IF NOT EXISTS idx_staging_events_source_id
ON staging_events (source_platform, source_event_id);

-- ============================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================

COMMENT ON TABLE staging_teams IS 'Layer 1: Raw team data from scrapers. No validation - accepts everything.';
COMMENT ON TABLE staging_games IS 'Layer 1: Raw match/schedule data from scrapers. No validation - accepts everything.';
COMMENT ON TABLE staging_events IS 'Layer 1: Raw event data from scrapers. No validation - accepts everything.';

COMMENT ON COLUMN staging_games.home_score IS 'NULL for scheduled games (future), populated for completed matches';
COMMENT ON COLUMN staging_games.away_score IS 'NULL for scheduled games (future), populated for completed matches';
COMMENT ON COLUMN staging_games.source_match_key IS 'Unique identifier from source system for deduplication';
