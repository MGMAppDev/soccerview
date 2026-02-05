/**
 * Analyze deleted matches - when did they happen?
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 60000
});

async function analyze() {
  console.log('=== DELETED MATCHES ANALYSIS ===\n');

  try {
    // 1. Current matches_v2 count
    console.log('1. Current matches_v2 count...');
    const current = await pool.query('SELECT COUNT(*) as count FROM matches_v2');
    console.log('   Current count:', current.rows[0].count);

    // 2. Deletion timeline - when were matches deleted?
    console.log('\n2. Deletion timeline (by date):');
    const timeline = await pool.query(`
      SELECT
        DATE(changed_at) as deletion_date,
        COUNT(*) as count
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      GROUP BY DATE(changed_at)
      ORDER BY deletion_date DESC
      LIMIT 10
    `);
    timeline.rows.forEach(r => {
      console.log(`   ${r.deletion_date} | ${r.count} deletions`);
    });

    // 3. Most recent deletions (likely Session 85)
    console.log('\n3. Most recent deletion batch (looking for Session 85):');
    const recent = await pool.query(`
      SELECT
        DATE(changed_at) as deletion_date,
        changed_by,
        COUNT(*) as count
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      AND changed_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(changed_at), changed_by
      ORDER BY deletion_date DESC
    `);
    if (recent.rows.length === 0) {
      console.log('   No deletions in last 7 days');
    } else {
      recent.rows.forEach(r => {
        console.log(`   ${r.deletion_date} | by: ${r.changed_by || 'unknown'} | ${r.count} deletions`);
      });
    }

    // 4. Sample one of the recent deletions to see the data
    console.log('\n4. Sample recent deleted match:');
    const sample = await pool.query(`
      SELECT
        record_id,
        old_data->>'match_date' as match_date,
        old_data->>'home_score' as home_score,
        old_data->>'away_score' as away_score,
        old_data->>'source_match_key' as source_key,
        changed_at,
        changed_by
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      ORDER BY changed_at DESC
      LIMIT 1
    `);
    if (sample.rows.length > 0) {
      const r = sample.rows[0];
      console.log(`   Match date: ${r.match_date}`);
      console.log(`   Score: ${r.home_score}-${r.away_score}`);
      console.log(`   Source key: ${r.source_key}`);
      console.log(`   Deleted at: ${r.changed_at}`);
      console.log(`   Deleted by: ${r.changed_by}`);
    }

    // 5. Check if matchDedup.js was the source
    console.log('\n5. Deletions by source (changed_by):');
    const bySource = await pool.query(`
      SELECT
        COALESCE(changed_by, 'NULL') as source,
        COUNT(*) as count
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      GROUP BY changed_by
      ORDER BY count DESC
    `);
    bySource.rows.forEach(r => {
      console.log(`   ${r.source}: ${r.count} deletions`);
    });

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

analyze();
