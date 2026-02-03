require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Check for Sporting Classic in staging
  const { data: staging, count } = await supabase
    .from('staging_games')
    .select('id, event_name, processed', { count: 'exact' })
    .ilike('event_name', '%Sporting Classic%');

  console.log('Sporting Classic in staging:', count || 0);
  if (staging && staging.length > 0) {
    const processed = staging.filter(s => s.processed).length;
    const unprocessed = staging.filter(s => !s.processed).length;
    console.log('  Processed:', processed);
    console.log('  Unprocessed:', unprocessed);
  }

  // Check for htg-13418 in matches
  const { data: matches, count: mcount } = await supabase
    .from('matches_v2')
    .select('id, tournament_id, source_match_key', { count: 'exact' })
    .ilike('source_match_key', 'htg-13418%');

  console.log('\nMatches with htg-13418 key:', mcount || 0);

  // Check for staging_games from htgsports
  const { data: htgStaging, count: htgCount } = await supabase
    .from('staging_games')
    .select('id, source_event_id, event_name, processed', { count: 'exact' })
    .eq('source', 'htgsports');

  console.log('\nTotal HTGSports staging records:', htgCount || 0);

  // Show some samples
  if (htgStaging && htgStaging.length > 0) {
    const byEvent = {};
    htgStaging.forEach(s => {
      if (!byEvent[s.event_name]) {
        byEvent[s.event_name] = { processed: 0, unprocessed: 0 };
      }
      if (s.processed) {
        byEvent[s.event_name].processed++;
      } else {
        byEvent[s.event_name].unprocessed++;
      }
    });

    console.log('\nHTGSports events in staging:');
    Object.entries(byEvent).forEach(([name, counts]) => {
      console.log(`  ${name}: ${counts.processed} processed, ${counts.unprocessed} unprocessed`);
    });
  }

  // Check if 13418 event was processed
  const { data: sc13418 } = await supabase
    .from('staging_games')
    .select('id, source_event_id, event_name, processed')
    .eq('source_event_id', '13418')
    .limit(10);

  console.log('\nStaging records with source_event_id=13418:', sc13418?.length || 0);
  sc13418?.forEach(s => console.log(`  Event: ${s.event_name} | Processed: ${s.processed}`));
})();
