require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('=== CHECKING STAGING_GAMES FOR SPORTING BV ===\n');

  // Check staging_games for any Sporting BV Pre-NAL data
  const { data: staging, error } = await supabase
    .from('staging_games')
    .select('*')
    .or('home_team_name.ilike.%Sporting%Pre-NAL%,away_team_name.ilike.%Sporting%Pre-NAL%,home_team_name.ilike.%SPORTING BV Pre-NAL%,away_team_name.ilike.%SPORTING BV Pre-NAL%')
    .order('match_date', { ascending: true });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Staging games found: ' + (staging ? staging.length : 0));
  if (staging && staging.length > 0) {
    staging.forEach(s => {
      console.log('\n  ' + s.match_date + ': ' + s.home_team_name + ' vs ' + s.away_team_name);
      console.log('    Score: ' + s.home_score + '-' + s.away_score);
      console.log('    Source: ' + s.source + ', Event: ' + s.event_name);
      console.log('    Processed: ' + s.processed);
    });
  }

  // Also check for all "Pre-NAL" team variants
  console.log('\n\n=== ALL PRE-NAL MATCHES IN STAGING ===\n');
  const { data: allPreNal } = await supabase
    .from('staging_games')
    .select('home_team_name, away_team_name, match_date, home_score, away_score, source, event_name, processed')
    .or('home_team_name.ilike.%Pre-NAL%,away_team_name.ilike.%Pre-NAL%')
    .order('match_date', { ascending: true });

  console.log('All Pre-NAL staging: ' + (allPreNal ? allPreNal.length : 0));
  if (allPreNal && allPreNal.length > 0) {
    allPreNal.forEach(s => {
      console.log('  ' + s.match_date + ': ' + (s.home_team_name || '').substring(0, 30) + ' vs ' + (s.away_team_name || '').substring(0, 30) + ' | ' + s.home_score + '-' + s.away_score + ' | ' + s.source);
    });
  }

  // Check what leagues exist for Heartland
  console.log('\n\n=== HEARTLAND LEAGUES IN DATABASE ===\n');
  const { data: leagues } = await supabase
    .from('leagues')
    .select('id, name, source_event_id, season')
    .ilike('name', '%Heartland%')
    .order('season', { ascending: false });

  console.log('Heartland leagues: ' + (leagues ? leagues.length : 0));
  if (leagues) {
    leagues.forEach(l => {
      console.log('  - ' + l.name + ' (season: ' + l.season + ')');
      console.log('    source_event_id: ' + l.source_event_id);
    });
  }

  // Check matches_v2 for any matches from OP Academy 2015B
  console.log('\n\n=== CHECKING OP ACADEMY AND HORIZON MATCHES ===\n');

  // Find OP Academy team
  const { data: opTeams } = await supabase
    .from('teams_v2')
    .select('id, display_name, birth_year')
    .ilike('display_name', '%OP Academy%2015%');

  console.log('OP Academy 2015 teams: ' + (opTeams ? opTeams.length : 0));
  if (opTeams) {
    opTeams.forEach(t => console.log('  - ' + t.display_name + ' (birth_year: ' + t.birth_year + ')'));
  }

  // Find Horizon team
  const { data: horizonTeams } = await supabase
    .from('teams_v2')
    .select('id, display_name, birth_year')
    .ilike('display_name', '%Horizon%')
    .eq('birth_year', 2015);

  console.log('\nHorizon 2015 teams: ' + (horizonTeams ? horizonTeams.length : 0));
  if (horizonTeams) {
    horizonTeams.forEach(t => console.log('  - ' + t.display_name + ' (birth_year: ' + t.birth_year + ')'));
  }
}

check().catch(console.error);
