-- ============================================================
-- Migration 092: Database Hygiene
-- Fixes 93 Supabase dashboard issues (47 security + 46 performance)
-- ============================================================

-- ============================================================
-- STEP 1: Drop empty rebuild artifact tables (3 tables)
-- CASCADE automatically drops their indexes
-- ============================================================

DROP TABLE IF EXISTS canonical_teams_rebuild CASCADE;
DROP TABLE IF EXISTS teams_v2_rebuild CASCADE;
DROP TABLE IF EXISTS matches_v2_rebuild CASCADE;

-- ============================================================
-- STEP 2: Enable RLS on 8 unprotected tables
-- service_role bypasses RLS, so pipeline scripts are unaffected
-- ============================================================

-- Internal registries (pipeline-only, service_role access)
ALTER TABLE canonical_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON canonical_teams FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE canonical_clubs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON canonical_clubs FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE canonical_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON canonical_events FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE source_entity_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON source_entity_map FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE pipeline_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON pipeline_config FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE pipeline_blocked_writes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON pipeline_blocked_writes FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE staging_rejected ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON staging_rejected FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE _archived_recreational_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON _archived_recreational_matches FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- STEP 3: Add missing FK indexes (9 columns)
-- Skipping 2 FKs on deprecated tables (ambiguous_match_queue, scrape_targets)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_canonical_clubs_club_id ON canonical_clubs(club_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_tournament_id ON canonical_events(tournament_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_league_id ON canonical_events(league_id);
CREATE INDEX IF NOT EXISTS idx_canonical_teams_team_v2_id ON canonical_teams(team_v2_id);
CREATE INDEX IF NOT EXISTS idx_matches_v2_venue_id ON matches_v2(venue_id);
CREATE INDEX IF NOT EXISTS idx_predictions_v2_schedule_id ON predictions_v2(schedule_id);
CREATE INDEX IF NOT EXISTS idx_predictions_v2_predicted_winner ON predictions_v2(predicted_winner);
CREATE INDEX IF NOT EXISTS idx_schedules_venue_id ON schedules(venue_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_venue_id ON tournaments(venue_id);

-- ============================================================
-- STEP 4: Drop indexes on deprecated/empty tables
-- ~800+ MB savings. Tables kept for reference, indexes removed.
-- (Rebuild table indexes already dropped by CASCADE in Step 1)
-- ============================================================

-- ambiguous_match_queue (3 indexes)
ALTER TABLE ambiguous_match_queue DROP CONSTRAINT IF EXISTS ambiguous_match_queue_pkey;
DROP INDEX IF EXISTS idx_ambiguous_queue_created;
DROP INDEX IF EXISTS idx_ambiguous_queue_status;

-- event_registry_deprecated (7 indexes)
ALTER TABLE event_registry_deprecated DROP CONSTRAINT IF EXISTS event_registry_event_id_key;
ALTER TABLE event_registry_deprecated DROP CONSTRAINT IF EXISTS event_registry_pkey;
ALTER TABLE event_registry_deprecated DROP CONSTRAINT IF EXISTS event_registry_source_platform_event_id_key;
DROP INDEX IF EXISTS idx_event_registry_platform;
DROP INDEX IF EXISTS idx_event_registry_region;
DROP INDEX IF EXISTS idx_event_registry_status;
DROP INDEX IF EXISTS idx_event_registry_type;

-- external_team_records (3 indexes)
DROP INDEX IF EXISTS external_team_records_canonical_idx;
ALTER TABLE external_team_records DROP CONSTRAINT IF EXISTS external_team_records_pkey;
DROP INDEX IF EXISTS external_team_records_source_uniq;

-- match_results_deprecated (16 indexes, ~207 MB)
DROP INDEX IF EXISTS idx_match_results_age_group;
DROP INDEX IF EXISTS idx_match_results_away_name;
DROP INDEX IF EXISTS idx_match_results_away_team;
DROP INDEX IF EXISTS idx_match_results_date;
DROP INDEX IF EXISTS idx_match_results_event;
DROP INDEX IF EXISTS idx_match_results_home_name;
DROP INDEX IF EXISTS idx_match_results_home_team;
DROP INDEX IF EXISTS idx_match_results_recent_scored;
DROP INDEX IF EXISTS idx_match_results_recent_with_scores;
DROP INDEX IF EXISTS idx_match_results_season;
DROP INDEX IF EXISTS idx_match_results_source_platform;
DROP INDEX IF EXISTS idx_match_results_source_type;
DROP INDEX IF EXISTS idx_match_results_status;
ALTER TABLE match_results_deprecated DROP CONSTRAINT IF EXISTS match_results_event_id_match_number_key;
ALTER TABLE match_results_deprecated DROP CONSTRAINT IF EXISTS match_results_pkey CASCADE;
ALTER TABLE match_results_deprecated DROP CONSTRAINT IF EXISTS match_results_source_match_key_unique;

-- matches (old V1 table, 10 indexes)
DROP INDEX IF EXISTS idx_matches_away_team_date;
DROP INDEX IF EXISTS idx_matches_date;
DROP INDEX IF EXISTS idx_matches_source_date;
DROP INDEX IF EXISTS idx_matches_team_date;
DROP INDEX IF EXISTS matches_competition_id_idx;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_match_id_key;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_pkey;
DROP INDEX IF EXISTS matches_source_id_idx;
DROP INDEX IF EXISTS matches_source_id_source_match_key_uidx;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_source_match_key_key;

-- predictions_deprecated (5 indexes)
DROP INDEX IF EXISTS idx_predictions_created;
DROP INDEX IF EXISTS idx_predictions_device;
DROP INDEX IF EXISTS idx_predictions_status;
DROP INDEX IF EXISTS idx_predictions_teams;
ALTER TABLE predictions_deprecated DROP CONSTRAINT IF EXISTS predictions_pkey;

-- rank_history_deprecated (5 indexes, ~162 MB)
DROP INDEX IF EXISTS idx_rank_history_date;
DROP INDEX IF EXISTS idx_rank_history_team_date;
DROP INDEX IF EXISTS idx_rank_history_team_id;
ALTER TABLE rank_history_deprecated DROP CONSTRAINT IF EXISTS rank_history_pkey;
ALTER TABLE rank_history_deprecated DROP CONSTRAINT IF EXISTS unique_team_date;

-- team_name_aliases_deprecated (6 indexes, ~139 MB)
DROP INDEX IF EXISTS idx_alias_name_lookup;
DROP INDEX IF EXISTS idx_alias_name_trgm;
DROP INDEX IF EXISTS idx_alias_team_id;
DROP INDEX IF EXISTS idx_team_aliases_name;
ALTER TABLE team_name_aliases_deprecated DROP CONSTRAINT IF EXISTS team_name_aliases_alias_name_key;
ALTER TABLE team_name_aliases_deprecated DROP CONSTRAINT IF EXISTS team_name_aliases_pkey;

-- team_ranks_daily (4 indexes)
DROP INDEX IF EXISTS idx_team_ranks_lists;
DROP INDEX IF EXISTS idx_team_ranks_team;
ALTER TABLE team_ranks_daily DROP CONSTRAINT IF EXISTS team_ranks_daily_pkey;
ALTER TABLE team_ranks_daily DROP CONSTRAINT IF EXISTS team_ranks_daily_unique;

-- teams_deprecated (24 indexes, ~290 MB)
DROP INDEX IF EXISTS idx_team_elo_matches_played_positive;
DROP INDEX IF EXISTS idx_teams_age_group;
DROP INDEX IF EXISTS idx_teams_composite_filters;
DROP INDEX IF EXISTS idx_teams_elo_gender_age;
DROP INDEX IF EXISTS idx_teams_elo_national_rank;
DROP INDEX IF EXISTS idx_teams_elo_rating;
DROP INDEX IF EXISTS idx_teams_elo_state_rank;
DROP INDEX IF EXISTS idx_teams_gender;
DROP INDEX IF EXISTS idx_teams_gotsport_id;
DROP INDEX IF EXISTS idx_teams_gotsport_points;
DROP INDEX IF EXISTS idx_teams_lower_name;
DROP INDEX IF EXISTS idx_teams_name_trgm;
DROP INDEX IF EXISTS idx_teams_national_rank;
DROP INDEX IF EXISTS idx_teams_normalized_name;
DROP INDEX IF EXISTS idx_teams_normalized_trgm;
DROP INDEX IF EXISTS idx_teams_ranked;
DROP INDEX IF EXISTS idx_teams_rating;
DROP INDEX IF EXISTS idx_teams_reconciliation_candidates;
DROP INDEX IF EXISTS idx_teams_reconciliation_priority;
DROP INDEX IF EXISTS idx_teams_season_code;
DROP INDEX IF EXISTS idx_teams_state;
DROP INDEX IF EXISTS idx_teams_state_rank;
ALTER TABLE teams_deprecated DROP CONSTRAINT IF EXISTS teams_pkey CASCADE;
ALTER TABLE teams_deprecated DROP CONSTRAINT IF EXISTS teams_team_name_key;

-- ============================================================
-- STEP 5: Drop unused production indexes (conservative)
-- Only clearly unused non-PK, non-unique indexes on production tables.
-- Skipping: materialized view indexes, canonical table indexes, PKs, unique constraints.
-- ============================================================

DROP INDEX IF EXISTS idx_rank_history_v2_elo_state;    -- rank_history_v2, 27 MB, 0 scans
DROP INDEX IF EXISTS idx_teams_v2_search;               -- teams_v2, 15 MB, 0 scans (app uses trgm)
DROP INDEX IF EXISTS idx_teams_v2_aliases;              -- teams_v2, 5 MB, 0 scans (GIN on known_aliases)
DROP INDEX IF EXISTS idx_teams_v2_incomplete;           -- teams_v2, 2 MB, 0 scans (partial: data_quality_score < 0.5)
DROP INDEX IF EXISTS idx_teams_v2_needs_review;         -- teams_v2, 200 kB, 0 scans (partial: needs_review)

-- ============================================================
-- STEP 6: Audit log retention infrastructure (60-day policy)
-- All current data is within 60 days, so DELETE is a no-op today.
-- Index + policy set up for future automated cleanup.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON audit_log(changed_at);

DELETE FROM audit_log WHERE changed_at < NOW() - INTERVAL '60 days';
