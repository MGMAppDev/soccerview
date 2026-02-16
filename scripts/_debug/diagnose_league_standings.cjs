#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    console.log('=== DIAGNOSTIC: app_league_standings VIEW ===\n');

    // Query 1: Total rows
    console.log('Query 1: Total rows in app_league_standings');
    const countResult = await pool.query('SELECT COUNT(*) FROM app_league_standings');
    console.log(`Result: ${countResult.rows[0].count} rows\n`);

    // Query 2: Distinct leagues
    console.log('Query 2: Distinct leagues with data');
    const leaguesResult = await pool.query('SELECT COUNT(DISTINCT league_id) FROM app_league_standings');
    console.log(`Result: ${leaguesResult.rows[0].count} leagues\n`);

    // Query 3: Top 20 leagues by team count
    console.log('Query 3: Top 20 leagues by team count');
    const topLeaguesResult = await pool.query(`
      SELECT league_id, league_name, COUNT(*) as team_count, 
             ROUND(SUM(CAST(played AS FLOAT))/2) as match_count
      FROM app_league_standings 
      GROUP BY league_id, league_name 
      ORDER BY team_count DESC 
      LIMIT 20
    `);
    console.log('League | Team Count | Match Count');
    console.log('------+----------+-----------');
    topLeaguesResult.rows.forEach(row => {
      console.log(`${row.league_id.substring(0, 8)}... | ${row.team_count.toString().padStart(10)} | ${(row.match_count || 0).toString().padStart(11)}`);
    });
    console.log('');

    // Query 4: First 5 leagues
    console.log('Query 4: First 5 leagues (confirm dominance by top 2)');
    const first5Result = await pool.query(`
      SELECT league_id, league_name, COUNT(*) as team_count
      FROM app_league_standings 
      GROUP BY league_id, league_name 
      ORDER BY team_count DESC 
      LIMIT 5
    `);
    let totalTop5 = 0;
    first5Result.rows.forEach(row => {
      console.log(`${row.league_name}: ${row.team_count} teams`);
      totalTop5 += row.team_count;
    });
    console.log(`Total for top 5: ${totalTop5} teams\n`);

    // Query 5: Check app_team_profile columns
    console.log('Query 5: app_team_profile columns');
    const columnsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'app_team_profile' 
      ORDER BY ordinal_position
    `);
    console.log(`Columns (${columnsResult.rows.length} total):`);
    columnsResult.rows.forEach(row => {
      console.log(`  - ${row.column_name}`);
    });
    console.log('');

    // Query 6: Current season
    console.log('Query 6: Current season');
    const seasonResult = await pool.query('SELECT * FROM seasons WHERE is_current = true');
    if (seasonResult.rows.length > 0) {
      const season = seasonResult.rows[0];
      console.log(`Name: ${season.name}`);
      console.log(`Year: ${season.year}`);
      console.log(`Start: ${season.start_date}`);
      console.log(`End: ${season.end_date}`);
      console.log(`Current: ${season.is_current}\n`);
    } else {
      console.log('No current season found\n');
    }

    // Additional diagnostic: Check if view has updated_at
    console.log('Query 7: Check app_league_standings for updated_at column');
    const viewColumnsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'app_league_standings' 
      ORDER BY ordinal_position
    `);
    console.log(`Columns in app_league_standings (${viewColumnsResult.rows.length} total):`);
    viewColumnsResult.rows.forEach(row => {
      console.log(`  - ${row.column_name}`);
    });
    console.log('');

    // Query 8: Sample rows from app_league_standings
    console.log('Query 8: Sample row from app_league_standings (first row)');
    const sampleResult = await pool.query('SELECT * FROM app_league_standings LIMIT 1');
    if (sampleResult.rows.length > 0) {
      console.log(JSON.stringify(sampleResult.rows[0], null, 2));
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

run();
