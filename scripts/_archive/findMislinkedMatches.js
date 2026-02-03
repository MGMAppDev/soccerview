/**
 * Find Mislinked Matches
 * ======================
 *
 * Identifies matches linked to a team where the team's name pattern
 * doesn't appear in either home_team_name or away_team_name.
 *
 * This catches cases where fuzzy matching incorrectly linked matches.
 *
 * Usage: node scripts/findMislinkedMatches.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Team to analyze
const TEAM_ID = 'cc329f08-1f57-4a7b-923a-768b2138fa92';
const TEAM_NAME_PATTERNS = ['SPORTING BV', 'Sporting Blue Valley'];

async function main() {
  console.log('='.repeat(70));
  console.log('FIND MISLINKED MATCHES');
  console.log('='.repeat(70));
  console.log(`Team ID: ${TEAM_ID}`);
  console.log(`Patterns: ${TEAM_NAME_PATTERNS.join(', ')}\n`);

  // Get all matches linked to this team
  const { data: homeMatches } = await supabase
    .from('match_results')
    .select('id, match_date, home_team_name, away_team_name, home_score, away_score, gender')
    .eq('home_team_id', TEAM_ID);

  const { data: awayMatches } = await supabase
    .from('match_results')
    .select('id, match_date, home_team_name, away_team_name, home_score, away_score, gender')
    .eq('away_team_id', TEAM_ID);

  console.log(`Matches where this team is HOME: ${homeMatches?.length || 0}`);
  console.log(`Matches where this team is AWAY: ${awayMatches?.length || 0}`);

  // Find mislinked HOME matches (team should be in home_team_name)
  console.log('\n--- Checking HOME matches ---');
  const mislinkedHome = [];
  for (const m of homeMatches || []) {
    const nameMatches = TEAM_NAME_PATTERNS.some(p =>
      m.home_team_name?.toUpperCase().includes(p.toUpperCase())
    );
    if (!nameMatches) {
      mislinkedHome.push(m);
      console.log(`❌ MISLINKED: ${m.match_date} | ${m.home_team_name} vs ${m.away_team_name} | Gender: ${m.gender || 'null'}`);
    }
  }

  // Find mislinked AWAY matches (team should be in away_team_name)
  console.log('\n--- Checking AWAY matches ---');
  const mislinkedAway = [];
  for (const m of awayMatches || []) {
    const nameMatches = TEAM_NAME_PATTERNS.some(p =>
      m.away_team_name?.toUpperCase().includes(p.toUpperCase())
    );
    if (!nameMatches) {
      mislinkedAway.push(m);
      console.log(`❌ MISLINKED: ${m.match_date} | ${m.home_team_name} vs ${m.away_team_name} | Gender: ${m.gender || 'null'}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total linked matches: ${(homeMatches?.length || 0) + (awayMatches?.length || 0)}`);
  console.log(`Mislinked HOME: ${mislinkedHome.length}`);
  console.log(`Mislinked AWAY: ${mislinkedAway.length}`);
  console.log(`Total to unlink: ${mislinkedHome.length + mislinkedAway.length}`);

  if (mislinkedHome.length > 0 || mislinkedAway.length > 0) {
    console.log('\n🔧 Run fixMislinkedMatches.js to unlink these matches');
  } else {
    console.log('\n✅ All matches correctly linked!');
  }

  return { mislinkedHome, mislinkedAway };
}

main();
