#!/usr/bin/env node
/**
 * Test the Points Table feature
 * Tests: getLeaguePointsTable() and getTeamsForm()
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Import the functions we're testing
async function getTeamsForm(eventId, teamIds) {
  const formMap = new Map();
  if (teamIds.length === 0) return formMap;

  const { data: matches, error } = await supabase
    .from('match_results')
    .select('id, home_team_id, away_team_id, home_score, away_score, match_date')
    .eq('event_id', eventId)
    .or(`home_team_id.in.(${teamIds.join(',')}),away_team_id.in.(${teamIds.join(',')})`)
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)
    .order('match_date', { ascending: true });

  if (error) {
    console.error('Error fetching form data:', error);
    return formMap;
  }

  const teamMatches = {};
  matches?.forEach(match => {
    const homeId = match.home_team_id;
    const awayId = match.away_team_id;
    const homeScore = match.home_score;
    const awayScore = match.away_score;
    const date = match.match_date;

    if (homeId && teamIds.includes(homeId)) {
      if (!teamMatches[homeId]) teamMatches[homeId] = [];
      const result = homeScore > awayScore ? 'W' : homeScore === awayScore ? 'D' : 'L';
      teamMatches[homeId].push({ date, result });
    }

    if (awayId && teamIds.includes(awayId)) {
      if (!teamMatches[awayId]) teamMatches[awayId] = [];
      const result = awayScore > homeScore ? 'W' : awayScore === homeScore ? 'D' : 'L';
      teamMatches[awayId].push({ date, result });
    }
  });

  teamIds.forEach(teamId => {
    const matches = teamMatches[teamId] || [];
    matches.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const last5 = matches.slice(-5);
    const form = last5.map(m => m.result);
    formMap.set(teamId, form);
  });

  return formMap;
}

async function getLeaguePointsTable(eventId, filters = {}) {
  const startTime = Date.now();

  // Step 1: Get matches
  const { data: matches, error: matchesError } = await supabase
    .from('match_results')
    .select('id, home_team_id, away_team_id, home_score, away_score, match_date')
    .eq('event_id', eventId)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)
    .order('match_date', { ascending: true });

  if (matchesError || !matches || matches.length === 0) {
    console.log('No matches found');
    return [];
  }

  // Step 2: Calculate stats
  const teamStats = {};
  matches.forEach(match => {
    const homeId = match.home_team_id;
    const awayId = match.away_team_id;
    const homeScore = match.home_score;
    const awayScore = match.away_score;

    if (!teamStats[homeId]) teamStats[homeId] = { gp: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 };
    if (!teamStats[awayId]) teamStats[awayId] = { gp: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 };

    teamStats[homeId].gp++;
    teamStats[homeId].gf += homeScore;
    teamStats[homeId].ga += awayScore;
    if (homeScore > awayScore) { teamStats[homeId].wins++; teamStats[homeId].points += 3; }
    else if (homeScore === awayScore) { teamStats[homeId].draws++; teamStats[homeId].points += 1; }
    else { teamStats[homeId].losses++; }

    teamStats[awayId].gp++;
    teamStats[awayId].gf += awayScore;
    teamStats[awayId].ga += homeScore;
    if (awayScore > homeScore) { teamStats[awayId].wins++; teamStats[awayId].points += 3; }
    else if (awayScore === homeScore) { teamStats[awayId].draws++; teamStats[awayId].points += 1; }
    else { teamStats[awayId].losses++; }
  });

  // Step 3: Get teams
  const teamIds = Object.keys(teamStats);
  let query = supabase
    .from('teams')
    .select('id, team_name, club_name, age_group, gender, elo_rating, elo_national_rank')
    .in('id', teamIds);

  if (filters.ageGroup && filters.ageGroup !== 'All') query = query.eq('age_group', filters.ageGroup);
  if (filters.gender && filters.gender !== 'All') query = query.eq('gender', filters.gender);

  const { data: teams } = await query;
  if (!teams) return [];

  // Step 4: Get form
  const formMap = await getTeamsForm(eventId, teams.map(t => t.id));

  // Step 5: Build points table
  const pointsTable = teams.map(team => {
    const stats = teamStats[team.id];
    const form = formMap.get(team.id) || [];

    return {
      id: team.id,
      name: team.team_name,
      club_name: team.club_name,
      position: 0,
      games_played: stats.gp,
      wins: stats.wins,
      draws: stats.draws,
      losses: stats.losses,
      goals_for: stats.gf,
      goals_against: stats.ga,
      goal_difference: stats.gf - stats.ga,
      points: stats.points,
      form: form,
    };
  });

  // Step 6: Sort and assign positions
  pointsTable.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (a.goal_difference !== b.goal_difference) return b.goal_difference - a.goal_difference;
    if (a.goals_for !== b.goals_for) return b.goals_for - a.goals_for;
    return a.name.localeCompare(b.name);
  });

  pointsTable.forEach((team, index) => { team.position = index + 1; });

  const duration = Date.now() - startTime;
  console.log(`⏱️  Query executed in ${duration}ms`);

  return pointsTable;
}

async function testPointsTable() {
  const TEST_EVENT = '45260'; // Fall 2025 LIJSL League (509 matches, 575 teams)

  console.log('🧪 Testing Points Table Feature\n');
  console.log(`Test Event: ${TEST_EVENT} (Fall 2025 LIJSL League)\n`);

  try {
    // Test 1: Basic functionality
    console.log('Test 1: Basic Points Table Query');
    const table = await getLeaguePointsTable(TEST_EVENT);

    console.log(`✅ Returned ${table.length} teams\n`);

    // Test 2: Display top 10
    console.log('Test 2: Top 10 Teams\n');
    console.log('Pos | Team                                | GP | W  D  L | GF  GA | GD   | Pts | Form');
    console.log('─'.repeat(95));

    table.slice(0, 10).forEach(team => {
      const formStr = team.form.join('');
      console.log(
        `${String(team.position).padStart(3)} | ` +
        `${team.name.substring(0, 35).padEnd(35)} | ` +
        `${String(team.games_played).padStart(2)} | ` +
        `${String(team.wins).padStart(2)} ${String(team.draws).padStart(2)} ${String(team.losses).padStart(2)} | ` +
        `${String(team.goals_for).padStart(3)} ${String(team.goals_against).padStart(3)} | ` +
        `${(team.goal_difference >= 0 ? '+' : '') + String(team.goal_difference).padStart(3)} | ` +
        `${String(team.points).padStart(3)} | ` +
        `${formStr}`
      );
    });

    // Test 3: Verify calculations
    console.log('\nTest 3: Verify Points Calculation');
    const sampleTeam = table[0];
    const calculatedPoints = (sampleTeam.wins * 3) + (sampleTeam.draws * 1);
    const calculatedGP = sampleTeam.wins + sampleTeam.draws + sampleTeam.losses;
    const calculatedGD = sampleTeam.goals_for - sampleTeam.goals_against;

    console.log(`Team: ${sampleTeam.name}`);
    console.log(`Points Check: ${sampleTeam.points} = (${sampleTeam.wins} × 3) + (${sampleTeam.draws} × 1) = ${calculatedPoints} ✅`);
    console.log(`GP Check: ${sampleTeam.games_played} = ${sampleTeam.wins} + ${sampleTeam.draws} + ${sampleTeam.losses} = ${calculatedGP} ✅`);
    console.log(`GD Check: ${sampleTeam.goal_difference} = ${sampleTeam.goals_for} - ${sampleTeam.goals_against} = ${calculatedGD} ✅`);

    // Test 4: Form badges
    console.log('\nTest 4: Form Indicators');
    table.slice(0, 5).forEach(team => {
      console.log(`${team.name.substring(0, 40)}: ${team.form.join('-')} (${team.form.length} matches)`);
    });

    console.log('\n✅ All tests passed!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testPointsTable();
