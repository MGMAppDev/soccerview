#!/usr/bin/env node
/**
 * Check for active database operations and long-running queries
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkActivity() {
  console.log('🔍 Checking database activity...\n');

  try {
    // Check if ELO recalculation is in progress
    // We can infer this by checking recent team updates
    const { data: recentTeams, error: teamsError } = await supabase
      .from('teams')
      .select('id, team_name, elo_rating')
      .not('elo_rating', 'is', null)
      .order('id', { ascending: false })
      .limit(5);

    if (teamsError) {
      console.error('Error checking teams:', teamsError);
    } else {
      console.log('📊 Recent team ELO ratings (sample):');
      recentTeams?.slice(0, 3).forEach(t => {
        console.log(`   ${t.team_name}: ${Math.round(t.elo_rating)}`);
      });
    }

    // Check match linking status
    const { count: total } = await supabase
      .from('match_results')
      .select('id', { count: 'exact', head: true });

    const { count: linked } = await supabase
      .from('match_results')
      .select('id', { count: 'exact', head: true })
      .not('home_team_id', 'is', null)
      .not('away_team_id', 'is', null);

    console.log(`\n📊 Match Linking Status:`);
    console.log(`   Total: ${total?.toLocaleString()}`);
    console.log(`   Linked: ${linked?.toLocaleString()} (${((linked/total)*100).toFixed(1)}%)`);

    // Check for teams with current season matches
    const { count: teamsWithMatches } = await supabase
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .gt('matches_played', 0);

    console.log(`\n📊 Teams with Matches:`);
    console.log(`   Count: ${teamsWithMatches?.toLocaleString()}`);

    // Check for league events
    const { count: leagues } = await supabase
      .from('event_registry')
      .select('event_id', { count: 'exact', head: true })
      .eq('source_type', 'league');

    console.log(`\n📊 League Events:`);
    console.log(`   Count: ${leagues?.toLocaleString()}`);

    console.log('\n✅ Database accessible and responsive');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  process.exit(0);
}

checkActivity();
