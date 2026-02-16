#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    console.log('=== DIAGNOSTIC: Materialized View Definition (Fixed) ===\n');

    // Query 1: Get the exact view definition
    console.log('Query 1: View definition SQL');
    const defResult = await pool.query(`
      SELECT definition
      FROM pg_matviews 
      WHERE matviewname = 'app_league_standings'
    `);
    if (defResult.rows.length > 0) {
      console.log(defResult.rows[0].definition);
    }
    console.log('');

    // Query 2: Check view size
    console.log('\nQuery 2: View size on disk');
    const sizeResult = await pool.query(`
      SELECT 
        pg_size_pretty(pg_total_relation_size('app_league_standings'::regclass)) as total_size,
        pg_size_pretty(pg_relation_size('app_league_standings'::regclass)) as table_size
    `);
    console.log(JSON.stringify(sizeResult.rows[0], null, 2));
    console.log('');

    // Query 3: Check when it was last refreshed
    console.log('Query 3: View refresh timestamp');
    const statResult = await pool.query(`
      SELECT relname, last_vacuum, last_analyze, n_tup_ins, n_tup_upd, n_tup_del
      FROM pg_stat_user_tables
      WHERE relname = 'app_league_standings'
    `);
    if (statResult.rows.length > 0) {
      console.log(JSON.stringify(statResult.rows[0], null, 2));
    } else {
      console.log('No stats found (view may be new or rarely updated)');
    }
    console.log('');

    // Query 4: Unique constraint check
    console.log('Query 4: Check for unique index on (league_id, team_id)');
    const uniqueResult = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes 
      WHERE tablename = 'app_league_standings'
      AND indexdef ILIKE '%unique%'
    `);
    console.log(`Found ${uniqueResult.rows.length} unique index(es):`);
    uniqueResult.rows.forEach(row => {
      console.log(`  ${row.indexname}: ${row.indexdef}`);
    });
    console.log('');

    // Query 5: Check primary key
    console.log('Query 5: Primary key info');
    const pkResult = await pool.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'app_league_standings'
      AND constraint_type = 'PRIMARY KEY'
    `);
    console.log(`Primary key constraints: ${pkResult.rows.length}`);
    pkResult.rows.forEach(row => {
      console.log(`  ${row.constraint_name}: ${row.constraint_type}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

run();
