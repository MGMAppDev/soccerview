/**
 * Quick Supabase Health Verification
 *
 * Run after fixSupabaseSecurity.js to confirm everything is ready
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verify() {
  const client = await pool.connect();

  try {
    console.log('='.repeat(70));
    console.log('SUPABASE HEALTH VERIFICATION');
    console.log('='.repeat(70));
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    // 1. RLS Summary
    const rlsSummary = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE relrowsecurity) as rls_enabled,
        COUNT(*) FILTER (WHERE NOT relrowsecurity) as rls_disabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r';
    `);

    const rls = rlsSummary.rows[0];
    console.log('RLS Status:');
    console.log(`  ✅ Tables with RLS enabled:  ${rls.rls_enabled}`);
    console.log(`  ❌ Tables with RLS disabled: ${rls.rls_disabled}`);

    // 2. Policy Count
    const policyCount = await client.query(`
      SELECT COUNT(*) as count FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public';
    `);
    console.log(`\nPolicies: ${policyCount.rows[0].count} total`);

    // 3. Table Sizes (after VACUUM)
    const sizes = await client.query(`
      SELECT
        relname,
        pg_size_pretty(pg_total_relation_size(relid)) as size,
        n_dead_tup as dead_rows
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 5;
    `);

    console.log('\nTop 5 Tables by Size (after VACUUM):');
    for (const row of sizes.rows) {
      const deadStatus = row.dead_rows > 1000 ? `⚠️ ${row.dead_rows}` : `✅ ${row.dead_rows}`;
      console.log(`  ${row.relname.padEnd(25)} ${row.size.padEnd(12)} Dead: ${deadStatus}`);
    }

    // 4. Connection Stats
    const conn = await client.query(`
      SELECT
        count(*) as total,
        count(*) FILTER (WHERE state = 'active') as active,
        count(*) FILTER (WHERE state = 'idle') as idle
      FROM pg_stat_activity
      WHERE datname = current_database();
    `);
    const c = conn.rows[0];
    console.log(`\nConnections: ${c.total} total (${c.active} active, ${c.idle} idle)`);

    // 5. Key Settings
    const settings = await client.query(`
      SELECT name, setting, unit
      FROM pg_settings
      WHERE name IN ('statement_timeout', 'max_connections');
    `);

    console.log('\nKey Settings:');
    for (const row of settings.rows) {
      const val = row.unit ? `${row.setting} ${row.unit}` : row.setting;
      console.log(`  ${row.name}: ${val}`);
    }

    // 6. Check critical tables for fastLinkV3
    console.log('\n' + '─'.repeat(70));
    console.log('CRITICAL TABLES FOR fastLinkV3.js');
    console.log('─'.repeat(70));

    const criticalTables = ['match_results', 'teams', 'team_name_aliases'];
    for (const table of criticalTables) {
      const result = await client.query(`
        SELECT
          c.relrowsecurity as rls,
          (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) as policies,
          (SELECT count(*) FROM "${table}") as rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1;
      `, [table]);

      if (result.rows.length > 0) {
        const r = result.rows[0];
        const rlsStatus = r.rls ? '✅ RLS' : '❌ NO RLS';
        console.log(`  ${table.padEnd(25)} ${rlsStatus}  ${r.policies} policies  ${parseInt(r.rows).toLocaleString()} rows`);
      }
    }

    // 7. Unlinked matches count
    const unlinked = await client.query(`
      SELECT COUNT(*) as count
      FROM match_results
      WHERE home_team_id IS NULL OR away_team_id IS NULL;
    `);
    console.log(`\n  Unlinked matches to process: ${parseInt(unlinked.rows[0].count).toLocaleString()}`);

    // Overall assessment
    console.log('\n' + '═'.repeat(70));
    console.log('ASSESSMENT');
    console.log('═'.repeat(70));

    const issues = [];
    if (parseInt(rls.rls_disabled) > 0) {
      issues.push(`${rls.rls_disabled} tables still have RLS disabled`);
    }
    if (parseInt(c.total) > 50) {
      issues.push(`High connection count: ${c.total}`);
    }

    if (issues.length === 0) {
      console.log('\n  ✅ DATABASE IS HEALTHY AND READY FOR fastLinkV3.js');
      console.log('\n  Run: node scripts/fastLinkV3.js');
    } else {
      console.log('\n  ⚠️  Issues found:');
      for (const issue of issues) {
        console.log(`     - ${issue}`);
      }
    }

    console.log('\n' + '═'.repeat(70));

  } finally {
    client.release();
    await pool.end();
  }
}

verify().catch(err => {
  console.error('Verification failed:', err.message);
  process.exit(1);
});
