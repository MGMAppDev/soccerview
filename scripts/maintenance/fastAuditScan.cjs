/**
 * Fast audit scan - uses LIMIT 1 to check existence quickly
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 30000
});

async function scan() {
  console.log('=== FAST AUDIT SCAN ===\n');

  try {
    // 1. Check if ANY matchDedup records exist (LIMIT 1 is fast)
    console.log('1. Looking for matchDedup records (fast check)...');
    const matchDedupCheck = await pool.query(`
      SELECT record_id, changed_at, changed_by
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      AND changed_by = 'matchDedup'
      LIMIT 1
    `);

    if (matchDedupCheck.rows.length > 0) {
      console.log('   ✅ Found matchDedup records!');
      console.log('   Sample:', matchDedupCheck.rows[0]);
    } else {
      console.log('   ❌ No matchDedup records found');
    }

    // 2. Check what changed_by values exist for DELETEs
    console.log('\n2. Checking changed_by values (sample)...');
    const changedByCheck = await pool.query(`
      SELECT DISTINCT changed_by
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      LIMIT 20
    `);
    console.log('   changed_by values:', changedByCheck.rows.map(r => r.changed_by));

    // 3. Get ONE recent delete to see structure
    console.log('\n3. Most recent DELETE (checking structure)...');
    const recentDelete = await pool.query(`
      SELECT record_id, changed_by, changed_at,
             old_data IS NOT NULL as has_old_data,
             CASE WHEN old_data IS NOT NULL THEN jsonb_typeof(old_data) ELSE 'null' END as data_type
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      ORDER BY changed_at DESC
      LIMIT 1
    `);
    if (recentDelete.rows.length > 0) {
      console.log('   Most recent:', recentDelete.rows[0]);
    }

    // 4. Check current matches_v2 count
    console.log('\n4. Current matches_v2:');
    const current = await pool.query('SELECT COUNT(*) as count FROM matches_v2');
    console.log('   Count:', current.rows[0].count);

    // 5. Check if Session 85 migration ran
    console.log('\n5. Checking for Session 85 semantic constraint...');
    const constraintCheck = await pool.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'matches_v2'
      AND constraint_type = 'UNIQUE'
    `);
    console.log('   UNIQUE constraints:', constraintCheck.rows.map(r => r.constraint_name));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

scan();
