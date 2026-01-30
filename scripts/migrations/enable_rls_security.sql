-- =============================================================================
-- SoccerView RLS Security Migration - COMPLETE
-- =============================================================================
-- Fixes ALL security issues from Supabase Security Advisor
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- =============================================================================

-- =============================================================================
-- PART 1: Enable RLS on all tables (15 tables)
-- =============================================================================

ALTER TABLE public.teams_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_history_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- PART 2: RLS Policies for Core Data Tables
-- =============================================================================

-- teams_v2
DROP POLICY IF EXISTS "teams_v2_select_public" ON public.teams_v2;
DROP POLICY IF EXISTS "teams_v2_insert_service" ON public.teams_v2;
DROP POLICY IF EXISTS "teams_v2_update_service" ON public.teams_v2;
DROP POLICY IF EXISTS "teams_v2_delete_service" ON public.teams_v2;
CREATE POLICY "teams_v2_select_public" ON public.teams_v2 FOR SELECT USING (true);
CREATE POLICY "teams_v2_insert_service" ON public.teams_v2 FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "teams_v2_update_service" ON public.teams_v2 FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "teams_v2_delete_service" ON public.teams_v2 FOR DELETE USING (auth.role() = 'service_role');

-- matches_v2
DROP POLICY IF EXISTS "matches_v2_select_public" ON public.matches_v2;
DROP POLICY IF EXISTS "matches_v2_insert_service" ON public.matches_v2;
DROP POLICY IF EXISTS "matches_v2_update_service" ON public.matches_v2;
DROP POLICY IF EXISTS "matches_v2_delete_service" ON public.matches_v2;
CREATE POLICY "matches_v2_select_public" ON public.matches_v2 FOR SELECT USING (true);
CREATE POLICY "matches_v2_insert_service" ON public.matches_v2 FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "matches_v2_update_service" ON public.matches_v2 FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "matches_v2_delete_service" ON public.matches_v2 FOR DELETE USING (auth.role() = 'service_role');

-- leagues
DROP POLICY IF EXISTS "leagues_select_public" ON public.leagues;
DROP POLICY IF EXISTS "leagues_insert_service" ON public.leagues;
DROP POLICY IF EXISTS "leagues_update_service" ON public.leagues;
DROP POLICY IF EXISTS "leagues_delete_service" ON public.leagues;
CREATE POLICY "leagues_select_public" ON public.leagues FOR SELECT USING (true);
CREATE POLICY "leagues_insert_service" ON public.leagues FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "leagues_update_service" ON public.leagues FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "leagues_delete_service" ON public.leagues FOR DELETE USING (auth.role() = 'service_role');

-- tournaments
DROP POLICY IF EXISTS "tournaments_select_public" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_insert_service" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_update_service" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments_delete_service" ON public.tournaments;
CREATE POLICY "tournaments_select_public" ON public.tournaments FOR SELECT USING (true);
CREATE POLICY "tournaments_insert_service" ON public.tournaments FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "tournaments_update_service" ON public.tournaments FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "tournaments_delete_service" ON public.tournaments FOR DELETE USING (auth.role() = 'service_role');

-- clubs
DROP POLICY IF EXISTS "clubs_select_public" ON public.clubs;
DROP POLICY IF EXISTS "clubs_insert_service" ON public.clubs;
DROP POLICY IF EXISTS "clubs_update_service" ON public.clubs;
DROP POLICY IF EXISTS "clubs_delete_service" ON public.clubs;
CREATE POLICY "clubs_select_public" ON public.clubs FOR SELECT USING (true);
CREATE POLICY "clubs_insert_service" ON public.clubs FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "clubs_update_service" ON public.clubs FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "clubs_delete_service" ON public.clubs FOR DELETE USING (auth.role() = 'service_role');

-- venues
DROP POLICY IF EXISTS "venues_select_public" ON public.venues;
DROP POLICY IF EXISTS "venues_insert_service" ON public.venues;
DROP POLICY IF EXISTS "venues_update_service" ON public.venues;
DROP POLICY IF EXISTS "venues_delete_service" ON public.venues;
CREATE POLICY "venues_select_public" ON public.venues FOR SELECT USING (true);
CREATE POLICY "venues_insert_service" ON public.venues FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "venues_update_service" ON public.venues FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "venues_delete_service" ON public.venues FOR DELETE USING (auth.role() = 'service_role');

-- seasons
DROP POLICY IF EXISTS "seasons_select_public" ON public.seasons;
DROP POLICY IF EXISTS "seasons_insert_service" ON public.seasons;
DROP POLICY IF EXISTS "seasons_update_service" ON public.seasons;
DROP POLICY IF EXISTS "seasons_delete_service" ON public.seasons;
CREATE POLICY "seasons_select_public" ON public.seasons FOR SELECT USING (true);
CREATE POLICY "seasons_insert_service" ON public.seasons FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "seasons_update_service" ON public.seasons FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "seasons_delete_service" ON public.seasons FOR DELETE USING (auth.role() = 'service_role');

-- schedules
DROP POLICY IF EXISTS "schedules_select_public" ON public.schedules;
DROP POLICY IF EXISTS "schedules_insert_service" ON public.schedules;
DROP POLICY IF EXISTS "schedules_update_service" ON public.schedules;
DROP POLICY IF EXISTS "schedules_delete_service" ON public.schedules;
CREATE POLICY "schedules_select_public" ON public.schedules FOR SELECT USING (true);
CREATE POLICY "schedules_insert_service" ON public.schedules FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "schedules_update_service" ON public.schedules FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "schedules_delete_service" ON public.schedules FOR DELETE USING (auth.role() = 'service_role');

-- rank_history_v2
DROP POLICY IF EXISTS "rank_history_v2_select_public" ON public.rank_history_v2;
DROP POLICY IF EXISTS "rank_history_v2_insert_service" ON public.rank_history_v2;
DROP POLICY IF EXISTS "rank_history_v2_update_service" ON public.rank_history_v2;
DROP POLICY IF EXISTS "rank_history_v2_delete_service" ON public.rank_history_v2;
CREATE POLICY "rank_history_v2_select_public" ON public.rank_history_v2 FOR SELECT USING (true);
CREATE POLICY "rank_history_v2_insert_service" ON public.rank_history_v2 FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "rank_history_v2_update_service" ON public.rank_history_v2 FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "rank_history_v2_delete_service" ON public.rank_history_v2 FOR DELETE USING (auth.role() = 'service_role');

-- =============================================================================
-- PART 3: RLS Policies for Staging Tables (service role only)
-- =============================================================================

DROP POLICY IF EXISTS "staging_teams_all_service" ON public.staging_teams;
DROP POLICY IF EXISTS "staging_games_all_service" ON public.staging_games;
DROP POLICY IF EXISTS "staging_events_all_service" ON public.staging_events;
CREATE POLICY "staging_teams_all_service" ON public.staging_teams FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "staging_games_all_service" ON public.staging_games FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "staging_events_all_service" ON public.staging_events FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- PART 4: RLS Policies for User Data Tables
-- =============================================================================

DROP POLICY IF EXISTS "favorites_all_public" ON public.favorites;
CREATE POLICY "favorites_all_public" ON public.favorites FOR ALL USING (true);

DROP POLICY IF EXISTS "predictions_v2_all_public" ON public.predictions_v2;
CREATE POLICY "predictions_v2_all_public" ON public.predictions_v2 FOR ALL USING (true);

DROP POLICY IF EXISTS "audit_log_insert_all" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_select_service" ON public.audit_log;
CREATE POLICY "audit_log_insert_all" ON public.audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY "audit_log_select_service" ON public.audit_log FOR SELECT USING (auth.role() = 'service_role');

-- =============================================================================
-- PART 5: Fix Function Search Paths (only functions that exist)
-- =============================================================================

DO $$
DECLARE
    func_name text;
    func_list text[] := ARRAY[
        'update_normalized_name()',
        'get_team_count()',
        'get_match_count()',
        'trg_calculate_age_group()',
        'trg_validate_match_insert()',
        'get_recent_matches()',
        'trg_update_team_stats_after_match()',
        'trg_reverse_team_stats_after_match_delete()',
        'convert_schedule_to_match()',
        'trg_audit_changes()',
        'trg_set_updated_at()',
        'cleanup_audit_log()',
        'cleanup_staging_tables()',
        'refresh_app_views()',
        'refresh_team_profile()',
        'refresh_league_standings()',
        'refresh_rankings()',
        'calculate_data_quality_score()',
        'update_team_quality_score()',
        'get_current_season_year()'
    ];
BEGIN
    FOREACH func_name IN ARRAY func_list
    LOOP
        BEGIN
            EXECUTE format('ALTER FUNCTION public.%s SET search_path = public', func_name);
            RAISE NOTICE 'Updated search_path for %', func_name;
        EXCEPTION WHEN undefined_function THEN
            RAISE NOTICE 'Function % does not exist, skipping', func_name;
        END;
    END LOOP;
END $$;

-- Handle functions with parameters separately
DO $$
BEGIN
    BEGIN
        ALTER FUNCTION public.calculate_age_group(integer) SET search_path = public;
        RAISE NOTICE 'Updated calculate_age_group(integer)';
    EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE 'calculate_age_group(integer) does not exist';
    END;

    BEGIN
        ALTER FUNCTION public.get_head_to_head(uuid, uuid) SET search_path = public;
        RAISE NOTICE 'Updated get_head_to_head(uuid, uuid)';
    EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE 'get_head_to_head(uuid, uuid) does not exist';
    END;

    BEGIN
        ALTER FUNCTION public.get_team_matches(uuid) SET search_path = public;
        RAISE NOTICE 'Updated get_team_matches(uuid)';
    EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE 'get_team_matches(uuid) does not exist';
    END;
END $$;

-- =============================================================================
-- PART 6: Fix permissive RLS policies on deprecated tables
-- =============================================================================

DROP POLICY IF EXISTS "Allow anonymous insert predictions" ON public.predictions_deprecated;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;

-- =============================================================================
-- PART 7: Create extensions schema (for pg_trgm - optional)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;

-- =============================================================================
-- VERIFICATION - Check RLS status
-- =============================================================================

SELECT tablename, rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
