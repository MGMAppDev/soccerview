#!/usr/bin/env node
/**
 * Diagnose why app_rankings materialized view returns 0 rows.
 * Read-only — no writes to any table.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function diagnose() {
  console.log('=== app_rankings Diagnostic ===\n');

  // 1. Does the view exist?
  const { rows: viewInfo } = await pool.query(`
    SELECT matviewname, hasindexes, ispopulated
    FROM pg_matviews WHERE matviewname = 'app_rankings'
  `);
  console.log('1. View existence:', viewInfo.length > 0 ? 'EXISTS' : 'MISSING');
  if (viewInfo.length > 0) {
    console.log('   hasindexes:', viewInfo[0].hasindexes);
    console.log('   ispopulated:', viewInfo[0].ispopulated);
  }

  if (viewInfo.length === 0) {
    console.log('\n>>> ROOT CAUSE: app_rankings view DOES NOT EXIST. Needs recreation from migration 023.');
    await pool.end();
    return;
  }

  // 2. Row count
  const { rows: countRows } = await pool.query('SELECT COUNT(*) as total FROM app_rankings');
  console.log('\n2. Total rows in app_rankings:', countRows[0].total);

  const { rows: matchRows } = await pool.query('SELECT COUNT(*) as total FROM app_rankings WHERE has_matches = true');
  console.log('   Rows with has_matches=true:', matchRows[0].total);

  const { rows: rankedRows } = await pool.query('SELECT COUNT(*) as total FROM app_rankings WHERE national_rank IS NOT NULL');
  console.log('   Rows with national_rank:', rankedRows[0].total);

  // 3. teams_v2 source table check
  const { rows: teamCount } = await pool.query('SELECT COUNT(*) as total FROM teams_v2');
  console.log('\n3. teams_v2 total rows:', teamCount[0].total);

  const { rows: teamMatches } = await pool.query('SELECT COUNT(*) as total FROM teams_v2 WHERE matches_played > 0');
  console.log('   teams_v2 with matches_played > 0:', teamMatches[0].total);

  // 4. Column check on view
  const { rows: viewCols } = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'app_rankings'
    ORDER BY ordinal_position
  `);
  console.log('\n4. app_rankings columns (' + viewCols.length + '):');
  viewCols.forEach(c => console.log('   ', c.column_name, '(' + c.data_type + ')'));

  const hasEloNatRank = viewCols.some(c => c.column_name === 'elo_national_rank');
  const hasEloStateRank = viewCols.some(c => c.column_name === 'elo_state_rank');
  console.log('   elo_national_rank present:', hasEloNatRank);
  console.log('   elo_state_rank present:', hasEloStateRank);

  // 5. Unique index check (required for CONCURRENTLY refresh)
  const { rows: indexes } = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'app_rankings'
  `);
  console.log('\n5. Indexes on app_rankings (' + indexes.length + '):');
  indexes.forEach(i => console.log('   ', i.indexname));

  const hasUniqueIndex = indexes.some(i => i.indexdef.includes('UNIQUE'));
  console.log('   Has UNIQUE index:', hasUniqueIndex);

  // 6. Permissions check
  const { rows: grants } = await pool.query(`
    SELECT grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_name = 'app_rankings'
    ORDER BY grantee, privilege_type
  `);
  console.log('\n6. Permissions on app_rankings:');
  if (grants.length === 0) {
    console.log('   >>> NO GRANTS FOUND — anon/authenticated cannot read!');
  } else {
    grants.forEach(g => console.log('   ', g.grantee, '→', g.privilege_type));
  }

  const anonHasSelect = grants.some(g => g.grantee === 'anon' && g.privilege_type === 'SELECT');
  const authHasSelect = grants.some(g => g.grantee === 'authenticated' && g.privilege_type === 'SELECT');
  console.log('   anon has SELECT:', anonHasSelect);
  console.log('   authenticated has SELECT:', authHasSelect);

  // 7. get_current_season_year() check
  try {
    const { rows: seasonRows } = await pool.query('SELECT get_current_season_year() as year');
    console.log('\n7. get_current_season_year():', seasonRows[0].year);
  } catch (e) {
    console.log('\n7. get_current_season_year() FAILED:', e.message);
  }

  // 8. Sample rows (if any)
  const { rows: sampleRows } = await pool.query(`
    SELECT id, display_name, elo_rating, national_rank, has_matches
    FROM app_rankings LIMIT 5
  `);
  console.log('\n8. Sample rows:', sampleRows.length > 0 ? '' : 'NONE');
  sampleRows.forEach(r => console.log('   ', r.display_name, '| elo:', r.elo_rating, '| rank:', r.national_rank, '| has_matches:', r.has_matches));

  // 9. app_matches_feed check (control — this one works)
  const { rows: matchFeedCount } = await pool.query('SELECT COUNT(*) as total FROM app_matches_feed');
  console.log('\n9. app_matches_feed rows (control):', matchFeedCount[0].total);

  // 10. Summary
  console.log('\n=== DIAGNOSIS SUMMARY ===');
  const total = parseInt(countRows[0].total);
  if (total === 0 && viewInfo[0].ispopulated) {
    console.log('>>> View EXISTS and is marked POPULATED but has 0 rows.');
    console.log('>>> Likely: View was refreshed when teams_v2 was empty, or refresh failed mid-way.');
    console.log('>>> FIX: REFRESH MATERIALIZED VIEW CONCURRENTLY app_rankings;');
  } else if (total === 0 && !viewInfo[0].ispopulated) {
    console.log('>>> View EXISTS but is NOT POPULATED.');
    console.log('>>> FIX: REFRESH MATERIALIZED VIEW app_rankings;');
  } else if (total > 0 && !anonHasSelect) {
    console.log('>>> View has ' + total + ' rows but anon role CANNOT read.');
    console.log('>>> FIX: GRANT SELECT ON app_rankings TO anon, authenticated;');
  } else if (total > 0 && !hasEloNatRank) {
    console.log('>>> View has rows but MISSING elo_national_rank column.');
    console.log('>>> FIX: Recreate view from migration 023 definition.');
  } else if (total > 0) {
    console.log('>>> View has ' + total + ' rows and appears healthy.');
    console.log('>>> Issue may be client-side (Supabase anon key, network, etc.).');
  }

  await pool.end();
}

diagnose().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
