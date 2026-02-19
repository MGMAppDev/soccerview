/**
 * End-to-end verification for Session 115 metadata fixes.
 * Verifies all 7 gaps are resolved + measures improvement.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('='.repeat(70));
  console.log('SESSION 115 — END-TO-END VERIFICATION');
  console.log('='.repeat(70));

  // 1. League state coverage
  const { rows: [ls] } = await pool.query(`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE state IS NOT NULL) as has_state,
           COUNT(*) FILTER (WHERE state IS NULL) as null_state
    FROM leagues
  `);
  console.log(`\n1. LEAGUE STATE: ${ls.has_state}/${ls.total} have state (${(ls.has_state/ls.total*100).toFixed(1)}%) | ${ls.null_state} NULL`);

  // 2. League season_id coverage
  const { rows: [lsid] } = await pool.query(`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE season_id IS NOT NULL) as has_season,
           COUNT(*) FILTER (WHERE season_id IS NULL) as null_season
    FROM leagues
  `);
  console.log(`2. LEAGUE SEASON_ID: ${lsid.has_season}/${lsid.total} have season (${(lsid.has_season/lsid.total*100).toFixed(1)}%) | ${lsid.null_season} NULL`);

  // 3. Tournament state coverage
  const { rows: [ts] } = await pool.query(`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE state IS NOT NULL) as has_state,
           COUNT(*) FILTER (WHERE state IS NULL) as null_state
    FROM tournaments
  `);
  console.log(`3. TOURNAMENT STATE: ${ts.has_state}/${ts.total} have state (${(ts.has_state/ts.total*100).toFixed(1)}%) | ${ts.null_state} NULL`);

  // 4. SEM coverage
  const { rows: semRows } = await pool.query(`
    SELECT entity_type, COUNT(*) as cnt FROM source_entity_map GROUP BY entity_type ORDER BY entity_type
  `);
  console.log(`4. SOURCE_ENTITY_MAP:`);
  semRows.forEach(r => console.log(`   ${r.entity_type}: ${r.cnt}`));

  // 5. Team counts by state (TN/NM specifically)
  const { rows: tnNm } = await pool.query(`
    SELECT state, COUNT(*) as cnt, COUNT(*) FILTER (WHERE matches_played > 0) as with_matches
    FROM teams_v2 WHERE state IN ('TN', 'NM') GROUP BY state ORDER BY state
  `);
  console.log(`5. TN/NM TEAMS:`);
  tnNm.forEach(r => console.log(`   ${r.state}: ${r.cnt} total, ${r.with_matches} with matches`));

  // 6. Match counts
  const { rows: [mc] } = await pool.query(`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE deleted_at IS NULL) as active
    FROM matches_v2
  `);
  console.log(`6. MATCHES: ${mc.active} active (${mc.total} total incl soft-deleted)`);

  // 7. Standings summary
  const { rows: [sc] } = await pool.query(`SELECT COUNT(*) as cnt FROM league_standings`);
  const { rows: [su] } = await pool.query(`SELECT COUNT(*) as cnt FROM staging_standings WHERE processed = false`);
  console.log(`7. STANDINGS: ${sc.cnt} production | ${su.cnt} unprocessed`);

  // 8. ELO coverage
  const { rows: [elo] } = await pool.query(`
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE elo_rating IS NOT NULL AND elo_rating != 1500) as has_elo,
           COUNT(*) FILTER (WHERE elo_national_rank IS NOT NULL) as has_national_rank,
           COUNT(*) FILTER (WHERE matches_played > 0) as with_matches
    FROM teams_v2
  `);
  console.log(`8. ELO: ${elo.has_elo} teams with non-default ELO | ${elo.has_national_rank} with national rank | ${elo.with_matches} with matches`);

  // 9. Forward-prevention check: fastProcessStaging.cjs creates events with state
  console.log(`\n9. FORWARD-PREVENTION:`);
  const { readFileSync } = require('fs');
  const fps = readFileSync('./scripts/maintenance/fastProcessStaging.cjs', 'utf8');
  const dqe = readFileSync('./scripts/universal/dataQualityEngine.js', 'utf8');

  console.log(`   fastProcessStaging.cjs:`);
  console.log(`     - staging_events fetches state: ${fps.includes('event_type, state FROM staging_events') ? '✅' : '❌'}`);
  console.log(`     - League INSERT includes state: ${fps.includes('leagues (name, source_event_id, source_platform, state, season_id)') ? '✅' : '❌'}`);
  console.log(`     - Tournament INSERT includes state: ${fps.includes("tournaments (name, source_event_id, source_platform, start_date, end_date, state)") ? '✅' : '❌'}`);
  console.log(`     - SEM registration after creation: ${fps.includes("INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)") ? '✅' : '❌'}`);

  console.log(`   dataQualityEngine.js:`);
  console.log(`     - League INSERT includes state+season: ${dqe.includes('leagues (name, source_event_id, source_platform, state, season_id)') ? '✅' : '❌'}`);
  console.log(`     - Tournament uses match dates (no CURRENT_DATE): ${!dqe.includes('CURRENT_DATE, CURRENT_DATE') ? '✅' : '❌'}`);
  console.log(`     - Tournament INSERT includes state: ${dqe.includes("tournaments (name, source_event_id, source_platform, start_date, end_date, state)") ? '✅' : '❌'}`);

  // 10. Overall health summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log('='.repeat(70));
  const leaguePct = (ls.has_state / ls.total * 100).toFixed(1);
  const tournPct = (ts.has_state / ts.total * 100).toFixed(1);
  const seasonPct = (lsid.has_season / lsid.total * 100).toFixed(1);
  console.log(`  League state:     ${leaguePct}% (target: >90%) ${parseFloat(leaguePct) > 90 ? '✅' : '⚠️'}`);
  console.log(`  League season_id: ${seasonPct}% (target: >95%) ${parseFloat(seasonPct) > 95 ? '✅' : '⚠️'}`);
  console.log(`  Tournament state: ${tournPct}% (target: >90%) ${parseFloat(tournPct) > 90 ? '✅' : '⚠️'}`);
  console.log(`  Standings:        ${sc.cnt} (target: >30K) ${parseInt(sc.cnt) > 30000 ? '✅' : '⚠️'}`);
  console.log(`  Unprocessed:      ${su.cnt} (target: 0) ${parseInt(su.cnt) === 0 ? '✅' : '⚠️'}`);
  console.log(`  Active matches:   ${mc.active}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
