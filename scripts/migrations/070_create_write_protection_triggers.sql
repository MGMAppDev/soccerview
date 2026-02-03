-- ============================================================
-- SOCCERVIEW V2 ARCHITECTURE ENFORCEMENT - SESSION 79
-- Migration 070: Write Protection Triggers
--
-- Purpose: Block direct writes to production tables (teams_v2, matches_v2)
-- that bypass the official data pipeline (dataQualityEngine.js)
--
-- Mechanism: Checks for session variable 'app.pipeline_authorized'
-- Authorized scripts must call: SELECT authorize_pipeline_write();
-- After operations, call: SELECT revoke_pipeline_write();
--
-- Emergency Override: SELECT disable_write_protection();
-- Re-enable: SELECT enable_write_protection();
-- ============================================================

-- ============================================================
-- CONFIGURATION TABLE
-- ============================================================

-- Table to store write protection status (enables emergency disable)
CREATE TABLE IF NOT EXISTS pipeline_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default config (write protection enabled)
INSERT INTO pipeline_config (key, value)
VALUES ('write_protection_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- AUTHORIZATION FUNCTIONS
-- ============================================================

-- Function: Authorize current session for pipeline writes
-- Call this BEFORE any write operations in authorized scripts
CREATE OR REPLACE FUNCTION authorize_pipeline_write()
RETURNS VOID AS $$
BEGIN
    -- Set session variable to authorize writes (session-wide, not transaction-local)
    -- Using false for is_local so it persists across multiple statements
    PERFORM set_config('app.pipeline_authorized', 'true', false);
    RAISE NOTICE 'Pipeline write authorization granted for this session';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION authorize_pipeline_write() IS
'Grants write permission to production tables for the current transaction.
Call this at the start of authorized pipeline operations.';

-- Function: Revoke pipeline authorization (optional cleanup)
CREATE OR REPLACE FUNCTION revoke_pipeline_write()
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.pipeline_authorized', 'false', true);
    RAISE NOTICE 'Pipeline write authorization revoked';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION revoke_pipeline_write() IS
'Revokes write permission. Called automatically at transaction end, but can be called explicitly.';

-- Function: Check if current session is authorized
CREATE OR REPLACE FUNCTION is_pipeline_authorized()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN COALESCE(current_setting('app.pipeline_authorized', true), 'false') = 'true';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- EMERGENCY OVERRIDE FUNCTIONS
-- ============================================================

-- Function: Disable write protection globally (EMERGENCY USE ONLY)
CREATE OR REPLACE FUNCTION disable_write_protection()
RETURNS VOID AS $$
BEGIN
    UPDATE pipeline_config
    SET value = 'false', updated_at = NOW()
    WHERE key = 'write_protection_enabled';

    RAISE WARNING '⚠️ WRITE PROTECTION DISABLED - All direct writes are now allowed!';
    RAISE WARNING '⚠️ Remember to call enable_write_protection() when done.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION disable_write_protection() IS
'EMERGENCY USE ONLY: Disables write protection globally. All direct writes will be allowed.';

-- Function: Re-enable write protection
CREATE OR REPLACE FUNCTION enable_write_protection()
RETURNS VOID AS $$
BEGIN
    UPDATE pipeline_config
    SET value = 'true', updated_at = NOW()
    WHERE key = 'write_protection_enabled';

    RAISE NOTICE '✅ Write protection re-enabled';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION enable_write_protection() IS
'Re-enables write protection after emergency disable.';

-- Function: Check if write protection is enabled globally
CREATE OR REPLACE FUNCTION is_write_protection_enabled()
RETURNS BOOLEAN AS $$
DECLARE
    v_enabled TEXT;
BEGIN
    SELECT value INTO v_enabled
    FROM pipeline_config
    WHERE key = 'write_protection_enabled';

    RETURN COALESCE(v_enabled, 'true') = 'true';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- WRITE PROTECTION TRIGGERS
-- ============================================================

-- Trigger function: Block unauthorized writes to teams_v2
CREATE OR REPLACE FUNCTION trg_protect_teams_v2_write()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if write protection is enabled globally
    IF NOT is_write_protection_enabled() THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Check if current session is authorized
    IF NOT is_pipeline_authorized() THEN
        RAISE EXCEPTION 'UNAUTHORIZED WRITE BLOCKED: Direct writes to teams_v2 are not allowed. '
            'All data must flow through the pipeline (dataQualityEngine.js). '
            'If this is an authorized script, call SELECT authorize_pipeline_write() first. '
            'For emergencies, call SELECT disable_write_protection().';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger function: Block unauthorized writes to matches_v2
CREATE OR REPLACE FUNCTION trg_protect_matches_v2_write()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if write protection is enabled globally
    IF NOT is_write_protection_enabled() THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Check if current session is authorized
    IF NOT is_pipeline_authorized() THEN
        RAISE EXCEPTION 'UNAUTHORIZED WRITE BLOCKED: Direct writes to matches_v2 are not allowed. '
            'All data must flow through the pipeline (dataQualityEngine.js). '
            'If this is an authorized script, call SELECT authorize_pipeline_write() first. '
            'For emergencies, call SELECT disable_write_protection().';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- APPLY TRIGGERS
-- ============================================================

-- Drop existing protection triggers if they exist
DROP TRIGGER IF EXISTS trg_protect_teams_v2_insert ON teams_v2;
DROP TRIGGER IF EXISTS trg_protect_teams_v2_update ON teams_v2;
DROP TRIGGER IF EXISTS trg_protect_teams_v2_delete ON teams_v2;
DROP TRIGGER IF EXISTS trg_protect_matches_v2_insert ON matches_v2;
DROP TRIGGER IF EXISTS trg_protect_matches_v2_update ON matches_v2;
DROP TRIGGER IF EXISTS trg_protect_matches_v2_delete ON matches_v2;

-- Create protection triggers for teams_v2
CREATE TRIGGER trg_protect_teams_v2_insert
BEFORE INSERT ON teams_v2
FOR EACH ROW EXECUTE FUNCTION trg_protect_teams_v2_write();

CREATE TRIGGER trg_protect_teams_v2_update
BEFORE UPDATE ON teams_v2
FOR EACH ROW EXECUTE FUNCTION trg_protect_teams_v2_write();

CREATE TRIGGER trg_protect_teams_v2_delete
BEFORE DELETE ON teams_v2
FOR EACH ROW EXECUTE FUNCTION trg_protect_teams_v2_write();

-- Create protection triggers for matches_v2
CREATE TRIGGER trg_protect_matches_v2_insert
BEFORE INSERT ON matches_v2
FOR EACH ROW EXECUTE FUNCTION trg_protect_matches_v2_write();

CREATE TRIGGER trg_protect_matches_v2_update
BEFORE UPDATE ON matches_v2
FOR EACH ROW EXECUTE FUNCTION trg_protect_matches_v2_write();

CREATE TRIGGER trg_protect_matches_v2_delete
BEFORE DELETE ON matches_v2
FOR EACH ROW EXECUTE FUNCTION trg_protect_matches_v2_write();

-- ============================================================
-- AUDIT LOG FOR PROTECTION EVENTS
-- ============================================================

-- Log blocked writes for monitoring
CREATE TABLE IF NOT EXISTS pipeline_blocked_writes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name TEXT NOT NULL,
    operation TEXT NOT NULL,
    blocked_at TIMESTAMPTZ DEFAULT NOW(),
    blocked_by TEXT DEFAULT CURRENT_USER,
    application_name TEXT DEFAULT current_setting('application_name', true),
    query_preview TEXT
);

-- Index for recent blocked writes
CREATE INDEX IF NOT EXISTS idx_blocked_writes_time
ON pipeline_blocked_writes (blocked_at DESC);

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Verify triggers are installed
DO $$
DECLARE
    trigger_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO trigger_count
    FROM information_schema.triggers
    WHERE trigger_name LIKE 'trg_protect_%'
      AND event_object_schema = 'public';

    IF trigger_count = 6 THEN
        RAISE NOTICE '✅ Write protection triggers installed successfully (6 triggers)';
    ELSE
        RAISE WARNING '⚠️ Expected 6 triggers, found %', trigger_count;
    END IF;
END;
$$;

-- Show status
SELECT
    'Write Protection Status' as check,
    CASE WHEN is_write_protection_enabled() THEN '✅ ENABLED' ELSE '❌ DISABLED' END as status;
