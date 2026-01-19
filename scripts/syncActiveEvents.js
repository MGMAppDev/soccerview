import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PRIORITY_EVENTS = [
  { id: 4696, name: 'Midwest Conference' },
  { id: 27574, name: 'Midwest Conference Fall' },
  { id: 7173, name: 'Frontier Conference' },
  { id: 34696, name: 'Heartland Soccer League' },
  { id: 35204, name: 'Nevada State League' },
  { id: 44473, name: 'North Atlantic 25-26' },
  { id: 36330, name: 'Girls Academy' },
  { id: 34558, name: 'Desert Conference' },
  { id: 40362, name: 'Mid South Conference' },
];

async function fetchGroups(eventId) {
  const res = await fetch(\https://system.gotsport.com/api/event_public_schedule/\/groups\);
  return res.ok ? await res.json() : [];
}

async function fetchMatches(eventId, groupId) {
  const res = await fetch(\https://system.gotsport.com/api/event_public_schedule/\/group/\/games\);
  return res.ok ? await res.json() : [];
}

async function processEvent(event) {
  console.log(\Processing: \ (\)\);
  const groups = await fetchGroups(event.id);
  let total = 0;
  
  for (const g of groups) {
    const matches = await fetchMatches(event.id, g.group_id || g.id);
    if (matches.length > 0) {
      const rows = matches.map(m => ({
        id: \gs-\-\\,
        event_id: event.id.toString(),
        event_name: event.name,
        match_date: m.game_date,
        home_team_name: m.home_team_name || m.home_team,
        away_team_name: m.away_team_name || m.away_team,
        home_score: m.home_score,
        away_score: m.away_score,
        status: m.home_score !== null ? 'completed' : 'scheduled',
        source_type: 'league',
        source_platform: 'gotsport',
        scraped_at: new Date().toISOString()
      }));
      
      const { error } = await supabase.from('match_results').upsert(rows, { onConflict: 'id' });
      if (!error) total += rows.length;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(\  Synced \ matches\);
}

async function main() {
  console.log('Starting Active Events Sync');
  for (const event of PRIORITY_EVENTS) {
    await processEvent(event);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('Sync complete');
}

main().catch(console.error);
