/**
 * debug_staging.js - Check team match linkage status
 *
 * Usage: node scripts/_debug/debug_staging.js [team_name_pattern]
 * Example: node scripts/_debug/debug_staging.js "Sporting BV"
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  // Get search pattern from args or use default
  const pattern = process.argv[2] || '%sporting%bv%pre%nal%15%';

  // Find teams matching pattern
  const { data: teams } = await supabase
    .from('teams_v2')
    .select('id, display_name, canonical_name')
    .ilike('canonical_name', pattern)
    .limit(5);

  if (!teams || teams.length === 0) {
    console.log('No teams found with pattern:', pattern);
    console.log('Trying broader search...');

    const { data: teams2 } = await supabase
      .from('teams_v2')
      .select('id, display_name, canonical_name')
      .ilike('display_name', pattern.replace(/%/g, ''))
      .limit(10);

    console.log('Teams found:', teams2?.map(t => t.display_name) || 'none');
    return;
  }

  const team = teams[0];
  console.log('Team:', team.display_name);
  console.log('ID:', team.id);

  // Get matches for this team
  const { data: matches } = await supabase
    .from('matches_v2')
    .select('id, match_date, home_score, away_score, league_id, tournament_id')
    .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
    .order('match_date', { ascending: false });

  console.log('\nTotal matches:', matches.length);

  const withLeague = matches.filter(m => m.league_id);
  const withTournament = matches.filter(m => m.tournament_id);
  const noEvent = matches.filter(m => !m.league_id && !m.tournament_id);

  console.log('With league_id:', withLeague.length);
  console.log('With tournament_id:', withTournament.length);
  console.log('No event (NULL both):', noEvent.length);

  if (noEvent.length > 0) {
    console.log('\nSample unlinked match IDs:');
    noEvent.slice(0, 5).forEach(m => {
      console.log(' -', m.match_date, `${m.home_score}-${m.away_score}`, 'ID:', m.id);
    });
  }
}

check().catch(console.error);
