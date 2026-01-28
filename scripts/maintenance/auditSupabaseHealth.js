/**
 * Supabase Health Audit - Direct Database Query
 *
 * Uses DATABASE_URL to run actual SQL queries and report findings
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runAudit() {
  const client = await pool.connect();

  try {
    console.log('='.repeat(70));
    console.log('SUPABASE HEALTH AUDIT - DIRECT DATABASE QUERY');
    console.log('='.repeat(70));
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    // 1. RLS Status
    console.log('\n' + '─'.repeat(70));
    console.log('1. ROW LEVEL SECURITY (RLS) STATUS');
    console.log('─'.repeat(70));

    const rlsResult = await client.query(`
      SELECT
        c.relname as table_name,
        CASE WHEN c.relrowsecurity THEN '✅ ENABLED' ELSE '❌ DISABLED' END as rls_status,
        (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.schemaname = 'public') as policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relrowsecurity DESC, c.relname;
    `);

    console.log('\n  Table                          RLS Status       Policies');
    console.log('  ' + '-'.repeat(60));
    let rlsIssues = [];
    for (const row of rlsResult.rows) {
      const status = row.rls_status.includes('ENABLED') ? '✅ ENABLED' : '❌ DISABLED';
      console.log(`  ${row.table_name.padEnd(30)} ${status.padEnd(15)} ${row.policy_count}`);
      if (!row.rls_status.includes('ENABLED')) {
        rlsIssues.push(row.table_name);
      }
    }

    // 2. Policies Detail
    console.log('\n' + '─'.repeat(70));
    console.log('2. RLS POLICIES DETAIL');
    console.log('─'.repeat(70));

    const policiesResult = await client.query(`
      SELECT
        polname as policyname,
        relname as tablename,
        CASE WHEN polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END as permissive,
        ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(polroles))::text as roles,
        CASE polcmd
          WHEN 'r' THEN 'SELECT'
          WHEN 'a' THEN 'INSERT'
          WHEN 'w' THEN 'UPDATE'
          WHEN 'd' THEN 'DELETE'
          WHEN '*' THEN 'ALL'
        END as cmd
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public'
      ORDER BY relname, polname;
    `);

    if (policiesResult.rows.length === 0) {
      console.log('\n  ⚠️  NO POLICIES FOUND - Tables may be unprotected!');
    } else {
      console.log('\n  Table                Policy Name                    Type    Roles       Command');
      console.log('  ' + '-'.repeat(85));
      for (const row of policiesResult.rows) {
        const permissive = row.permissive === 'PERMISSIVE' ? 'PERM' : 'REST';
        console.log(`  ${row.tablename.padEnd(20)} ${row.policyname.substring(0, 28).padEnd(30)} ${permissive.padEnd(7)} ${row.roles.substring(0, 10).padEnd(11)} ${row.cmd}`);
      }
    }

    // 3. Table Sizes
    console.log('\n' + '─'.repeat(70));
    console.log('3. TABLE SIZES & BLOAT');
    console.log('─'.repeat(70));

    const sizeResult = await client.query(`
      SELECT
        relname as table_name,
        pg_size_pretty(pg_total_relation_size(relid)) as total_size,
        pg_size_pretty(pg_relation_size(relid)) as data_size,
        n_live_tup as rows,
        n_dead_tup as dead_rows,
        CASE WHEN n_live_tup > 0
          THEN round(100.0 * n_dead_tup / n_live_tup, 1)
          ELSE 0
        END as bloat_pct
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 15;
    `);

    console.log('\n  Table                    Total Size    Data Size     Rows         Dead    Bloat%');
    console.log('  ' + '-'.repeat(80));
    let bloatIssues = [];
    for (const row of sizeResult.rows) {
      const bloatStatus = parseFloat(row.bloat_pct) > 10 ? '⚠️' : '  ';
      console.log(`  ${row.table_name.padEnd(25)} ${row.total_size.padEnd(12)} ${row.data_size.padEnd(12)} ${String(row.rows).padEnd(12)} ${String(row.dead_rows).padEnd(7)} ${bloatStatus}${row.bloat_pct}%`);
      if (parseFloat(row.bloat_pct) > 20) {
        bloatIssues.push(row.table_name);
      }
    }

    // 4. Index Analysis
    console.log('\n' + '─'.repeat(70));
    console.log('4. INDEX ANALYSIS (Top 20 by Size)');
    console.log('─'.repeat(70));

    const indexResult = await client.query(`
      SELECT
        schemaname,
        tablename,
        indexname,
        pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
        idx_scan as scans,
        idx_tup_read as tuples_read
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
      ORDER BY pg_relation_size(indexrelid) DESC
      LIMIT 20;
    `);

    console.log('\n  Table                Index Name                              Size       Scans');
    console.log('  ' + '-'.repeat(75));
    for (const row of indexResult.rows) {
      const scans = row.scans || 0;
      const scanStatus = scans === 0 ? '⚠️ 0' : String(scans);
      console.log(`  ${row.tablename.padEnd(20)} ${row.indexname.substring(0, 35).padEnd(37)} ${row.index_size.padEnd(10)} ${scanStatus}`);
    }

    // 5. Duplicate Indexes
    console.log('\n' + '─'.repeat(70));
    console.log('5. DUPLICATE INDEX CHECK');
    console.log('─'.repeat(70));

    const dupResult = await client.query(`
      SELECT
        pg_size_pretty(sum(pg_relation_size(idx))::bigint) as wasted_size,
        array_agg(idx::text) as duplicate_indexes
      FROM (
        SELECT
          indexrelid::regclass as idx,
          (indrelid::text || E'\\n' || indclass::text || E'\\n' || indkey::text || E'\\n' || coalesce(indexprs::text, '') || E'\\n' || coalesce(indpred::text, '')) as key
        FROM pg_index
        WHERE indrelid::regclass::text LIKE 'public.%' OR indrelid::regclass::text NOT LIKE '%.%'
      ) sub
      GROUP BY key
      HAVING count(*) > 1
      ORDER BY sum(pg_relation_size(idx)) DESC;
    `);

    if (dupResult.rows.length === 0) {
      console.log('\n  ✅ No duplicate indexes found');
    } else {
      console.log('\n  ⚠️  DUPLICATE INDEXES FOUND:');
      for (const row of dupResult.rows) {
        console.log(`\n  Wasted: ${row.wasted_size}`);
        console.log(`  Duplicates: ${row.duplicate_indexes.join(', ')}`);
      }
    }

    // 6. Connection Stats
    console.log('\n' + '─'.repeat(70));
    console.log('6. CONNECTION STATISTICS');
    console.log('─'.repeat(70));

    const connResult = await client.query(`
      SELECT
        count(*) as total,
        count(*) FILTER (WHERE state = 'active') as active,
        count(*) FILTER (WHERE state = 'idle') as idle,
        count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_txn,
        max(EXTRACT(EPOCH FROM (now() - query_start)))::int as longest_query_sec
      FROM pg_stat_activity
      WHERE datname = current_database();
    `);

    const conn = connResult.rows[0];
    console.log(`\n  Total Connections:     ${conn.total}`);
    console.log(`  Active:                ${conn.active}`);
    console.log(`  Idle:                  ${conn.idle}`);
    console.log(`  Idle in Transaction:   ${conn.idle_in_txn}`);
    console.log(`  Longest Query (sec):   ${conn.longest_query_sec || 0}`);

    // 7. Extensions
    console.log('\n' + '─'.repeat(70));
    console.log('7. INSTALLED EXTENSIONS');
    console.log('─'.repeat(70));

    const extResult = await client.query(`
      SELECT
        extname as name,
        extversion as version
      FROM pg_extension
      ORDER BY extname;
    `);

    console.log('\n  Extension                      Version');
    console.log('  ' + '-'.repeat(45));
    for (const row of extResult.rows) {
      const important = ['pg_trgm', 'uuid-ossp', 'pgcrypto'].includes(row.name) ? '★' : ' ';
      console.log(`  ${important}${row.name.padEnd(28)} ${row.version}`);
    }

    // 8. Settings Check
    console.log('\n' + '─'.repeat(70));
    console.log('8. DATABASE SETTINGS');
    console.log('─'.repeat(70));

    const settingsResult = await client.query(`
      SELECT name, setting, unit
      FROM pg_settings
      WHERE name IN (
        'statement_timeout',
        'max_connections',
        'work_mem',
        'maintenance_work_mem',
        'effective_cache_size',
        'shared_buffers'
      )
      ORDER BY name;
    `);

    console.log('\n  Setting                   Value');
    console.log('  ' + '-'.repeat(45));
    for (const row of settingsResult.rows) {
      const value = row.unit ? `${row.setting} ${row.unit}` : row.setting;
      console.log(`  ${row.name.padEnd(25)} ${value}`);
    }

    // Summary
    console.log('\n' + '═'.repeat(70));
    console.log('AUDIT SUMMARY');
    console.log('═'.repeat(70));

    const issues = [];
    if (rlsIssues.length > 0) {
      issues.push(`❌ RLS disabled on ${rlsIssues.length} tables: ${rlsIssues.join(', ')}`);
    }
    if (policiesResult.rows.length === 0) {
      issues.push('❌ No RLS policies defined');
    }
    if (bloatIssues.length > 0) {
      issues.push(`⚠️  High bloat on tables: ${bloatIssues.join(', ')}`);
    }
    if (dupResult.rows.length > 0) {
      issues.push(`⚠️  ${dupResult.rows.length} duplicate index group(s) found`);
    }

    if (issues.length === 0) {
      console.log('\n  ✅ Database appears healthy!');
    } else {
      console.log('\n  Issues Found:');
      for (const issue of issues) {
        console.log(`  ${issue}`);
      }
    }

    console.log('\n' + '═'.repeat(70));

  } finally {
    client.release();
    await pool.end();
  }
}

runAudit().catch(err => {
  console.error('Audit failed:', err.message);
  process.exit(1);
});
