#!/usr/bin/env node
/**
 * Verify the QC fix for "0 Teams" bug.
 * Checks all 3 screen queries match what the app would see.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verify() {
  console.log('=== QC Fix Verification ===\n');

  // 1. Home screen team count (has_matches = true)
  const { rows: homeTeams } = await pool.query(
    "SELECT COUNT(*) as total FROM app_rankings WHERE has_matches = true"
  );
  console.log('1. Home screen team count (has_matches=true):', homeTeams[0].total);

  // 2. Rankings - SoccerView mode (has_matches = true, ordered by elo)
  const { rows: svRankings } = await pool.query(
    "SELECT COUNT(*) as total FROM app_rankings WHERE has_matches = true"
  );
  console.log('2. Rankings (SoccerView mode) count:', svRankings[0].total);

  // 3. Rankings - GotSport mode (national_rank IS NOT NULL)
  const { rows: gsRankings } = await pool.query(
    "SELECT COUNT(*) as total FROM app_rankings WHERE national_rank IS NOT NULL"
  );
  console.log('3. Rankings (GotSport mode) count:', gsRankings[0].total);

  // 4. Teams screen (has_matches = true)
  const { rows: teamsScreen } = await pool.query(
    "SELECT COUNT(*) as total FROM app_rankings WHERE has_matches = true"
  );
  console.log('4. Teams screen count:', teamsScreen[0].total);

  // 5. ELO distribution
  const { rows: elo } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE elo_rating != 1500) as custom_elo,
      COUNT(*) FILTER (WHERE matches_played > 0) as with_matches,
      MIN(elo_rating) as min_elo,
      MAX(elo_rating) as max_elo,
      ROUND(AVG(elo_rating)::numeric, 1) as avg_elo
    FROM teams_v2
  `);
  console.log('\n5. teams_v2 ELO stats:', elo[0]);

  // 6. Matches feed count
  const { rows: matchFeed } = await pool.query(
    "SELECT COUNT(*) as total FROM app_matches_feed"
  );
  console.log('6. app_matches_feed rows:', matchFeed[0].total);

  // 7. Sample rankings by state
  const { rows: stateBreakdown } = await pool.query(`
    SELECT state, COUNT(*) as teams
    FROM app_rankings
    WHERE has_matches = true AND state IS NOT NULL
    GROUP BY state
    ORDER BY teams DESC
    LIMIT 10
  `);
  console.log('\n7. Top 10 states by team count:');
  stateBreakdown.forEach(r => console.log('  ', r.state, ':', r.teams));

  // 8. Top 5 ranked teams (sanity check)
  const { rows: top5 } = await pool.query(`
    SELECT display_name, elo_rating, national_rank, elo_national_rank, state, age_group
    FROM app_rankings
    WHERE has_matches = true
    ORDER BY elo_rating DESC
    LIMIT 5
  `);
  console.log('\n8. Top 5 ELO teams:');
  top5.forEach((r, i) => console.log(`   ${i+1}. ${r.display_name} | ELO: ${r.elo_rating} | Nat: ${r.national_rank} | ELO Nat: ${r.elo_national_rank} | ${r.state} ${r.age_group}`));

  // PASS/FAIL
  const teamCount = parseInt(homeTeams[0].total);
  console.log('\n=== RESULT ===');
  if (teamCount > 50000) {
    console.log('PASS: ' + teamCount + ' teams visible (expected 75K+)');
  } else if (teamCount > 0) {
    console.log('PARTIAL: ' + teamCount + ' teams visible (lower than expected)');
  } else {
    console.log('FAIL: 0 teams visible — issue not resolved');
  }

  await pool.end();
}

verify().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
