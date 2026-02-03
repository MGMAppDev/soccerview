/**
 * Find missing match: 09/14 Union Kansas City KC Jr Elite - 4-1
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const TEAM_ID = 'cc329f08-1f57-4a7b-923a-768b2138fa92';

async function run() {
  const client = await pool.connect();
  try {
    console.log('='.repeat(70));
    console.log('SEARCHING FOR MISSING MATCH: 09/14 Union Kansas City - 4-1');
    console.log('='.repeat(70));

    // 1. Search matches_v2 for any Sept 14 match
    console.log('\n1. Checking matches_v2 for Sept 14, 2025...\n');

    const { rows: sept14Matches } = await client.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,
        m.home_team_id,
        m.away_team_id,
        m.league_id,
        m.tournament_id,
        ht.display_name as home_team,
        at.display_name as away_team
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      WHERE m.match_date::text LIKE '2025-09-14%'
        AND (m.home_team_id = $1 OR m.away_team_id = $1)
    `, [TEAM_ID]);

    if (sept14Matches.length === 0) {
      console.log('  ❌ No matches found on Sept 14 for this team');
    } else {
      console.log('  Found matches:');
      sept14Matches.forEach(m => {
        console.log(`    ${m.match_date}: ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
      });
    }

    // 2. Search for ANY match with "Union" in team name
    console.log('\n2. Checking matches_v2 for any "Union Kansas City" match...\n');

    const { rows: unionMatches } = await client.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,
        ht.display_name as home_team,
        at.display_name as away_team,
        m.league_id,
        m.tournament_id
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      WHERE (m.home_team_id = $1 OR m.away_team_id = $1)
        AND (ht.display_name ILIKE '%union%' OR at.display_name ILIKE '%union%')
    `, [TEAM_ID]);

    if (unionMatches.length === 0) {
      console.log('  ❌ No matches found against any "Union" team');
    } else {
      console.log('  Found matches:');
      unionMatches.forEach(m => {
        console.log(`    ${m.match_date}: ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
      });
    }

    // 3. Search staging_games for the missing match
    console.log('\n3. Checking staging_games for Sept 14 or Union KC match...\n');

    const { rows: stagingMatches } = await client.query(`
      SELECT
        id,
        match_date,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        source_platform,
        event_name,
        processed,
        scraped_at
      FROM staging_games
      WHERE (
        home_team_name ILIKE '%sporting%bv%pre%nal%'
        OR away_team_name ILIKE '%sporting%bv%pre%nal%'
        OR home_team_name ILIKE '%sporting blue valley%pre%nal%'
        OR away_team_name ILIKE '%sporting blue valley%pre%nal%'
      )
      AND (
        home_team_name ILIKE '%union%'
        OR away_team_name ILIKE '%union%'
        OR match_date::text LIKE '2025-09-14%'
      )
      ORDER BY match_date DESC
    `);

    if (stagingMatches.length === 0) {
      console.log('  ❌ No staging records found for this match');
    } else {
      console.log('  Found staging records:');
      stagingMatches.forEach(m => {
        console.log(`    ${m.match_date}: ${m.home_team_name} vs ${m.away_team_name}`);
        console.log(`      Score: ${m.home_score}-${m.away_score}, Event: ${m.event_name}`);
        console.log(`      Source: ${m.source_platform}, Processed: ${m.processed}`);
      });
    }

    // 4. Check if there's a Union Kansas City team in teams_v2
    console.log('\n4. Checking for Union Kansas City teams in teams_v2...\n');

    const { rows: unionTeams } = await client.query(`
      SELECT id, display_name, canonical_name, birth_year, gender
      FROM teams_v2
      WHERE display_name ILIKE '%union%kansas%'
        OR display_name ILIKE '%union%kc%'
        OR canonical_name ILIKE '%union%kansas%'
        OR canonical_name ILIKE '%union%kc%'
      ORDER BY display_name
      LIMIT 20
    `);

    if (unionTeams.length === 0) {
      console.log('  ❌ No Union Kansas City teams found');
    } else {
      console.log(`  Found ${unionTeams.length} Union KC teams:`);
      unionTeams.forEach(t => {
        console.log(`    ${t.display_name} (birth_year: ${t.birth_year}, gender: ${t.gender})`);
      });
    }

    // 5. Check if match exists but linked to wrong team
    console.log('\n5. Checking if match exists with different Sporting BV team...\n');

    const { rows: allSportingTeams } = await client.query(`
      SELECT id, display_name, birth_year
      FROM teams_v2
      WHERE display_name ILIKE '%sporting%bv%pre%nal%'
        OR display_name ILIKE '%sporting blue valley%pre%nal%'
      ORDER BY birth_year NULLS LAST
    `);

    console.log(`  Found ${allSportingTeams.length} Sporting BV Pre-NAL teams:`);
    allSportingTeams.forEach(t => {
      console.log(`    ${t.id}: ${t.display_name} (birth_year: ${t.birth_year})`);
    });

    // Check matches for any of these teams on Sept 14
    if (allSportingTeams.length > 0) {
      const teamIds = allSportingTeams.map(t => t.id);
      const { rows: otherTeamMatches } = await client.query(`
        SELECT
          m.id,
          m.match_date,
          m.home_score,
          m.away_score,
          m.home_team_id,
          m.away_team_id,
          ht.display_name as home_team,
          at.display_name as away_team
        FROM matches_v2 m
        JOIN teams_v2 ht ON m.home_team_id = ht.id
        JOIN teams_v2 at ON m.away_team_id = at.id
        WHERE m.match_date::text LIKE '2025-09-14%'
          AND (m.home_team_id = ANY($1) OR m.away_team_id = ANY($1))
      `, [teamIds]);

      if (otherTeamMatches.length > 0) {
        console.log('\n  ⚠️ Found Sept 14 matches for other Sporting BV teams:');
        otherTeamMatches.forEach(m => {
          console.log(`    ${m.match_date}: ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
          console.log(`    Home ID: ${m.home_team_id}, Away ID: ${m.away_team_id}`);
        });
      }
    }

    // 6. Search all matches on Sept 14 with 4-1 score
    console.log('\n6. Searching ALL matches on Sept 14, 2025 with 4-1 score...\n');

    const { rows: all41Matches } = await client.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,
        ht.display_name as home_team,
        at.display_name as away_team,
        m.league_id,
        l.name as league_name
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      LEFT JOIN leagues l ON m.league_id = l.id
      WHERE m.match_date::text LIKE '2025-09-14%'
        AND ((m.home_score = 4 AND m.away_score = 1) OR (m.home_score = 1 AND m.away_score = 4))
      LIMIT 50
    `);

    if (all41Matches.length === 0) {
      console.log('  ❌ No 4-1 matches found on Sept 14');
    } else {
      console.log(`  Found ${all41Matches.length} matches with 4-1 score:`);
      all41Matches.forEach(m => {
        console.log(`    ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
        console.log(`    League: ${m.league_name || 'None'}`);
      });
    }

    // 7. Check staging for Sept 14 Heartland matches
    console.log('\n7. Checking staging_games for ALL Heartland Sept 14 matches...\n');

    const { rows: heartlandSept14 } = await client.query(`
      SELECT
        id,
        match_date,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        event_name,
        source_platform,
        processed
      FROM staging_games
      WHERE match_date::text LIKE '2025-09-14%'
        AND (event_name ILIKE '%heartland%' OR source_platform = 'heartland')
      ORDER BY home_team_name
      LIMIT 100
    `);

    if (heartlandSept14.length === 0) {
      console.log('  ❌ No Heartland staging records for Sept 14');
    } else {
      console.log(`  Found ${heartlandSept14.length} Heartland matches on Sept 14:`);
      heartlandSept14.forEach(m => {
        console.log(`    ${m.home_team_name} vs ${m.away_team_name} (${m.home_score}-${m.away_score})`);
        console.log(`      Event: ${m.event_name}, Processed: ${m.processed}`);
      });
    }

    console.log('\n' + '='.repeat(70));
    console.log('INVESTIGATION COMPLETE');
    console.log('='.repeat(70));

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
