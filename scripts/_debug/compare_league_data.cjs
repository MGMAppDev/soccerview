/**
 * Cross-comparison: League games in Team Details vs League Standings
 *
 * Compares:
 * 1. Recent Matches in app_team_profile (Team Details page)
 * 2. League Standings data (app_league_standings)
 * 3. Raw matches_v2 data for this team + league
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const TEAM_ID = 'cc329f08-1f57-4a7b-923a-768b2138fa92'; // Sporting BV Pre-NAL 15
const TEAM_NAME = 'Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)';

async function run() {
  const client = await pool.connect();
  try {
    console.log('=' .repeat(70));
    console.log('CROSS-COMPARISON: League Games Data Accuracy');
    console.log('Team:', TEAM_NAME);
    console.log('=' .repeat(70));

    // =========================================================================
    // 1. Get data from app_team_profile (what Team Details page shows)
    // =========================================================================
    console.log('\n📱 SOURCE 1: app_team_profile (Team Details Page)\n');

    const { rows: profileRows } = await client.query(`
      SELECT
        id,
        display_name,
        leagues,
        recent_matches
      FROM app_team_profile
      WHERE id = $1
    `, [TEAM_ID]);

    if (profileRows.length === 0) {
      console.log('  ❌ Team not found in app_team_profile!');
      return;
    }

    const profile = profileRows[0];
    const leagues = profile.leagues || [];
    const recentMatches = profile.recent_matches || [];

    console.log('  Team:', profile.display_name);
    console.log('  Leagues in profile:', leagues.length);

    leagues.forEach(l => {
      console.log(`    - ${l.name} (${l.match_count} matches)`);
    });

    // Filter recent_matches to only league matches (not tournaments)
    const leagueMatches = recentMatches.filter(m => m.league_id && !m.tournament_id);
    const tournamentMatches = recentMatches.filter(m => m.tournament_id);
    const unlinkedMatches = recentMatches.filter(m => !m.league_id && !m.tournament_id);

    console.log('\n  Recent Matches breakdown:');
    console.log(`    Total matches: ${recentMatches.length}`);
    console.log(`    League matches: ${leagueMatches.length}`);
    console.log(`    Tournament matches: ${tournamentMatches.length}`);
    console.log(`    Unlinked matches: ${unlinkedMatches.length}`);

    // Group league matches by league
    const matchesByLeague = {};
    leagueMatches.forEach(m => {
      const key = m.league_id;
      if (!matchesByLeague[key]) {
        matchesByLeague[key] = { name: m.event_name, matches: [] };
      }
      matchesByLeague[key].matches.push(m);
    });

    console.log('\n  League matches grouped:');
    for (const [leagueId, data] of Object.entries(matchesByLeague)) {
      console.log(`    ${data.name}: ${data.matches.length} matches`);
    }

    // =========================================================================
    // 2. Get data from app_league_standings (what League Standings page shows)
    // =========================================================================
    console.log('\n📊 SOURCE 2: app_league_standings (League Standings Page)\n');

    // Get the league ID from the profile
    const leagueId = leagues[0]?.id;
    if (!leagueId) {
      console.log('  ❌ No league found in profile!');
    } else {
      const { rows: standingsRows } = await client.query(`
        SELECT
          team_id,
          team_name,
          display_name,
          league_id,
          league_name,
          played,
          wins,
          draws,
          losses,
          goals_for,
          goals_against,
          goal_difference,
          points,
          position
        FROM app_league_standings
        WHERE team_id = $1 AND league_id = $2
      `, [TEAM_ID, leagueId]);

      if (standingsRows.length === 0) {
        console.log(`  ❌ Team not found in app_league_standings for league ${leagueId}!`);
      } else {
        const standing = standingsRows[0];
        console.log('  League:', standing.league_name);
        console.log('  Team:', standing.display_name);
        console.log('  Position:', standing.position);
        console.log('  Games Played:', standing.played);
        console.log('  Record:', `${standing.wins}W-${standing.draws}D-${standing.losses}L`);
        console.log('  Goals:', `${standing.goals_for} for, ${standing.goals_against} against (${standing.goal_difference >= 0 ? '+' : ''}${standing.goal_difference} GD)`);
        console.log('  Points:', standing.points);
      }
    }

    // =========================================================================
    // 3. Get raw data from matches_v2 (ground truth)
    // =========================================================================
    console.log('\n🔍 SOURCE 3: matches_v2 (Raw Database - Ground Truth)\n');

    const { rows: rawMatches } = await client.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,
        m.home_team_id,
        m.away_team_id,
        m.league_id,
        m.tournament_id,
        ht.display_name as home_team_name,
        at.display_name as away_team_name,
        COALESCE(l.name, t.name, 'Unlinked') as event_name,
        CASE
          WHEN m.league_id IS NOT NULL THEN 'league'
          WHEN m.tournament_id IS NOT NULL THEN 'tournament'
          ELSE 'unlinked'
        END as event_type
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      LEFT JOIN leagues l ON m.league_id = l.id
      LEFT JOIN tournaments t ON m.tournament_id = t.id
      WHERE m.home_team_id = $1 OR m.away_team_id = $1
      ORDER BY m.match_date DESC
    `, [TEAM_ID]);

    const rawLeagueMatches = rawMatches.filter(m => m.event_type === 'league');
    const rawTournamentMatches = rawMatches.filter(m => m.event_type === 'tournament');
    const rawUnlinkedMatches = rawMatches.filter(m => m.event_type === 'unlinked');

    console.log(`  Total matches: ${rawMatches.length}`);
    console.log(`  League matches: ${rawLeagueMatches.length}`);
    console.log(`  Tournament matches: ${rawTournamentMatches.length}`);
    console.log(`  Unlinked matches: ${rawUnlinkedMatches.length}`);

    // Group by event
    const rawByEvent = {};
    rawMatches.forEach(m => {
      const key = m.league_id || m.tournament_id || 'unlinked';
      if (!rawByEvent[key]) {
        rawByEvent[key] = { name: m.event_name, type: m.event_type, matches: [] };
      }
      rawByEvent[key].matches.push(m);
    });

    console.log('\n  Grouped by event:');
    for (const [eventId, data] of Object.entries(rawByEvent)) {
      console.log(`    ${data.name} [${data.type}]: ${data.matches.length} matches`);
    }

    // =========================================================================
    // 4. COMPARISON SUMMARY
    // =========================================================================
    console.log('\n' + '=' .repeat(70));
    console.log('COMPARISON SUMMARY');
    console.log('=' .repeat(70));

    const heartlandLeagueId = leagueId;

    // Count league matches from each source
    const profileLeagueCount = matchesByLeague[heartlandLeagueId]?.matches.length || 0;
    const standingsLeagueCount = (await client.query(`
      SELECT played FROM app_league_standings WHERE team_id = $1 AND league_id = $2
    `, [TEAM_ID, heartlandLeagueId])).rows[0]?.played || 0;
    const rawLeagueCount = rawByEvent[heartlandLeagueId]?.matches.length || 0;

    console.log('\n  Heartland Premier League 2025 match counts:');
    console.log(`    Team Details (recent_matches): ${profileLeagueCount} matches`);
    console.log(`    League Standings (played):     ${standingsLeagueCount} matches`);
    console.log(`    Raw matches_v2:                ${rawLeagueCount} matches`);

    // Check if they match
    if (profileLeagueCount === standingsLeagueCount && standingsLeagueCount === rawLeagueCount) {
      console.log('\n  ✅ ALL SOURCES MATCH! Data is consistent.');
    } else {
      console.log('\n  ⚠️ MISMATCH DETECTED!');
      if (profileLeagueCount !== rawLeagueCount) {
        console.log(`    - Team Details shows ${profileLeagueCount} but raw has ${rawLeagueCount}`);
      }
      if (standingsLeagueCount !== rawLeagueCount) {
        console.log(`    - League Standings shows ${standingsLeagueCount} but raw has ${rawLeagueCount}`);
      }
    }

    // =========================================================================
    // 5. DETAILED MATCH LIST
    // =========================================================================
    console.log('\n' + '=' .repeat(70));
    console.log('DETAILED LEAGUE MATCH LIST (Heartland Premier League 2025)');
    console.log('=' .repeat(70));

    const heartlandMatches = rawByEvent[heartlandLeagueId]?.matches || [];
    heartlandMatches.sort((a, b) => new Date(a.match_date) - new Date(b.match_date));

    console.log('\n  #  | Date       | Opponent                              | Score | Result');
    console.log('  ' + '-'.repeat(75));

    heartlandMatches.forEach((m, i) => {
      const isHome = m.home_team_id === TEAM_ID;
      const opponent = isHome ? m.away_team_name : m.home_team_name;
      const ourScore = isHome ? m.home_score : m.away_score;
      const theirScore = isHome ? m.away_score : m.home_score;
      const result = ourScore > theirScore ? 'W' : ourScore < theirScore ? 'L' : 'D';
      const homeAway = isHome ? '(H)' : '(A)';

      console.log(`  ${String(i + 1).padStart(2)} | ${m.match_date} | ${(opponent || 'Unknown').substring(0, 37).padEnd(37)} | ${ourScore}-${theirScore}   | ${result} ${homeAway}`);
    });

    // Calculate W-D-L
    let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
    heartlandMatches.forEach(m => {
      const isHome = m.home_team_id === TEAM_ID;
      const ourScore = isHome ? m.home_score : m.away_score;
      const theirScore = isHome ? m.away_score : m.home_score;

      if (ourScore !== null && theirScore !== null) {
        goalsFor += ourScore;
        goalsAgainst += theirScore;
        if (ourScore > theirScore) wins++;
        else if (ourScore < theirScore) losses++;
        else draws++;
      }
    });

    console.log('\n  CALCULATED TOTALS:');
    console.log(`    Games: ${heartlandMatches.length}`);
    console.log(`    Record: ${wins}W-${draws}D-${losses}L`);
    console.log(`    Goals: ${goalsFor} for, ${goalsAgainst} against (${goalsFor - goalsAgainst >= 0 ? '+' : ''}${goalsFor - goalsAgainst} GD)`);
    console.log(`    Points: ${wins * 3 + draws}`);

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
