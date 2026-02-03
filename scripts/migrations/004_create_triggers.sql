-- ============================================================
-- SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1
-- Migration 004: Create Triggers & Functions
--
-- Purpose: Enforce data integrity at database level
-- These prevent bad data from EVER entering production tables
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Calculate age group from birth year and current season
CREATE OR REPLACE FUNCTION calculate_age_group(p_birth_year INTEGER)
RETURNS TEXT AS $$
DECLARE
    current_season_year INTEGER;
    age INTEGER;
BEGIN
    -- Youth soccer season runs Aug 1 - Jul 31
    -- Get the start year of current season
    IF EXTRACT(MONTH FROM CURRENT_DATE) >= 8 THEN
        current_season_year := EXTRACT(YEAR FROM CURRENT_DATE);
    ELSE
        current_season_year := EXTRACT(YEAR FROM CURRENT_DATE) - 1;
    END IF;

    -- Calculate age as of Aug 1 of current season
    age := current_season_year - p_birth_year;

    -- Return age group (U9, U10, U11, etc.)
    RETURN 'U' || age;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_age_group IS 'Calculates age group (U11, U12, etc.) from birth year based on current season';

-- ============================================================
-- TEAM TRIGGERS
-- ============================================================

-- Trigger: Auto-calculate age_group when team is inserted or birth_year changes
-- NOTE: This trigger was DISABLED in Session 52 (January 28, 2026) because it
-- conflicted with GotSport's formula. Age group is now set directly from source
-- data using the GotSport formula: age_group = 'U' || (current_year - birth_year)
--
-- The trigger kept overwriting correct values with "season-aware" calculations.
-- To re-enable, uncomment the CREATE TRIGGER statement below.
CREATE OR REPLACE FUNCTION trg_calculate_age_group()
RETURNS TRIGGER AS $$
BEGIN
    NEW.age_group := calculate_age_group(NEW.birth_year);
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DISABLED in Session 52 - GotSport formula used directly instead
DROP TRIGGER IF EXISTS trg_teams_v2_age_group ON teams_v2;
-- CREATE TRIGGER trg_teams_v2_age_group
-- BEFORE INSERT OR UPDATE OF birth_year ON teams_v2
-- FOR EACH ROW EXECUTE FUNCTION trg_calculate_age_group();

-- ============================================================
-- MATCH VALIDATION TRIGGERS
-- ============================================================

-- Trigger: Validate match team compatibility before insert
-- Ensures teams have compatible birth years and same gender
CREATE OR REPLACE FUNCTION trg_validate_match_insert()
RETURNS TRIGGER AS $$
DECLARE
    home_team RECORD;
    away_team RECORD;
BEGIN
    -- Get team details
    SELECT birth_year, gender, canonical_name INTO home_team
    FROM teams_v2 WHERE id = NEW.home_team_id;

    SELECT birth_year, gender, canonical_name INTO away_team
    FROM teams_v2 WHERE id = NEW.away_team_id;

    -- Teams must exist
    IF home_team IS NULL THEN
        RAISE EXCEPTION 'Home team % does not exist', NEW.home_team_id;
    END IF;
    IF away_team IS NULL THEN
        RAISE EXCEPTION 'Away team % does not exist', NEW.away_team_id;
    END IF;

    -- Birth years must be within 1 year (age group flexibility for tournaments)
    IF ABS(home_team.birth_year - away_team.birth_year) > 1 THEN
        RAISE EXCEPTION 'Teams have incompatible birth years: % (%) vs % (%)',
            home_team.canonical_name, home_team.birth_year,
            away_team.canonical_name, away_team.birth_year;
    END IF;

    -- Genders must match
    IF home_team.gender != away_team.gender THEN
        RAISE EXCEPTION 'Teams have different genders: % (%) vs % (%)',
            home_team.canonical_name, home_team.gender,
            away_team.canonical_name, away_team.gender;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply validation to both matches and schedules
DROP TRIGGER IF EXISTS trg_validate_match ON matches_v2;
CREATE TRIGGER trg_validate_match
BEFORE INSERT ON matches_v2
FOR EACH ROW EXECUTE FUNCTION trg_validate_match_insert();

DROP TRIGGER IF EXISTS trg_validate_schedule ON schedules;
CREATE TRIGGER trg_validate_schedule
BEFORE INSERT ON schedules
FOR EACH ROW EXECUTE FUNCTION trg_validate_match_insert();

-- ============================================================
-- TEAM STATS UPDATE TRIGGERS
-- ============================================================

-- Trigger: Update team stats after match insert
CREATE OR REPLACE FUNCTION trg_update_team_stats_after_match()
RETURNS TRIGGER AS $$
BEGIN
    -- Update home team stats
    UPDATE teams_v2 SET
        matches_played = matches_played + 1,
        wins = wins + CASE WHEN NEW.home_score > NEW.away_score THEN 1 ELSE 0 END,
        losses = losses + CASE WHEN NEW.home_score < NEW.away_score THEN 1 ELSE 0 END,
        draws = draws + CASE WHEN NEW.home_score = NEW.away_score THEN 1 ELSE 0 END,
        goals_for = goals_for + NEW.home_score,
        goals_against = goals_against + NEW.away_score,
        updated_at = NOW()
    WHERE id = NEW.home_team_id;

    -- Update away team stats
    UPDATE teams_v2 SET
        matches_played = matches_played + 1,
        wins = wins + CASE WHEN NEW.away_score > NEW.home_score THEN 1 ELSE 0 END,
        losses = losses + CASE WHEN NEW.away_score < NEW.home_score THEN 1 ELSE 0 END,
        draws = draws + CASE WHEN NEW.home_score = NEW.away_score THEN 1 ELSE 0 END,
        goals_for = goals_for + NEW.away_score,
        goals_against = goals_against + NEW.home_score,
        updated_at = NOW()
    WHERE id = NEW.away_team_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_match_stats ON matches_v2;
CREATE TRIGGER trg_match_stats
AFTER INSERT ON matches_v2
FOR EACH ROW EXECUTE FUNCTION trg_update_team_stats_after_match();

-- Trigger: Reverse team stats if match is deleted
CREATE OR REPLACE FUNCTION trg_reverse_team_stats_after_match_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- Reverse home team stats
    UPDATE teams_v2 SET
        matches_played = GREATEST(0, matches_played - 1),
        wins = GREATEST(0, wins - CASE WHEN OLD.home_score > OLD.away_score THEN 1 ELSE 0 END),
        losses = GREATEST(0, losses - CASE WHEN OLD.home_score < OLD.away_score THEN 1 ELSE 0 END),
        draws = GREATEST(0, draws - CASE WHEN OLD.home_score = OLD.away_score THEN 1 ELSE 0 END),
        goals_for = GREATEST(0, goals_for - OLD.home_score),
        goals_against = GREATEST(0, goals_against - OLD.away_score),
        updated_at = NOW()
    WHERE id = OLD.home_team_id;

    -- Reverse away team stats
    UPDATE teams_v2 SET
        matches_played = GREATEST(0, matches_played - 1),
        wins = GREATEST(0, wins - CASE WHEN OLD.away_score > OLD.home_score THEN 1 ELSE 0 END),
        losses = GREATEST(0, losses - CASE WHEN OLD.away_score < OLD.home_score THEN 1 ELSE 0 END),
        draws = GREATEST(0, draws - CASE WHEN OLD.home_score = OLD.away_score THEN 1 ELSE 0 END),
        goals_for = GREATEST(0, goals_for - OLD.away_score),
        goals_against = GREATEST(0, goals_against - OLD.home_score),
        updated_at = NOW()
    WHERE id = OLD.away_team_id;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_match_stats_delete ON matches_v2;
CREATE TRIGGER trg_match_stats_delete
AFTER DELETE ON matches_v2
FOR EACH ROW EXECUTE FUNCTION trg_reverse_team_stats_after_match_delete();

-- ============================================================
-- SCHEDULE TO MATCH CONVERSION
-- ============================================================

-- Function: Convert a scheduled game to a completed match
-- Call this when scores become available
CREATE OR REPLACE FUNCTION convert_schedule_to_match(
    p_schedule_id UUID,
    p_home_score INTEGER,
    p_away_score INTEGER
)
RETURNS UUID AS $$
DECLARE
    v_schedule RECORD;
    v_new_match_id UUID;
BEGIN
    -- Get the schedule
    SELECT * INTO v_schedule FROM schedules WHERE id = p_schedule_id;

    IF v_schedule IS NULL THEN
        RAISE EXCEPTION 'Schedule % not found', p_schedule_id;
    END IF;

    -- Insert into matches
    INSERT INTO matches_v2 (
        match_date, match_time, home_team_id, away_team_id,
        home_score, away_score, venue_id, field_name,
        league_id, tournament_id, source_platform, source_match_key
    ) VALUES (
        v_schedule.match_date, v_schedule.match_time,
        v_schedule.home_team_id, v_schedule.away_team_id,
        p_home_score, p_away_score,
        v_schedule.venue_id, v_schedule.field_name,
        v_schedule.league_id, v_schedule.tournament_id,
        v_schedule.source_platform, v_schedule.source_match_key
    )
    RETURNING id INTO v_new_match_id;

    -- Delete the schedule
    DELETE FROM schedules WHERE id = p_schedule_id;

    RETURN v_new_match_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION convert_schedule_to_match IS 'Converts a scheduled game to a completed match once scores are available';

-- ============================================================
-- AUDIT TRIGGERS
-- ============================================================

-- Trigger: Log all changes to audit table
CREATE OR REPLACE FUNCTION trg_audit_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, record_id, action, new_data)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD));
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply audit logging to important tables
DROP TRIGGER IF EXISTS trg_audit_teams ON teams_v2;
CREATE TRIGGER trg_audit_teams
AFTER INSERT OR UPDATE OR DELETE ON teams_v2
FOR EACH ROW EXECUTE FUNCTION trg_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_matches ON matches_v2;
CREATE TRIGGER trg_audit_matches
AFTER INSERT OR UPDATE OR DELETE ON matches_v2
FOR EACH ROW EXECUTE FUNCTION trg_audit_changes();

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

-- Generic updated_at trigger function
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at column
DROP TRIGGER IF EXISTS trg_clubs_updated_at ON clubs;
CREATE TRIGGER trg_clubs_updated_at
BEFORE UPDATE ON clubs
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_venues_updated_at ON venues;
CREATE TRIGGER trg_venues_updated_at
BEFORE UPDATE ON venues
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_leagues_updated_at ON leagues;
CREATE TRIGGER trg_leagues_updated_at
BEFORE UPDATE ON leagues
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_tournaments_updated_at ON tournaments;
CREATE TRIGGER trg_tournaments_updated_at
BEFORE UPDATE ON tournaments
FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- CLEANUP FUNCTIONS
-- ============================================================

-- Function: Clean old audit logs (keep 90 days)
CREATE OR REPLACE FUNCTION cleanup_audit_log(p_days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM audit_log
    WHERE changed_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_audit_log IS 'Deletes audit log entries older than specified days (default 90)';

-- Function: Clean processed staging records (keep 7 days)
CREATE OR REPLACE FUNCTION cleanup_staging_tables(p_days_to_keep INTEGER DEFAULT 7)
RETURNS TABLE(teams_deleted INTEGER, games_deleted INTEGER, events_deleted INTEGER) AS $$
DECLARE
    v_teams INTEGER;
    v_games INTEGER;
    v_events INTEGER;
BEGIN
    DELETE FROM staging_teams
    WHERE processed = TRUE
      AND processed_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
    GET DIAGNOSTICS v_teams = ROW_COUNT;

    DELETE FROM staging_games
    WHERE processed = TRUE
      AND processed_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
    GET DIAGNOSTICS v_games = ROW_COUNT;

    DELETE FROM staging_events
    WHERE processed = TRUE
      AND processed_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
    GET DIAGNOSTICS v_events = ROW_COUNT;

    RETURN QUERY SELECT v_teams, v_games, v_events;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_staging_tables IS 'Deletes processed staging records older than specified days (default 7)';
