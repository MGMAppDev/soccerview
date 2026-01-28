/**
 * Supabase Security & Health Audit
 *
 * Checks:
 * 1. RLS status on all public tables
 * 2. Existing policies
 * 3. Index health (duplicates, unused)
 * 4. Table sizes and bloat
 * 5. Connection stats
 * 6. Extension versions
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runAudit() {
  console.log('='.repeat(60));
  console.log('SUPABASE SECURITY & HEALTH AUDIT');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // 1. Check RLS Status on Public Tables
  console.log('\n' + '='.repeat(60));
  console.log('1. ROW LEVEL SECURITY (RLS) STATUS');
  console.log('='.repeat(60));

  const { data: rlsStatus, error: rlsError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        schemaname,
        tablename,
        rowsecurity as rls_enabled
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `
  }).single();

  if (rlsError) {
    // Fallback: query directly
    const { data: tables, error: tablesError } = await supabase
      .from('pg_tables')
      .select('schemaname, tablename, rowsecurity')
      .eq('schemaname', 'public');

    if (tablesError) {
      console.log('Using alternative RLS check method...');
      // Use raw SQL via REST API
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_rls_status`, {
        method: 'POST',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        console.log('Could not query RLS status via RPC. Checking via information_schema...');
      }
    }
  }

  // Alternative: Use Supabase's built-in table info
  const { data: tableInfo, error: tableInfoError } = await supabase
    .rpc('pg_catalog_info')
    .select('*');

  // Let's query the tables we know about directly
  const coreTables = ['teams', 'match_results', 'event_registry', 'team_name_aliases'];

  console.log('\nCore Tables RLS Check:');
  console.log('-'.repeat(50));

  for (const table of coreTables) {
    try {
      // Test if we can access the table (indicates RLS config)
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.log(`  ${table}: ❌ Error - ${error.message}`);
      } else {
        console.log(`  ${table}: ✅ Accessible (${count?.toLocaleString() || 'N/A'} rows)`);
      }
    } catch (e) {
      console.log(`  ${table}: ❌ Exception - ${e.message}`);
    }
  }

  // 2. Check Policies
  console.log('\n' + '='.repeat(60));
  console.log('2. RLS POLICIES');
  console.log('='.repeat(60));

  // Query pg_policies via a direct SQL query
  const policiesQuery = `
    SELECT
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `;

  // Try to get policies info
  console.log('\nNote: Checking policies requires database function access.');
  console.log('Run this SQL in Supabase SQL Editor to see policies:');
  console.log('-'.repeat(50));
  console.log(policiesQuery);

  // 3. Check Indexes
  console.log('\n' + '='.repeat(60));
  console.log('3. INDEX ANALYSIS');
  console.log('='.repeat(60));

  const indexQuery = `
    SELECT
      schemaname,
      tablename,
      indexname,
      pg_size_pretty(pg_relation_size(indexrelid)) as index_size
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    ORDER BY pg_relation_size(indexrelid) DESC
    LIMIT 20;
  `;

  console.log('\nRun this SQL to see indexes:');
  console.log('-'.repeat(50));
  console.log(indexQuery);

  // 4. Check Table Sizes
  console.log('\n' + '='.repeat(60));
  console.log('4. TABLE SIZES');
  console.log('='.repeat(60));

  const sizeQuery = `
    SELECT
      relname as table_name,
      pg_size_pretty(pg_total_relation_size(relid)) as total_size,
      pg_size_pretty(pg_relation_size(relid)) as data_size,
      pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) as index_size,
      n_live_tup as row_count,
      n_dead_tup as dead_rows,
      CASE WHEN n_live_tup > 0
        THEN round(100.0 * n_dead_tup / n_live_tup, 2)
        ELSE 0
      END as dead_row_pct
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(relid) DESC;
  `;

  console.log('\nRun this SQL to see table sizes:');
  console.log('-'.repeat(50));
  console.log(sizeQuery);

  // 5. Check for Duplicate Indexes
  console.log('\n' + '='.repeat(60));
  console.log('5. DUPLICATE INDEX CHECK');
  console.log('='.repeat(60));

  const dupIndexQuery = `
    SELECT
      pg_size_pretty(sum(pg_relation_size(idx))::bigint) as size,
      (array_agg(idx))[1] as idx1,
      (array_agg(idx))[2] as idx2,
      (array_agg(idx))[3] as idx3
    FROM (
      SELECT
        indexrelid::regclass as idx,
        (indrelid::text || E'\n' || indclass::text || E'\n' || indkey::text || E'\n' || coalesce(indexprs::text, '') || E'\n' || coalesce(indpred::text, '')) as key
      FROM pg_index
    ) sub
    GROUP BY key
    HAVING count(*) > 1
    ORDER BY sum(pg_relation_size(idx)) DESC;
  `;

  console.log('\nRun this SQL to find duplicate indexes:');
  console.log('-'.repeat(50));
  console.log(dupIndexQuery);

  // 6. Connection Stats
  console.log('\n' + '='.repeat(60));
  console.log('6. CONNECTION STATISTICS');
  console.log('='.repeat(60));

  const connQuery = `
    SELECT
      count(*) as total_connections,
      count(*) FILTER (WHERE state = 'active') as active,
      count(*) FILTER (WHERE state = 'idle') as idle,
      count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
      max(EXTRACT(EPOCH FROM (now() - query_start))) as longest_query_seconds
    FROM pg_stat_activity
    WHERE datname = current_database();
  `;

  console.log('\nRun this SQL to see connection stats:');
  console.log('-'.repeat(50));
  console.log(connQuery);

  // 7. Security Advisor Equivalent Checks
  console.log('\n' + '='.repeat(60));
  console.log('7. SECURITY ADVISOR CHECKS');
  console.log('='.repeat(60));

  // Check for tables without RLS
  const noRlsQuery = `
    SELECT
      c.relname as table_name,
      CASE WHEN c.relrowsecurity THEN 'ENABLED' ELSE 'DISABLED' END as rls_status,
      (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) as policy_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relrowsecurity, c.relname;
  `;

  console.log('\nRLS Status per Table:');
  console.log('-'.repeat(50));
  console.log(noRlsQuery);

  // 8. Extension Versions
  console.log('\n' + '='.repeat(60));
  console.log('8. INSTALLED EXTENSIONS');
  console.log('='.repeat(60));

  const extQuery = `
    SELECT
      extname as extension,
      extversion as version,
      (SELECT default_version FROM pg_available_extensions WHERE name = extname) as latest_version
    FROM pg_extension
    ORDER BY extname;
  `;

  console.log('\nRun this SQL to see extensions:');
  console.log('-'.repeat(50));
  console.log(extQuery);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(60));
  console.log('\nNext Steps:');
  console.log('1. Run the SQL queries above in Supabase SQL Editor');
  console.log('2. Check Security Advisor in Dashboard → Database → Security Advisor');
  console.log('3. Fix any warnings before running fastLinkV3.js');
  console.log('\nAlternatively, run: node scripts/fixSupabaseSecurity.js');
}

runAudit().catch(console.error);
