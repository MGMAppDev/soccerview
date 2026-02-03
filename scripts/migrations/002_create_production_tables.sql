-- ============================================================
-- SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1
-- Migration 002: Create Production Tables (Layer 2)
--
-- Purpose: Clean, validated, normalized data with strict enforcement
-- All data here has passed validation pipeline
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

-- Gender enum (M = Male/Boys, F = Female/Girls)
DO $$ BEGIN
    CREATE TYPE gender_type AS ENUM ('M', 'F');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- REFERENCE TABLES (No dependencies)
-- ============================================================

-- Seasons: Temporal boundaries for youth soccer (Aug 1 - Jul 31)
CREATE TABLE IF NOT EXISTS seasons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,                 -- '2025-26 Season'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_season_dates UNIQUE (start_date, end_date),
    CONSTRAINT valid_season_range CHECK (end_date > start_date)
);

-- Venues: Physical locations where games are played
CREATE TABLE IF NOT EXISTS venues (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    field_count INTEGER,
    source_platform TEXT,               -- Where this venue was discovered
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clubs: Parent organizations (e.g., "Sporting Blue Valley", "KC Fusion")
CREATE TABLE IF NOT EXISTS clubs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,                 -- 'Sporting Blue Valley'
    short_name TEXT,                    -- 'SBV'
    state TEXT NOT NULL,
    city TEXT,
    website TEXT,
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_club_name_state UNIQUE (name, state)
);

-- ============================================================
-- CORE TABLES (With dependencies)
-- ============================================================

-- Teams v2: With proper columns (birth_year, gender as COLUMNS, not parsed from name)
CREATE TABLE IF NOT EXISTS teams_v2 (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    club_id UUID REFERENCES clubs(id) ON DELETE SET NULL,
    canonical_name TEXT NOT NULL,       -- Standardized name for matching
    display_name TEXT NOT NULL,         -- Full name for display in app
    birth_year INTEGER NOT NULL,        -- 2015 (stored, not parsed!)
    gender gender_type NOT NULL,        -- 'M' or 'F' (stored, not parsed!)
    age_group TEXT,                     -- 'U11' (calculated from birth_year)
    state TEXT NOT NULL,
    known_aliases TEXT[] DEFAULT '{}',  -- Array in same row, not separate table!

    -- Ratings
    elo_rating DECIMAL(7,2) DEFAULT 1500.00,
    national_rank INTEGER,
    state_rank INTEGER,
    regional_rank INTEGER,

    -- Official GotSport rankings (if applicable)
    gotsport_rank INTEGER,
    gotsport_points DECIMAL(10,2),

    -- Stats (current season - updated by triggers)
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    matches_played INTEGER DEFAULT 0,
    goals_for INTEGER DEFAULT 0,
    goals_against INTEGER DEFAULT 0,

    -- Source tracking
    source_platform TEXT,
    source_team_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_birth_year CHECK (birth_year >= 2000 AND birth_year <= 2025),
    CONSTRAINT valid_elo CHECK (elo_rating >= 1000 AND elo_rating <= 2500),
    CONSTRAINT unique_team_identity UNIQUE (canonical_name, birth_year, gender, state)
);

-- ============================================================
-- EVENT TABLES (Leagues and Tournaments)
-- ============================================================

-- Leagues: Regular season competitions (weeks/months)
CREATE TABLE IF NOT EXISTS leagues (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    season_id UUID REFERENCES seasons(id) ON DELETE SET NULL,
    state TEXT,
    region TEXT,
    divisions JSONB,                    -- Array of division names
    standings_rules JSONB,              -- Points system, tiebreakers
    source_platform TEXT,
    source_event_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_league_season UNIQUE (name, season_id)
);

-- Tournaments: Weekend events (1-3 days)
CREATE TABLE IF NOT EXISTS tournaments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
    state TEXT,
    format TEXT,                        -- 'bracket', 'group', 'round-robin'
    age_groups TEXT[],
    genders gender_type[],
    source_platform TEXT,
    source_event_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_tournament_dates CHECK (end_date >= start_date)
);

-- ============================================================
-- GAME TABLES (Schedules and Matches)
-- ============================================================

-- Schedules: Future games (no scores yet)
CREATE TABLE IF NOT EXISTS schedules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_date DATE NOT NULL,
    match_time TIME,
    home_team_id UUID NOT NULL REFERENCES teams_v2(id) ON DELETE CASCADE,
    away_team_id UUID NOT NULL REFERENCES teams_v2(id) ON DELETE CASCADE,
    venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
    field_name TEXT,

    -- Event reference (either league OR tournament, at least one required)
    league_id UUID REFERENCES leagues(id) ON DELETE SET NULL,
    tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,

    -- Source tracking
    source_platform TEXT,
    source_match_key TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT different_teams_schedule CHECK (home_team_id != away_team_id),
    CONSTRAINT has_event_schedule CHECK (league_id IS NOT NULL OR tournament_id IS NOT NULL),
    CONSTRAINT unique_schedule UNIQUE (match_date, home_team_id, away_team_id)
);

-- Matches v2: Past games with scores (REQUIRES scores)
CREATE TABLE IF NOT EXISTS matches_v2 (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_date DATE NOT NULL,
    match_time TIME,
    home_team_id UUID NOT NULL REFERENCES teams_v2(id) ON DELETE CASCADE,
    away_team_id UUID NOT NULL REFERENCES teams_v2(id) ON DELETE CASCADE,
    home_score INTEGER NOT NULL,        -- REQUIRED (this is a completed match)
    away_score INTEGER NOT NULL,        -- REQUIRED (this is a completed match)
    venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
    field_name TEXT,

    -- Event reference
    league_id UUID REFERENCES leagues(id) ON DELETE SET NULL,
    tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,

    -- Source tracking
    source_platform TEXT,
    source_match_key TEXT,

    -- ELO tracking (what ratings were at time of match)
    home_elo_before DECIMAL(7,2),
    away_elo_before DECIMAL(7,2),
    home_elo_after DECIMAL(7,2),
    away_elo_after DECIMAL(7,2),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT different_teams_match CHECK (home_team_id != away_team_id),
    CONSTRAINT valid_scores CHECK (home_score >= 0 AND away_score >= 0),
    CONSTRAINT unique_match UNIQUE (match_date, home_team_id, away_team_id, home_score, away_score)
);

-- ============================================================
-- HISTORICAL DATA TABLES
-- ============================================================

-- Rank History v2: For ranking journey charts
CREATE TABLE IF NOT EXISTS rank_history_v2 (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES teams_v2(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    elo_rating DECIMAL(7,2),
    national_rank INTEGER,
    state_rank INTEGER,
    regional_rank INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_rank_snapshot UNIQUE (team_id, snapshot_date)
);

-- ============================================================
-- USER DATA TABLES
-- ============================================================

-- Favorites: User's followed teams and clubs
CREATE TABLE IF NOT EXISTS favorites (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,              -- References auth.users
    team_id UUID REFERENCES teams_v2(id) ON DELETE CASCADE,
    club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT has_favorite CHECK (team_id IS NOT NULL OR club_id IS NOT NULL),
    CONSTRAINT unique_user_team_favorite UNIQUE (user_id, team_id),
    CONSTRAINT unique_user_club_favorite UNIQUE (user_id, club_id)
);

-- Predictions v2: User match predictions
CREATE TABLE IF NOT EXISTS predictions_v2 (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    match_id UUID REFERENCES matches_v2(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
    predicted_home_score INTEGER,
    predicted_away_score INTEGER,
    predicted_winner UUID REFERENCES teams_v2(id) ON DELETE SET NULL,
    points_earned INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    scored_at TIMESTAMPTZ,
    CONSTRAINT has_prediction_target CHECK (match_id IS NOT NULL OR schedule_id IS NOT NULL)
);

-- ============================================================
-- AUDIT TABLE
-- ============================================================

-- Audit Log: Track all changes to important tables
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action TEXT NOT NULL,               -- 'INSERT', 'UPDATE', 'DELETE'
    old_data JSONB,
    new_data JSONB,
    changed_by TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================

COMMENT ON TABLE seasons IS 'Youth soccer season boundaries (Aug 1 - Jul 31)';
COMMENT ON TABLE clubs IS 'Parent organizations that have multiple teams';
COMMENT ON TABLE teams_v2 IS 'Individual teams with birth_year and gender as proper columns';
COMMENT ON TABLE venues IS 'Physical locations where games are played';
COMMENT ON TABLE leagues IS 'Regular season competitions (weeks/months duration)';
COMMENT ON TABLE tournaments IS 'Weekend events (1-3 day duration)';
COMMENT ON TABLE schedules IS 'Future games without scores (upcoming matches)';
COMMENT ON TABLE matches_v2 IS 'Completed games with scores';
COMMENT ON TABLE rank_history_v2 IS 'Daily snapshots of team rankings for charts';
COMMENT ON TABLE favorites IS 'User followed teams and clubs';
COMMENT ON TABLE predictions_v2 IS 'User match predictions for gamification';
COMMENT ON TABLE audit_log IS 'Change tracking for important tables';

COMMENT ON COLUMN teams_v2.canonical_name IS 'Standardized team name used for matching/deduplication';
COMMENT ON COLUMN teams_v2.display_name IS 'Full team name shown in the app UI';
COMMENT ON COLUMN teams_v2.known_aliases IS 'Array of alternative names this team is known by (no separate table)';
COMMENT ON COLUMN teams_v2.birth_year IS 'Player birth year (e.g., 2015), not age group';
COMMENT ON COLUMN teams_v2.age_group IS 'Calculated from birth_year (e.g., U11), auto-updated by trigger';
