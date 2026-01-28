/**
 * Data Integrity Validation Script
 * =================================
 *
 * Validates that match data is consistent across:
 * 1. Team Details page (matches linked via team_id)
 * 2. League Standings page (matches via event_id)
 * 3. Source data (Heartland Soccer League website)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TEAM_NAME = 'Sporting Blue Valley SPORTING BV Pre-NAL 15';
const HEARTLAND_EVENT_ID = 'heartland-league-2025';

async function validateDataIntegrity() {
  console.log('='.repeat(70));
  console.log('DATA INTEGRITY VALIDATION');
  console.log('='.repeat(70));
  console.log(`Team: ${TEAM_NAME}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  // ============================================================
  // SOURCE 1: Team Details Page (matches linked via team_id)
  // ============================================================
  console.log('📋 SOURCE 1: Team Details Page (linked matches)');
  console.log('-'.repeat(70));

  // Find the team
  const { data: teams } = await supabase
    .from('teams')
    .select('id, team_name, matches_played, wins, losses, draws')
    .ilike('team_name', `%${TEAM_NAME}%`)
    .limit(1);

  if (!teams || teams.length === 0) {
    console.log('❌ Team not found!');
    return;
  }

  const team = teams[0];
  console.log(`Team ID: ${team.id}`);
  console.log(`Team Name: ${team.team_name}`);
  console.log(`DB Stats: ${team.matches_played} matches, ${team.wins}W-${team.losses}L-${team.draws || 0}D`);

  // Get all matches linked to this team
  const { data: homeMatches } = await supabase
    .from('match_results')
    .select('*')
    .eq('home_team_id', team.id)
    .order('match_date', { ascending: true });

  const { data: awayMatches } = await supabase
    .from('match_results')
    .select('*')
    .eq('away_team_id', team.id)
    .order('match_date', { ascending: true });

  const linkedMatches = [...(homeMatches || []), ...(awayMatches || [])];
  linkedMatches.sort((a, b) => new Date(a.match_date) - new Date(b.match_date));

  console.log(`\nLinked matches: ${linkedMatches.length}`);
  console.log('\nMatch List (Team Details view):');
  linkedMatches.forEach((m, i) => {
    const isHome = m.home_team_id === team.id;
    const opponent = isHome ? m.away_team_name : m.home_team_name;
    const score = m.home_score !== null ? `${m.home_score}-${m.away_score}` : 'TBD';
    const result = getResult(m, team.id);
    console.log(`  ${i + 1}. ${m.match_date} | ${m.home_team_name} vs ${m.away_team_name} | ${score} | ${result}`);
  });

  // Calculate actual stats from matches
  let calcWins = 0, calcLosses = 0, calcDraws = 0;
  linkedMatches.forEach(m => {
    if (m.home_score === null || m.away_score === null) return;
    const isHome = m.home_team_id === team.id;
    const teamScore = isHome ? m.home_score : m.away_score;
    const oppScore = isHome ? m.away_score : m.home_score;
    if (teamScore > oppScore) calcWins++;
    else if (teamScore < oppScore) calcLosses++;
    else calcDraws++;
  });
  console.log(`\nCalculated from matches: ${linkedMatches.length} matches, ${calcWins}W-${calcLosses}L-${calcDraws}D`);

  // ============================================================
  // SOURCE 2: League Standings Page (matches via event_id)
  // ============================================================
  console.log('\n\n📋 SOURCE 2: League Standings Page (event_id matches)');
  console.log('-'.repeat(70));

  // Get Heartland league matches for this team BY EVENT_ID
  const { data: leagueMatches } = await supabase
    .from('match_results')
    .select('*')
    .eq('event_id', HEARTLAND_EVENT_ID)
    .or(`home_team_name.ilike.%Pre-NAL 15%,away_team_name.ilike.%Pre-NAL 15%`)
    .order('match_date', { ascending: true });

  // Filter to just this team (case-insensitive match on "Sporting" + "Pre-NAL 15")
  const teamLeagueMatches = (leagueMatches || []).filter(m =>
    (m.home_team_name?.toLowerCase().includes('sporting') && m.home_team_name?.toLowerCase().includes('pre-nal 15')) ||
    (m.away_team_name?.toLowerCase().includes('sporting') && m.away_team_name?.toLowerCase().includes('pre-nal 15'))
  );

  console.log(`Event ID: ${HEARTLAND_EVENT_ID}`);
  console.log(`League matches for team: ${teamLeagueMatches.length}`);
  console.log('\nMatch List (League Standings view):');
  teamLeagueMatches.forEach((m, i) => {
    const score = m.home_score !== null ? `${m.home_score}-${m.away_score}` : 'TBD';
    console.log(`  ${i + 1}. ${m.match_date} | ${m.home_team_name} vs ${m.away_team_name} | ${score}`);
  });

  // ============================================================
  // SOURCE 3: Raw database matches by team name (no links)
  // ============================================================
  console.log('\n\n📋 SOURCE 3: Raw matches by team name (no ID links)');
  console.log('-'.repeat(70));

  const { data: rawMatches } = await supabase
    .from('match_results')
    .select('*')
    .or(`home_team_name.ilike.%SPORTING BV Pre-NAL 15%,away_team_name.ilike.%SPORTING BV Pre-NAL 15%`)
    .order('match_date', { ascending: true });

  console.log(`Raw matches by name: ${rawMatches?.length || 0}`);
  console.log('\nMatch List (by team name):');
  rawMatches?.forEach((m, i) => {
    const score = m.home_score !== null ? `${m.home_score}-${m.away_score}` : 'TBD';
    const linked = (m.home_team_id === team.id || m.away_team_id === team.id) ? '✅' : '❌';
    console.log(`  ${i + 1}. ${m.match_date} | ${m.home_team_name} vs ${m.away_team_name} | ${score} | Linked: ${linked}`);
  });

  // ============================================================
  // ANALYSIS: Compare all sources
  // ============================================================
  console.log('\n\n' + '='.repeat(70));
  console.log('ANALYSIS: Cross-Source Comparison');
  console.log('='.repeat(70));

  const linkedIds = new Set(linkedMatches.map(m => m.id));
  const leagueIds = new Set(teamLeagueMatches.map(m => m.id));
  const rawIds = new Set(rawMatches?.map(m => m.id) || []);

  // Find matches in raw but not linked
  const unlinkedMatches = rawMatches?.filter(m => !linkedIds.has(m.id)) || [];
  console.log(`\n⚠️  Matches in DB by name but NOT linked to team: ${unlinkedMatches.length}`);
  unlinkedMatches.forEach(m => {
    console.log(`   - ${m.match_date}: ${m.home_team_name} vs ${m.away_team_name}`);
    console.log(`     home_team_id: ${m.home_team_id || 'NULL'}, away_team_id: ${m.away_team_id || 'NULL'}`);
  });

  // Find linked matches not in league
  const linkedNotInLeague = linkedMatches.filter(m => m.event_id !== HEARTLAND_EVENT_ID);
  console.log(`\n📋 Linked matches NOT in Heartland League event: ${linkedNotInLeague.length}`);
  linkedNotInLeague.forEach(m => {
    console.log(`   - ${m.match_date}: ${m.home_team_name} vs ${m.away_team_name} (event: ${m.event_id || 'NULL'})`);
  });

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`1. Team Details (linked):     ${linkedMatches.length} matches`);
  console.log(`2. League Standings (event):  ${teamLeagueMatches.length} matches`);
  console.log(`3. Raw by name (all):         ${rawMatches?.length || 0} matches`);
  console.log(`\nDiscrepancies:`);
  console.log(`   - Unlinked matches: ${unlinkedMatches.length}`);
  console.log(`   - Non-league linked: ${linkedNotInLeague.length}`);

  if (unlinkedMatches.length === 0 && linkedMatches.length === rawMatches?.length) {
    console.log('\n✅ DATA INTEGRITY CHECK PASSED');
  } else {
    console.log('\n❌ DATA INTEGRITY ISSUES FOUND');
  }

  return {
    team,
    linkedMatches,
    teamLeagueMatches,
    rawMatches,
    unlinkedMatches
  };
}

function getResult(match, teamId) {
  if (match.home_score === null || match.away_score === null) return '-';
  const isHome = match.home_team_id === teamId;
  const teamScore = isHome ? match.home_score : match.away_score;
  const oppScore = isHome ? match.away_score : match.home_score;
  if (teamScore > oppScore) return 'W';
  if (teamScore < oppScore) return 'L';
  return 'D';
}

validateDataIntegrity();
