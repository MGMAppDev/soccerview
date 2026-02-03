/**
 * Investigate if we can infer event linkage from team's other matches
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  // Get a sample of unlinked matches
  const { data: unlinkedSample } = await supabase
    .from('matches_v2')
    .select('id, match_date, home_team_id, away_team_id')
    .is('league_id', null)
    .is('tournament_id', null)
    .eq('source_platform', 'gotsport')
    .is('source_match_key', null)
    .limit(10);

  console.log('Checking if teams have linked matches we can use to infer events...\n');

  let couldInfer = 0;
  let couldNotInfer = 0;

  for (const m of unlinkedSample || []) {
    // For this match's home team, find other linked matches
    const { data: homeTeamMatches } = await supabase
      .from('matches_v2')
      .select('league_id, tournament_id')
      .or(`home_team_id.eq.${m.home_team_id},away_team_id.eq.${m.home_team_id}`)
      .or('league_id.not.is.null,tournament_id.not.is.null')
      .limit(50);

    // Get unique events for home team
    const homeEvents = new Set();
    for (const match of homeTeamMatches || []) {
      if (match.league_id) homeEvents.add('L:' + match.league_id);
      if (match.tournament_id) homeEvents.add('T:' + match.tournament_id);
    }

    console.log(`Match ${m.id.slice(0,8)}... (${m.match_date})`);
    console.log(`  Home team ${m.home_team_id.slice(0,8)}... has ${homeEvents.size} linked events`);

    if (homeEvents.size === 1) {
      console.log(`  ✓ Could infer event: ${[...homeEvents][0]}`);
      couldInfer++;
    } else if (homeEvents.size === 0) {
      console.log(`  ✗ No linked events found`);
      couldNotInfer++;
    } else {
      console.log(`  ✗ Multiple events, can't infer: ${[...homeEvents].slice(0, 3).join(', ')}...`);
      couldNotInfer++;
    }
  }

  console.log('\n---------');
  console.log(`Could infer: ${couldInfer}/${unlinkedSample.length}`);
  console.log(`Could not infer: ${couldNotInfer}/${unlinkedSample.length}`);

  // Check what % of unlinked teams have ANY linked matches
  console.log('\n\nChecking broader pattern...');

  // Get all unique team IDs from unlinked matches
  const allUnlinked = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from('matches_v2')
      .select('home_team_id, away_team_id')
      .is('league_id', null)
      .is('tournament_id', null)
      .eq('source_platform', 'gotsport')
      .is('source_match_key', null)
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    allUnlinked.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }

  const uniqueTeamIds = new Set();
  allUnlinked.forEach(m => {
    if (m.home_team_id) uniqueTeamIds.add(m.home_team_id);
    if (m.away_team_id) uniqueTeamIds.add(m.away_team_id);
  });

  console.log(`Unique teams in unlinked matches: ${uniqueTeamIds.size}`);

  // Sample: check if some of these teams have ANY linked matches
  const teamSample = [...uniqueTeamIds].slice(0, 100);
  let teamsWithLinked = 0;

  for (const teamId of teamSample) {
    const { count } = await supabase
      .from('matches_v2')
      .select('*', { count: 'exact', head: true })
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .or('league_id.not.is.null,tournament_id.not.is.null');

    if (count > 0) teamsWithLinked++;
  }

  console.log(`Teams with at least one linked match (sample 100): ${teamsWithLinked}`);
}

investigate().catch(console.error);
