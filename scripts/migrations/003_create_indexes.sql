-- ============================================================
-- SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1
-- Migration 003: Create Indexes
--
-- Purpose: Optimal performance for app queries and data processing
-- ============================================================

-- ============================================================
-- TEAMS_V2 INDEXES
-- For Rankings tab, Teams tab, filtering, and search
-- ============================================================

-- Rankings page sorting (national rank, then ELO)
CREATE INDEX IF NOT EXISTS idx_teams_v2_rankings
ON teams_v2 (national_rank ASC NULLS LAST, elo_rating DESC);

-- Filtering by state, gender, birth_year (common filters)
CREATE INDEX IF NOT EXISTS idx_teams_v2_filter
ON teams_v2 (state, gender, birth_year);

-- Club lookup (for club detail pages)
CREATE INDEX IF NOT EXISTS idx_teams_v2_club
ON teams_v2 (club_id);

-- Alias search (for team matching during validation)
CREATE INDEX IF NOT EXISTS idx_teams_v2_aliases
ON teams_v2 USING GIN (known_aliases);

-- Full-text search on team name
CREATE INDEX IF NOT EXISTS idx_teams_v2_search
ON teams_v2 USING GIN (to_tsvector('english', canonical_name));

-- Source deduplication
CREATE INDEX IF NOT EXISTS idx_teams_v2_source
ON teams_v2 (source_platform, source_team_id);

-- State + ELO ranking (for state rankings page)
CREATE INDEX IF NOT EXISTS idx_teams_v2_state_ranking
ON teams_v2 (state, elo_rating DESC);

-- Teams with match history (for "Teams" tab which filters matches_played > 0)
CREATE INDEX IF NOT EXISTS idx_teams_v2_with_matches
ON teams_v2 (matches_played DESC)
WHERE matches_played > 0;

-- ============================================================
-- MATCHES_V2 INDEXES
-- For match history, recent matches, team detail pages
-- ============================================================

-- Recent matches (for home page, matches tab)
CREATE INDEX IF NOT EXISTS idx_matches_v2_date
ON matches_v2 (match_date DESC);

-- Home team match history
CREATE INDEX IF NOT EXISTS idx_matches_v2_home
ON matches_v2 (home_team_id, match_date DESC);

-- Away team match history
CREATE INDEX IF NOT EXISTS idx_matches_v2_away
ON matches_v2 (away_team_id, match_date DESC);

-- League matches (for league standings)
CREATE INDEX IF NOT EXISTS idx_matches_v2_league
ON matches_v2 (league_id, match_date DESC);

-- Tournament matches (for tournament brackets)
CREATE INDEX IF NOT EXISTS idx_matches_v2_tournament
ON matches_v2 (tournament_id, match_date DESC);

-- Combined team lookup (for team detail page - all matches)
CREATE INDEX IF NOT EXISTS idx_matches_v2_teams
ON matches_v2 (match_date DESC, home_team_id, away_team_id);

-- Source deduplication
CREATE INDEX IF NOT EXISTS idx_matches_v2_source
ON matches_v2 (source_platform, source_match_key);

-- ============================================================
-- SCHEDULES INDEXES
-- For upcoming games, team schedules
-- ============================================================

-- Upcoming games (sorted by date for efficient range queries)
-- Note: Cannot use CURRENT_DATE in partial index (not immutable)
-- Query planner will still use this index efficiently with WHERE match_date >= $1
CREATE INDEX IF NOT EXISTS idx_schedules_upcoming
ON schedules (match_date ASC);

-- Home team upcoming schedule
CREATE INDEX IF NOT EXISTS idx_schedules_home
ON schedules (home_team_id, match_date ASC);

-- Away team upcoming schedule
CREATE INDEX IF NOT EXISTS idx_schedules_away
ON schedules (away_team_id, match_date ASC);

-- League schedule
CREATE INDEX IF NOT EXISTS idx_schedules_league
ON schedules (league_id, match_date ASC);

-- Tournament schedule
CREATE INDEX IF NOT EXISTS idx_schedules_tournament
ON schedules (tournament_id, match_date ASC);

-- Source deduplication
CREATE INDEX IF NOT EXISTS idx_schedules_source
ON schedules (source_platform, source_match_key);

-- ============================================================
-- LEAGUES INDEXES
-- ============================================================

-- Season lookup
CREATE INDEX IF NOT EXISTS idx_leagues_season
ON leagues (season_id, state);

-- Source lookup
CREATE INDEX IF NOT EXISTS idx_leagues_source
ON leagues (source_platform, source_event_id);

-- ============================================================
-- TOURNAMENTS INDEXES
-- ============================================================

-- Date range lookup (for finding active tournaments)
CREATE INDEX IF NOT EXISTS idx_tournaments_dates
ON tournaments (start_date, end_date);

-- Source lookup
CREATE INDEX IF NOT EXISTS idx_tournaments_source
ON tournaments (source_platform, source_event_id);

-- State filter
CREATE INDEX IF NOT EXISTS idx_tournaments_state
ON tournaments (state, start_date DESC);

-- ============================================================
-- VENUES INDEXES
-- ============================================================

-- State and city lookup
CREATE INDEX IF NOT EXISTS idx_venues_state
ON venues (state, city);

-- Name search
CREATE INDEX IF NOT EXISTS idx_venues_name
ON venues USING GIN (to_tsvector('english', name));

-- Geographic search (if using PostGIS in future)
-- CREATE INDEX idx_venues_geo ON venues USING GIST (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326));

-- ============================================================
-- RANK_HISTORY_V2 INDEXES
-- For ranking journey charts
-- ============================================================

-- Team ranking history (for chart on team detail page)
CREATE INDEX IF NOT EXISTS idx_rank_history_team_date
ON rank_history_v2 (team_id, snapshot_date DESC);

-- Date-based cleanup
CREATE INDEX IF NOT EXISTS idx_rank_history_date
ON rank_history_v2 (snapshot_date);

-- ============================================================
-- CLUBS INDEXES
-- ============================================================

-- State lookup
CREATE INDEX IF NOT EXISTS idx_clubs_state
ON clubs (state);

-- Name search
CREATE INDEX IF NOT EXISTS idx_clubs_name
ON clubs USING GIN (to_tsvector('english', name));

-- ============================================================
-- SEASONS INDEXES
-- ============================================================

-- Current season lookup
CREATE INDEX IF NOT EXISTS idx_seasons_current
ON seasons (is_current)
WHERE is_current = TRUE;

-- ============================================================
-- AUDIT_LOG INDEXES
-- ============================================================

-- Table + record lookup
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record
ON audit_log (table_name, record_id);

-- Date range for cleanup
CREATE INDEX IF NOT EXISTS idx_audit_log_date
ON audit_log (changed_at DESC);

-- ============================================================
-- FAVORITES INDEXES
-- ============================================================

-- User's favorites
CREATE INDEX IF NOT EXISTS idx_favorites_user
ON favorites (user_id);

-- ============================================================
-- PREDICTIONS_V2 INDEXES
-- ============================================================

-- User's predictions
CREATE INDEX IF NOT EXISTS idx_predictions_user
ON predictions_v2 (user_id, created_at DESC);

-- Match predictions (for scoring)
CREATE INDEX IF NOT EXISTS idx_predictions_match
ON predictions_v2 (match_id)
WHERE match_id IS NOT NULL;

-- Unscored predictions
CREATE INDEX IF NOT EXISTS idx_predictions_unscored
ON predictions_v2 (created_at)
WHERE scored_at IS NULL AND match_id IS NOT NULL;
