-- ============================================================
-- Migration 080: Add Soft Delete Support for teams_v2
-- ============================================================
-- Instead of permanently deleting merged teams, mark them as
-- dormant with a reference to the team they were merged into.
--
-- This preserves:
-- - Historical audit trail
-- - Ability to undo merges
-- - Data integrity verification
-- ============================================================

-- Add status column with default 'active'
ALTER TABLE teams_v2
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Add merged_into reference (NULL for active teams)
ALTER TABLE teams_v2
ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES teams_v2(id);

-- Add merge timestamp
ALTER TABLE teams_v2
ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;

-- Add merge reason for audit
ALTER TABLE teams_v2
ADD COLUMN IF NOT EXISTS merge_reason TEXT;

-- Index for filtering active teams efficiently
CREATE INDEX IF NOT EXISTS idx_teams_v2_status
ON teams_v2 (status)
WHERE status = 'active';

-- Index for finding merged teams
CREATE INDEX IF NOT EXISTS idx_teams_v2_merged_into
ON teams_v2 (merged_into)
WHERE merged_into IS NOT NULL;

-- Comment on new columns
COMMENT ON COLUMN teams_v2.status IS
'Team status: active, merged, dormant, archived. Only active teams appear in app views.';

COMMENT ON COLUMN teams_v2.merged_into IS
'UUID of the team this was merged into (NULL for active teams).';

COMMENT ON COLUMN teams_v2.merged_at IS
'Timestamp when the merge occurred.';

COMMENT ON COLUMN teams_v2.merge_reason IS
'Reason for merge (e.g., "duplicate_canonical", "manual_review").';

-- ============================================================
-- UPDATE APP VIEWS TO FILTER ACTIVE TEAMS ONLY
-- ============================================================
-- IMPORTANT: After running this migration, update all views that
-- query teams_v2 to add: WHERE status = 'active' OR status IS NULL
-- This ensures backward compatibility during rollout.
-- ============================================================

-- Verify migration
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'teams_v2' AND column_name = 'status'
    ) THEN
        RAISE NOTICE '✅ Migration 080 complete: soft delete columns added';
    ELSE
        RAISE WARNING '❌ Migration 080 failed: status column not found';
    END IF;
END $$;
