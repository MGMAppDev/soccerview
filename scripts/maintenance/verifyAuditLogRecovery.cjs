/**
 * Session 86: Pre-Flight Verification
 * Verifies audit_log contains deleted match records for recovery
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verify() {
  console.log('=== PHASE 0: PRE-FLIGHT VERIFICATION ===\n');

  try {
    // 1. Check if audit_log table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'audit_log'
      ) as exists
    `);
    console.log('1. audit_log table exists:', tableCheck.rows[0].exists);

    if (!tableCheck.rows[0].exists) {
      console.log('\nERROR: audit_log table does not exist!');
      console.log('Recovery from audit_log is NOT possible.');
      console.log('Alternative: Use Supabase Point-in-Time Recovery or V1 archive.');
      process.exit(1);
    }

    // 2. Count deleted matches in audit_log
    const deleteCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      AND old_data IS NOT NULL
    `);
    console.log('2. Deleted matches in audit_log:', deleteCount.rows[0].count);

    // 3. Current matches_v2 count (baseline)
    const matchCount = await pool.query('SELECT COUNT(*) as count FROM matches_v2');
    console.log('3. Current matches_v2 count:', matchCount.rows[0].count);

    // 4. Sample 5 deleted matches to verify data completeness
    const sample = await pool.query(`
      SELECT
        record_id,
        old_data->>'match_date' as match_date,
        old_data->>'home_team_id' as home_team_id,
        old_data->>'away_team_id' as away_team_id,
        old_data->>'home_score' as home_score,
        old_data->>'away_score' as away_score,
        old_data->>'league_id' as league_id,
        old_data->>'tournament_id' as tournament_id,
        old_data->>'source_match_key' as source_match_key,
        old_data->>'source_platform' as source_platform,
        changed_at
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      AND old_data IS NOT NULL
      ORDER BY changed_at DESC
      LIMIT 5
    `);

    console.log('\n4. Sample deleted matches (most recent):');
    if (sample.rows.length === 0) {
      console.log('   NO DELETED MATCHES FOUND IN AUDIT_LOG!');
      console.log('\n   Recovery from audit_log is NOT possible.');
      console.log('   Alternative: Use Supabase Point-in-Time Recovery or V1 archive.');
    } else {
      sample.rows.forEach((r, i) => {
        console.log(`   [${i+1}] ${r.match_date} | Score: ${r.home_score}-${r.away_score}`);
        console.log(`       Key: ${r.source_match_key ? r.source_match_key.substring(0, 50) : 'NULL'}...`);
        console.log(`       League: ${r.league_id || 'NULL'} | Tournament: ${r.tournament_id || 'NULL'}`);
        console.log(`       Deleted at: ${r.changed_at}`);
        console.log('');
      });
    }

    // 5. Check what columns are in old_data
    const columnCheck = await pool.query(`
      SELECT DISTINCT jsonb_object_keys(old_data) as col
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      AND old_data IS NOT NULL
      LIMIT 1
    `);

    if (columnCheck.rows.length > 0) {
      // Get all keys from first record
      const keysQuery = await pool.query(`
        SELECT jsonb_object_keys(old_data) as col
        FROM audit_log
        WHERE table_name = 'matches_v2'
        AND action = 'DELETE'
        AND old_data IS NOT NULL
        LIMIT 1
      `);
      console.log('5. Columns available in old_data:');
      console.log('   ', keysQuery.rows.map(r => r.col).join(', '));
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    const deletedCount = parseInt(deleteCount.rows[0].count);
    const currentCount = parseInt(matchCount.rows[0].count);

    if (deletedCount > 0) {
      console.log(`✅ RECOVERY IS POSSIBLE`);
      console.log(`   ${deletedCount} matches can be recovered from audit_log`);
      console.log(`   Current matches_v2: ${currentCount}`);
      console.log(`   After recovery: ~${currentCount + deletedCount}`);
    } else {
      console.log(`❌ NO DELETED MATCHES IN AUDIT_LOG`);
      console.log(`   Must use alternative recovery method`);
    }

  } catch (err) {
    console.error('Error:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

verify().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
