require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function trace() {
  console.log('=== TRACING MISSING HEARTLAND INVITATIONAL MATCHES ===\n');

  // The source_match_keys from staging for our team's Heartland Invitational matches
  const missingKeys = [
    'htg-13014-1356177',  // Nov 7: vs Sporting City
    'htg-13014-1356183',  // Nov 8: vs Supra United FC 15
  ];

  // Also get Nov 9 match
  const { data: nov9Staging } = await supabase
    .from('staging_games')
    .select('source_match_key, home_team_name, away_team_name')
    .ilike('event_name', '%Heartland%Invitational%')
    .or('home_team_name.ilike.%Pre-NAL 15%,away_team_name.ilike.%Pre-NAL 15%')
    .gte('match_date', '2025-11-09')
    .limit(10);

  console.log('Nov 9 staging matches:');
  nov9Staging?.forEach(s => {
    console.log('  ' + s.source_match_key + ': ' + s.home_team_name + ' vs ' + s.away_team_name);
    if (!missingKeys.includes(s.source_match_key)) missingKeys.push(s.source_match_key);
  });

  console.log('\n\nSearching for source_match_keys:', missingKeys);

  // Check if these matches exist in matches_v2
  console.log('\n\n1. CHECKING MATCHES_V2 FOR THESE SOURCE_MATCH_KEYS...\n');

  for (const key of missingKeys) {
    const { data: match } = await supabase
      .from('matches_v2')
      .select('id, match_date, home_score, away_score, home_team_id, away_team_id, tournament_id')
      .eq('source_match_key', key)
      .maybeSingle();

    if (match) {
      // Get team names
      const { data: teams } = await supabase
        .from('teams_v2')
        .select('id, display_name, birth_year')
        .in('id', [match.home_team_id, match.away_team_id]);

      const teamMap = {};
      teams?.forEach(t => { teamMap[t.id] = t; });

      console.log('\n  KEY: ' + key);
      console.log('    Found in matches_v2!');
      console.log('    match_id: ' + match.id);
      console.log('    date: ' + match.match_date + ', score: ' + match.home_score + '-' + match.away_score);
      console.log('    tournament_id: ' + match.tournament_id);

      const homeTeam = teamMap[match.home_team_id];
      const awayTeam = teamMap[match.away_team_id];

      console.log('    HOME: ' + (homeTeam?.display_name || 'UNKNOWN') + ' (birth_year: ' + (homeTeam?.birth_year || 'NULL') + ')');
      console.log('    AWAY: ' + (awayTeam?.display_name || 'UNKNOWN') + ' (birth_year: ' + (awayTeam?.birth_year || 'NULL') + ')');

      // Check if either team is our target team
      const targetTeamId = 'cc329f08-1f57-4a7b-923a-768b2138fa92';
      if (match.home_team_id === targetTeamId || match.away_team_id === targetTeamId) {
        console.log('    ✅ LINKED TO CORRECT TEAM');
      } else {
        console.log('    ❌ NOT LINKED TO CORRECT TEAM!');
      }
    } else {
      console.log('\n  KEY: ' + key);
      console.log('    ❌ NOT FOUND in matches_v2');
    }
  }

  // 2. Check if there's a team named exactly "SPORTING BV Pre-NAL 15" (without Sporting Blue Valley prefix)
  console.log('\n\n2. CHECK TEAM "SPORTING BV Pre-NAL 15" (WITHOUT CLUB PREFIX)...\n');

  const wrongTeamId = 'c877fe63-3af8-48dd-9399-a053fa8fafd8';

  const { data: wrongTeamMatches } = await supabase
    .from('matches_v2')
    .select('id, match_date, home_score, away_score, tournament_id, source_match_key, home_team_id, away_team_id')
    .or('home_team_id.eq.' + wrongTeamId + ',away_team_id.eq.' + wrongTeamId)
    .order('match_date');

  console.log('Matches linked to "SPORTING BV Pre-NAL 15" (wrong team): ' + (wrongTeamMatches?.length || 0));
  if (wrongTeamMatches && wrongTeamMatches.length > 0) {
    for (const m of wrongTeamMatches) {
      const { data: teams } = await supabase
        .from('teams_v2')
        .select('id, display_name')
        .in('id', [m.home_team_id, m.away_team_id]);
      const teamMap = {};
      teams?.forEach(t => { teamMap[t.id] = t.display_name; });

      console.log('  ' + m.match_date + ': ' + (teamMap[m.home_team_id] || '').substring(0, 35) + ' vs ' + (teamMap[m.away_team_id] || '').substring(0, 35));
      console.log('    Score: ' + m.home_score + '-' + m.away_score);
      console.log('    source_match_key: ' + m.source_match_key);
    }
  }

  // 3. Check if the 2025 Heartland Invitational tournament has the matches at all
  console.log('\n\n3. ALL MATCHES IN "2025 Heartland Invitational - Boys" TOURNAMENT...\n');

  const { data: invitTournaments } = await supabase
    .from('tournaments')
    .select('id, name, source_event_id')
    .ilike('name', '%Heartland%Invitational%Boys%');

  for (const t of (invitTournaments || [])) {
    console.log('\nTournament: ' + t.name);
    console.log('  ID: ' + t.id);
    console.log('  source_event_id: ' + t.source_event_id);

    const { count } = await supabase
      .from('matches_v2')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', t.id);

    console.log('  Total matches: ' + count);

    // Check for Pre-NAL teams in this tournament
    const { data: preNalMatches } = await supabase
      .from('matches_v2')
      .select('id, match_date, home_score, away_score, home_team_id, away_team_id, source_match_key')
      .eq('tournament_id', t.id)
      .limit(500);

    // Check team names
    const teamIds = new Set();
    preNalMatches?.forEach(m => {
      teamIds.add(m.home_team_id);
      teamIds.add(m.away_team_id);
    });

    const { data: teams } = await supabase
      .from('teams_v2')
      .select('id, display_name')
      .in('id', Array.from(teamIds));

    const teamMap = {};
    teams?.forEach(t => { teamMap[t.id] = t.display_name; });

    // Find matches with Pre-NAL teams
    const preNalInTourney = preNalMatches?.filter(m => {
      const homeName = teamMap[m.home_team_id] || '';
      const awayName = teamMap[m.away_team_id] || '';
      return homeName.includes('Pre-NAL') || awayName.includes('Pre-NAL');
    });

    console.log('  Matches with Pre-NAL teams: ' + (preNalInTourney?.length || 0));
    preNalInTourney?.slice(0, 10).forEach(m => {
      console.log('    ' + m.match_date + ': ' + (teamMap[m.home_team_id] || '').substring(0, 30) + ' vs ' + (teamMap[m.away_team_id] || '').substring(0, 30));
      console.log('      Score: ' + m.home_score + '-' + m.away_score);
    });
  }

  // 4. Check the third tournament the user mentioned
  console.log('\n\n4. OTHER FALL 2025 TOURNAMENTS THIS TEAM MIGHT HAVE PLAYED...\n');

  // Search for any tournaments between Aug-Nov 2025 with Sporting BV teams
  const { data: fallTourneys } = await supabase
    .from('tournaments')
    .select('id, name, start_date, source_event_id')
    .gte('start_date', '2025-08-01')
    .lte('start_date', '2025-11-30')
    .order('start_date');

  console.log('Fall 2025 tournaments: ' + (fallTourneys?.length || 0));

  // Check a few for Sporting BV Pre-NAL
  for (const t of (fallTourneys || []).slice(0, 30)) {
    const { data: matches } = await supabase
      .from('matches_v2')
      .select('home_team_id, away_team_id')
      .eq('tournament_id', t.id)
      .limit(500);

    const allTeamIds = new Set();
    matches?.forEach(m => {
      allTeamIds.add(m.home_team_id);
      allTeamIds.add(m.away_team_id);
    });

    const { data: teamList } = await supabase
      .from('teams_v2')
      .select('id, display_name')
      .in('id', Array.from(allTeamIds));

    const hasPreNal = teamList?.some(t =>
      t.display_name.includes('SPORTING BV Pre-NAL') ||
      t.display_name.includes('Sporting BV Pre-NAL') ||
      t.display_name.includes('Pre-NAL 15')
    );

    if (hasPreNal) {
      console.log('  * ' + t.name + ' (' + t.start_date + ')');
    }
  }
}

trace().catch(console.error);
