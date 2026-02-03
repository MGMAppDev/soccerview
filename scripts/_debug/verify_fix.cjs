/**
 * Verify the fix: Check that Sporting BV Pre-NAL 15 now has 8 league matches
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const TEAM_ID = 'cc329f08-1f57-4a7b-923a-768b2138fa92'; // Sporting BV Pre-NAL 15

async function run() {
  const client = await pool.connect();
  try {
    console.log('='.repeat(70));
    console.log('VERIFICATION: Sporting BV Pre-NAL 15 League Matches');
    console.log('='.repeat(70));

    // 1. Check matches_v2 for this team's league matches
    console.log('\n1. matches_v2 - All league matches for Sporting BV Pre-NAL 15:');
    const { rows: matches } = await client.query(`
      SELECT
        m.match_date,
        m.home_score,
        m.away_score,
        ht.display_name as home_team,
        at.display_name as away_team
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      WHERE (m.home_team_id = $1 OR m.away_team_id = $1)
        AND m.league_id IS NOT NULL
      ORDER BY m.match_date
    `, [TEAM_ID]);

    console.log(`  Total league matches: ${matches.length}`);
    matches.forEach((m, i) => {
      const dateStr = new Date(m.match_date).toISOString().split('T')[0];
      const marker = dateStr === '2025-09-14' ? '⭐ NEW' : '      ';
      console.log(`  ${marker} ${dateStr}: ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
    });

    // 2. Check app_team_profile for the team
    console.log('\n2. app_team_profile - Leagues for this team:');
    const { rows: profile } = await client.query(`
      SELECT
        display_name,
        leagues,
        matches_played
      FROM app_team_profile
      WHERE id = $1
    `, [TEAM_ID]);

    if (profile.length > 0) {
      console.log(`  Team: ${profile[0].display_name}`);
      console.log(`  Total matches played: ${profile[0].matches_played}`);
      const leagues = profile[0].leagues || [];
      console.log(`  Leagues: ${leagues.length}`);
      leagues.forEach(l => {
        console.log(`    - ${l.name} (${l.match_count} matches)`);
      });
    }

    // 3. Check app_league_standings
    console.log('\n3. app_league_standings - This team\'s standing:');
    const { rows: standings } = await client.query(`
      SELECT
        team_name,
        league_name,
        played,
        wins,
        draws,
        losses,
        goals_for,
        goals_against,
        points,
        position
      FROM app_league_standings
      WHERE team_id = $1
    `, [TEAM_ID]);

    if (standings.length > 0) {
      const s = standings[0];
      console.log(`  Team: ${s.team_name}`);
      console.log(`  League: ${s.league_name}`);
      console.log(`  Position: ${s.position}`);
      console.log(`  Games Played: ${s.played}`);
      console.log(`  Record: ${s.wins}W-${s.draws}D-${s.losses}L`);
      console.log(`  Goals: ${s.goals_for} for, ${s.goals_against} against`);
      console.log(`  Points: ${s.points}`);
    } else {
      console.log('  ❌ Not found in league standings');
    }

    console.log('\n' + '='.repeat(70));
    if (matches.length >= 8) {
      console.log('✅ FIX VERIFIED: Team now has ' + matches.length + ' league matches!');
    } else {
      console.log('⚠️ Expected 8 matches, found ' + matches.length);
    }
    console.log('='.repeat(70));

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
