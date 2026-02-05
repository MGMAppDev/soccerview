import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkDuplicates() {
  // Get all matches for this team by name
  const { data: matches } = await supabase
    .from('match_results')
    .select('id, match_date, home_team_name, away_team_name, home_score, away_score, source_platform, event_id')
    .or('home_team_name.ilike.%SPORTING BV Pre-NAL 15%,away_team_name.ilike.%SPORTING BV Pre-NAL 15%')
    .order('match_date', { ascending: true });

  console.log('=== CHECKING FOR DUPLICATE MATCHES ===\n');

  // Group by date + teams
  const groups = {};
  matches?.forEach(m => {
    const key = m.match_date + '|' + m.home_team_name + '|' + m.away_team_name;
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });

  let dupCount = 0;
  for (const [key, mlist] of Object.entries(groups)) {
    if (mlist.length > 1) {
      dupCount++;
      console.log('DUPLICATE MATCH:');
      mlist.forEach(m => {
        console.log('  ID:', m.id.substring(0,8), '| Source:', m.source_platform, '| Event:', m.event_id);
      });
      console.log('  Match:', mlist[0].match_date, mlist[0].home_team_name, 'vs', mlist[0].away_team_name, mlist[0].home_score + '-' + mlist[0].away_score);
      console.log('');
    }
  }

  console.log('Total duplicate match groups:', dupCount);
  console.log('Total match records:', matches?.length);
  console.log('Unique matches:', Object.keys(groups).length);
}

checkDuplicates();
