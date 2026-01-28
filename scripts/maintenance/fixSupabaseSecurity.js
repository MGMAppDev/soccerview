/**
 * Fix Supabase Security Issues
 *
 * This script:
 * 1. Enables RLS on all public tables
 * 2. Creates read-only policies for public access (anon role)
 * 3. Creates full access policies for service role
 * 4. Runs VACUUM to reduce bloat
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Tables that need RLS enabled and policies created
const TABLES_TO_SECURE = [
  'teams',
  'event_registry',
  'clubs',
  'competitions',
  'leagues',
  'matches',
  'platform_registry',
  'scrape_targets',
  'source_weights',
  'team_aliases',
  'team_ranks_daily',
  'team_ratings_daily',
  'tournament_sources',
  'venue_geo',
  // Internal/admin tables - still need RLS for security
  'ambiguous_match_queue',
  'canonical_teams',
  'external_team_records',
  'ingestion_runs',
  'match_ingest_audit',
  'user_predictions',
  'v_teams_ranked'
];

// Tables that should be publicly readable (app needs these)
const PUBLIC_READ_TABLES = [
  'teams',
  'event_registry',
  'clubs',
  'competitions',
  'leagues',
  'matches',
  'platform_registry',
  'team_ranks_daily',
  'team_ratings_daily',
  'venue_geo'
];

// Tables that are internal/admin only (service role only)
const ADMIN_ONLY_TABLES = [
  'ambiguous_match_queue',
  'canonical_teams',
  'external_team_records',
  'ingestion_runs',
  'match_ingest_audit',
  'scrape_targets',
  'source_weights',
  'team_aliases',
  'tournament_sources',
  'user_predictions',
  'v_teams_ranked'
];

async function fixSecurity() {
  const client = await pool.connect();

  try {
    console.log('='.repeat(70));
    console.log('SUPABASE SECURITY FIX');
    console.log('='.repeat(70));
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    // Get current RLS status
    const rlsResult = await client.query(`
      SELECT
        c.relname as table_name,
        c.relrowsecurity as rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relname;
    `);

    const currentStatus = new Map(rlsResult.rows.map(r => [r.table_name, r.rls_enabled]));

    // 1. Enable RLS on tables that need it
    console.log('\n' + '─'.repeat(70));
    console.log('1. ENABLING ROW LEVEL SECURITY');
    console.log('─'.repeat(70));

    for (const table of TABLES_TO_SECURE) {
      if (!currentStatus.has(table)) {
        console.log(`  ⏭️  ${table}: Table not found, skipping`);
        continue;
      }

      if (currentStatus.get(table)) {
        console.log(`  ✅ ${table}: RLS already enabled`);
        continue;
      }

      try {
        await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
        console.log(`  ✅ ${table}: RLS ENABLED`);
      } catch (err) {
        console.log(`  ❌ ${table}: Failed - ${err.message}`);
      }
    }

    // 2. Create policies for public read tables
    console.log('\n' + '─'.repeat(70));
    console.log('2. CREATING PUBLIC READ POLICIES');
    console.log('─'.repeat(70));

    for (const table of PUBLIC_READ_TABLES) {
      if (!currentStatus.has(table)) {
        continue;
      }

      const policyName = `${table}_public_read`;

      // Check if policy exists
      const existingPolicy = await client.query(`
        SELECT 1 FROM pg_policy p
        JOIN pg_class c ON p.polrelid = c.oid
        WHERE c.relname = $1 AND p.polname = $2
      `, [table, policyName]);

      if (existingPolicy.rows.length > 0) {
        console.log(`  ✅ ${table}: Policy '${policyName}' already exists`);
        continue;
      }

      try {
        // Create SELECT policy for anon/authenticated roles
        await client.query(`
          CREATE POLICY "${policyName}" ON "${table}"
          FOR SELECT
          TO public
          USING (true);
        `);
        console.log(`  ✅ ${table}: Created '${policyName}' policy`);
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`  ✅ ${table}: Policy already exists (different name)`);
        } else {
          console.log(`  ❌ ${table}: Failed - ${err.message}`);
        }
      }
    }

    // 3. Create service role policies for all secured tables
    console.log('\n' + '─'.repeat(70));
    console.log('3. CREATING SERVICE ROLE POLICIES');
    console.log('─'.repeat(70));

    for (const table of TABLES_TO_SECURE) {
      if (!currentStatus.has(table)) {
        continue;
      }

      const policyName = `${table}_service_all`;

      // Check if policy exists
      const existingPolicy = await client.query(`
        SELECT 1 FROM pg_policy p
        JOIN pg_class c ON p.polrelid = c.oid
        WHERE c.relname = $1 AND p.polname = $2
      `, [table, policyName]);

      if (existingPolicy.rows.length > 0) {
        console.log(`  ✅ ${table}: Service policy already exists`);
        continue;
      }

      try {
        // Create ALL policy for service role
        await client.query(`
          CREATE POLICY "${policyName}" ON "${table}"
          FOR ALL
          TO service_role
          USING (true)
          WITH CHECK (true);
        `);
        console.log(`  ✅ ${table}: Created '${policyName}' policy`);
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`  ✅ ${table}: Service policy already exists (different name)`);
        } else {
          console.log(`  ❌ ${table}: Failed - ${err.message}`);
        }
      }
    }

    // 4. Run VACUUM on bloated tables
    console.log('\n' + '─'.repeat(70));
    console.log('4. CLEANING UP TABLE BLOAT (VACUUM)');
    console.log('─'.repeat(70));

    const bloatedTables = ['match_results', 'teams', 'event_registry', 'scrape_targets'];

    for (const table of bloatedTables) {
      try {
        console.log(`  🔄 ${table}: Running VACUUM ANALYZE...`);
        await client.query(`VACUUM ANALYZE "${table}";`);
        console.log(`  ✅ ${table}: VACUUM complete`);
      } catch (err) {
        console.log(`  ❌ ${table}: VACUUM failed - ${err.message}`);
      }
    }

    // 5. Verify final state
    console.log('\n' + '─'.repeat(70));
    console.log('5. VERIFICATION');
    console.log('─'.repeat(70));

    const finalRls = await client.query(`
      SELECT
        c.relname as table_name,
        CASE WHEN c.relrowsecurity THEN '✅' ELSE '❌' END as rls,
        (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) as policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN (${TABLES_TO_SECURE.map((_, i) => `$${i + 1}`).join(', ')})
      ORDER BY c.relname;
    `, TABLES_TO_SECURE);

    console.log('\n  Table                    RLS    Policies');
    console.log('  ' + '-'.repeat(45));
    let allGood = true;
    for (const row of finalRls.rows) {
      console.log(`  ${row.table_name.padEnd(25)} ${row.rls}     ${row.policies}`);
      if (row.rls === '❌' || row.policies === 0) {
        allGood = false;
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(70));
    console.log('SECURITY FIX COMPLETE');
    console.log('═'.repeat(70));

    if (allGood) {
      console.log('\n  ✅ All tables secured with RLS and policies!');
    } else {
      console.log('\n  ⚠️  Some tables may still need attention.');
    }

    console.log('\n  Next Steps:');
    console.log('  1. Check Supabase Dashboard → Security Advisor for remaining warnings');
    console.log('  2. Run: node scripts/fastLinkV3.js');
    console.log('\n' + '═'.repeat(70));

  } finally {
    client.release();
    await pool.end();
  }
}

fixSecurity().catch(err => {
  console.error('Security fix failed:', err.message);
  process.exit(1);
});
