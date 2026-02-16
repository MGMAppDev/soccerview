#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    console.log('=== DIAGNOSTIC: Materialized View Details ===\n');

    // Query 1: Check if it's a materialized view
    console.log('Query 1: Is app_league_standings a materialized view?');
    const matViewResult = await pool.query(`
      SELECT schemaname, matviewname, matviewowner
      FROM pg_matviews 
      WHERE matviewname = 'app_league_standings'
    `);
    if (matViewResult.rows.length > 0) {
      console.log('YES - Materialized View Details:');
      console.log(JSON.stringify(matViewResult.rows[0], null, 2));
    } else {
      console.log('NOT a materialized view in pg_matviews');
    }
    console.log('');

    // Query 2: Check if it's a regular view
    console.log('Query 2: Is it a regular view?');
    const regViewResult = await pool.query(`
      SELECT schemaname, viewname, viewowner
      FROM pg_views 
      WHERE viewname = 'app_league_standings'
    `);
    if (regViewResult.rows.length > 0) {
      console.log('YES - Regular View Details:');
      console.log(JSON.stringify(regViewResult.rows[0], null, 2));
    } else {
      console.log('NOT a regular view in pg_views');
    }
    console.log('');

    // Query 3: Check table type from pg_tables
    console.log('Query 3: Check pg_tables for app_league_standings');
    const tableResult = await pool.query(`
      SELECT schemaname, tablename, tableowner 
      FROM pg_tables 
      WHERE tablename = 'app_league_standings'
    `);
    if (tableResult.rows.length > 0) {
      console.log('Found in pg_tables:');
      console.log(JSON.stringify(tableResult.rows[0], null, 2));
    } else {
      console.log('NOT found in pg_tables');
    }
    console.log('');

    // Query 4: Get columns using a different method - actual SELECT
    console.log('Query 4: Get actual columns by selecting and checking structure');
    const sampleResult = await pool.query('SELECT * FROM app_league_standings LIMIT 1');
    if (sampleResult.rows.length > 0) {
      const columns = Object.keys(sampleResult.rows[0]);
      console.log(`Total columns: ${columns.length}`);
      columns.forEach(col => {
        const value = sampleResult.rows[0][col];
        const type = Array.isArray(value) ? 'array' : typeof value;
        console.log(`  ${col.padEnd(25)} | Type: ${type}`);
      });
    }
    console.log('');

    // Query 5: Check if app_league_standings has index
    console.log('Query 5: Indexes on app_league_standings');
    const indexResult = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes 
      WHERE tablename = 'app_league_standings'
    `);
    if (indexResult.rows.length > 0) {
      console.log(`Found ${indexResult.rows.length} index(es):`);
      indexResult.rows.forEach(row => {
        console.log(`  ${row.indexname}: ${row.indexdef}`);
      });
    } else {
      console.log('No indexes found');
    }
    console.log('');

    // Query 6: Check if there's a unique constraint
    console.log('Query 6: Constraints on app_league_standings');
    const constraintResult = await pool.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'app_league_standings'
    `);
    console.log(`Found ${constraintResult.rows.length} constraint(s):`);
    constraintResult.rows.forEach(row => {
      console.log(`  ${row.constraint_name}: ${row.constraint_type}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

run();
