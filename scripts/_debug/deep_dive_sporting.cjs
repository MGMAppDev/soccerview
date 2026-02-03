require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function deepDive() {
  console.log('=== DEEP DIVE: SPORTING BV PRE-NAL 15 ===\n');

  // 1. Check ALL tournaments for this team
  console.log('1. ALL TOURNAMENTS IN DATABASE...\n');

  const teamId = 'cc329f08-1f57-4a7b-923a-768b2138fa92';

  const { data: tourneyMatches } = await supabase
    .from('matches_v2')
    .select('tournament_id, match_date, home_score, away_score, source_match_key, home_team_id, away_team_id')
    .or('home_team_id.eq.' + teamId + ',away_team_id.eq.' + teamId)
    .not('tournament_id', 'is', null)
    .order('match_date');

  const tourneyIds = [...new Set(tourneyMatches?.map(m => m.tournament_id) || [])];

  if (tourneyIds.length > 0) {
    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('id, name, source_event_id, start_date, end_date')
      .in('id', tourneyIds);

    console.log('Tournaments found: ' + tournaments.length);
    tournaments?.forEach(t => {
      console.log('\n  - ' + t.name);
      console.log('    source_event_id: ' + t.source_event_id);
      console.log('    dates: ' + t.start_date + ' to ' + t.end_date);
      const matches = tourneyMatches.filter(m => m.tournament_id === t.id);
      console.log('    matches: ' + matches.length);
    });
  }

  // 2. Check if Heartland Invitational exists in tournaments
  console.log('\n\n2. SEARCHING FOR HEARTLAND INVITATIONAL...\n');

  const { data: heartlandTourneys } = await supabase
    .from('tournaments')
    .select('id, name, source_event_id, start_date')
    .ilike('name', '%Heartland%Invitational%');

  console.log('Heartland Invitational tournaments: ' + (heartlandTourneys?.length || 0));
  heartlandTourneys?.forEach(t => {
    console.log('  - ' + t.name + ' (id: ' + t.id + ')');
    console.log('    source_event_id: ' + t.source_event_id);
  });

  // 3. Check leagues table for Heartland
  console.log('\n\n3. ALL HEARTLAND ENTRIES (LEAGUES + TOURNAMENTS)...\n');

  const { data: heartlandLeagues } = await supabase
    .from('leagues')
    .select('id, name, source_event_id, season')
    .ilike('name', '%Heartland%');

  console.log('Heartland leagues: ' + (heartlandLeagues?.length || 0));
  heartlandLeagues?.forEach(l => {
    console.log('  - ' + l.name + ' (source_event_id: ' + l.source_event_id + ')');
  });

  // 4. Check for any unprocessed staging with Heartland Invitational
  console.log('\n\n4. STAGING WITH HEARTLAND INVITATIONAL...\n');

  const { data: invitStaging } = await supabase
    .from('staging_games')
    .select('*')
    .ilike('event_name', '%Heartland%Invitational%')
    .order('match_date');

  console.log('Heartland Invitational staging: ' + (invitStaging?.length || 0));
  if (invitStaging && invitStaging.length > 0) {
    // Check if any contain our team
    const ourTeamMatches = invitStaging.filter(s =>
      (s.home_team_name || '').includes('Pre-NAL 15') ||
      (s.away_team_name || '').includes('Pre-NAL 15')
    );
    console.log('Our team (Pre-NAL 15) matches: ' + ourTeamMatches.length);
    ourTeamMatches.forEach(s => {
      console.log('  ' + s.match_date + ': ' + s.home_team_name + ' vs ' + s.away_team_name + ' | ' + s.home_score + '-' + s.away_score);
      console.log('    processed: ' + s.processed + ', source_match_key: ' + (s.source_match_key || 'NULL'));
    });
  }

  // 5. Check for matches from November 2025 (Heartland Invitational timeframe)
  console.log('\n\n5. NOVEMBER 2025 MATCHES FOR THIS TEAM...\n');

  const { data: novMatches } = await supabase
    .from('matches_v2')
    .select('id, match_date, home_score, away_score, source_match_key, league_id, tournament_id, home_team_id, away_team_id')
    .or('home_team_id.eq.' + teamId + ',away_team_id.eq.' + teamId)
    .gte('match_date', '2025-11-01')
    .lte('match_date', '2025-11-30')
    .order('match_date');

  console.log('November 2025 matches in matches_v2: ' + (novMatches?.length || 0));
  if (novMatches && novMatches.length > 0) {
    for (const m of novMatches) {
      const { data: teams } = await supabase
        .from('teams_v2')
        .select('id, display_name')
        .in('id', [m.home_team_id, m.away_team_id]);
      const teamMap = {};
      teams?.forEach(t => { teamMap[t.id] = t.display_name; });

      console.log('  ' + m.match_date + ': ' + (teamMap[m.home_team_id] || '').substring(0, 40) + ' vs ' + (teamMap[m.away_team_id] || '').substring(0, 40));
      console.log('    Score: ' + m.home_score + '-' + m.away_score);
      console.log('    league_id: ' + m.league_id + ', tournament_id: ' + m.tournament_id);
    }
  }

  // 6. Check matches_played vs actual count
  console.log('\n\n6. MATCHES_PLAYED DISCREPANCY...\n');

  const { data: teamData } = await supabase
    .from('teams_v2')
    .select('matches_played, elo_rating')
    .eq('id', teamId)
    .single();

  const { count: actualMatchCount } = await supabase
    .from('matches_v2')
    .select('id', { count: 'exact', head: true })
    .or('home_team_id.eq.' + teamId + ',away_team_id.eq.' + teamId);

  console.log('teams_v2.matches_played: ' + teamData?.matches_played);
  console.log('Actual matches in matches_v2: ' + actualMatchCount);
  console.log('DISCREPANCY: ' + (teamData?.matches_played - actualMatchCount));

  // 7. Check if the staging has a different team ID
  console.log('\n\n7. CHECKING FOR DIFFERENT TEAM VARIANTS...\n');

  const { data: variants } = await supabase
    .from('teams_v2')
    .select('id, display_name, birth_year, matches_played')
    .or('display_name.ilike.%Sporting%Pre-NAL%15%,display_name.ilike.%SPORTING BV Pre-NAL 15%,canonical_name.ilike.%sporting%pre-nal%15%');

  console.log('Team variants for Pre-NAL 15:');
  variants?.forEach(v => {
    console.log('  - ' + v.display_name);
    console.log('    id: ' + v.id + ', birth_year: ' + v.birth_year + ', matches: ' + v.matches_played);
  });
}

deepDive().catch(console.error);
