-- Session 89: Universal Source Entity Map + State Normalization
--
-- Creates the source_entity_map table for deterministic entity resolution
-- across ALL entity types (teams, clubs, leagues, tournaments, venues, schedules).
-- Also normalizes inconsistent state values to 'unknown'.

-- ===================================================================
-- STEP 1: State Normalization
-- Three different representations exist: 'Unknown', 'XX', 'xx'
-- Standardize all to 'unknown' (lowercase, matches teams_v2 default)
-- ===================================================================

UPDATE teams_v2
SET state = 'unknown'
WHERE state IN ('Unknown', 'XX', 'xx', 'UNKNOWN');

-- ===================================================================
-- STEP 2: Create source_entity_map table
-- Universal mapping: (entity_type, source_platform, source_entity_id) → SoccerView UUID
-- ===================================================================

CREATE TABLE IF NOT EXISTS source_entity_map (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- What type of entity this maps
  entity_type TEXT NOT NULL CHECK (entity_type IN ('team', 'club', 'league', 'tournament', 'venue', 'schedule')),

  -- Which source platform provided this ID
  source_platform TEXT NOT NULL,

  -- The source's own identifier for this entity
  source_entity_id TEXT NOT NULL,

  -- The SoccerView UUID this maps to (our authoritative ID)
  sv_id UUID NOT NULL,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each (entity_type, source_platform, source_entity_id) maps to exactly one SV ID
  CONSTRAINT source_entity_map_unique
    UNIQUE (entity_type, source_platform, source_entity_id)
);

-- Index for reverse lookups: given an SV ID, find all source mappings
CREATE INDEX IF NOT EXISTS idx_source_entity_map_sv_id
ON source_entity_map (sv_id);

-- Index for platform-specific lookups
CREATE INDEX IF NOT EXISTS idx_source_entity_map_platform_type
ON source_entity_map (source_platform, entity_type);

-- Comments
COMMENT ON TABLE source_entity_map IS 'Universal mapping from source-specific entity IDs to SoccerView UUIDs. Tier 1 resolution for deterministic entity matching.';
COMMENT ON COLUMN source_entity_map.entity_type IS 'Entity type: team, club, league, tournament, venue, schedule';
COMMENT ON COLUMN source_entity_map.source_platform IS 'Source platform: gotsport, htgsports, heartland, v1-legacy, etc.';
COMMENT ON COLUMN source_entity_map.source_entity_id IS 'The source platforms own identifier for this entity';
COMMENT ON COLUMN source_entity_map.sv_id IS 'The authoritative SoccerView UUID this source entity maps to';
