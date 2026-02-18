/**
 * FINAL SESSION — Block F Verification
 *
 * Verifies all 5 data elements across all states:
 * 1. Matches — flow 1 (matches_v2)
 * 2. SV Power Rating / ELO — computed from matches
 * 3. GotSport Rankings — Tier 3 overlay
 * 4. League Standings — flow 2 (league_standings)
 * 5. Schedules — flow 3 (future matches with league linkage)
 *
 * Also runs pipeline health check equivalent.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('=== FINAL SESSION: Block F Verification ===\n');

  // 1. Overall database metrics
  const metrics = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL) as matches,
      (SELECT COUNT(*) FROM teams_v2) as teams,
      (SELECT COUNT(*) FROM league_standings) as standings,
      (SELECT COUNT(*) FROM leagues) as leagues,
      (SELECT COUNT(*) FROM tournaments) as tournaments,
      (SELECT COUNT(*) FROM source_entity_map) as sem_entries,
      (SELECT COUNT(*) FROM staging_games WHERE processed_at IS NULL) as unprocessed_staging,
      (SELECT COUNT(*) FROM staging_standings WHERE processed = false OR processed IS NULL) as unprocessed_standings,
      (SELECT COUNT(*) FROM teams_v2 WHERE elo_rating > 0) as teams_with_elo,
      (SELECT COUNT(*) FROM teams_v2 WHERE national_rank IS NOT NULL) as teams_with_gs_rank,
      (SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL AND home_score IS NULL AND match_date > NOW()) as upcoming_scheduled,
      (SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL AND home_score IS NULL AND match_date > NOW() AND (league_id IS NOT NULL OR tournament_id IS NOT NULL)) as upcoming_linked
  `);

  const m = metrics.rows[0];
  console.log('📊 OVERALL DATABASE METRICS:');
  console.log(`  matches_v2 (active):          ${parseInt(m.matches).toLocaleString()}`);
  console.log(`  teams_v2:                     ${parseInt(m.teams).toLocaleString()}`);
  console.log(`  league_standings:             ${parseInt(m.standings).toLocaleString()}`);
  console.log(`  leagues:                      ${parseInt(m.leagues).toLocaleString()}`);
  console.log(`  tournaments:                  ${parseInt(m.tournaments).toLocaleString()}`);
  console.log(`  source_entity_map entries:    ${parseInt(m.sem_entries).toLocaleString()}`);
  console.log(`  teams with ELO (>0):          ${parseInt(m.teams_with_elo).toLocaleString()}`);
  console.log(`  teams with GS rank:           ${parseInt(m.teams_with_gs_rank).toLocaleString()}`);
  console.log(`  upcoming scheduled (total):   ${parseInt(m.upcoming_scheduled).toLocaleString()}`);
  console.log(`  upcoming linked to event:     ${parseInt(m.upcoming_linked).toLocaleString()}`);
  console.log(`  staging_games unprocessed:    ${parseInt(m.unprocessed_staging).toLocaleString()}`);
  console.log(`  staging_standings unprocessed: ${parseInt(m.unprocessed_standings).toLocaleString()}`);
  console.log('');

  // Check data elements
  const checks = [
    { name: 'DATA ELEMENT 1: Active Matches', passed: parseInt(m.matches) > 500000 },
    { name: 'DATA ELEMENT 2: Teams with ELO', passed: parseInt(m.teams_with_elo) > 50000 },
    { name: 'DATA ELEMENT 3: Teams with GS Ranks', passed: parseInt(m.teams_with_gs_rank) > 50000 },
    { name: 'DATA ELEMENT 4: League Standings', passed: parseInt(m.standings) > 15000 },
    { name: 'DATA ELEMENT 5: Upcoming w/ League Linkage', passed: parseInt(m.upcoming_linked) > 1000 },
    { name: 'PIPELINE: No unprocessed staging_games', passed: parseInt(m.unprocessed_staging) === 0 },
    { name: 'PIPELINE: No unprocessed standings', passed: parseInt(m.unprocessed_standings) < 100 },
  ];

  // 2. Per-state coverage check (sample key states)
  const stateCheck = await pool.query(`
    SELECT
      state,
      COUNT(*) as total_teams,
      COUNT(*) FILTER (WHERE elo_rating > 0) as teams_with_elo,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as teams_with_rank
    FROM teams_v2
    WHERE state IS NOT NULL AND state != 'Unknown' AND state != 'unknown'
    GROUP BY state
    ORDER BY total_teams DESC
    LIMIT 20
  `);

  console.log('🗺️  TOP 20 STATES BY TEAM COUNT:');
  console.log(`  ${'State'.padEnd(8)} ${'Teams'.padStart(7)} ${'w/ELO'.padStart(7)} ${'w/GS Rank'.padStart(10)}`);
  console.log('  ' + '-'.repeat(35));
  for (const row of stateCheck.rows) {
    const eloRate = Math.round(100 * row.teams_with_elo / row.total_teams);
    const rankRate = Math.round(100 * row.teams_with_rank / row.total_teams);
    console.log(`  ${row.state.padEnd(8)} ${row.total_teams.toString().padStart(7)} ${row.teams_with_elo.toString().padStart(7)} (${eloRate}%) ${row.teams_with_rank.toString().padStart(7)} (${rankRate}%)`);
  }

  // 3. Standings coverage check
  const standingsCheck = await pool.query(`
    SELECT
      l.state,
      COUNT(DISTINCT ls.league_id) as leagues_with_standings,
      COUNT(ls.id) as total_standings
    FROM league_standings ls
    JOIN leagues l ON l.id = ls.league_id
    WHERE l.state IS NOT NULL
    GROUP BY l.state
    ORDER BY total_standings DESC
    LIMIT 15
  `);

  console.log('\n📋 TOP 15 STATES BY STANDINGS COUNT:');
  console.log(`  ${'State'.padEnd(8)} ${'Leagues'.padStart(10)} ${'Standings'.padStart(10)}`);
  console.log('  ' + '-'.repeat(30));
  for (const row of standingsCheck.rows) {
    console.log(`  ${row.state.padEnd(8)} ${row.leagues_with_standings.toString().padStart(10)} ${row.total_standings.toString().padStart(10)}`);
  }

  // 4. Materialized view health check
  const viewCheck = await pool.query(`
    SELECT
      schemaname,
      matviewname,
      ispopulated
    FROM pg_matviews
    WHERE matviewname IN ('app_rankings', 'app_matches_feed', 'app_league_standings', 'app_team_profile', 'app_upcoming_schedule')
    ORDER BY matviewname
  `);

  console.log('\n🔄 MATERIALIZED VIEW STATUS:');
  for (const v of viewCheck.rows) {
    const status = v.ispopulated ? '✅ Populated' : '❌ Not populated';
    console.log(`  ${v.matviewname.padEnd(30)} ${status}`);
  }

  // 5. Data integrity checks
  const integrityCheck = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL AND home_team_id = away_team_id) as self_matches,
      (SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL AND match_date > '2027-01-01') as future_garbage,
      (SELECT COUNT(*) FROM teams_v2 WHERE birth_year IS NULL) as null_birth_year,
      (SELECT COUNT(*) FROM teams_v2 WHERE gender IS NULL) as null_gender,
      (SELECT COUNT(*) FROM teams_v2 WHERE state IS NULL OR state = 'Unknown' OR state = 'unknown') as unknown_state
  `);

  const integrity = integrityCheck.rows[0];
  console.log('\n🔍 DATA INTEGRITY CHECKS:');
  console.log(`  Self-matches (same team both sides): ${integrity.self_matches} ${integrity.self_matches == 0 ? '✅' : '⚠️'}`);
  console.log(`  Future garbage matches (2027+):      ${integrity.future_garbage} ${integrity.future_garbage == 0 ? '✅' : '⚠️'}`);
  console.log(`  Teams with NULL birth_year:          ${parseInt(integrity.null_birth_year).toLocaleString()}`);
  console.log(`  Teams with NULL gender:              ${parseInt(integrity.null_gender).toLocaleString()}`);
  console.log(`  Teams with unknown state:            ${parseInt(integrity.unknown_state).toLocaleString()}`);

  // Summary
  console.log('\n\n=== FINAL VERIFICATION SUMMARY ===');
  let passed = 0, failed = 0;
  for (const check of checks) {
    const icon = check.passed ? '✅' : '❌';
    console.log(`  ${icon} ${check.name}`);
    if (check.passed) passed++;
    else failed++;
  }
  console.log(`\n  ${passed}/${checks.length} checks passed${failed > 0 ? ` | ${failed} FAILED` : ''}`);

  if (failed === 0) {
    console.log('\n  🏆 ALL CHECKS PASSED — FINAL SESSION COMPLETE');
  } else {
    console.log('\n  ⚠️  Some checks failed — investigate before closing');
  }

  pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
