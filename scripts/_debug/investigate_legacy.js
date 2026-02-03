/**
 * Quick investigation of legacy gotsport matches without source_match_key
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  // Get one sample unlinked match with full team data
  const { data: sample } = await supabase
    .from('matches_v2')
    .select(`
      id,
      match_date,
      home_score,
      away_score,
      home_team:teams_v2!matches_v2_home_team_id_fkey(id, name, display_name),
      away_team:teams_v2!matches_v2_away_team_id_fkey(id, name, display_name)
    `)
    .is('league_id', null)
    .is('tournament_id', null)
    .eq('source_platform', 'gotsport')
    .is('source_match_key', null)
    .gt('home_score', 0)
    .order('match_date', { ascending: true })
    .limit(5);

  console.log('Sample unlinked matches with PLAYED scores:');
  for (const m of sample || []) {
    console.log('  Date: ' + m.match_date);
    console.log('    Home: ' + (m.home_team?.display_name || m.home_team?.name || 'NULL'));
    console.log('    Away: ' + (m.away_team?.display_name || m.away_team?.name || 'NULL'));
    console.log('    Score: ' + m.home_score + '-' + m.away_score);
    console.log('');
  }

  // Check if staging_games has gotsport data with event_name
  const { data: stagingSample } = await supabase
    .from('staging_games')
    .select('home_team_name, away_team_name, match_date, event_name, source_match_key')
    .eq('source_platform', 'gotsport')
    .not('event_name', 'is', null)
    .order('match_date', { ascending: false })
    .limit(5);

  console.log('Sample gotsport staging_games (with event_name):');
  for (const s of stagingSample || []) {
    console.log('  ' + s.match_date + ' | ' + s.home_team_name + ' vs ' + s.away_team_name);
    console.log('    Event: ' + s.event_name);
    console.log('    Key: ' + s.source_match_key);
    console.log('');
  }

  // Count gotsport records in staging
  const { count: gotsportStaging } = await supabase
    .from('staging_games')
    .select('*', { count: 'exact', head: true })
    .eq('source_platform', 'gotsport');

  console.log('Total gotsport records in staging_games:', gotsportStaging);

  // Check how many unlinked have actual scores (played matches)
  const { count: withScores } = await supabase
    .from('matches_v2')
    .select('*', { count: 'exact', head: true })
    .is('league_id', null)
    .is('tournament_id', null)
    .eq('source_platform', 'gotsport')
    .is('source_match_key', null)
    .or('home_score.gt.0,away_score.gt.0');

  console.log('\nUnlinked matches with actual scores (played):', withScores);

  // How many are just 0-0 (scheduled)
  const { count: noScores } = await supabase
    .from('matches_v2')
    .select('*', { count: 'exact', head: true })
    .is('league_id', null)
    .is('tournament_id', null)
    .eq('source_platform', 'gotsport')
    .is('source_match_key', null)
    .eq('home_score', 0)
    .eq('away_score', 0);

  console.log('Unlinked matches with 0-0 score (scheduled):', noScores);
}

investigate().catch(console.error);
