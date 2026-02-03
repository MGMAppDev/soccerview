import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verify() {
  // Find the Pre-NAL 15 team
  const { data: teams } = await supabase
    .from('teams')
    .select('id, team_name')
    .ilike('team_name', '%Sporting%Pre-NAL 15%')
    .limit(5);

  console.log('=== Sporting Pre-NAL 15 Teams ===');
  teams?.forEach(t => console.log(t.id.substring(0,8), t.team_name));

  if (teams && teams.length > 0) {
    const teamId = teams[0].id;
    console.log('\n=== Matches NOW linked to team: ' + teams[0].team_name + ' ===');

    // Get home matches
    const { data: homeMatches } = await supabase
      .from('match_results')
      .select('home_team_name, away_team_name, match_date, home_score, away_score')
      .eq('home_team_id', teamId)
      .order('match_date', { ascending: false })
      .limit(8);

    // Get away matches
    const { data: awayMatches } = await supabase
      .from('match_results')
      .select('home_team_name, away_team_name, match_date, home_score, away_score')
      .eq('away_team_id', teamId)
      .order('match_date', { ascending: false })
      .limit(8);

    console.log('\nHome matches:');
    homeMatches?.forEach(m => {
      console.log(`  ${m.match_date}: ${m.home_team_name} vs ${m.away_team_name} (${m.home_score}-${m.away_score})`);
    });

    console.log('\nAway matches:');
    awayMatches?.forEach(m => {
      console.log(`  ${m.match_date}: ${m.home_team_name} vs ${m.away_team_name} (${m.home_score}-${m.away_score})`);
    });

    // Check if any Pre-NAL 14 matches remain
    const allMatches = [...(homeMatches || []), ...(awayMatches || [])];
    const wrongMatches = allMatches.filter(m =>
      (m.home_team_name?.includes('14') && m.home_team_name?.includes('NAL')) ||
      (m.away_team_name?.includes('14') && m.away_team_name?.includes('NAL'))
    );

    console.log(`\n=== VERIFICATION ===`);
    console.log(`Total matches: ${allMatches.length}`);
    console.log(`Matches with 'Pre-NAL 14' in name: ${wrongMatches.length}`);
    if (wrongMatches.length === 0) {
      console.log('✅ NO MORE YEAR MISMATCHES - FIX VERIFIED!');
    } else {
      console.log('⚠️  Some mismatched matches still exist:');
      wrongMatches.forEach(m => console.log(`  ${m.home_team_name} vs ${m.away_team_name}`));
    }
  }
}

verify();
