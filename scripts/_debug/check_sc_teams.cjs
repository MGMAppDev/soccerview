require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Get Sporting Classic matches
  const { data: matches } = await supabase
    .from('matches_v2')
    .select('id, home_team_id, away_team_id, source_match_key')
    .like('source_match_key', 'htg-13418%')
    .limit(500);

  // Get unique team IDs
  const teamIds = new Set();
  matches?.forEach(m => {
    teamIds.add(m.home_team_id);
    teamIds.add(m.away_team_id);
  });

  console.log('Unique teams in Sporting Classic:', teamIds.size);

  // Get team names
  const { data: teams } = await supabase
    .from('teams_v2')
    .select('id, display_name, birth_year, gender')
    .in('id', [...teamIds]);

  // Look for Sporting BV teams
  const bvTeams = teams?.filter(t => t.display_name.toLowerCase().includes('sporting bv'));
  console.log('\nSporting BV teams in tournament:', bvTeams?.length || 0);
  bvTeams?.forEach(t => console.log('  ', t.display_name, '| BY:', t.birth_year, '| G:', t.gender));

  // Look for U11 Boys teams
  const u11Boys = teams?.filter(t => t.birth_year === 2015 && t.gender === 'M');
  console.log('\nU11 Boys (2015/M) teams in tournament:', u11Boys?.length || 0);
  u11Boys?.slice(0, 10).forEach(t => console.log('  ', t.display_name));

  // Check the original team
  const { data: origTeam } = await supabase
    .from('teams_v2')
    .select('id')
    .ilike('display_name', '%Sporting BV Pre-NAL 15%')
    .single();

  if (origTeam) {
    console.log('\nOriginal team ID:', origTeam.id);

    // Check if this team is in any Sporting Classic matches
    const matchWithTeam = matches?.find(m =>
      m.home_team_id === origTeam.id || m.away_team_id === origTeam.id
    );
    console.log('Team in Sporting Classic matches:', matchWithTeam ? 'YES' : 'NO');

    // Find matches linked to Sporting Classic tournament
    const { data: tourn } = await supabase
      .from('tournaments')
      .select('id')
      .ilike('name', '%Sporting Classic 2025%')
      .single();

    if (tourn) {
      const { data: teamMatches, count } = await supabase
        .from('matches_v2')
        .select('id, tournament_id', { count: 'exact' })
        .eq('tournament_id', tourn.id)
        .or(`home_team_id.eq.${origTeam.id},away_team_id.eq.${origTeam.id}`);

      console.log('Team matches in Sporting Classic:', count || 0);
    }
  }

  // Show sample team names from Boys U11 divisions
  console.log('\nSample team names from staging for Boys U11:');
  const { data: stagingSample } = await supabase
    .from('staging_games')
    .select('home_team_name, away_team_name, division')
    .ilike('event_name', '%Sporting Classic%')
    .ilike('division', '%U11%')
    .limit(5);

  stagingSample?.forEach(s => {
    console.log('  Division:', s.division);
    console.log('    Home:', s.home_team_name);
    console.log('    Away:', s.away_team_name);
  });
})();
