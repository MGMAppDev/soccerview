-- Session 86: Add soft-delete columns to matches_v2
-- This prevents permanent data loss during deduplication operations

-- Add soft delete columns
ALTER TABLE matches_v2 ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE matches_v2 ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- Create index for active matches (excludes soft-deleted)
CREATE INDEX IF NOT EXISTS idx_matches_v2_active
ON matches_v2 (match_date)
WHERE deleted_at IS NULL;

-- Create index for deleted matches (for recovery/audit)
CREATE INDEX IF NOT EXISTS idx_matches_v2_deleted
ON matches_v2 (deleted_at)
WHERE deleted_at IS NOT NULL;

-- Comment
COMMENT ON COLUMN matches_v2.deleted_at IS 'Soft-delete timestamp - NULL means active';
COMMENT ON COLUMN matches_v2.deletion_reason IS 'Reason for soft delete (e.g., "duplicate", "merged")';
