/**
 * Manually process the Sept 14 match to verify the fix
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('='.repeat(70));
    console.log('MANUALLY PROCESSING SEPT 14 MATCH');
    console.log('='.repeat(70));

    // Get the staging record
    const { rows: staging } = await client.query(`
      SELECT *
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND match_date::text LIKE '2025-09-14%'
        AND home_team_name = 'Union KC Jr Elite B15'
        AND away_team_name ILIKE '%pre-nal%15%'
    `);

    if (staging.length === 0) {
      console.log('❌ Staging record not found!');
      return;
    }

    const match = staging[0];
    console.log('\nStaging record:');
    console.log('  Home:', match.home_team_name);
    console.log('  Away:', match.away_team_name);
    console.log('  Score:', match.home_score + '-' + match.away_score);
    console.log('  Date:', match.match_date);

    // Find or create teams
    console.log('\n1. Finding/creating teams...');

    // Home team: Union KC Jr Elite B15 (2015 birth year)
    // Use existing team with birth_year=2015 and gender='M'
    const HOME_TEAM_ID = '869faf7e-ac29-4d03-90b5-a435b60fad4a';
    let { rows: homeTeams } = await client.query(`
      SELECT id, display_name FROM teams_v2 WHERE id = $1
    `, [HOME_TEAM_ID]);

    let homeTeamId;
    if (homeTeams.length === 0) {
      console.log('  ❌ Home team not found!');
      return;
    } else {
      homeTeamId = homeTeams[0].id;
      console.log('  Found home team:', homeTeams[0].display_name, '(', homeTeams[0].id, ')');
    }

    // Away team: Sporting BV Pre-NAL 15
    const SPORTING_TEAM_ID = 'cc329f08-1f57-4a7b-923a-768b2138fa92';
    const { rows: awayTeams } = await client.query(`
      SELECT id, display_name FROM teams_v2 WHERE id = $1
    `, [SPORTING_TEAM_ID]);

    if (awayTeams.length === 0) {
      console.log('  ❌ Sporting BV Pre-NAL 15 not found!');
      return;
    }
    const awayTeamId = awayTeams[0].id;
    console.log('  Found away team:', awayTeams[0].display_name, '(', awayTeams[0].id, ')');

    // Find the league
    console.log('\n2. Finding league...');
    const { rows: leagues } = await client.query(`
      SELECT id, name FROM leagues WHERE name ILIKE '%Heartland Premier%2025%'
    `);

    if (leagues.length === 0) {
      console.log('  ❌ Heartland Premier League 2025 not found!');
      return;
    }
    const leagueId = leagues[0].id;
    console.log('  Found league:', leagues[0].name, '(', leagues[0].id, ')');

    // Check if match already exists
    console.log('\n3. Checking if match exists in matches_v2...');
    const { rows: existing } = await client.query(`
      SELECT id FROM matches_v2
      WHERE match_date = $1
        AND home_team_id = $2
        AND away_team_id = $3
    `, [match.match_date, homeTeamId, awayTeamId]);

    if (existing.length > 0) {
      console.log('  Match already exists:', existing[0].id);
    } else {
      // Insert the match
      console.log('\n4. Inserting match into matches_v2...');
      const sourceMatchKey = match.source_match_key || `heartland-premier-${homeTeamId.substring(0,8)}-${awayTeamId.substring(0,8)}-${match.match_date}`;

      const { rows: inserted } = await client.query(`
        INSERT INTO matches_v2 (
          match_date, home_team_id, away_team_id, home_score, away_score,
          league_id, source_match_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (source_match_key) DO NOTHING
        RETURNING id
      `, [match.match_date, homeTeamId, awayTeamId, match.home_score, match.away_score, leagueId, sourceMatchKey]);

      if (inserted.length > 0) {
        console.log('  ✅ Match inserted:', inserted[0].id);
      } else {
        console.log('  ⚠️ Match already exists (conflict on source_match_key)');
      }
    }

    // Mark staging as processed
    console.log('\n5. Marking staging record as processed...');
    await client.query(`
      UPDATE staging_games SET processed = true WHERE id = $1
    `, [match.id]);
    console.log('  ✅ Staging record marked as processed');

    // Refresh views
    console.log('\n6. Refreshing materialized views...');
    await client.query('REFRESH MATERIALIZED VIEW app_team_profile');
    await client.query('REFRESH MATERIALIZED VIEW app_league_standings');
    console.log('  ✅ Views refreshed');

    // Verify
    console.log('\n' + '='.repeat(70));
    console.log('VERIFICATION');
    console.log('='.repeat(70));

    const { rows: verify } = await client.query(`
      SELECT COUNT(*) as count
      FROM matches_v2 m
      WHERE (m.home_team_id = $1 OR m.away_team_id = $1)
        AND m.league_id IS NOT NULL
    `, [SPORTING_TEAM_ID]);

    console.log('\nSporting BV Pre-NAL 15 league matches:', verify[0].count);

    const { rows: profile } = await client.query(`
      SELECT leagues FROM app_team_profile WHERE id = $1
    `, [SPORTING_TEAM_ID]);

    const leagues2 = profile[0]?.leagues || [];
    console.log('Profile leagues:', leagues2.map(l => `${l.name} (${l.match_count})`).join(', '));

    if (verify[0].count >= 8) {
      console.log('\n✅ SUCCESS: Team now has ' + verify[0].count + ' league matches!');
    } else {
      console.log('\n⚠️ Still only ' + verify[0].count + ' matches');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
