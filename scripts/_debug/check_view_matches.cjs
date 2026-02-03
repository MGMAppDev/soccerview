require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const teamId = 'cc329f08-1f57-4a7b-923a-768b2138fa92';

  // Get the raw profile with recent_matches
  const { data: profile, error } = await supabase
    .from('app_team_profile')
    .select('id, recent_matches')
    .eq('id', teamId)
    .single();

  if (error) {
    console.log('Error:', error);
    return;
  }

  if (!profile) {
    console.log('Team not found in app_team_profile');
    return;
  }

  const matches = profile.recent_matches || [];

  console.log('Total recent_matches in app_team_profile view:', matches.length);
  console.log('');

  // Group by tournament/league
  const byEvent = {};
  matches.forEach(m => {
    const key = m.tournament_id || m.league_id || 'unlinked';
    const name = m.event_name || 'Unknown';
    if (!byEvent[key]) byEvent[key] = { name, matches: [] };
    byEvent[key].matches.push(m);
  });

  console.log('Grouped by event:');
  for (const [key, data] of Object.entries(byEvent)) {
    const type = key === 'unlinked' ? 'unlinked' : (matches.find(m => m.tournament_id === key) ? 'tournament' : 'league');
    console.log('  ' + data.name + ' [' + type + ']: ' + data.matches.length + ' matches');
  }

  console.log('\nDetailed match list:');
  matches.forEach(m => {
    const eventType = m.tournament_id ? 'tournament' : (m.league_id ? 'league' : 'none');
    console.log('  ' + m.match_date + ': ' + (m.event_name || 'No event') + ' [' + eventType + ']');
  });
}

check().catch(console.error);
