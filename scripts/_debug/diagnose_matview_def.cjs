#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    console.log('=== DIAGNOSTIC: Materialized View Definition ===\n');

    // Query 1: Get the exact view definition
    console.log('Query 1: View definition SQL');
    const defResult = await pool.query(`
      SELECT pg_get_viewdef(oid) as definition
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
    console.log('Query 3: View refresh timestamp (from pg_stat_user_tables)');
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

    // Query 5: Sample data from different positions
    console.log('Query 5: Sample data distribution check');
    const sampleDistResult = await pool.query(`
      SELECT 
        'First 10' as position,
        COUNT(*) as count,
        COUNT(DISTINCT league_id) as leagues
      FROM app_league_standings
      WHERE team_id IN (
        SELECT team_id FROM app_league_standings ORDER BY ctid LIMIT 10
      )
      UNION ALL
      SELECT 
        'Middle 10' as position,
        COUNT(*) as count,
        COUNT(DISTINCT league_id) as leagues
      FROM app_league_standings
      WHERE team_id IN (
        SELECT team_id FROM app_league_standings ORDER BY ctid OFFSET 9929 LIMIT 10
      )
      UNION ALL
      SELECT 
        'Last 10' as position,
        COUNT(*) as count,
        COUNT(DISTINCT league_id) as leagues
      FROM app_league_standings
      WHERE team_id IN (
        SELECT team_id FROM app_league_standings ORDER BY ctid DESC LIMIT 10
      )
    `);
    console.log('Position | Count | Leagues');
    sampleDistResult.rows.forEach(row => {
      console.log(`${row.position.padEnd(15)} | ${row.count.toString().padStart(5)} | ${row.leagues}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

run();
