#!/usr/bin/env node
/**
 * Quick check of linking status
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatus() {
  console.log('🔍 Checking linking status...\n');

  // Total matches
  const { count: total } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true });

  // Fully linked (both home and away)
  const { count: linked } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  // Unlinked
  const unlinked = total - linked;
  const linkRate = ((linked / total) * 100).toFixed(1);

  console.log(`📊 Current Status:`);
  console.log(`   Total matches:   ${total.toLocaleString()}`);
  console.log(`   Linked:          ${linked.toLocaleString()} (${linkRate}%)`);
  console.log(`   Unlinked:        ${unlinked.toLocaleString()}`);

  // Compare to baseline
  const baseline = 393488;
  const improvement = linked - baseline;

  if (improvement > 0) {
    console.log(`\n✅ Progress: +${improvement.toLocaleString()} matches linked since baseline`);
  } else {
    console.log(`\n⏸️  No change from baseline (${baseline.toLocaleString()} linked)`);
  }

  process.exit(0);
}

checkStatus().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
