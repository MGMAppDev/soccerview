require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Check staging count
  const { count: staging } = await supabase
    .from('staging_games')
    .select('*', { count: 'exact', head: true })
    .is('processed', false);
  console.log('Unprocessed staging records:', staging);

  // Check Sporting Classic matches in production
  const { data: scMatches } = await supabase
    .from('matches_v2')
    .select('id')
    .ilike('source_match_key', 'htg-13418%');
  console.log('Sporting Classic matches in production:', scMatches?.length || 0);

  // Check for Sporting BV Pre-NAL 15 team
  const { data: team } = await supabase
    .from('teams_v2')
    .select('id, display_name, birth_year, gender, matches_played')
    .ilike('display_name', '%Sporting BV Pre-NAL 15%')
    .single();

  if (team) {
    console.log('\nSporting BV Pre-NAL 15:', team.display_name);
    console.log('  Birth year:', team.birth_year, ', Gender:', team.gender);
    console.log('  Matches played:', team.matches_played);

    // Check tournament matches for this team
    const { data: tMatches } = await supabase
      .from('matches_v2')
      .select('id, match_date, home_score, away_score, tournament_id')
      .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
      .not('tournament_id', 'is', null)
      .order('match_date', { ascending: false });

    console.log('  Tournament matches:', tMatches?.length || 0);

    // Get unique tournament IDs
    const tournIds = [...new Set(tMatches?.map(m => m.tournament_id) || [])];

    // Get tournament names
    if (tournIds.length > 0) {
      const { data: tourns } = await supabase
        .from('tournaments')
        .select('id, name')
        .in('id', tournIds);

      console.log('\n  Tournaments played:');
      tourns?.forEach(t => {
        const matchCount = tMatches.filter(m => m.tournament_id === t.id).length;
        console.log(`    - ${t.name} (${matchCount} matches)`);
      });
    }
  } else {
    console.log('Team not found');
  }

  // Check if Sporting Classic tournament exists
  const { data: scTourn } = await supabase
    .from('tournaments')
    .select('id, name, source_event_id')
    .ilike('name', '%Sporting Classic%');

  console.log('\nSporting Classic tournaments in DB:', scTourn?.length || 0);
  scTourn?.forEach(t => console.log(`  - ${t.name} (source: ${t.source_event_id})`));
})();
