require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Check for HTGSports events with 'classic' in the name
  const { data: htgClassic } = await supabase
    .from('tournaments')
    .select('id, name, source, source_event_id, start_date')
    .ilike('name', '%classic%')
    .eq('source', 'htgsports');

  console.log('HTGSports Classic tournaments:', htgClassic?.length || 0);
  htgClassic?.forEach(t => console.log(`  - ${t.name} | ID: ${t.source_event_id} | Date: ${t.start_date}`));

  // Check specifically for event ID 13418 or similar
  const { data: byId } = await supabase
    .from('tournaments')
    .select('id, name, source, source_event_id')
    .or('source_event_id.ilike.%13418%,source_event_id.ilike.%11826%');

  console.log('\nEvents with ID 13418 or 11826:', byId?.length || 0);
  byId?.forEach(t => console.log(`  - ${t.name} | ${t.source_event_id}`));

  // Check what HTGSports events we have for Sep 2025
  const { data: septEvents } = await supabase
    .from('tournaments')
    .select('id, name, start_date, source_event_id')
    .eq('source', 'htgsports')
    .gte('start_date', '2025-09-01')
    .lte('start_date', '2025-09-30');

  console.log('\nHTGSports events in Sep 2025:', septEvents?.length || 0);
  septEvents?.forEach(t => console.log(`  - ${t.name} | Date: ${t.start_date}`));

  // Check staging for HTGSports events in Sep 2025
  const { data: stgSept } = await supabase
    .from('staging_games')
    .select('event_name')
    .eq('source', 'htgsports')
    .gte('match_date', '2025-09-01')
    .lte('match_date', '2025-09-10')
    .limit(100);

  const uniqueEvents = [...new Set(stgSept?.map(s => s.event_name))];
  console.log('\nHTGSports staging events Sep 1-10 2025:', uniqueEvents.length);
  uniqueEvents.forEach(e => console.log(`  - ${e}`));

  // Check what source events we've scraped from HTGSports overall
  const { data: htgTourns } = await supabase
    .from('tournaments')
    .select('name, source_event_id, start_date')
    .eq('source', 'htgsports')
    .order('start_date', { ascending: false })
    .limit(20);

  console.log('\nRecent HTGSports tournaments (top 20):');
  htgTourns?.forEach(t => console.log(`  - ${t.name} | ${t.source_event_id} | ${t.start_date}`));
})();
