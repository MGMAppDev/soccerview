/**
 * Diagnose Team Data Issues
 * Compares data between v1 and v2 schemas for a specific team
 */

require('dotenv').config();
const { Client } = require('pg');

async function diagnose() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log('=== DIAGNOSING: Sporting Blue Valley SPORTING BV Pre-NAL 15 ===\n');

  // 1. Find the team in v2 schema
  const teamResult = await client.query(`
    SELECT id, canonical_name, display_name, matches_played, wins, losses, draws,
           birth_year, gender, state
    FROM teams_v2
    WHERE display_name ILIKE '%Sporting Blue Valley%Pre-NAL 15%'
    LIMIT 1
  `);

  if (teamResult.rows.length === 0) {
    console.log('Team NOT FOUND in teams_v2!');
    await client.end();
    return;
  }

  const team = teamResult.rows[0];
  console.log('TEAM (v2):', team.display_name);
  console.log('  ID:', team.id);
  console.log('  canonical_name:', team.canonical_name);
  console.log('  Stats: matches_played=' + team.matches_played + ', wins=' + team.wins + ', losses=' + team.losses + ', draws=' + team.draws);
  console.log('  Math check:', team.wins + team.losses + team.draws, '=', team.matches_played, team.wins + team.losses + team.draws === team.matches_played ? '✓' : '✗');

  // 2. Count matches in matches_v2
  const matchesV2 = await client.query(`
    SELECT COUNT(*) as count
    FROM matches_v2
    WHERE home_team_id = $1 OR away_team_id = $1
  `, [team.id]);
  console.log('\nMATCHES in matches_v2:', matchesV2.rows[0].count);

  // 3. Find team in OLD schema
  const oldTeamResult = await client.query(`
    SELECT id, team_name, matches_played, wins, losses, draws
    FROM teams
    WHERE team_name ILIKE '%Sporting Blue Valley%Pre-NAL 15%'
       OR team_name ILIKE '%Sporting BV Pre-NAL 15%'
    ORDER BY matches_played DESC
    LIMIT 5
  `);

  console.log('\nTEAMS in OLD schema (v1):');
  oldTeamResult.rows.forEach(t => {
    console.log('  -', t.team_name);
    console.log('    ID:', t.id);
    console.log('    Stats: matches=' + t.matches_played + ', W=' + t.wins + ', L=' + t.losses + ', D=' + t.draws);
  });

  // 4. Count matches in OLD match_results for each old team
  if (oldTeamResult.rows.length > 0) {
    for (const oldTeam of oldTeamResult.rows) {
      const oldMatches = await client.query(`
        SELECT COUNT(*) as count
        FROM match_results
        WHERE home_team_id = $1 OR away_team_id = $1
      `, [oldTeam.id]);
      console.log('  Matches in match_results for', oldTeam.id + ':', oldMatches.rows[0].count);
    }
  }

  // 5. Check for matches by team NAME in old schema (unlinked)
  const unlinkedMatches = await client.query(`
    SELECT COUNT(*) as count
    FROM match_results
    WHERE (home_team_name ILIKE '%Sporting Blue Valley%Pre-NAL 15%'
           OR away_team_name ILIKE '%Sporting Blue Valley%Pre-NAL 15%'
           OR home_team_name ILIKE '%Sporting BV Pre-NAL 15%'
           OR away_team_name ILIKE '%Sporting BV Pre-NAL 15%')
      AND (home_team_id IS NULL OR away_team_id IS NULL)
  `);
  console.log('\nUNLINKED matches (by name) in v1:', unlinkedMatches.rows[0].count);

  // 6. Check schedules
  const schedules = await client.query(`
    SELECT COUNT(*) as count
    FROM schedules
    WHERE home_team_id = $1 OR away_team_id = $1
  `, [team.id]);
  console.log('\nUPCOMING SCHEDULES in schedules table:', schedules.rows[0].count);

  // 7. Sample the actual matches in v2 to see their details
  const sampleMatches = await client.query(`
    SELECT m.id, m.match_date, m.home_score, m.away_score,
           ht.canonical_name as home_team, at.canonical_name as away_team,
           l.name as league_name, t.name as tournament_name
    FROM matches_v2 m
    JOIN teams_v2 ht ON m.home_team_id = ht.id
    JOIN teams_v2 at ON m.away_team_id = at.id
    LEFT JOIN leagues l ON m.league_id = l.id
    LEFT JOIN tournaments t ON m.tournament_id = t.id
    WHERE m.home_team_id = $1 OR m.away_team_id = $1
    ORDER BY m.match_date DESC
    LIMIT 15
  `, [team.id]);

  console.log('\nSAMPLE MATCHES (v2):');
  sampleMatches.rows.forEach(m => {
    const event = m.league_name || m.tournament_name || 'Unknown';
    console.log('  ' + m.match_date + ': ' + m.home_team + ' ' + m.home_score + '-' + m.away_score + ' ' + m.away_team + ' [' + event + ']');
  });

  // 8. Check what's in app_team_profile view for this team
  const profileResult = await client.query(`
    SELECT
      matches_played, wins, losses, draws,
      jsonb_array_length(recent_matches) as recent_matches_count,
      jsonb_array_length(upcoming_schedule) as upcoming_schedule_count
    FROM app_team_profile
    WHERE id = $1
  `, [team.id]);

  if (profileResult.rows.length > 0) {
    const profile = profileResult.rows[0];
    console.log('\nAPP_TEAM_PROFILE view:');
    console.log('  matches_played:', profile.matches_played);
    console.log('  W-L-D:', profile.wins + '-' + profile.losses + '-' + profile.draws);
    console.log('  recent_matches embedded:', profile.recent_matches_count);
    console.log('  upcoming_schedule embedded:', profile.upcoming_schedule_count);
  }

  await client.end();
}

diagnose().catch(console.error);
