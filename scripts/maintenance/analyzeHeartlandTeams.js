/**
 * Analyze Heartland Teams - Check what teams we can extract from match data
 */

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function analyze() {
  const client = await pool.connect();

  try {
    // Get unique team names from Heartland matches
    const teams = await client.query(`
      WITH heartland_teams AS (
        SELECT DISTINCT home_team_name as name, age_group, gender
        FROM match_results
        WHERE source_platform IN ('htgsports', 'heartland')
          AND home_team_name IS NOT NULL
          AND LENGTH(home_team_name) >= 4
        UNION
        SELECT DISTINCT away_team_name as name, age_group, gender
        FROM match_results
        WHERE source_platform IN ('htgsports', 'heartland')
          AND away_team_name IS NOT NULL
          AND LENGTH(away_team_name) >= 4
      )
      SELECT COUNT(DISTINCT name) as unique_teams,
             COUNT(DISTINCT name) FILTER (WHERE age_group IS NOT NULL) as with_age
      FROM heartland_teams
    `);

    console.log('HEARTLAND TEAMS AVAILABLE FROM MATCH DATA:');
    console.log('  Unique team names:', teams.rows[0].unique_teams);
    console.log('  With age_group:', teams.rows[0].with_age);

    // Check how many already exist in teams table (exact match)
    const existing = await client.query(`
      WITH heartland_names AS (
        SELECT DISTINCT LOWER(TRIM(home_team_name)) as name
        FROM match_results
        WHERE source_platform IN ('htgsports', 'heartland')
          AND home_team_name IS NOT NULL
          AND LENGTH(home_team_name) >= 4
        UNION
        SELECT DISTINCT LOWER(TRIM(away_team_name)) as name
        FROM match_results
        WHERE source_platform IN ('htgsports', 'heartland')
          AND away_team_name IS NOT NULL
          AND LENGTH(away_team_name) >= 4
      )
      SELECT
        COUNT(*) as heartland_names,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM teams t WHERE LOWER(t.team_name) = hn.name
        )) as already_in_teams
      FROM heartland_names hn
    `);

    console.log('\nCROSS-REFERENCE WITH TEAMS TABLE:');
    console.log('  Heartland team names:', existing.rows[0].heartland_names);
    console.log('  Already in teams table:', existing.rows[0].already_in_teams);
    console.log('  Need to CREATE:', existing.rows[0].heartland_names - existing.rows[0].already_in_teams);

    // Sample of names NOT in teams table
    const missing = await client.query(`
      WITH heartland_names AS (
        SELECT DISTINCT home_team_name as name, age_group, gender
        FROM match_results
        WHERE source_platform IN ('htgsports', 'heartland')
          AND home_team_name IS NOT NULL
          AND LENGTH(home_team_name) >= 4
        UNION
        SELECT DISTINCT away_team_name as name, age_group, gender
        FROM match_results
        WHERE source_platform IN ('htgsports', 'heartland')
          AND away_team_name IS NOT NULL
          AND LENGTH(away_team_name) >= 4
      )
      SELECT hn.name, hn.age_group, hn.gender
      FROM heartland_names hn
      WHERE NOT EXISTS (
        SELECT 1 FROM teams t WHERE LOWER(t.team_name) = LOWER(hn.name)
      )
      AND hn.name NOT IN ('TBD', '1', '2', '3', '4', '5')
      LIMIT 20
    `);

    console.log('\nSAMPLE OF TEAMS TO CREATE:');
    for (const row of missing.rows) {
      console.log(`  ${row.name} | ${row.age_group || 'no age'} | ${row.gender || 'no gender'}`);
    }

    // Check current link status
    const linkStatus = await client.query(`
      SELECT
        source_platform,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NULL AND away_team_id IS NULL) as both_unlinked,
        COUNT(*) FILTER (WHERE (home_team_id IS NULL) != (away_team_id IS NULL)) as partial
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
      GROUP BY source_platform
    `);

    console.log('\nCURRENT LINK STATUS:');
    for (const row of linkStatus.rows) {
      console.log(`  ${row.source_platform}:`);
      console.log(`    Total: ${row.total}`);
      console.log(`    Fully linked: ${row.fully_linked} (${(row.fully_linked/row.total*100).toFixed(1)}%)`);
      console.log(`    Both unlinked: ${row.both_unlinked}`);
      console.log(`    Partial: ${row.partial}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

analyze().catch(console.error);
