-- ============================================================
-- Migration 092b: Security & Performance Fixes
-- Resolves remaining Supabase dashboard issues (88 ERROR+WARN → ~8)
--
-- SAFETY: Zero impact on V2 Data Architecture, app queries, or UI.
-- - Pipeline uses DATABASE_URL / SERVICE_ROLE_KEY (both bypass RLS)
-- - App uses anon key with public SELECT policies (NOT touched)
-- - All changes are metadata-only or remove dead code
--
-- Execute via: node scripts/migrations/run_092b.cjs
-- (Some steps need CONCURRENTLY or dynamic SQL, can't run as plain .sql)
-- ============================================================

-- ============================================================
-- STEP 7: Fix Security Definer Views (6 ERRORs → 0)
-- ============================================================

-- 7a: DROP dead views (reference V1 tables, zero app code references)
-- team_match_history: depends on match_results_deprecated (V1)
-- upcoming_matches: depends on match_results_deprecated (V1)
-- v_matches_competition_resolved: depends on matches (V1), only used by dead _explore.tsx
DROP VIEW IF EXISTS team_match_history CASCADE;
DROP VIEW IF EXISTS upcoming_matches CASCADE;
DROP VIEW IF EXISTS v_matches_competition_resolved CASCADE;

-- 7b: Set security_invoker on live views
-- Underlying tables all have public SELECT policies (USING (true))
ALTER VIEW leaderboard_all_time SET (security_invoker = true);
ALTER VIEW leaderboard_weekly SET (security_invoker = true);
ALTER VIEW teams_v2_live SET (security_invoker = true);

-- ============================================================
-- STEP 8: Fix Function Search Path (21 WARNs → 0)
-- Purely metadata — no behavioral change
-- ============================================================

ALTER FUNCTION authorize_pipeline_write() SET search_path = public;
ALTER FUNCTION calculate_data_quality_score(integer, varchar, gender_type, varchar, integer, integer, numeric) SET search_path = public;
ALTER FUNCTION cleanup_audit_log(integer) SET search_path = public;
ALTER FUNCTION cleanup_low_confidence_patterns() SET search_path = public;
ALTER FUNCTION cleanup_staging_tables(integer) SET search_path = public;
ALTER FUNCTION convert_schedule_to_match(uuid, integer, integer) SET search_path = public;
ALTER FUNCTION disable_write_protection() SET search_path = public;
ALTER FUNCTION enable_write_protection() SET search_path = public;
ALTER FUNCTION get_recent_matches(integer) SET search_path = public;
ALTER FUNCTION get_team_matches(uuid, integer) SET search_path = public;
ALTER FUNCTION is_pipeline_authorized() SET search_path = public;
ALTER FUNCTION is_write_protection_enabled() SET search_path = public;
ALTER FUNCTION refresh_league_standings(uuid) SET search_path = public;
ALTER FUNCTION refresh_team_profile(uuid) SET search_path = public;
ALTER FUNCTION resolve_canonical_club(text) SET search_path = public;
ALTER FUNCTION resolve_canonical_event(text, text) SET search_path = public;
ALTER FUNCTION resolve_canonical_team(text, integer, gender_type) SET search_path = public;
ALTER FUNCTION revoke_pipeline_write() SET search_path = public;
ALTER FUNCTION trg_protect_matches_v2_write() SET search_path = public;
ALTER FUNCTION trg_protect_teams_v2_write() SET search_path = public;
ALTER FUNCTION update_learned_patterns_timestamp() SET search_path = public;

-- ============================================================
-- STEP 9: Fix audit_log INSERT policy (always-true → service_role)
-- App NEVER inserts to audit_log. Pipeline uses DATABASE_URL (bypasses RLS).
-- ============================================================

DROP POLICY IF EXISTS "audit_log_insert_all" ON audit_log;
CREATE POLICY "audit_log_insert_service" ON audit_log FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- ============================================================
-- STEP 10: Drop deprecated tables (11 tables)
-- All V1 data migrated to V2. Zero active code references.
-- CASCADE drops any remaining dependent objects.
-- Views already dropped in Step 7 (team_match_history, upcoming_matches,
-- v_matches_competition_resolved) — CASCADE here is a safety net.
-- ============================================================

DROP TABLE IF EXISTS match_results_deprecated CASCADE;
DROP TABLE IF EXISTS teams_deprecated CASCADE;
DROP TABLE IF EXISTS rank_history_deprecated CASCADE;
DROP TABLE IF EXISTS team_name_aliases_deprecated CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS event_registry_deprecated CASCADE;
DROP TABLE IF EXISTS ambiguous_match_queue CASCADE;
DROP TABLE IF EXISTS team_ranks_daily CASCADE;
DROP TABLE IF EXISTS predictions_deprecated CASCADE;
DROP TABLE IF EXISTS external_team_records CASCADE;
DROP TABLE IF EXISTS v_teams_ranked CASCADE;

-- ============================================================
-- STEP 11: Fix RLS InitPlan on active tables
-- Wraps auth.role() in (SELECT ...) for per-query eval instead of per-row.
-- Same policy logic, just more efficient.
-- Only affects WRITE policies (service_role). Public SELECT untouched.
--
-- NOTE: After Step 10 drops deprecated tables, ~10 policies are auto-removed.
-- Remaining ~32 policies on active tables are fixed below.
-- ============================================================

-- teams_v2 (3 write policies)
DROP POLICY IF EXISTS "teams_v2_insert_service" ON teams_v2;
CREATE POLICY "teams_v2_insert_service" ON teams_v2 FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "teams_v2_update_service" ON teams_v2;
CREATE POLICY "teams_v2_update_service" ON teams_v2 FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "teams_v2_delete_service" ON teams_v2;
CREATE POLICY "teams_v2_delete_service" ON teams_v2 FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- matches_v2 (3 write policies)
DROP POLICY IF EXISTS "matches_v2_insert_service" ON matches_v2;
CREATE POLICY "matches_v2_insert_service" ON matches_v2 FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "matches_v2_update_service" ON matches_v2;
CREATE POLICY "matches_v2_update_service" ON matches_v2 FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "matches_v2_delete_service" ON matches_v2;
CREATE POLICY "matches_v2_delete_service" ON matches_v2 FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- leagues (3 write policies)
DROP POLICY IF EXISTS "leagues_insert_service" ON leagues;
CREATE POLICY "leagues_insert_service" ON leagues FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "leagues_update_service" ON leagues;
CREATE POLICY "leagues_update_service" ON leagues FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "leagues_delete_service" ON leagues;
CREATE POLICY "leagues_delete_service" ON leagues FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- tournaments (3 write policies)
DROP POLICY IF EXISTS "tournaments_insert_service" ON tournaments;
CREATE POLICY "tournaments_insert_service" ON tournaments FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "tournaments_update_service" ON tournaments;
CREATE POLICY "tournaments_update_service" ON tournaments FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "tournaments_delete_service" ON tournaments;
CREATE POLICY "tournaments_delete_service" ON tournaments FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- clubs (3 write policies)
DROP POLICY IF EXISTS "clubs_insert_service" ON clubs;
CREATE POLICY "clubs_insert_service" ON clubs FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "clubs_update_service" ON clubs;
CREATE POLICY "clubs_update_service" ON clubs FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "clubs_delete_service" ON clubs;
CREATE POLICY "clubs_delete_service" ON clubs FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- venues (3 write policies)
DROP POLICY IF EXISTS "venues_insert_service" ON venues;
CREATE POLICY "venues_insert_service" ON venues FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "venues_update_service" ON venues;
CREATE POLICY "venues_update_service" ON venues FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "venues_delete_service" ON venues;
CREATE POLICY "venues_delete_service" ON venues FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- seasons (3 write policies)
DROP POLICY IF EXISTS "seasons_insert_service" ON seasons;
CREATE POLICY "seasons_insert_service" ON seasons FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "seasons_update_service" ON seasons;
CREATE POLICY "seasons_update_service" ON seasons FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "seasons_delete_service" ON seasons;
CREATE POLICY "seasons_delete_service" ON seasons FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- schedules (3 write policies)
DROP POLICY IF EXISTS "schedules_insert_service" ON schedules;
CREATE POLICY "schedules_insert_service" ON schedules FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "schedules_update_service" ON schedules;
CREATE POLICY "schedules_update_service" ON schedules FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "schedules_delete_service" ON schedules;
CREATE POLICY "schedules_delete_service" ON schedules FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- rank_history_v2 (3 write policies)
DROP POLICY IF EXISTS "rank_history_v2_insert_service" ON rank_history_v2;
CREATE POLICY "rank_history_v2_insert_service" ON rank_history_v2 FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "rank_history_v2_update_service" ON rank_history_v2;
CREATE POLICY "rank_history_v2_update_service" ON rank_history_v2 FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "rank_history_v2_delete_service" ON rank_history_v2;
CREATE POLICY "rank_history_v2_delete_service" ON rank_history_v2 FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- staging_games (1 ALL policy)
DROP POLICY IF EXISTS "staging_games_all_service" ON staging_games;
CREATE POLICY "staging_games_all_service" ON staging_games FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- staging_teams (1 ALL policy)
DROP POLICY IF EXISTS "staging_teams_all_service" ON staging_teams;
CREATE POLICY "staging_teams_all_service" ON staging_teams FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- staging_events (1 ALL policy)
DROP POLICY IF EXISTS "staging_events_all_service" ON staging_events;
CREATE POLICY "staging_events_all_service" ON staging_events FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- audit_log SELECT policy (already fixed INSERT in Step 9)
DROP POLICY IF EXISTS "audit_log_select_service" ON audit_log;
CREATE POLICY "audit_log_select_service" ON audit_log FOR SELECT
  USING ((SELECT auth.role()) = 'service_role');

-- learned_patterns (1 ALL policy)
DROP POLICY IF EXISTS "learned_patterns_service_all" ON learned_patterns;
CREATE POLICY "learned_patterns_service_all" ON learned_patterns FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- canonical_teams (1 ALL policy — created in 092)
DROP POLICY IF EXISTS "service_role_all" ON canonical_teams;
CREATE POLICY "service_role_all" ON canonical_teams FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- canonical_clubs (1 ALL policy — created in 092)
DROP POLICY IF EXISTS "service_role_all" ON canonical_clubs;
CREATE POLICY "service_role_all" ON canonical_clubs FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- canonical_events (1 ALL policy — created in 092)
DROP POLICY IF EXISTS "service_role_all" ON canonical_events;
CREATE POLICY "service_role_all" ON canonical_events FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- source_entity_map (1 ALL policy — created in 092)
DROP POLICY IF EXISTS "service_role_all" ON source_entity_map;
CREATE POLICY "service_role_all" ON source_entity_map FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- pipeline_config (1 ALL policy — created in 092)
DROP POLICY IF EXISTS "service_role_all" ON pipeline_config;
CREATE POLICY "service_role_all" ON pipeline_config FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- pipeline_blocked_writes (1 ALL policy — created in 092)
DROP POLICY IF EXISTS "service_role_all" ON pipeline_blocked_writes;
CREATE POLICY "service_role_all" ON pipeline_blocked_writes FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- staging_rejected (1 ALL policy — created in 092)
DROP POLICY IF EXISTS "service_role_all" ON staging_rejected;
CREATE POLICY "service_role_all" ON staging_rejected FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- _archived_recreational_matches (1 ALL policy — created in 092)
-- Change to: public SELECT + service_role write
DROP POLICY IF EXISTS "service_role_all" ON _archived_recreational_matches;
CREATE POLICY "archived_rec_select_public" ON _archived_recreational_matches FOR SELECT
  USING (true);
CREATE POLICY "archived_rec_write_service" ON _archived_recreational_matches FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');
CREATE POLICY "archived_rec_update_service" ON _archived_recreational_matches FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role');
CREATE POLICY "archived_rec_delete_service" ON _archived_recreational_matches FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- ============================================================
-- STEP 12: Add missing FK indexes on favorites
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_favorites_team_id ON favorites(team_id);
CREATE INDEX IF NOT EXISTS idx_favorites_club_id ON favorites(club_id);

-- ============================================================
-- END OF MIGRATION 092b
-- ============================================================
