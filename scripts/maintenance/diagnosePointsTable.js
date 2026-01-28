#!/usr/bin/env node
/**
 * Diagnose why Points Table returns 0 teams
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function diagnose() {
  const TEST_EVENT = '45260';

  console.log('🔍 Diagnosing Points Table Issue\n');

  // Step 1: Check matches
  const { data: matches, count: matchCount } = await supabase
    .from('match_results')
    .select('id, home_team_id, away_team_id, home_score, away_score', { count: 'exact' })
    .eq('event_id', TEST_EVENT)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)
    .limit(5);

  console.log(`Step 1: Matches with scores and team IDs`);
  console.log(`  Count: ${matchCount}`);
  if (matches?.length > 0) {
    console.log(`  Sample: home_team_id=${matches[0].home_team_id}, away_team_id=${matches[0].away_team_id}`);
  }

  if (matchCount === 0) {
    console.log('  ❌ No linked matches found - this is the problem!');
    process.exit(1);
  }

  // Step 2: Get unique team IDs from matches
  const { data: allMatches } = await supabase
    .from('match_results')
    .select('home_team_id, away_team_id')
    .eq('event_id', TEST_EVENT)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  const teamIds = [
    ...new Set([
      ...allMatches?.map(m => m.home_team_id) || [],
      ...allMatches?.map(m => m.away_team_id) || []
    ])
  ];

  console.log(`\nStep 2: Unique team IDs in matches`);
  console.log(`  Count: ${teamIds.length}`);
  console.log(`  Sample: ${teamIds.slice(0, 3).join(', ')}`);

  // Step 3: Check if those teams exist
  const { data: teams, count: teamCount } = await supabase
    .from('teams')
    .select('id, team_name, age_group, gender', { count: 'exact' })
    .in('id', teamIds.slice(0, 100)); // Test with first 100

  console.log(`\nStep 3: Teams found in teams table`);
  console.log(`  Found: ${teamCount} / 100 checked`);

  if (teamCount === 0) {
    console.log('  ❌ Team IDs from matches not found in teams table!');
    console.log('  This means linking created invalid team IDs');
    process.exit(1);
  }

  if (teams?.length > 0) {
    const withAge = teams.filter(t => t.age_group).length;
    const withGender = teams.filter(t => t.gender).length;

    console.log(`  Teams with age_group: ${withAge} / ${teams.length}`);
    console.log(`  Teams with gender: ${withGender} / ${teams.length}`);

    console.log(`\n  Sample teams:`);
    teams.slice(0, 3).forEach(t => {
      console.log(`    ${t.id}: ${t.team_name} (${t.age_group || 'no age'}, ${t.gender || 'no gender'})`);
    });
  }

  // Step 4: Try query WITHOUT filters
  const { data: teamsNoFilter, count: noFilterCount } = await supabase
    .from('teams')
    .select('id, team_name', { count: 'exact' })
    .in('id', teamIds);

  console.log(`\nStep 4: Query without age/gender filters`);
  console.log(`  Teams returned: ${noFilterCount}`);

  if (noFilterCount > 0) {
    console.log(`  ✅ Teams exist! Filter issue confirmed.`);
  }

  console.log('\n✅ Diagnosis complete');
  process.exit(0);
}

diagnose();
