-- =============================================================================
-- Migration 020: Archive V1 Tables to *_deprecated
-- =============================================================================
-- Purpose: Rename old V1 tables to *_deprecated for historical reference
-- These tables are NOT deleted, just renamed so they're preserved but dormant.
--
-- After this migration:
--   - V2 tables (teams_v2, matches_v2, etc.) are the ONLY active tables
--   - V1 tables remain accessible with _deprecated suffix for historical queries
--   - App must use V2 tables exclusively
--
-- Run with: psql $DATABASE_URL -f scripts/migrations/020_archive_v1_tables.sql
-- Or via: node scripts/migrations/run_migration_020.js
-- =============================================================================

BEGIN;

-- =============================================================================
-- STEP 1: Archive Core V1 Tables
-- =============================================================================

-- Archive teams table (V1)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teams' AND table_schema = 'public') THEN
        -- First drop any views that depend on teams
        DROP VIEW IF EXISTS team_elo CASCADE;

        -- Rename the table
        ALTER TABLE teams RENAME TO teams_deprecated;
        RAISE NOTICE 'Archived: teams -> teams_deprecated';
    ELSE
        RAISE NOTICE 'Skipped: teams table does not exist';
    END IF;
END $$;

-- Archive match_results table (V1)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'match_results' AND table_schema = 'public') THEN
        ALTER TABLE match_results RENAME TO match_results_deprecated;
        RAISE NOTICE 'Archived: match_results -> match_results_deprecated';
    ELSE
        RAISE NOTICE 'Skipped: match_results table does not exist';
    END IF;
END $$;

-- Archive event_registry table (V1)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_registry' AND table_schema = 'public') THEN
        ALTER TABLE event_registry RENAME TO event_registry_deprecated;
        RAISE NOTICE 'Archived: event_registry -> event_registry_deprecated';
    ELSE
        RAISE NOTICE 'Skipped: event_registry table does not exist';
    END IF;
END $$;

-- Archive team_name_aliases table (V1)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_name_aliases' AND table_schema = 'public') THEN
        ALTER TABLE team_name_aliases RENAME TO team_name_aliases_deprecated;
        RAISE NOTICE 'Archived: team_name_aliases -> team_name_aliases_deprecated';
    ELSE
        RAISE NOTICE 'Skipped: team_name_aliases table does not exist';
    END IF;
END $$;

-- Archive rank_history table (V1)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rank_history' AND table_schema = 'public') THEN
        ALTER TABLE rank_history RENAME TO rank_history_deprecated;
        RAISE NOTICE 'Archived: rank_history -> rank_history_deprecated';
    ELSE
        RAISE NOTICE 'Skipped: rank_history table does not exist';
    END IF;
END $$;

-- Archive predictions table (V1) if exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'predictions' AND table_schema = 'public') THEN
        ALTER TABLE predictions RENAME TO predictions_deprecated;
        RAISE NOTICE 'Archived: predictions -> predictions_deprecated';
    ELSE
        RAISE NOTICE 'Skipped: predictions table does not exist';
    END IF;
END $$;

-- Archive favorites table (V1) if exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'favorites' AND table_schema = 'public')
    AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'favorites_v2' AND table_schema = 'public') THEN
        -- Only archive if v2 exists (otherwise keep old favorites)
        ALTER TABLE favorites RENAME TO favorites_v1_deprecated;
        ALTER TABLE favorites_v2 RENAME TO favorites;
        RAISE NOTICE 'Archived: favorites -> favorites_v1_deprecated, favorites_v2 -> favorites';
    ELSE
        RAISE NOTICE 'Skipped: favorites archival (no v2 table exists)';
    END IF;
END $$;

-- =============================================================================
-- STEP 2: Rename V2 Tables to Production Names (Remove _v2 suffix)
-- =============================================================================
-- Note: Only do this if you want cleaner production table names
-- Uncomment the section below if desired

/*
-- Rename teams_v2 to teams (requires teams to be archived first)
ALTER TABLE teams_v2 RENAME TO teams;
RAISE NOTICE 'Renamed: teams_v2 -> teams';

-- Rename matches_v2 to matches
ALTER TABLE matches_v2 RENAME TO matches;
RAISE NOTICE 'Renamed: matches_v2 -> matches';

-- Update foreign keys if renamed
-- (Would need additional ALTER statements)
*/

-- =============================================================================
-- STEP 3: Add Archival Comments
-- =============================================================================

COMMENT ON TABLE teams_deprecated IS 'ARCHIVED V1 Table (Session 50). Use teams_v2 instead. Kept for historical reference only.';
COMMENT ON TABLE match_results_deprecated IS 'ARCHIVED V1 Table (Session 50). Use matches_v2 instead. Kept for historical reference only.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_registry_deprecated') THEN
        COMMENT ON TABLE event_registry_deprecated IS 'ARCHIVED V1 Table (Session 50). Use leagues/tournaments instead. Kept for historical reference only.';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_name_aliases_deprecated') THEN
        COMMENT ON TABLE team_name_aliases_deprecated IS 'ARCHIVED V1 Table (Session 50). Team linking now in validation pipeline. Kept for historical reference only.';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rank_history_deprecated') THEN
        COMMENT ON TABLE rank_history_deprecated IS 'ARCHIVED V1 Table (Session 50). Use rank_history_v2 instead. Kept for historical reference only.';
    END IF;
END $$;

-- =============================================================================
-- STEP 4: Create Archival Summary View
-- =============================================================================

CREATE OR REPLACE VIEW v1_archive_summary AS
SELECT
    'teams_deprecated' as table_name,
    (SELECT COUNT(*) FROM teams_deprecated) as row_count,
    'Historical team data (V1)' as description
UNION ALL
SELECT
    'match_results_deprecated',
    (SELECT COUNT(*) FROM match_results_deprecated),
    'Historical match data (V1)'
UNION ALL
SELECT
    'event_registry_deprecated',
    (SELECT COUNT(*) FROM event_registry_deprecated WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_registry_deprecated')),
    'Historical event registry (V1)'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_registry_deprecated' AND table_schema = 'public');

COMMENT ON VIEW v1_archive_summary IS 'Summary of archived V1 tables - for reference only';

-- =============================================================================
-- STEP 5: Verification Queries
-- =============================================================================

-- List all archived tables
DO $$
DECLARE
    archived_tables TEXT;
BEGIN
    SELECT string_agg(table_name, ', ')
    INTO archived_tables
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name LIKE '%_deprecated';

    RAISE NOTICE 'Archived tables: %', archived_tables;
END $$;

-- List all V2 production tables
DO $$
DECLARE
    v2_tables TEXT;
BEGIN
    SELECT string_agg(table_name, ', ')
    INTO v2_tables
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('teams_v2', 'matches_v2', 'clubs', 'leagues', 'tournaments', 'venues', 'schedules', 'seasons', 'rank_history_v2', 'predictions_v2', 'favorites_v2', 'staging_games', 'staging_events', 'staging_teams', 'audit_log');

    RAISE NOTICE 'V2 production tables: %', v2_tables;
END $$;

-- List all app views
DO $$
DECLARE
    app_views TEXT;
BEGIN
    SELECT string_agg(matviewname, ', ')
    INTO app_views
    FROM pg_matviews
    WHERE schemaname = 'public'
    AND matviewname LIKE 'app_%';

    RAISE NOTICE 'App materialized views: %', app_views;
END $$;

COMMIT;

-- =============================================================================
-- POST-MIGRATION NOTES
-- =============================================================================
--
-- To query archived data (read-only historical reference):
--   SELECT * FROM teams_deprecated WHERE ...
--   SELECT * FROM match_results_deprecated WHERE ...
--
-- To see archive summary:
--   SELECT * FROM v1_archive_summary;
--
-- Current active tables (V2 Architecture):
--   - teams_v2: 137,582 teams (production)
--   - matches_v2: 292,802 matches (production)
--   - clubs: 32,334 clubs
--   - leagues: 273 leagues
--   - tournaments: 1,492 tournaments
--   - staging_*: Incoming data buffer
--   - app_*: Pre-computed materialized views
--
-- =============================================================================
