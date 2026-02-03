/**
 * Analyze legacy gotsport matches to find patterns for re-scraping
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyze() {
  console.log('='.repeat(60));
  console.log('ANALYZING LEGACY GOTSPORT MATCHES FOR RE-SCRAPE');
  console.log('='.repeat(60));

  // Get ALL legacy matches (paginated)
  console.log('\nStep 1: Loading all legacy gotsport matches...');
  const legacyMatches = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from('matches_v2')
      .select('id, match_date, home_team_id, away_team_id, home_score, away_score')
      .is('league_id', null)
      .is('tournament_id', null)
      .eq('source_platform', 'gotsport')
      .is('source_match_key', null)
      .range(offset, offset + 999);

    if (!batch || batch.length === 0) break;
    legacyMatches.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }

  console.log(`  Total legacy matches: ${legacyMatches.length}`);

  // Group by month to find event patterns
  const byMonth = {};
  legacyMatches.forEach(m => {
    const month = m.match_date?.slice(0, 7) || 'unknown';
    byMonth[month] = (byMonth[month] || 0) + 1;
  });

  console.log('\nBy month:');
  Object.entries(byMonth).sort().forEach(([month, count]) => {
    console.log(`  ${month}: ${count}`);
  });

  // Get unique team IDs
  const teamIds = new Set();
  legacyMatches.forEach(m => {
    if (m.home_team_id) teamIds.add(m.home_team_id);
    if (m.away_team_id) teamIds.add(m.away_team_id);
  });

  console.log(`\nUnique teams in legacy matches: ${teamIds.size}`);

  // Sample teams to check for source_team_id (gotsport ID)
  const sampleTeamIds = [...teamIds].slice(0, 500);
  const { data: teams } = await supabase
    .from('teams_v2')
    .select('id, canonical_name, state, birth_year, source_team_id')
    .in('id', sampleTeamIds);

  const withSourceId = teams?.filter(t => t.source_team_id)?.length || 0;
  console.log(`Teams with source_team_id: ${withSourceId} of ${teams?.length} sampled`);

  // Group teams by state
  const byState = {};
  teams?.forEach(t => {
    byState[t.state] = (byState[t.state] || 0) + 1;
  });

  console.log('\nTeams by state (sample):');
  Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([state, count]) => {
    console.log(`  ${state}: ${count}`);
  });

  // Check if teams have LINKED matches we can use to infer events
  console.log('\n--- INFERENCE ANALYSIS ---');
  console.log('Checking if teams have other linked matches...\n');

  let teamsWithLinkedMatches = 0;
  let totalInferrableMatches = 0;
  const eventInferenceMap = new Map(); // team -> events they play in

  for (const teamId of sampleTeamIds.slice(0, 100)) {
    // Get this team's linked matches
    const { data: linkedMatches } = await supabase
      .from('matches_v2')
      .select('league_id, tournament_id')
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .not('league_id', 'is', null)
      .limit(50);

    const { data: linkedTournaments } = await supabase
      .from('matches_v2')
      .select('tournament_id')
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .not('tournament_id', 'is', null)
      .limit(50);

    const allLinked = [...(linkedMatches || []), ...(linkedTournaments || [])];

    if (allLinked.length > 0) {
      teamsWithLinkedMatches++;

      // Count unique events this team plays in
      const events = new Set();
      allLinked.forEach(m => {
        if (m.league_id) events.add('L:' + m.league_id);
        if (m.tournament_id) events.add('T:' + m.tournament_id);
      });

      if (events.size === 1) {
        // Team only plays in ONE event - we can infer their unlinked matches belong to it!
        totalInferrableMatches++;
        eventInferenceMap.set(teamId, [...events][0]);
      }
    }
  }

  console.log(`Teams with linked matches: ${teamsWithLinkedMatches} of 100 checked`);
  console.log(`Teams with SINGLE event (inferrable): ${eventInferenceMap.size}`);

  // If teams play in only one event, we can assign their unlinked matches to that event
  console.log('\n--- POTENTIAL INFERENCE FIX ---');

  if (eventInferenceMap.size > 0) {
    // Count how many legacy matches could be fixed via inference
    let inferrableCount = 0;
    for (const [teamId, eventKey] of eventInferenceMap) {
      const teamMatches = legacyMatches.filter(m =>
        m.home_team_id === teamId || m.away_team_id === teamId
      );
      inferrableCount += teamMatches.length;
    }

    console.log(`Matches fixable via single-event inference: ${inferrableCount}`);
    console.log('(If a team only plays in one event, assign all their matches to it)');
  }

  // Check staging_games for event patterns
  console.log('\n--- STAGING DATA ANALYSIS ---');

  const { data: stagingEvents } = await supabase
    .from('staging_games')
    .select('event_name, event_id, source_platform')
    .eq('source_platform', 'gotsport')
    .not('event_id', 'is', null)
    .limit(1000);

  const uniqueEvents = new Map();
  stagingEvents?.forEach(s => {
    if (s.event_id && !uniqueEvents.has(s.event_id)) {
      uniqueEvents.set(s.event_id, s.event_name);
    }
  });

  console.log(`Unique gotsport events in staging: ${uniqueEvents.size}`);
  console.log('\nEvent IDs available for re-scrape:');
  [...uniqueEvents.entries()].slice(0, 10).forEach(([id, name]) => {
    console.log(`  ${id}: ${name}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('RECOMMENDATION');
  console.log('='.repeat(60));
  console.log(`
Two approaches to fix legacy matches:

1. INFERENCE APPROACH (fast, ~${eventInferenceMap.size * 10} matches):
   - If a team only plays in ONE linked event, assign all their unlinked matches to it
   - Requires: Script to analyze team event patterns

2. RE-SCRAPE APPROACH (accurate, but needs event IDs):
   - Problem: We don't know which gotsport event IDs these matches came from
   - The staging_games only has ${uniqueEvents.size} event IDs
   - Would need to identify events by team names + dates

3. HYBRID: Use team's source_team_id to query GotSport API
   - If teams have source_team_id, we can look up their event history
   - Then re-scrape those specific events
`);
}

analyze().catch(console.error);
