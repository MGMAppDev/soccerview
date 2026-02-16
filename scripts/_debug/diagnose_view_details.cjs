#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    console.log('=== DIAGNOSTIC: View Column Details ===\n');

    // Query 1: Detailed info on app_league_standings view definition
    console.log('Query 1: View definition');
    const viewDefResult = await pool.query(`
      SELECT table_name, view_definition 
      FROM information_schema.views 
      WHERE table_name = 'app_league_standings'
    `);
    if (viewDefResult.rows.length > 0) {
      console.log('View SQL:');
      console.log(viewDefResult.rows[0].view_definition);
      console.log('');
    }

    // Query 2: Get all columns for app_league_standings with types
    console.log('\nQuery 2: All columns in app_league_standings with types');
    const colDetailResult = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'app_league_standings'
      ORDER BY ordinal_position
    `);
    console.log(`Total columns: ${colDetailResult.rows.length}`);
    colDetailResult.rows.forEach(row => {
      console.log(`  ${row.column_name.padEnd(20)} | ${row.data_type.padEnd(15)} | Nullable: ${row.is_nullable}`);
    });
    console.log('');

    // Query 3: Check if app_team_profile exists and has columns
    console.log('Query 3: Check if app_team_profile exists');
    const existsResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'app_team_profile'
      ) as exists
    `);
    console.log(`app_team_profile exists: ${existsResult.rows[0].exists}`);
    console.log('');

    if (existsResult.rows[0].exists) {
      const appTeamResult = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_team_profile'
        ORDER BY ordinal_position
      `);
      console.log(`Total columns in app_team_profile: ${appTeamResult.rows.length}`);
      appTeamResult.rows.forEach(row => {
        console.log(`  ${row.column_name.padEnd(25)} | ${row.data_type}`);
      });
      console.log('');
    }

    // Query 4: Count teams by league with LIMIT
    console.log('\nQuery 4: League standings data integrity check');
    const integrityResult = await pool.query(`
      SELECT 
        league_id,
        league_name,
        COUNT(*) as team_count,
        COUNT(DISTINCT team_id) as unique_teams,
        COUNT(DISTINCT team_name) as unique_team_names
      FROM app_league_standings
      GROUP BY league_id, league_name
      ORDER BY team_count DESC
      LIMIT 3
    `);
    integrityResult.rows.forEach(row => {
      console.log(`${row.league_name.substring(0, 40)}`);
      console.log(`  Teams: ${row.team_count}, Unique IDs: ${row.unique_teams}, Unique Names: ${row.unique_team_names}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

run();
