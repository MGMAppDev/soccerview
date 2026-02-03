/**
 * analyze_unlinked.js - Analyze remaining unlinked matches
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function analyze() {
  // Get unlinked matches
  const { data: unlinked } = await supabase
    .from('matches_v2')
    .select('id, source_platform, source_match_key, match_date')
    .is('league_id', null)
    .is('tournament_id', null)
    .limit(5000);

  console.log('Total unlinked matches:', unlinked?.length || 0);

  // Count by source_platform
  const bySource = {};
  const withKey = unlinked?.filter(m => m.source_match_key).length || 0;
  const withoutKey = unlinked?.filter(m => !m.source_match_key).length || 0;

  unlinked?.forEach(m => {
    const src = m.source_platform || 'NULL';
    bySource[src] = (bySource[src] || 0) + 1;
  });

  console.log('\nBy source_platform:', bySource);
  console.log('With source_match_key:', withKey);
  console.log('Without source_match_key:', withoutKey);

  // Sample unlinked matches with source_match_key (should be in staging but aren't)
  const withKeyMatches = unlinked?.filter(m => m.source_match_key).slice(0, 5);
  if (withKeyMatches?.length) {
    console.log('\nSample unlinked WITH source_match_key:');
    withKeyMatches.forEach(m => console.log(' ', m.source_platform, m.source_match_key?.slice(0,30), m.match_date));

    // Check if these keys exist in staging
    const keys = withKeyMatches.map(m => m.source_match_key);
    const { data: staging } = await supabase
      .from('staging_games')
      .select('source_match_key, event_name')
      .in('source_match_key', keys);
    console.log('Found in staging:', staging?.length || 0, 'of', keys.length);
  }

  // Sample unlinked matches WITHOUT source_match_key
  const withoutKeyMatches = unlinked?.filter(m => !m.source_match_key).slice(0, 5);
  if (withoutKeyMatches?.length) {
    console.log('\nSample unlinked WITHOUT source_match_key:');
    withoutKeyMatches.forEach(m => console.log(' ', m.source_platform, m.id.slice(0,8), m.match_date));
  }

  // Date distribution
  const byYear = {};
  unlinked?.forEach(m => {
    const year = m.match_date?.split('-')[0] || 'NULL';
    byYear[year] = (byYear[year] || 0) + 1;
  });
  console.log('\nBy year:', byYear);
}

analyze().catch(console.error);
