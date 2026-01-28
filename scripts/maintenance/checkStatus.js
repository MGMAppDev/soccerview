import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatus() {
  console.log('Checking database status...\n');

  // Get counts
  const { data: teamCount } = await supabase.rpc('get_team_count');
  const { data: matchCount } = await supabase.rpc('get_match_count');

  // Get linked/unlinked matches
  const { count: linkedCount } = await supabase
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  const { count: unlinkedCount } = await supabase
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .or('home_team_id.is.null,away_team_id.is.null');

  // Get Heartland matches
  const { count: heartlandCount } = await supabase
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .eq('source_platform', 'heartland');

  const { count: htgsportsCount } = await supabase
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .eq('source_platform', 'htgsports');

  // Get reconciliation progress
  const { count: rankedTeams } = await supabase
    .from('teams')
    .select('*', { count: 'exact', head: true })
    .not('official_rank', 'is', null);

  const { count: rankedWithMatches } = await supabase
    .from('teams')
    .select('*', { count: 'exact', head: true })
    .not('official_rank', 'is', null)
    .gt('matches_played', 0);

  console.log('DATABASE STATUS:');
  console.log('================');
  console.log(`Total teams: ${teamCount.toLocaleString()}`);
  console.log(`Total matches: ${matchCount.toLocaleString()}`);
  console.log(`Linked matches: ${linkedCount.toLocaleString()} (${(linkedCount/matchCount*100).toFixed(1)}%)`);
  console.log(`Unlinked matches: ${unlinkedCount.toLocaleString()} (${(unlinkedCount/matchCount*100).toFixed(1)}%)`);
  console.log('');
  console.log('HEARTLAND DATA:');
  console.log(`HTGSports matches: ${htgsportsCount?.toLocaleString() || 0}`);
  console.log(`Heartland League matches: ${heartlandCount?.toLocaleString() || 0}`);
  console.log(`Total Heartland: ${((htgsportsCount || 0) + (heartlandCount || 0)).toLocaleString()}`);
  console.log('');
  console.log('RECONCILIATION STATUS:');
  console.log(`Total ranked teams: ${rankedTeams?.toLocaleString() || 'N/A'}`);
  console.log(`Ranked with matches: ${rankedWithMatches?.toLocaleString() || 'N/A'} (${rankedTeams && rankedWithMatches ? (rankedWithMatches/rankedTeams*100).toFixed(1) : 'N/A'}%)`);
  console.log(`Ranked without matches: ${rankedTeams && rankedWithMatches ? (rankedTeams - rankedWithMatches).toLocaleString() : 'N/A'} (need reconciliation)`);
}

checkStatus()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
