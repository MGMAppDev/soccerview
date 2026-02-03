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
    .select('id, name, birth_year, gender, club_id, elo_rating, elo_rank')
    .or('name.ilike.%Sporting%Pre-NAL%15%,name.ilike.%Sporting BV%Pre-NAL%')
    .eq('birth_year', 2015);
    
  if (teamError) {
    console.error('Team query error:', teamError);
    return;
  }
  
  console.log('Teams found:', teams.length);
  teams.forEach(t => console.log(`  - ${t.name} (id: ${t.id}, birth_year: ${t.birth_year}, elo: ${t.elo_rating})`));
  
  if (teams.length === 0) {
    console.log('\nNo team found. Trying broader search...');
    const { data: broader } = await supabase
      .from('teams_v2')
      .select('id, name, birth_year')
      .ilike('name', '%Sporting%BV%')
      .eq('birth_year', 2015);
    console.log('Broader results:', broader);
    return;
  }
  
  const teamId = teams[0].id;
  console.log(`\nUsing team ID: ${teamId}\n`);
  
  // 2. Get ALL matches from matches_v2
  console.log('2. ALL MATCHES IN matches_v2...\n');
  const { data: homeMatches } = await supabase
    .from('matches_v2')
    .select(`
      id, match_date, home_score, away_score, source_match_key,
      league_id, tournament_id,
      home_team:home_team_id(name),
      away_team:away_team_id(name),
      league:league_id(name),
      tournament:tournament_id(name)
    `)
    .eq('home_team_id', teamId)
    .order('match_date', { ascending: true });
    
  const { data: awayMatches } = await supabase
    .from('matches_v2')
    .select(`
      id, match_date, home_score, away_score, source_match_key,
      league_id, tournament_id,
      home_team:home_team_id(name),
      away_team:away_team_id(name),
      league:league_id(name),
      tournament:tournament_id(name)
    `)
    .eq('away_team_id', teamId)
    .order('match_date', { ascending: true });
  
  const allMatches = [...(homeMatches || []), ...(awayMatches || [])];
  allMatches.sort((a, b) => new Date(a.match_date) - new Date(b.match_date));
  
  console.log(`Total matches found: ${allMatches.length}`);
  console.log('\n--- MATCH DETAILS ---');
  
  // Group by event type
  const leagueMatches = allMatches.filter(m => m.league_id);
  const tournamentMatches = allMatches.filter(m => m.tournament_id);
  const unlinkedMatches = allMatches.filter(m => !m.league_id && !m.tournament_id);
  
  console.log(`\n  League matches: ${leagueMatches.length}`);
  console.log(`  Tournament matches: ${tournamentMatches.length}`);
  console.log(`  Unlinked matches: ${unlinkedMatches.length}`);
  
  // League matches detail
  if (leagueMatches.length > 0) {
    console.log('\n--- LEAGUE MATCHES ---');
    const leagueGroups = {};
    leagueMatches.forEach(m => {
      const key = m.league?.name || 'Unknown';
      if (!leagueGroups[key]) leagueGroups[key] = [];
      leagueGroups[key].push(m);
    });
    
    for (const [league, matches] of Object.entries(leagueGroups)) {
      console.log(`\n  ${league} (${matches.length} matches):`);
      matches.forEach(m => {
        const isHome = m.home_team?.name?.includes('Sporting');
        const opponent = isHome ? m.away_team?.name : m.home_team?.name;
        const score = isHome ? `${m.home_score}-${m.away_score}` : `${m.away_score}-${m.home_score}`;
        console.log(`    ${m.match_date}: vs ${opponent} | ${score}`);
      });
    }
  }
  
  // Tournament matches detail
  if (tournamentMatches.length > 0) {
    console.log('\n--- TOURNAMENT MATCHES ---');
    const tourneyGroups = {};
    tournamentMatches.forEach(m => {
      const key = m.tournament?.name || 'Unknown';
      if (!tourneyGroups[key]) tourneyGroups[key] = [];
      tourneyGroups[key].push(m);
    });
    
    for (const [tourney, matches] of Object.entries(tourneyGroups)) {
      console.log(`\n  ${tourney} (${matches.length} matches):`);
      matches.forEach(m => {
        const isHome = m.home_team?.name?.includes('Sporting');
        const opponent = isHome ? m.away_team?.name : m.home_team?.name;
        const score = isHome ? `${m.home_score}-${m.away_score}` : `${m.away_score}-${m.home_score}`;
        console.log(`    ${m.match_date}: vs ${opponent} | ${score}`);
      });
    }
  }
  
  // Unlinked matches
  if (unlinkedMatches.length > 0) {
    console.log('\n--- UNLINKED MATCHES (NO EVENT) ---');
    unlinkedMatches.forEach(m => {
      const isHome = m.home_team?.name?.includes('Sporting');
      const opponent = isHome ? m.away_team?.name : m.home_team?.name;
      const score = isHome ? `${m.home_score}-${m.away_score}` : `${m.away_score}-${m.home_score}`;
      console.log(`  ${m.match_date}: vs ${opponent} | ${score} | key: ${m.source_match_key}`);
    });
  }
  
  // 3. Check what leagues this team is associated with
  console.log('\n\n3. LEAGUES ASSOCIATED WITH TEAM...\n');
  const leagueIds = [...new Set(leagueMatches.map(m => m.league_id).filter(Boolean))];
  if (leagueIds.length > 0) {
    const { data: leagues } = await supabase
      .from('leagues')
      .select('id, name, season, source, source_event_id')
      .in('id', leagueIds);
    
    leagues?.forEach(l => {
      console.log(`  - ${l.name} (season: ${l.season}, source: ${l.source})`);
      console.log(`    source_event_id: ${l.source_event_id}`);
    });
  }
  
  // 4. Check staging_games for this team (to see what's waiting)
  console.log('\n\n4. CHECKING STAGING_GAMES FOR PENDING DATA...\n');
  const { data: staging } = await supabase
    .from('staging_games')
    .select('*')
    .or(`home_team_name.ilike.%Sporting%Pre-NAL%15%,away_team_name.ilike.%Sporting%Pre-NAL%15%,home_team_name.ilike.%Sporting BV%Pre-NAL%,away_team_name.ilike.%Sporting BV%Pre-NAL%`)
    .limit(50);
    
  console.log(`Staging games found: ${staging?.length || 0}`);
  if (staging?.length > 0) {
    staging.forEach(s => {
      console.log(`  ${s.match_date}: ${s.home_team_name} vs ${s.away_team_name} | ${s.home_score}-${s.away_score} | processed: ${s.processed}`);
    });
  }
  
  console.log('\n=== END AUDIT ===');
}

audit().catch(console.error);
