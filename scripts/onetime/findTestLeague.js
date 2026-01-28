#!/usr/bin/env node
/**
 * Find a good league event for testing Points Table
 * Criteria: League with 10+ teams, 20+ completed matches
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findTestLeague() {
  console.log('🔍 Finding test league for Points Table...\n');

  try {
    // Get leagues with matches
    const { data: leagues, error } = await supabase
      .from('event_registry')
      .select('event_id, event_name, match_count, region, state, season')
      .eq('source_type', 'league')
      .gte('match_count', 20)
      .order('match_count', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error:', error);
      process.exit(1);
    }

    console.log('📊 Top Leagues by Match Count:\n');

    for (const league of leagues || []) {
      // Count completed matches with scores
      const { count: completedCount } = await supabase
        .from('match_results')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', league.event_id)
        .not('home_score', 'is', null)
        .not('away_score', 'is', null)
        .not('home_team_id', 'is', null)
        .not('away_team_id', 'is', null);

      // Count unique teams
      const { data: teams } = await supabase
        .from('match_results')
        .select('home_team_id, away_team_id')
        .eq('event_id', league.event_id)
        .not('home_team_id', 'is', null)
        .not('away_team_id', 'is', null);

      const uniqueTeams = new Set([
        ...teams?.map(t => t.home_team_id) || [],
        ...teams?.map(t => t.away_team_id) || []
      ]);

      console.log(`Event: ${league.event_id}`);
      console.log(`Name: ${league.event_name}`);
      console.log(`Location: ${league.state || league.region || 'Unknown'}`);
      console.log(`Season: ${league.season || 'Unknown'}`);
      console.log(`Total Matches: ${league.match_count}`);
      console.log(`Completed: ${completedCount}`);
      console.log(`Teams: ${uniqueTeams.size}`);

      if (completedCount > 0 && uniqueTeams.size >= 10) {
        console.log(`✅ GOOD FOR TESTING\n`);
      } else {
        console.log(`⚠️  May not have enough data\n`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

findTestLeague();
