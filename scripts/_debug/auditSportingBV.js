/**
 * Audit Script: Sporting BV Pre-NAL 15 Team Data
 * 
 * Queries:
 * 1. Find team in teams_v2
 * 2. Get ALL matches from matches_v2
 * 3. Check app_team_profile view
 * 4. Check app_matches_feed for this team
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('='.repeat(80));
  console.log('AUDIT: Sporting BV Pre-NAL 15 Team Data');
  console.log('='.repeat(80));
  console.log();

  // 1. Find the team in teams_v2
  console.log('1. FINDING TEAM IN teams_v2');
  console.log('-'.repeat(80));
  
  const { data: teams, error: teamError } = await supabase
    .from('teams_v2')
    .select('id, name, birth_year, gender, club_id, elo_rating, elo_rank')
    .or('name.ilike.%Sporting%Pre-NAL%15%,name.ilike.%Sporting BV%Pre-NAL%15%');

  if (teamError) {
    console.error('Error finding team:', teamError);
    return;
  }

  console.log(`Found ${teams.length} matching team(s):\n`);
  teams.forEach(t => {
    console.log(`  ID: ${t.id}`);
    console.log(`  Name: ${t.name}`);
    console.log(`  Birth Year: ${t.birth_year}`);
    console.log(`  Gender: ${t.gender}`);
    console.log(`  Club ID: ${t.club_id}`);
    console.log(`  ELO Rating: ${t.elo_rating}`);
    console.log(`  ELO Rank: ${t.elo_rank}`);
    console.log();
  });

  if (teams.length === 0) {
    console.log('No team found. Exiting.');
    return;
  }

  const teamId = teams[0].id;
  console.log(`Using team ID: ${teamId}\n`);

  // 2. Get ALL matches from matches_v2
  console.log('2. ALL MATCHES FROM matches_v2');
  console.log('-'.repeat(80));

  const { data: matches, error: matchError } = await supabase
    .rpc('get_team_matches_audit', { team_uuid: teamId });

  // If RPC doesn't exist, use raw query approach
  if (matchError && matchError.code === 'PGRST202') {
    // Fallback: use separate queries for home and away
    console.log('(Using fallback query method)\n');
    
    const { data: homeMatches, error: homeErr } = await supabase
      .from('matches_v2')
      .select(`
        id, match_date, home_score, away_score, source_match_key, league_id, tournament_id,
        home_team:teams_v2!matches_v2_home_team_id_fkey(name),
        away_team:teams_v2!matches_v2_away_team_id_fkey(name),
        league:leagues(name),
        tournament:tournaments(name)
      `)
      .eq('home_team_id', teamId)
      .order('match_date', { ascending: false });

    const { data: awayMatches, error: awayErr } = await supabase
      .from('matches_v2')
      .select(`
        id, match_date, home_score, away_score, source_match_key, league_id, tournament_id,
        home_team:teams_v2!matches_v2_home_team_id_fkey(name),
        away_team:teams_v2!matches_v2_away_team_id_fkey(name),
        league:leagues(name),
        tournament:tournaments(name)
      `)
      .eq('away_team_id', teamId)
      .order('match_date', { ascending: false });

    if (homeErr || awayErr) {
      console.error('Error fetching matches:', homeErr || awayErr);
      return;
    }

    // Combine and sort
    const allMatches = [...(homeMatches || []), ...(awayMatches || [])];
    allMatches.sort((a, b) => new Date(b.match_date) - new Date(a.match_date));

    // Remove duplicates (in case same match appears)
    const uniqueMatches = [];
    const seenIds = new Set();
    for (const m of allMatches) {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id);
        uniqueMatches.push(m);
      }
    }

    console.log(`Found ${uniqueMatches.length} total matches:\n`);
    
    // Group by event
    const byLeague = {};
    const byTournament = {};
    const unlinked = [];

    for (const m of uniqueMatches) {
      const eventName = m.league?.name || m.tournament?.name || null;
      if (m.league_id) {
        if (!byLeague[m.league.name]) byLeague[m.league.name] = [];
        byLeague[m.league.name].push(m);
      } else if (m.tournament_id) {
        if (!byTournament[m.tournament.name]) byTournament[m.tournament.name] = [];
        byTournament[m.tournament.name].push(m);
      } else {
        unlinked.push(m);
      }
    }

    // Print matches by league
    if (Object.keys(byLeague).length > 0) {
      console.log('LEAGUE MATCHES:');
      for (const [leagueName, leagueMatches] of Object.entries(byLeague)) {
        console.log(`\n  ${leagueName} (${leagueMatches.length} matches):`);
        for (const m of leagueMatches) {
          console.log(`    ${m.match_date} | ${m.home_team?.name || 'Unknown'} ${m.home_score}-${m.away_score} ${m.away_team?.name || 'Unknown'}`);
          console.log(`      source_match_key: ${m.source_match_key}`);
        }
      }
    }

    // Print matches by tournament
    if (Object.keys(byTournament).length > 0) {
      console.log('\nTOURNAMENT MATCHES:');
      for (const [tournamentName, tournamentMatches] of Object.entries(byTournament)) {
        console.log(`\n  ${tournamentName} (${tournamentMatches.length} matches):`);
        for (const m of tournamentMatches) {
          console.log(`    ${m.match_date} | ${m.home_team?.name || 'Unknown'} ${m.home_score}-${m.away_score} ${m.away_team?.name || 'Unknown'}`);
          console.log(`      source_match_key: ${m.source_match_key}`);
        }
      }
    }

    // Print unlinked matches
    if (unlinked.length > 0) {
      console.log(`\nUNLINKED MATCHES (${unlinked.length}):`);
      for (const m of unlinked) {
        console.log(`  ${m.match_date} | ${m.home_team?.name || 'Unknown'} ${m.home_score}-${m.away_score} ${m.away_team?.name || 'Unknown'}`);
        console.log(`    source_match_key: ${m.source_match_key}`);
      }
    }

    console.log();
  } else if (matchError) {
    console.error('Error fetching matches:', matchError);
  }

  // 3. Check app_team_profile
  console.log('3. app_team_profile VIEW');
  console.log('-'.repeat(80));

  const { data: profile, error: profileError } = await supabase
    .from('app_team_profile')
    .select('*')
    .eq('id', teamId);

  if (profileError) {
    console.error('Error fetching profile:', profileError);
  } else if (profile && profile.length > 0) {
    console.log('Team Profile:');
    const p = profile[0];
    for (const [key, value] of Object.entries(p)) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
  } else {
    console.log('No profile found in app_team_profile view');
  }
  console.log();

  // 4. Check app_matches_feed
  console.log('4. app_matches_feed FOR THIS TEAM');
  console.log('-'.repeat(80));

  const { data: feedMatches, error: feedError } = await supabase
    .from('app_matches_feed')
    .select('*')
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order('match_date', { ascending: false });

  if (feedError) {
    console.error('Error fetching feed:', feedError);
  } else {
    console.log(`Found ${feedMatches?.length || 0} matches in app_matches_feed:\n`);
    for (const m of feedMatches || []) {
      console.log(`  ${m.match_date} | ${m.home_team_name} ${m.home_score}-${m.away_score} ${m.away_team_name}`);
      console.log(`    Event: ${m.event_name || 'N/A'} | Type: ${m.event_type || 'N/A'}`);
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
