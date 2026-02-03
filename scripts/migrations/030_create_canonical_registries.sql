-- =============================================================================
-- PHASE 1: CANONICAL REGISTRY SYSTEM
-- Universal Data Quality Specification v1.0
-- Created: January 30, 2026
-- =============================================================================

-- Enable pg_trgm extension for fuzzy matching (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- TABLE: canonical_events
-- Single source of truth for event names across ALL data sources
-- =============================================================================

CREATE TABLE IF NOT EXISTS canonical_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('league', 'tournament')),
  aliases TEXT[] NOT NULL DEFAULT '{}',
  source_patterns JSONB DEFAULT '{}',
  state TEXT,
  region TEXT,
  year INTEGER,
  league_id UUID REFERENCES leagues(id) ON DELETE SET NULL,
  tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(canonical_name, event_type, year)
);

-- Index for fast alias lookup using GIN
CREATE INDEX IF NOT EXISTS idx_canonical_events_aliases ON canonical_events USING GIN (aliases);

-- Index for fuzzy name matching
CREATE INDEX IF NOT EXISTS idx_canonical_events_name_trgm ON canonical_events USING GIN (canonical_name gin_trgm_ops);

-- Index for year-based lookups
CREATE INDEX IF NOT EXISTS idx_canonical_events_year ON canonical_events (year);

COMMENT ON TABLE canonical_events IS 'Single source of truth for event names. Maps variant names to canonical versions.';

-- =============================================================================
-- TABLE: canonical_teams
-- Single source of truth for team names across ALL data sources
-- =============================================================================

CREATE TABLE IF NOT EXISTS canonical_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  club_name TEXT,
  birth_year INTEGER,
  gender gender_type,
  state TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  team_v2_id UUID REFERENCES teams_v2(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(canonical_name, birth_year, gender, state)
);

-- Index for fast alias lookup
CREATE INDEX IF NOT EXISTS idx_canonical_teams_aliases ON canonical_teams USING GIN (aliases);

-- Index for fuzzy name matching
CREATE INDEX IF NOT EXISTS idx_canonical_teams_name_trgm ON canonical_teams USING GIN (canonical_name gin_trgm_ops);

-- Index for team lookup by attributes
CREATE INDEX IF NOT EXISTS idx_canonical_teams_lookup ON canonical_teams (birth_year, gender, state);

COMMENT ON TABLE canonical_teams IS 'Single source of truth for team names. Maps variant names to canonical versions.';

-- =============================================================================
-- TABLE: canonical_clubs
-- Single source of truth for club organization names
-- =============================================================================

CREATE TABLE IF NOT EXISTS canonical_clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  state TEXT,
  region TEXT,
  logo_url TEXT,
  club_id UUID REFERENCES clubs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast alias lookup
CREATE INDEX IF NOT EXISTS idx_canonical_clubs_aliases ON canonical_clubs USING GIN (aliases);

-- Index for fuzzy name matching
CREATE INDEX IF NOT EXISTS idx_canonical_clubs_name_trgm ON canonical_clubs USING GIN (canonical_name gin_trgm_ops);

COMMENT ON TABLE canonical_clubs IS 'Single source of truth for club organization names.';

-- =============================================================================
-- FUNCTION: resolve_canonical_event
-- Resolve a raw event name to its canonical version
-- =============================================================================

CREATE OR REPLACE FUNCTION resolve_canonical_event(
  raw_name TEXT,
  p_event_type TEXT DEFAULT NULL
) RETURNS TABLE(
  canonical_id UUID,
  canonical_name TEXT,
  event_type TEXT,
  league_id UUID,
  tournament_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.id AS canonical_id,
    ce.canonical_name,
    ce.event_type,
    ce.league_id,
    ce.tournament_id
  FROM canonical_events ce
  WHERE
    -- Exact match on canonical name
    ce.canonical_name = raw_name
    -- Or match in aliases
    OR raw_name = ANY(ce.aliases)
    -- Or fuzzy match (0.85 threshold)
    OR similarity(ce.canonical_name, raw_name) > 0.85
  ORDER BY
    CASE
      WHEN ce.canonical_name = raw_name THEN 0
      WHEN raw_name = ANY(ce.aliases) THEN 1
      ELSE 2
    END,
    similarity(ce.canonical_name, raw_name) DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION resolve_canonical_event IS 'Resolve raw event name to canonical version using exact, alias, or fuzzy matching.';

-- =============================================================================
-- FUNCTION: resolve_canonical_team
-- Resolve a raw team name to its canonical version
-- =============================================================================

CREATE OR REPLACE FUNCTION resolve_canonical_team(
  raw_name TEXT,
  p_birth_year INTEGER DEFAULT NULL,
  p_gender gender_type DEFAULT NULL
) RETURNS TABLE(
  canonical_id UUID,
  canonical_name TEXT,
  team_v2_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ct.id AS canonical_id,
    ct.canonical_name,
    ct.team_v2_id
  FROM canonical_teams ct
  WHERE
    (ct.canonical_name = raw_name OR raw_name = ANY(ct.aliases))
    AND (p_birth_year IS NULL OR ct.birth_year = p_birth_year)
    AND (p_gender IS NULL OR ct.gender = p_gender)
  ORDER BY
    CASE WHEN ct.canonical_name = raw_name THEN 0 ELSE 1 END
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION resolve_canonical_team IS 'Resolve raw team name to canonical version using exact or alias matching.';

-- =============================================================================
-- FUNCTION: resolve_canonical_club
-- Resolve a raw club name to its canonical version
-- =============================================================================

CREATE OR REPLACE FUNCTION resolve_canonical_club(
  raw_name TEXT
) RETURNS TABLE(
  canonical_id UUID,
  canonical_name TEXT,
  club_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id AS canonical_id,
    cc.canonical_name,
    cc.club_id
  FROM canonical_clubs cc
  WHERE
    cc.canonical_name = raw_name
    OR raw_name = ANY(cc.aliases)
    OR similarity(cc.canonical_name, raw_name) > 0.85
  ORDER BY
    CASE
      WHEN cc.canonical_name = raw_name THEN 0
      WHEN raw_name = ANY(cc.aliases) THEN 1
      ELSE 2
    END,
    similarity(cc.canonical_name, raw_name) DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION resolve_canonical_club IS 'Resolve raw club name to canonical version.';

-- =============================================================================
-- FUNCTION: add_event_alias
-- Add an alias to a canonical event entry
-- =============================================================================

CREATE OR REPLACE FUNCTION add_event_alias(
  p_canonical_name TEXT,
  p_alias TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE canonical_events
  SET
    aliases = array_append(aliases, p_alias),
    updated_at = NOW()
  WHERE canonical_name = p_canonical_name
    AND NOT (p_alias = ANY(aliases));

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION add_event_alias IS 'Add an alias to an existing canonical event entry.';

-- =============================================================================
-- FUNCTION: add_team_alias
-- Add an alias to a canonical team entry
-- =============================================================================

CREATE OR REPLACE FUNCTION add_team_alias(
  p_canonical_name TEXT,
  p_birth_year INTEGER,
  p_alias TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE canonical_teams
  SET
    aliases = array_append(aliases, p_alias),
    updated_at = NOW()
  WHERE canonical_name = p_canonical_name
    AND birth_year = p_birth_year
    AND NOT (p_alias = ANY(aliases));

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION add_team_alias IS 'Add an alias to an existing canonical team entry.';

-- =============================================================================
-- SEED DATA: Known Heartland League Mappings
-- =============================================================================

INSERT INTO canonical_events (canonical_name, event_type, aliases, state, region, year) VALUES
  ('Heartland Premier League 2025', 'league',
   ARRAY['Heartland Soccer League 2025', 'Heartland League 2025', 'HPL 2025', 'heartland-league-2025', 'heartland-premier-2025'],
   'KS', 'Kansas City', 2025),
  ('Heartland Recreational League 2025', 'league',
   ARRAY['Heartland Rec League 2025', 'HRL 2025'],
   'KS', 'Kansas City', 2025),
  ('Heartland Premier League 2026', 'league',
   ARRAY['Heartland Soccer League 2026', 'Heartland League 2026', 'HPL 2026', 'heartland-league-2026', 'heartland-premier-2026'],
   'KS', 'Kansas City', 2026),
  ('Heartland Recreational League 2026', 'league',
   ARRAY['Heartland Rec League 2026', 'HRL 2026'],
   'KS', 'Kansas City', 2026)
ON CONFLICT (canonical_name, event_type, year) DO NOTHING;

-- Link canonical events to actual league records
UPDATE canonical_events ce
SET league_id = l.id
FROM leagues l
WHERE ce.event_type = 'league'
  AND (l.name ILIKE '%' || ce.canonical_name || '%' OR ce.canonical_name ILIKE '%' || l.name || '%')
  AND ce.league_id IS NULL;

-- =============================================================================
-- VERIFICATION QUERY
-- =============================================================================

-- SELECT 'canonical_events' as table_name, COUNT(*) as row_count FROM canonical_events
-- UNION ALL
-- SELECT 'canonical_teams', COUNT(*) FROM canonical_teams
-- UNION ALL
-- SELECT 'canonical_clubs', COUNT(*) FROM canonical_clubs;
