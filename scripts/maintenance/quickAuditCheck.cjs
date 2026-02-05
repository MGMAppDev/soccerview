/**
 * Quick audit_log check - simpler queries
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 30000 // 30 second timeout
});

async function check() {
  console.log('=== QUICK AUDIT CHECK ===\n');

  try {
    // 1. Total rows in audit_log
    console.log('1. Checking audit_log table size...');
    const total = await pool.query('SELECT COUNT(*) as count FROM audit_log');
    console.log('   Total audit_log rows:', total.rows[0].count);

    // 2. Check distinct table names and actions
    console.log('\n2. Audit log contents by table/action:');
    const breakdown = await pool.query(`
      SELECT table_name, action, COUNT(*) as count
      FROM audit_log
      GROUP BY table_name, action
      ORDER BY count DESC
      LIMIT 10
    `);
    breakdown.rows.forEach(r => {
      console.log(`   ${r.table_name} | ${r.action} | ${r.count} records`);
    });

    // 3. Check specifically for matches_v2 DELETEs
    console.log('\n3. matches_v2 DELETE records:');
    const matchDeletes = await pool.query(`
      SELECT COUNT(*) as count
      FROM audit_log
      WHERE table_name = 'matches_v2' AND action = 'DELETE'
    `);
    console.log('   Count:', matchDeletes.rows[0].count);

    // 4. Sample one record
    if (parseInt(matchDeletes.rows[0].count) > 0) {
      console.log('\n4. Sample one deleted match:');
      const sample = await pool.query(`
        SELECT record_id, old_data, changed_at, changed_by
        FROM audit_log
        WHERE table_name = 'matches_v2' AND action = 'DELETE'
        LIMIT 1
      `);
      if (sample.rows.length > 0) {
        const r = sample.rows[0];
        console.log('   Record ID:', r.record_id);
        console.log('   Changed at:', r.changed_at);
        console.log('   Changed by:', r.changed_by);
        console.log('   old_data keys:', r.old_data ? Object.keys(r.old_data).join(', ') : 'NULL');
      }
    }

    // 5. Current matches_v2 count
    console.log('\n5. Current matches_v2 count:');
    const current = await pool.query('SELECT COUNT(*) as count FROM matches_v2');
    console.log('   Count:', current.rows[0].count);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

check();
