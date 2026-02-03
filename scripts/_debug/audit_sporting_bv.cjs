require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function audit() {
  console.log('=== SPORTING BV PRE-NAL 15 DATA AUDIT ===\n');

  // 1. Find the team
  console.log('1. FINDING TEAM IN DATABASE...\n');
  const { data: teams, error: teamError } = await supabase
    .from('teams_v2')
    .select('id, display_name, canonical_name, birth_year, gender, club_id, elo_rating, elo_national_rank, state, matches_played')
    .ilike('display_name', '%Sporting%Pre-NAL%15%')
    .eq('birth_year', 2015);

  if (teamError) {
    console.error('Team query error:', teamError);
    return;
  }

  console.log('Teams found:', teams.length);
  for (const t of teams) {
    console.log('  - ' + t.display_name);
    console.log('    id: ' + t.id);
    console.log('    birth_year: ' + t.birth_year + ', matches_played: ' + t.matches_played + ', elo: ' + t.elo_rating);
  }

  if (teams.length === 0) {
    console.log('\nNo team found with Pre-NAL. Trying broader search...');
    const { data: broader } = await supabase
      .from('teams_v2')
      .select('id, display_name, birth_year, matches_played')
      .ilike('display_name', '%Sporting%BV%')
      .eq('birth_year', 2015);
    console.log('Broader results:', broader ? broader.length : 0);
    if (broader) {
      for (const t of broader) {
        console.log('  - ' + t.display_name + ' (matches: ' + t.matches_played + ')');
      }
    }
    return;
  }

  const team = teams[0];
  const teamId = team.id;
  console.log('\nUsing team ID: ' + teamId + '\n');

  // 2. Get ALL matches from matches_v2
  console.log('2. ALL MATCHES IN matches_v2...\n');
  const { data: homeMatches } = await supabase
    .from('matches_v2')
    .select('id, match_date, home_score, away_score, source_match_key, league_id, tournament_id, home_team_id, away_team_id')
    .eq('home_team_id', teamId)
    .order('match_date', { ascending: true });

  const { data: awayMatches } = await supabase
    .from('matches_v2')
    .select('id, match_date, home_score, away_score, source_match_key, league_id, tournament_id, home_team_id, away_team_id')
    .eq('away_team_id', teamId)
    .order('match_date', { ascending: true });

  const allMatches = [...(homeMatches || []), ...(awayMatches || [])];
  allMatches.sort((a, b) => new Date(a.match_date) - new Date(b.match_date));

  console.log('Total matches found: ' + allMatches.length);

  // Group by event type
  const leagueMatches = allMatches.filter(m => m.league_id);
  const tournamentMatches = allMatches.filter(m => m.tournament_id);
  const unlinkedMatches = allMatches.filter(m => !m.league_id && !m.tournament_id);

  console.log('\n  League matches: ' + leagueMatches.length);
  console.log('  Tournament matches: ' + tournamentMatches.length);
  console.log('  Unlinked matches: ' + unlinkedMatches.length);

  // Get team names for display
  const teamIds = new Set();
  allMatches.forEach(m => {
    teamIds.add(m.home_team_id);
    teamIds.add(m.away_team_id);
  });

  const { data: teamNames } = await supabase
    .from('teams_v2')
    .select('id, display_name')
    .in('id', Array.from(teamIds));

  const teamMap = {};
  if (teamNames) {
    teamNames.forEach(t => { teamMap[t.id] = t.display_name; });
  }

  // Get league/tournament names
  const leagueIds = [...new Set(leagueMatches.map(m => m.league_id).filter(Boolean))];
  const tourneyIds = [...new Set(tournamentMatches.map(m => m.tournament_id).filter(Boolean))];

  let leagueMap = {};
  let tourneyMap = {};

  if (leagueIds.length > 0) {
    const { data: leagues } = await supabase
      .from('leagues')
      .select('id, name, source_event_id')
      .in('id', leagueIds);
    if (leagues) leagues.forEach(l => { leagueMap[l.id] = l; });
  }

  if (tourneyIds.length > 0) {
    const { data: tourneys } = await supabase
      .from('tournaments')
      .select('id, name, source_event_id')
      .in('id', tourneyIds);
    if (tourneys) tourneys.forEach(t => { tourneyMap[t.id] = t; });
  }

  // League matches detail
  if (leagueMatches.length > 0) {
    console.log('\n--- LEAGUE MATCHES ---');
    const leagueGroups = {};
    leagueMatches.forEach(m => {
      const key = m.league_id;
      if (!leagueGroups[key]) leagueGroups[key] = [];
      leagueGroups[key].push(m);
    });

    for (const [leagueId, matches] of Object.entries(leagueGroups)) {
      const league = leagueMap[leagueId] || { name: 'Unknown', source_event_id: '?' };
      console.log('\n  ' + league.name + ' (' + matches.length + ' matches):');
      console.log('    source_event_id: ' + league.source_event_id);
      matches.forEach(m => {
        const isHome = m.home_team_id === teamId;
        const opponentId = isHome ? m.away_team_id : m.home_team_id;
        const opponent = teamMap[opponentId] || 'Unknown';
        const score = isHome ? m.home_score + '-' + m.away_score : m.away_score + '-' + m.home_score;
        const shortOpp = opponent.length > 50 ? opponent.substring(0, 47) + '...' : opponent;
        console.log('    ' + m.match_date + ': vs ' + shortOpp + ' | ' + score);
      });
    }
  }

  // Tournament matches detail
  if (tournamentMatches.length > 0) {
    console.log('\n--- TOURNAMENT MATCHES ---');
    const tourneyGroups = {};
    tournamentMatches.forEach(m => {
      const key = m.tournament_id;
      if (!tourneyGroups[key]) tourneyGroups[key] = [];
      tourneyGroups[key].push(m);
    });

    for (const [tourneyId, matches] of Object.entries(tourneyGroups)) {
      const tourney = tourneyMap[tourneyId] || { name: 'Unknown', source_event_id: '?' };
      console.log('\n  ' + tourney.name + ' (' + matches.length + ' matches):');
      console.log('    source_event_id: ' + tourney.source_event_id);
      matches.forEach(m => {
        const isHome = m.home_team_id === teamId;
        const opponentId = isHome ? m.away_team_id : m.home_team_id;
        const opponent = teamMap[opponentId] || 'Unknown';
        const score = isHome ? m.home_score + '-' + m.away_score : m.away_score + '-' + m.home_score;
        const shortOpp = opponent.length > 50 ? opponent.substring(0, 47) + '...' : opponent;
        console.log('    ' + m.match_date + ': vs ' + shortOpp + ' | ' + score);
      });
    }
  }

  // Unlinked matches
  if (unlinkedMatches.length > 0) {
    console.log('\n--- UNLINKED MATCHES (NO EVENT) ---');
    unlinkedMatches.forEach(m => {
      const isHome = m.home_team_id === teamId;
      const opponentId = isHome ? m.away_team_id : m.home_team_id;
      const opponent = teamMap[opponentId] || 'Unknown';
      const score = isHome ? m.home_score + '-' + m.away_score : m.away_score + '-' + m.home_score;
      const shortOpp = opponent.length > 50 ? opponent.substring(0, 47) + '...' : opponent;
      const shortKey = m.source_match_key ? m.source_match_key.substring(0, 60) : 'no key';
      console.log('  ' + m.match_date + ': vs ' + shortOpp + ' | ' + score + ' | key: ' + shortKey);
    });
  }

  // 3. Check app_league_standings for this team
  console.log('\n\n3. APP_LEAGUE_STANDINGS FOR THIS TEAM...\n');
  const { data: standings, error: standErr } = await supabase
    .from('app_league_standings')
    .select('*')
    .eq('team_id', teamId);

  if (standErr) {
    console.log('Standings error:', standErr);
  } else {
    console.log('Standings entries: ' + (standings ? standings.length : 0));
    if (standings) {
      standings.forEach(s => {
        console.log('  League: ' + s.league_name);
        console.log('    W-L-D: ' + s.wins + '-' + s.losses + '-' + s.draws + ', GF: ' + s.goals_for + ', GA: ' + s.goals_against);
      });
    }
  }

  // 4. Check for duplicate teams
  console.log('\n\n4. CHECK FOR DUPLICATE TEAM ENTRIES...\n');
  const { data: dupes } = await supabase
    .from('teams_v2')
    .select('id, display_name, birth_year, elo_rating, matches_played, source_platform')
    .or('display_name.ilike.%Sporting%Pre-NAL%,display_name.ilike.%Sporting BV%Pre-NAL%,canonical_name.ilike.%sporting%pre-nal%')
    .order('birth_year');

  console.log('Potential duplicates/variants found: ' + (dupes ? dupes.length : 0));
  if (dupes) {
    dupes.forEach(d => {
      console.log('  - ' + d.display_name);
      console.log('    birth_year: ' + d.birth_year + ', matches: ' + d.matches_played + ', elo: ' + d.elo_rating + ', source: ' + d.source_platform);
    });
  }

  console.log('\n=== END AUDIT ===');
}

audit().catch(console.error);
