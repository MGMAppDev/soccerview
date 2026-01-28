/**
 * Analyze V2 Data Loss - Deep Dive
 * Understanding exactly what data was excluded and why
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeDataLoss() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('         V2 DATA LOSS ANALYSIS - COMPREHENSIVE DEEP DIVE        ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Overall counts
  console.log('1. OVERALL DATA COUNTS\n');

  const { count: v1Teams } = await supabase.from('teams').select('*', { count: 'exact', head: true });
  const { count: v2Teams } = await supabase.from('teams_v2').select('*', { count: 'exact', head: true });
  const { count: v1Matches } = await supabase.from('match_results').select('*', { count: 'exact', head: true });
  const { count: v2Matches } = await supabase.from('matches_v2').select('*', { count: 'exact', head: true });

  console.log('   TEAMS:');
  console.log('     V1 (teams):        ' + v1Teams.toLocaleString());
  console.log('     V2 (teams_v2):     ' + v2Teams.toLocaleString());
  console.log('     LOST:              ' + (v1Teams - v2Teams).toLocaleString() + ' (' + ((v1Teams - v2Teams) / v1Teams * 100).toFixed(1) + '%)');

  console.log('\n   MATCHES:');
  console.log('     V1 (match_results): ' + v1Matches.toLocaleString());
  console.log('     V2 (matches_v2):    ' + v2Matches.toLocaleString());
  console.log('     LOST:               ' + (v1Matches - v2Matches).toLocaleString() + ' (' + ((v1Matches - v2Matches) / v1Matches * 100).toFixed(1) + '%)');

  // 2. Find excluded teams with high value
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('2. EXCLUDED TEAMS WITH HIGH VALUE\n');

  // Get all v2 IDs (paginated due to Supabase limit of 1000)
  let v2IdSet = new Set();
  let offset = 0;
  const pageSize = 1000;
  let totalFetched = 0;

  console.log('   Fetching V2 team IDs...');

  while (true) {
    const { data: v2Ids, error } = await supabase
      .from('teams_v2')
      .select('id')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.log('Error fetching v2 IDs:', error.message);
      break;
    }
    if (!v2Ids || v2Ids.length === 0) break;

    v2Ids.forEach(t => v2IdSet.add(t.id));
    totalFetched += v2Ids.length;
    offset += pageSize;

    // Progress indicator
    if (totalFetched % 10000 === 0) {
      console.log('   ... fetched ' + totalFetched.toLocaleString() + ' IDs');
    }

    if (v2Ids.length < pageSize) break;
  }

  console.log('   V2 ID set size: ' + v2IdSet.size.toLocaleString());

  // Get v1 teams with matches, check which are excluded
  const { data: v1TeamsWithMatches, error: v1Error } = await supabase
    .from('teams')
    .select('id, team_name, matches_played, national_rank, state')
    .gt('matches_played', 0)
    .order('matches_played', { ascending: false })
    .limit(1000);

  if (v1Error) {
    console.log('Error fetching v1 teams:', v1Error.message);
    return;
  }

  const excluded = (v1TeamsWithMatches || []).filter(t => !v2IdSet.has(t.id));

  console.log('   V1 teams with matches (top 1000): ' + v1TeamsWithMatches.length);
  console.log('   Of those, excluded from v2:       ' + excluded.length);

  console.log('\n   TOP 20 EXCLUDED TEAMS (by match count):');
  console.log('   ───────────────────────────────────────────────────────────');

  excluded.slice(0, 20).forEach((t, i) => {
    // Parse patterns from team name
    const birthMatch = t.team_name.match(/20[0-2][0-9]/);
    const ageMatch = t.team_name.match(/U(\d+)/i);
    const genderPatterns = [
      /(boys?)/i,
      /(girls?)/i,
      /\(B\)/,
      /\(G\)/,
      /\s+B\s*$/,
      /\s+G\s*$/,
      /\s+B\s+/,
      /\s+G\s+/
    ];
    const genderMatch = genderPatterns.some(p => p.test(t.team_name));

    const hasBirth = birthMatch ? '✓' : '✗';
    const hasAge = ageMatch ? '✓' : '✗';
    const hasGender = genderMatch ? '✓' : '✗';

    console.log(`   ${(i+1).toString().padStart(2)}. "${t.team_name.substring(0, 50)}..."`);
    console.log(`       matches=${t.matches_played}, rank=${t.national_rank || '-'}, state=${t.state || '-'}`);
    console.log(`       Patterns: birth=${hasBirth}, age=${hasAge}, gender=${hasGender}`);
  });

  // 3. Analyze exclusion reasons
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('3. EXCLUSION REASON ANALYSIS\n');

  let noBirthOrAge = 0;
  let noGender = 0;
  let hasBothPatterns = 0;
  let hasMatchesButExcluded = 0;
  let hasRankButExcluded = 0;

  excluded.forEach(t => {
    const birthMatch = t.team_name.match(/20[0-2][0-9]/);
    const ageMatch = t.team_name.match(/U(\d+)/i);
    const genderPatterns = [/(boys?)/i, /(girls?)/i, /\(B\)/, /\(G\)/, /\s+B$/, /\s+G$/];
    const genderMatch = genderPatterns.some(p => p.test(t.team_name));

    const hasBirthOrAge = birthMatch || ageMatch;

    if (!hasBirthOrAge) noBirthOrAge++;
    if (!genderMatch) noGender++;
    if (hasBirthOrAge && genderMatch) hasBothPatterns++;
    if (t.matches_played > 0) hasMatchesButExcluded++;
    if (t.national_rank) hasRankButExcluded++;
  });

  console.log('   From ' + excluded.length + ' excluded teams (with match history):');
  console.log('   ───────────────────────────────────────────────────────────');
  console.log('   Missing birth year OR age group:  ' + noBirthOrAge);
  console.log('   Missing gender indicator:         ' + noGender);
  console.log('   HAS BOTH patterns (false exclude): ' + hasBothPatterns);
  console.log('');
  console.log('   VALUE BEING LOST:');
  console.log('   Teams with match history excluded: ' + hasMatchesButExcluded);
  console.log('   Teams with GotSport rank excluded: ' + hasRankButExcluded);

  // 4. Check match loss cascade
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('4. MATCH LOSS CASCADE EFFECT\n');

  // Count v1 matches with linked teams
  const { count: v1FullyLinked } = await supabase
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null);

  console.log('   V1 matches with BOTH teams linked: ' + (v1FullyLinked || 'N/A').toLocaleString());
  console.log('   V2 matches:                        ' + v2Matches.toLocaleString());
  console.log('   Matches lost due to team exclusion: ' + ((v1FullyLinked || 0) - v2Matches).toLocaleString());
  console.log('');
  console.log('   EXPLANATION:');
  console.log('   When a team is excluded from v2, ALL matches involving');
  console.log('   that team are also excluded - creating a cascade effect.');

  // 5. Recommendations
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('5. RECOMMENDATIONS FOR COMPREHENSIVE DATA STRATEGY\n');

  console.log('   CURRENT APPROACH (Too Restrictive):');
  console.log('   • Skip teams without parseable birth_year');
  console.log('   • Skip teams without parseable gender');
  console.log('   • Skip matches where either team excluded');
  console.log('   • Result: 46% match data LOST');
  console.log('');
  console.log('   RECOMMENDED APPROACH (Inclusive + Quality Flags):');
  console.log('   • Include ALL teams regardless of parsing success');
  console.log('   • Add data_quality_score column (0-100)');
  console.log('   • Add birth_year_source column (parsed/inferred/unknown)');
  console.log('   • Add gender_source column (parsed/inferred/unknown)');
  console.log('   • Include ALL matches');
  console.log('   • Filter by quality at query time, not at ingest');
  console.log('');
  console.log('   BENEFITS:');
  console.log('   • Zero data loss at migration');
  console.log('   • Quality improvements can be applied retroactively');
  console.log('   • Teams without birth_year can still have ELO/matches');
  console.log('   • Matches remain linked even with incomplete team data');
}

analyzeDataLoss().catch(console.error);
