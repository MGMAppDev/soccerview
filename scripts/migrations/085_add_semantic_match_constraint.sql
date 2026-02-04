-- =============================================================================
-- Migration 085: Add Semantic Unique Constraint on matches_v2
-- =============================================================================
-- Session 85: Universal SoccerView ID Architecture
--
-- PRINCIPLE: A match is uniquely identified by (match_date, home_team_id, away_team_id)
-- using SoccerView Team IDs as the uniqueness anchor.
--
-- This aligns with:
-- - schedules table: CONSTRAINT unique_schedule UNIQUE (match_date, home_team_id, away_team_id)
-- - Universal SoccerView ID Architecture (all entities use SV IDs for uniqueness)
--
-- The source_match_key column remains for audit/tracing purposes but is no longer
-- used as the primary uniqueness constraint.
-- =============================================================================

-- Step 1: Drop the old constraint that includes scores
-- This constraint allowed the same match to exist multiple times with different scores
ALTER TABLE matches_v2 DROP CONSTRAINT IF EXISTS unique_match;

-- Step 2: Drop the old source_match_key unique constraint if it exists
-- We're moving from source-specific to semantic uniqueness
ALTER TABLE matches_v2 DROP CONSTRAINT IF EXISTS matches_v2_source_match_key_unique;

-- Step 3: Add the semantic unique constraint
-- Uses SoccerView Team IDs (teams_v2.id) as the uniqueness anchor
-- Same approach as schedules table
ALTER TABLE matches_v2 ADD CONSTRAINT unique_match_semantic
  UNIQUE (match_date, home_team_id, away_team_id);

-- Step 4: Add an index on source_match_key for audit/lookup purposes (non-unique)
-- Keeps source_match_key useful for tracing data lineage without enforcing uniqueness
CREATE INDEX IF NOT EXISTS idx_matches_v2_source_match_key
ON matches_v2 (source_match_key)
WHERE source_match_key IS NOT NULL;

-- =============================================================================
-- VERIFICATION
-- =============================================================================
-- After running this migration, verify with:
--
-- SELECT constraint_name, constraint_type
-- FROM information_schema.table_constraints
-- WHERE table_name = 'matches_v2' AND constraint_name LIKE '%unique%';
--
-- Expected output:
-- unique_match_semantic | UNIQUE
-- =============================================================================

COMMENT ON CONSTRAINT unique_match_semantic ON matches_v2 IS
  'Session 85: Semantic uniqueness using SoccerView Team IDs. One match per date per team pair.';
