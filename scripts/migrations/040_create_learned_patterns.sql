-- ============================================================
-- Migration 040: Create Adaptive Learning Infrastructure
-- ============================================================
-- This table stores patterns learned from data processing.
-- Used by adaptiveLearning.js for future-proof universal processing.
--
-- Session: 63
-- Date: January 30, 2026
-- ============================================================

-- Table to store learned patterns
CREATE TABLE IF NOT EXISTS learned_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL,  -- 'team_club_prefix', 'event_league_keywords', etc.
  source TEXT NOT NULL,        -- Adapter ID or 'all'
  pattern_data JSONB NOT NULL, -- The actual pattern data
  confidence NUMERIC(3,2) DEFAULT 0.5,  -- 0.00 to 1.00
  usage_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  learned_at TIMESTAMPTZ DEFAULT NOW(),
  last_success TIMESTAMPTZ,
  last_failure TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint to prevent duplicates
  UNIQUE(pattern_type, source, pattern_data)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_learned_patterns_lookup
ON learned_patterns(pattern_type, source, confidence DESC);

-- Index for cleanup of low-confidence patterns
CREATE INDEX IF NOT EXISTS idx_learned_patterns_confidence
ON learned_patterns(confidence);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_learned_patterns_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS learned_patterns_updated ON learned_patterns;
CREATE TRIGGER learned_patterns_updated
BEFORE UPDATE ON learned_patterns
FOR EACH ROW
EXECUTE FUNCTION update_learned_patterns_timestamp();

-- Enable RLS
ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;

-- Policies: service role can do everything
DROP POLICY IF EXISTS learned_patterns_service_all ON learned_patterns;
CREATE POLICY learned_patterns_service_all ON learned_patterns
FOR ALL USING (auth.role() = 'service_role');

-- Function to clean up low-confidence patterns (run periodically)
CREATE OR REPLACE FUNCTION cleanup_low_confidence_patterns()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM learned_patterns
  WHERE confidence < 0.1
    AND failure_count > usage_count
    AND last_failure < NOW() - INTERVAL '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comment on table
COMMENT ON TABLE learned_patterns IS 'Stores patterns learned from data processing for adaptive universal handling';
