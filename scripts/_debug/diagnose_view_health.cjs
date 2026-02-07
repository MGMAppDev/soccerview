/**
 * Diagnose View Health - Session 92 QC Part 2
 *
 * Checks:
 * - Row counts for all 5 materialized views
 * - Direct matches_v2 count (baseline DB health)
 * - Active locks / long-running queries
 * - Whether refresh_app_views() executes or fails
 * - View freshness (when were they last populated?)
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 30000, // 30s for diagnostics
});

async function main() {
  console.log('='.repeat(60));
  console.log('VIEW HEALTH DIAGNOSTIC');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const client = await pool.connect();

  try {
    // 1. Row counts for all materialized views
    console.log('--- Materialized View Row Counts ---');
    const views = [
      'app_rankings',
      'app_matches_feed',
      'app_team_profile',
      'app_upcoming_schedule',
      'app_league_standings',
    ];

    for (const view of views) {
      try {
        const { rows } = await client.query(`SELECT COUNT(*) as cnt FROM ${view}`);
        const status = parseInt(rows[0].cnt) > 0 ? 'OK' : 'EMPTY';
        console.log(`  ${view}: ${rows[0].cnt} rows [${status}]`);
      } catch (err) {
        console.log(`  ${view}: ERROR - ${err.message}`);
      }
    }

    // 2. Direct source table counts (baseline)
    console.log('\n--- Source Table Counts (Baseline) ---');
    const tables = [
      { name: 'teams_v2', query: "SELECT COUNT(*) as cnt FROM teams_v2" },
      { name: 'matches_v2 (active)', query: "SELECT COUNT(*) as cnt FROM matches_v2 WHERE deleted_at IS NULL" },
      { name: 'matches_v2 (with scores)', query: "SELECT COUNT(*) as cnt FROM matches_v2 WHERE deleted_at IS NULL AND home_score IS NOT NULL" },
      { name: 'leagues', query: "SELECT COUNT(*) as cnt FROM leagues" },
      { name: 'tournaments', query: "SELECT COUNT(*) as cnt FROM tournaments" },
      { name: 'league_standings', query: "SELECT COUNT(*) as cnt FROM league_standings" },
      { name: 'staging_standings', query: "SELECT COUNT(*) as cnt FROM staging_standings" },
    ];

    for (const t of tables) {
      try {
        const { rows } = await client.query(t.query);
        console.log(`  ${t.name}: ${rows[0].cnt}`);
      } catch (err) {
        console.log(`  ${t.name}: ERROR - ${err.message}`);
      }
    }

    // 3. Check for active locks / long-running queries
    console.log('\n--- Active Queries (> 5s) ---');
    try {
      const { rows } = await client.query(`
        SELECT pid, now() - pg_stat_activity.query_start AS duration,
               query, state
        FROM pg_stat_activity
        WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
          AND state != 'idle'
          AND pid != pg_backend_pid()
        ORDER BY duration DESC
        LIMIT 5
      `);
      if (rows.length === 0) {
        console.log('  No long-running queries found');
      } else {
        rows.forEach(r => {
          console.log(`  PID ${r.pid}: ${r.duration} | ${r.state} | ${r.query.substring(0, 80)}...`);
        });
      }
    } catch (err) {
      console.log(`  ERROR checking queries: ${err.message}`);
    }

    // 4. Test refresh_app_views() function
    console.log('\n--- Testing refresh_app_views() ---');
    try {
      await client.query('SELECT refresh_app_views()');
      console.log('  refresh_app_views(): SUCCESS');
    } catch (err) {
      console.log(`  refresh_app_views(): FAILED`);
      console.log(`  Error: ${err.message}`);
      if (err.message.includes('CONCURRENTLY')) {
        console.log('  ROOT CAUSE: CONCURRENTLY refresh on view without unique index');
        console.log('  FIX: Migration 095 will update refresh_app_views() to use non-concurrent for app_league_standings');
      }
    }

    // 5. Check if app_league_standings has a unique index
    console.log('\n--- app_league_standings Index Check ---');
    try {
      const { rows } = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'app_league_standings'
        ORDER BY indexname
      `);
      if (rows.length === 0) {
        console.log('  No indexes found on app_league_standings');
      } else {
        rows.forEach(r => {
          const isUnique = r.indexdef.includes('UNIQUE') ? '[UNIQUE]' : '[non-unique]';
          console.log(`  ${r.indexname} ${isUnique}`);
        });
      }
      const hasUnique = rows.some(r => r.indexdef.includes('UNIQUE'));
      if (!hasUnique) {
        console.log('  WARNING: No UNIQUE index → CONCURRENTLY refresh will fail');
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }

    // 6. Check RLS status on standings tables
    console.log('\n--- RLS Status on Standings Tables ---');
    try {
      const { rows } = await client.query(`
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('staging_standings', 'league_standings', 'favorites', 'predictions_v2')
        ORDER BY tablename
      `);
      rows.forEach(r => {
        const status = r.rowsecurity ? 'ENABLED' : 'DISABLED';
        const icon = r.rowsecurity ? 'OK' : 'WARNING';
        console.log(`  ${r.tablename}: RLS ${status} [${icon}]`);
      });
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }

    // 7. Quick sample queries (what the app does)
    console.log('\n--- App Query Simulation ---');

    // Home tab: team count
    try {
      const { rows } = await client.query(`
        SELECT COUNT(*) as cnt FROM app_rankings WHERE has_matches = true
      `);
      console.log(`  Home tab team count: ${rows[0].cnt}`);
    } catch (err) {
      console.log(`  Home tab team count: ERROR - ${err.message}`);
    }

    // Home tab: match count
    try {
      const { rows } = await client.query(`
        SELECT COUNT(*) as cnt FROM matches_v2
        WHERE deleted_at IS NULL AND home_score IS NOT NULL
      `);
      console.log(`  Home tab match count: ${rows[0].cnt}`);
    } catch (err) {
      console.log(`  Home tab match count: ERROR - ${err.message}`);
    }

    // Teams tab: app_rankings query
    try {
      const { rows } = await client.query(`
        SELECT COUNT(*) as cnt FROM app_rankings
      `);
      console.log(`  Teams tab rankings count: ${rows[0].cnt}`);
    } catch (err) {
      console.log(`  Teams tab rankings count: ERROR - ${err.message}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('DIAGNOSTIC COMPLETE');
    console.log('='.repeat(60));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
