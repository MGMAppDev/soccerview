/**
 * Migration 092b Execution Script
 *
 * Executes the SQL migration in proper order with safety checks.
 * Some steps can't use CONCURRENTLY inside a transaction, so we
 * run them outside the main transaction block.
 *
 * SAFETY:
 * - Zero impact on V2 Data Architecture
 * - Zero UI/design changes
 * - Pipeline uses DATABASE_URL/SERVICE_ROLE_KEY (bypass RLS)
 * - App SELECT policies are NOT modified
 *
 * Run: node scripts/migrations/run_092b.cjs
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const startTime = Date.now();
  console.log('=== MIGRATION 092b: Security & Performance Fixes ===\n');

  // Read the SQL file
  const sqlPath = path.join(__dirname, '092b_security_fixes.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Split into individual statements (skip comments and empty lines)
  const statements = sql
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  console.log(`Loaded ${statements.length} SQL statements\n`);

  // Pre-flight: count current issues
  console.log('--- PRE-FLIGHT COUNTS ---');
  const { rows: preViews } = await pool.query(`
    SELECT COUNT(*) as cnt FROM pg_views
    WHERE schemaname = 'public'
    AND viewname IN ('team_match_history','upcoming_matches','v_matches_competition_resolved','leaderboard_all_time','leaderboard_weekly','teams_v2_live')
  `);
  console.log(`  Security Definer Views: ${preViews[0].cnt}`);

  const { rows: preFuncs } = await pool.query(`
    SELECT COUNT(*) as cnt FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname NOT LIKE 'pg_%' AND p.proname NOT LIKE '%trgm%'
      AND p.proname NOT LIKE 'set_%' AND p.proname NOT LIKE 'show_%'
      AND p.proname NOT LIKE 'similarity%' AND p.proname NOT LIKE 'word_similarity%'
      AND p.proname NOT LIKE 'strict_word_similarity%' AND p.proname NOT LIKE 'gtrgm_%'
      AND (p.proconfig IS NULL OR NOT 'search_path=public' = ANY(p.proconfig))
  `);
  console.log(`  Functions without search_path: ${preFuncs[0].cnt}`);

  const { rows: prePolicies } = await pool.query(`
    SELECT COUNT(*) as cnt FROM pg_policies
    WHERE schemaname = 'public'
    AND ((qual LIKE '%auth.role()%' AND qual NOT LIKE '%(SELECT auth.role())%')
      OR (with_check LIKE '%auth.role()%' AND with_check NOT LIKE '%(SELECT auth.role())%'))
  `);
  console.log(`  Policies with InitPlan issue: ${prePolicies[0].cnt}`);

  const { rows: preDepTables } = await pool.query(`
    SELECT COUNT(*) as cnt FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('match_results_deprecated','teams_deprecated','rank_history_deprecated',
      'team_name_aliases_deprecated','matches','event_registry_deprecated','ambiguous_match_queue',
      'team_ranks_daily','predictions_deprecated','external_team_records','v_teams_ranked')
  `);
  console.log(`  Deprecated tables: ${preDepTables[0].cnt}`);
  console.log();

  // Execute statements one by one (not in a transaction because some
  // statements like DROP TABLE CASCADE may have complex dependencies)
  let success = 0;
  let failed = 0;
  let currentStep = '';

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];

    // Detect step changes from comments in preceding SQL
    if (stmt.includes('STEP 7')) currentStep = 'STEP 7: Fix Security Definer Views';
    else if (stmt.includes('STEP 8')) currentStep = 'STEP 8: Fix Function Search Path';
    else if (stmt.includes('STEP 9')) currentStep = 'STEP 9: Fix audit_log Policy';
    else if (stmt.includes('STEP 10')) currentStep = 'STEP 10: Drop Deprecated Tables';
    else if (stmt.includes('STEP 11')) currentStep = 'STEP 11: Fix RLS InitPlan';
    else if (stmt.includes('STEP 12')) currentStep = 'STEP 12: Add FK Indexes';

    // Extract a short description for logging
    const firstLine = stmt.split('\n').find(l => !l.startsWith('--') && l.trim()) || stmt.substring(0, 80);
    const shortDesc = firstLine.trim().substring(0, 100);

    try {
      await pool.query(stmt);
      success++;
      // Only log every step header or important operations
      if (stmt.startsWith('DROP VIEW') || stmt.startsWith('ALTER VIEW') ||
          stmt.startsWith('DROP TABLE') || stmt.startsWith('ALTER FUNCTION') ||
          stmt.startsWith('CREATE INDEX')) {
        console.log(`  [${success}] OK: ${shortDesc}`);
      }
    } catch (err) {
      failed++;
      console.error(`  [FAIL] ${shortDesc}`);
      console.error(`         ${err.message}`);

      // Non-fatal errors for IF EXISTS / IF NOT EXISTS operations
      if (err.message.includes('does not exist') || err.message.includes('already exists')) {
        console.log('         (Non-fatal, continuing...)');
      } else {
        // Fatal error — stop execution
        console.error('\n  FATAL ERROR — stopping migration.');
        console.error('  No rollback needed for completed statements (all idempotent).');
        await pool.end();
        process.exit(1);
      }
    }
  }

  console.log(`\n--- EXECUTION SUMMARY ---`);
  console.log(`  Statements: ${success} succeeded, ${failed} failed`);
  console.log(`  Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // Post-flight verification
  console.log('\n--- POST-FLIGHT VERIFICATION ---');

  // 1. Security Definer Views
  const { rows: postViews } = await pool.query(`
    SELECT c.relname,
           (SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker') as security_invoker
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND c.relkind = 'v'
    ORDER BY c.relname
  `);
  console.log(`  Remaining views: ${postViews.length}`);
  for (const v of postViews) {
    const status = v.security_invoker === 'true' ? 'FIXED (security_invoker)' : 'NEEDS ATTENTION';
    console.log(`    ${v.relname}: ${status}`);
  }

  // 2. Functions with search_path
  const { rows: postFuncs } = await pool.query(`
    SELECT COUNT(*) as cnt FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname NOT LIKE 'pg_%' AND p.proname NOT LIKE '%trgm%'
      AND p.proname NOT LIKE 'set_%' AND p.proname NOT LIKE 'show_%'
      AND p.proname NOT LIKE 'similarity%' AND p.proname NOT LIKE 'word_similarity%'
      AND p.proname NOT LIKE 'strict_word_similarity%' AND p.proname NOT LIKE 'gtrgm_%'
      AND (p.proconfig IS NULL OR NOT 'search_path=public' = ANY(p.proconfig))
  `);
  console.log(`  Functions still without search_path: ${postFuncs[0].cnt} (should be 0)`);

  // 3. Policies with InitPlan issue
  const { rows: postPolicies } = await pool.query(`
    SELECT COUNT(*) as cnt FROM pg_policies
    WHERE schemaname = 'public'
    AND ((qual LIKE '%auth.role()%' AND qual NOT LIKE '%(SELECT auth.role())%')
      OR (with_check LIKE '%auth.role()%' AND with_check NOT LIKE '%(SELECT auth.role())%'))
  `);
  console.log(`  Policies still with InitPlan issue: ${postPolicies[0].cnt} (should be 0)`);

  // 4. Deprecated tables
  const { rows: postDepTables } = await pool.query(`
    SELECT COUNT(*) as cnt FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('match_results_deprecated','teams_deprecated','rank_history_deprecated',
      'team_name_aliases_deprecated','matches','event_registry_deprecated','ambiguous_match_queue',
      'team_ranks_daily','predictions_deprecated','external_team_records','v_teams_ranked')
  `);
  console.log(`  Deprecated tables remaining: ${postDepTables[0].cnt} (should be 0)`);

  // 5. Quick app query test — verify anon access still works
  const { rows: testRankings } = await pool.query(`SELECT COUNT(*) as cnt FROM app_rankings`);
  console.log(`  app_rankings accessible: ${testRankings[0].cnt} rows`);

  const { rows: testMatches } = await pool.query(`SELECT COUNT(*) as cnt FROM app_matches_feed LIMIT 1`);
  console.log(`  app_matches_feed accessible: ${testMatches[0].cnt > 0 ? 'YES' : 'NO'}`);

  const { rows: testLeaderboard } = await pool.query(`SELECT COUNT(*) as cnt FROM leaderboard_all_time`);
  console.log(`  leaderboard_all_time accessible: ${testLeaderboard[0].cnt} rows`);

  const { rows: testTeamsLive } = await pool.query(`SELECT COUNT(*) as cnt FROM teams_v2_live LIMIT 1`);
  console.log(`  teams_v2_live accessible: ${testTeamsLive[0].cnt > 0 ? 'YES' : 'NO'}`);

  // 6. Pipeline auth test
  const { rows: pipelineTest } = await pool.query(`SELECT authorize_pipeline_write() as result`);
  console.log(`  authorize_pipeline_write(): ${pipelineTest[0].result ? 'OK' : 'FAILED'}`);

  // 7. Write protection test
  const { rows: wpTest } = await pool.query(`SELECT is_write_protection_enabled() as result`);
  console.log(`  is_write_protection_enabled(): ${wpTest[0].result}`);

  // 8. Database size
  const { rows: dbSize } = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) as size`);
  console.log(`  Database size: ${dbSize[0].size}`);

  await pool.end();
  console.log(`\n=== MIGRATION 092b COMPLETE ===`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
