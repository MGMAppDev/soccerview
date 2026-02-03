-- Migration 050: Add SoccerView rank columns to rank_history_v2
-- These columns capture daily snapshots of ELO-based rank positions
-- Universal: Works for any team regardless of data source

-- Add columns if they don't exist
ALTER TABLE rank_history_v2
ADD COLUMN IF NOT EXISTS elo_national_rank INTEGER,
ADD COLUMN IF NOT EXISTS elo_state_rank INTEGER;

-- Add index for efficient queries by rank type
CREATE INDEX IF NOT EXISTS idx_rank_history_v2_elo_national
ON rank_history_v2 (team_id, snapshot_date)
WHERE elo_national_rank IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rank_history_v2_elo_state
ON rank_history_v2 (team_id, snapshot_date)
WHERE elo_state_rank IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN rank_history_v2.elo_national_rank IS 'SoccerView national rank position (derived from ELO rating)';
COMMENT ON COLUMN rank_history_v2.elo_state_rank IS 'SoccerView state rank position (derived from ELO rating)';
