-- =============================================================================
-- Migration 095: Fix refresh_app_views() + Enable RLS on Standings Tables
-- Session 92 QC Part 2
--
-- FIX A: refresh_app_views() function uses CONCURRENTLY on app_league_standings,
--        but that view (hybrid UNION ALL from migration 094) has NO UNIQUE INDEX.
--        CONCURRENTLY requires a unique index → fails → PL/pgSQL rolls back
--        ALL view refreshes → all 5 views stay stale → app breaks.
--
--        Fix: Use non-concurrent refresh for app_league_standings only.
--        This matches refresh_views_manual.js behavior (line 49).
--
-- FIX B: staging_standings and league_standings (created in migration 094)
--        are exposed to PostgREST without RLS enabled.
--        Supabase security lints flag these as ERROR-level.
--        Fix: Enable RLS. No public policies needed — service_role bypasses RLS,
--        and the app reads via app_league_standings materialized view.
-- =============================================================================

DO $$
BEGIN

RAISE NOTICE 'Migration 095: Fix refresh_app_views() + Enable RLS';

-- =========================================================================
-- FIX A: Update refresh_app_views() to NOT use CONCURRENTLY for
--        app_league_standings (hybrid UNION ALL view has no unique index)
-- =========================================================================

CREATE OR REPLACE FUNCTION refresh_app_views()
RETURNS void AS $fn$
BEGIN
    RAISE NOTICE 'Refreshing app_rankings...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_rankings;

    RAISE NOTICE 'Refreshing app_team_profile...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_team_profile;

    RAISE NOTICE 'Refreshing app_matches_feed...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_matches_feed;

    RAISE NOTICE 'Refreshing app_upcoming_schedule...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY app_upcoming_schedule;

    -- app_league_standings: NO CONCURRENTLY
    -- Hybrid UNION ALL view (migration 094) has no unique index.
    -- CONCURRENTLY requires a unique index and will fail without one.
    -- Non-concurrent refresh is safe — brief lock on reads during refresh.
    -- This matches refresh_views_manual.js behavior (line 49).
    RAISE NOTICE 'Refreshing app_league_standings (non-concurrent)...';
    REFRESH MATERIALIZED VIEW app_league_standings;

    RAISE NOTICE 'All views refreshed successfully.';
END;
$fn$ LANGUAGE plpgsql;

RAISE NOTICE '  Fixed refresh_app_views() — non-concurrent for app_league_standings';

-- =========================================================================
-- FIX B: Enable RLS on standings tables
-- service_role key automatically bypasses RLS for pipeline operations.
-- No public SELECT/INSERT policies needed because:
--   staging_standings: only written by backend scripts (service_role)
--   league_standings: only written by backend scripts; app reads via
--                     app_league_standings materialized view (not direct table)
-- =========================================================================

ALTER TABLE staging_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_standings ENABLE ROW LEVEL SECURITY;

RAISE NOTICE '  Enabled RLS on staging_standings and league_standings';

RAISE NOTICE 'Migration 095 complete.';

END $$;
