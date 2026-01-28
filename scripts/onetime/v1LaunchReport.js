#!/usr/bin/env node
/**
 * V1 App Store Launch Readiness - Executive Summary
 * Direct answers to launch decision questions
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const LAST_3_SEASONS = '2023-08-01';

console.log('═'.repeat(90));
console.log('📊 V1 APP STORE LAUNCH READINESS REPORT');
console.log('═'.repeat(90));
console.log(`Generated: ${new Date().toLocaleString()}\n`);

async function main() {
  // ==========================================================================
  // OVERALL DATABASE METRICS
  // ==========================================================================
  console.log('📈 OVERALL DATABASE METRICS');
  console.log('─'.repeat(90));

  // Total teams in database
  const { count: totalTeams } = await supabase
    .from('teams')
    .select('id', { count: 'exact', head: true });
  console.log(`✓ Total Teams in Database: ${totalTeams?.toLocaleString()}`);

  // Matches from last 3 seasons
  const { count: matchesLast3 } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .gte('match_date', LAST_3_SEASONS);
  console.log(`✓ Matches (Last 3 Seasons): ${matchesLast3?.toLocaleString()}`);

  // Matches linked to teams (last 3 seasons)
  const { count: matchesLinked } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .gte('match_date', LAST_3_SEASONS)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);
  console.log(`✓ Matches Linked to Teams: ${matchesLinked?.toLocaleString()}`);

  // Matches NOT linked
  const matchesNotLinked = matchesLast3 - matchesLinked;
  const linkRate = ((matchesLinked / matchesLast3) * 100).toFixed(1);
  console.log(`✓ Matches NOT Linked: ${matchesNotLinked?.toLocaleString()} (${(100-linkRate).toFixed(1)}%)`);
  console.log(`  → Link Rate: ${linkRate}%\n`);

  // Teams with GotSport Rankings
  const { count: teamsWithRankings } = await supabase
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .not('national_rank', 'is', null);
  console.log(`✓ Teams with GotSport Rankings: ${teamsWithRankings?.toLocaleString()}`);

  // Teams with SoccerView ELO
  const { count: teamsWithELO } = await supabase
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .not('elo_rating', 'is', null);
  console.log(`✓ Teams with SoccerView Power Rating (ELO): ${teamsWithELO?.toLocaleString()}\n`);

  // ==========================================================================
  // HEARTLAND SOCCER BREAKDOWN
  // ==========================================================================
  console.log('🏆 HEARTLAND SOCCER BREAKDOWN');
  console.log('─'.repeat(90));

  // Find all Heartland matches (by source_platform)
  const { count: heartlandAllTime } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .or('source_platform.eq.heartland,source_platform.eq.htgsports');

  console.log(`✓ Total Heartland Matches (All Time): ${(heartlandAllTime || 0).toLocaleString()}`);

  // Heartland matches last 3 seasons
  const { count: heartlandLast3 } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .or('source_platform.eq.heartland,source_platform.eq.htgsports')
    .gte('match_date', LAST_3_SEASONS);
  console.log(`✓ Heartland Matches (Last 3 Seasons): ${(heartlandLast3 || 0).toLocaleString()}`);

  // Heartland matches linked
  const { count: heartlandLinked } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .or('source_platform.eq.heartland,source_platform.eq.htgsports')
    .gte('match_date', LAST_3_SEASONS)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  const heartlandNotLinked = (heartlandLast3 || 0) - (heartlandLinked || 0);
  const heartlandLinkRate = heartlandLast3 > 0 ? ((heartlandLinked || 0) / heartlandLast3 * 100).toFixed(1) : '0';
  console.log(`✓ Heartland Matches Linked: ${(heartlandLinked || 0).toLocaleString()}`);
  console.log(`✓ Heartland Matches NOT Linked: ${heartlandNotLinked.toLocaleString()}`);
  console.log(`  → Heartland Link Rate: ${heartlandLinkRate}%\n`);

  // Heartland teams
  const { data: heartlandTeamMatches } = await supabase
    .from('match_results')
    .select('home_team_id, away_team_id')
    .or('source_platform.eq.heartland,source_platform.eq.htgsports')
    .gte('match_date', LAST_3_SEASONS)
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  const heartlandTeamIds = new Set([
    ...(heartlandTeamMatches?.map(m => m.home_team_id) || []),
    ...(heartlandTeamMatches?.map(m => m.away_team_id) || [])
  ]);

  console.log(`✓ Heartland Teams (Last 3 Seasons): ${heartlandTeamIds.size.toLocaleString()}`);

  // Heartland teams with rankings
  if (heartlandTeamIds.size > 0) {
    const { data: heartlandRanked } = await supabase
      .from('teams')
      .select('id')
      .in('id', Array.from(heartlandTeamIds))
      .not('national_rank', 'is', null);

    const { data: heartlandELO } = await supabase
      .from('teams')
      .select('id')
      .in('id', Array.from(heartlandTeamIds))
      .not('elo_rating', 'is', null);

    console.log(`✓ Heartland Teams with GotSport Rankings: ${(heartlandRanked?.length || 0).toLocaleString()}`);
    console.log(`✓ Heartland Teams with SoccerView ELO: ${(heartlandELO?.length || 0).toLocaleString()}\n`);
  }

  // ==========================================================================
  // LAUNCH DECISION
  // ==========================================================================
  console.log('🚀 V1 LAUNCH DECISION');
  console.log('─'.repeat(90));

  const metrics = [
    { name: 'Total Teams', value: totalTeams, target: 100000, unit: '' },
    { name: 'Matches (3 seasons)', value: matchesLast3, target: 300000, unit: '' },
    { name: 'Match Link Rate', value: parseFloat(linkRate), target: 85, unit: '%' },
    { name: 'Teams w/ Rankings', value: teamsWithRankings, target: 100000, unit: '' },
    { name: 'Teams w/ ELO', value: teamsWithELO, target: 40000, unit: '' },
  ];

  let passing = 0;
  metrics.forEach(m => {
    const status = m.value >= m.target ? '✅ PASS' : '⚠️  REVIEW';
    if (m.value >= m.target) passing++;
    const valueStr = m.unit === '%' ? `${m.value}${m.unit}` : m.value?.toLocaleString();
    const targetStr = m.unit === '%' ? `${m.target}${m.unit}` : m.target?.toLocaleString();
    console.log(`${m.name.padEnd(25)} ${valueStr?.padEnd(15)} (target: ${targetStr?.padEnd(10)}) ${status}`);
  });

  console.log('\n' + '─'.repeat(90));
  console.log(`CRITERIA MET: ${passing}/${metrics.length}\n`);

  if (passing === metrics.length) {
    console.log('🎉 RECOMMENDATION: READY FOR V1 LAUNCH');
    console.log('   All launch criteria exceeded. Database is production-ready.');
  } else if (passing >= metrics.length - 1) {
    console.log('✅ RECOMMENDATION: READY FOR V1 LAUNCH');
    console.log('   Strong foundation with minor gaps. Launch and iterate.');
  } else {
    console.log('⚠️  RECOMMENDATION: ADDITIONAL WORK RECOMMENDED');
    console.log('   Consider addressing gaps before V1 launch.');
  }

  console.log('\n' + '═'.repeat(90));
  console.log('END OF REPORT');
  console.log('═'.repeat(90));
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
