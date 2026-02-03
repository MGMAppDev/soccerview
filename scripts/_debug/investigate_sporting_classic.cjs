require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function investigate() {
  // Find the team
  const { data: team, error: teamErr } = await supabase
    .from('teams_v2')
    .select('id, display_name, birth_year, gender')
    .ilike('display_name', '%Sporting BV Pre-NAL 15%')
    .single();

  if (teamErr) {
    console.log('Team error:', teamErr.message);
    return;
  }

  console.log('Team found:', team.id, team.display_name);
  console.log('Birth year:', team.birth_year, 'Gender:', team.gender);

  // Find all tournaments this team has played in
  const { data: matches, error: matchErr } = await supabase
    .from('matches_v2')
    .select('id, match_date, home_score, away_score, tournament_id, league_id, home_team_id, away_team_id')
    .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
    .not('tournament_id', 'is', null)
    .order('match_date', { ascending: false });

  if (matchErr) {
    console.log('Match error:', matchErr.message);
    return;
  }

  console.log('\nTournament matches found:', matches.length);

  // Get unique tournament IDs
  const tournamentIds = [...new Set(matches.map(m => m.tournament_id))];
  console.log('Unique tournaments:', tournamentIds.length);

  // Get tournament names
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, start_date, end_date')
    .in('id', tournamentIds);

  console.log('\nTournaments this team played in:');
  tournaments?.forEach(t => {
    const matchCount = matches.filter(m => m.tournament_id === t.id).length;
    console.log(`  - ${t.name} (${matchCount} matches) - ${t.start_date || 'no date'}`);
  });

  // Check if Sporting Classic exists in our DB at all
  console.log('\n--- Checking for Sporting Classic tournament ---');
  const { data: sportingClassic } = await supabase
    .from('tournaments')
    .select('id, name, start_date, source')
    .ilike('name', '%Sporting Classic%');

  console.log('Sporting Classic tournaments in DB:', sportingClassic?.length || 0);
  sportingClassic?.forEach(t => console.log(`  - ${t.name} (source: ${t.source})`));

  // Check staging for any Sporting Classic data
  const { data: staging } = await supabase
    .from('staging_games')
    .select('id, event_name, source')
    .ilike('event_name', '%Sporting Classic%')
    .limit(10);

  console.log('\nStaging games with Sporting Classic:', staging?.length || 0);
  staging?.forEach(s => console.log(`  - ${s.event_name} (source: ${s.source})`));

  // Check for Sep 5-7, 2025 date range matches for this team
  console.log('\n--- Checking for matches in Sep 5-7, 2025 date range ---');
  const { data: septMatches } = await supabase
    .from('matches_v2')
    .select(`
      id, match_date, home_score, away_score,
      home_team:teams_v2!matches_v2_home_team_id_fkey(display_name),
      away_team:teams_v2!matches_v2_away_team_id_fkey(display_name),
      tournament:tournaments(name),
      league:leagues(name)
    `)
    .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
    .gte('match_date', '2025-09-01')
    .lte('match_date', '2025-09-10');

  console.log('Matches in early Sep 2025:', septMatches?.length || 0);
  septMatches?.forEach(m => {
    const eventName = m.tournament?.name || m.league?.name || 'NO EVENT';
    console.log(`  ${m.match_date}: ${m.home_team?.display_name} ${m.home_score}-${m.away_score} ${m.away_team?.display_name} [${eventName}]`);
  });

  // Search for matches with the specific opponents
  console.log('\n--- Searching for opponent teams in our DB ---');
  const searchTerms = ['Sporting Columbia', 'Diablos FC', 'Sporting Nebraska', 'FC Vardar'];

  for (const term of searchTerms) {
    const { data: foundTeams } = await supabase
      .from('teams_v2')
      .select('id, display_name, birth_year, gender')
      .ilike('display_name', `%${term}%`)
      .eq('birth_year', 2014) // Same birth year as our team (U11 in 2025)
      .limit(5);

    console.log(`\nTeams matching "${term}" (birth_year 2014):`);
    if (foundTeams && foundTeams.length > 0) {
      foundTeams.forEach(t => console.log(`  - ${t.display_name} (${t.gender})`));
    } else {
      console.log('  None found');
    }
  }
}

investigate().catch(console.error);
