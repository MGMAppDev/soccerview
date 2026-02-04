-- ============================================================
-- Migration 080: Remove Recreational Data (Premier-Only Policy)
-- Session 84: SoccerView focuses on premier/competitive soccer
--
-- IMPORTANT: Run scripts/migrations/run_migration_080.js instead of
-- executing this SQL directly. The runner handles proper authorization
-- and logging.
--
-- See:
-- - CLAUDE.md Principle 28: Premier-Only Data Policy
-- - docs/SESSION_84_PREMIER_ONLY_PLAN.md
-- ============================================================

-- Step 1: Create backup table (will be dropped after 30 days)
-- This preserves data for rollback if needed
CREATE TABLE IF NOT EXISTS _archived_recreational_matches AS
SELECT * FROM matches_v2
WHERE source_match_key LIKE 'heartland-recreational-%';

-- Log backup count
DO $$
DECLARE
  backup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backup_count FROM _archived_recreational_matches;
  RAISE NOTICE 'Backed up % recreational matches to _archived_recreational_matches', backup_count;
END $$;

-- Step 2: Delete recreational matches from production
DELETE FROM matches_v2
WHERE source_match_key LIKE 'heartland-recreational-%';

-- Step 3: Delete recreational leagues
DELETE FROM leagues
WHERE name ILIKE '%recreational%'
   OR source_event_id LIKE 'heartland-recreational-%';

-- Step 4: Delete from staging_games
DELETE FROM staging_games
WHERE source_match_key LIKE 'heartland-recreational-%';

-- Step 5: Clean canonical registries
DELETE FROM canonical_events
WHERE canonical_name ILIKE '%recreational%';

-- Step 6: DO NOT delete teams
-- Teams are kept even if they have 0 matches remaining.
-- This preserves data integrity and allows teams with GotSport ranks to still appear.
-- The ELO recalculation in Phase 5 will reset their stats to 0 if no matches remain.

-- Step 7: Log summary
DO $$
DECLARE
  remaining_rec_matches INTEGER;
  remaining_rec_leagues INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_rec_matches
  FROM matches_v2 WHERE source_match_key LIKE 'heartland-recreational-%';

  SELECT COUNT(*) INTO remaining_rec_leagues
  FROM leagues WHERE name ILIKE '%recreational%';

  RAISE NOTICE 'Migration 080 complete:';
  RAISE NOTICE '  Remaining recreational matches: % (should be 0)', remaining_rec_matches;
  RAISE NOTICE '  Remaining recreational leagues: % (should be 0)', remaining_rec_leagues;
END $$;

-- REMINDER: After 30 days, run:
-- DROP TABLE IF EXISTS _archived_recreational_matches;
