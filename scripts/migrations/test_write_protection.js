/**
 * Test Write Protection Triggers
 *
 * Session 79 - V2 Architecture Enforcement Phase 3
 *
 * This script verifies that the write protection triggers work correctly:
 * 1. Unauthorized writes are blocked
 * 2. Authorized writes (via authorize_pipeline_write()) succeed
 * 3. Emergency disable/enable works
 *
 * Usage:
 *   node scripts/migrations/test_write_protection.js
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite, disableWriteProtection, enableWriteProtection } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function runTests() {
  console.log('='.repeat(60));
  console.log('Testing Write Protection Triggers');
  console.log('Session 79 - V2 Architecture Enforcement');
  console.log('='.repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;

  const client = await pool.connect();

  try {
    // ============================================================
    // TEST 1: Check triggers are installed
    // ============================================================
    console.log('TEST 1: Checking triggers are installed...');

    const { rows: triggers } = await client.query(`
      SELECT trigger_name, event_object_table, event_manipulation
      FROM information_schema.triggers
      WHERE trigger_name LIKE 'trg_protect_%'
        AND event_object_schema = 'public'
      ORDER BY event_object_table, event_manipulation
    `);

    if (triggers.length === 6) {
      console.log('   ✅ PASS - All 6 protection triggers installed');
      triggers.forEach(t => console.log(`      - ${t.trigger_name}`));
      passed++;
    } else if (triggers.length === 0) {
      console.log('   ⚠️  SKIP - Triggers not installed yet');
      console.log('   Run: node scripts/migrations/run_migration_070.js');
      console.log('\n⚠️  Cannot run remaining tests without triggers installed.');
      return;
    } else {
      console.log(`   ❌ FAIL - Expected 6 triggers, found ${triggers.length}`);
      failed++;
    }

    // ============================================================
    // TEST 2: Check write protection is enabled
    // ============================================================
    console.log('\nTEST 2: Checking write protection status...');

    const { rows: status } = await client.query('SELECT is_write_protection_enabled() as enabled');

    if (status[0].enabled) {
      console.log('   ✅ PASS - Write protection is enabled');
      passed++;
    } else {
      console.log('   ❌ FAIL - Write protection is disabled (should be enabled by default)');
      failed++;
    }

    // ============================================================
    // TEST 3: Unauthorized write should be blocked
    // ============================================================
    console.log('\nTEST 3: Testing unauthorized write (should be blocked)...');

    try {
      // Try to insert a dummy team without authorization
      await client.query(`
        INSERT INTO teams_v2 (id, display_name, canonical_name, birth_year, gender)
        VALUES (gen_random_uuid(), 'TEST_UNAUTHORIZED', 'test_unauthorized', 2015, 'M')
      `);

      console.log('   ❌ FAIL - Unauthorized write was NOT blocked!');
      failed++;

      // Clean up if it somehow succeeded
      await client.query("DELETE FROM teams_v2 WHERE display_name = 'TEST_UNAUTHORIZED'");
    } catch (err) {
      if (err.message.includes('UNAUTHORIZED WRITE BLOCKED')) {
        console.log('   ✅ PASS - Unauthorized write was blocked correctly');
        console.log(`      Error: ${err.message.slice(0, 80)}...`);
        passed++;
      } else {
        console.log(`   ❌ FAIL - Wrong error: ${err.message}`);
        failed++;
      }
    }

    // ============================================================
    // TEST 4: Authorized write should succeed
    // ============================================================
    console.log('\nTEST 4: Testing authorized write (should succeed)...');

    try {
      // Authorize pipeline writes
      await authorizePipelineWrite(client);

      // Now insert should work
      await client.query(`
        INSERT INTO teams_v2 (id, display_name, canonical_name, birth_year, gender)
        VALUES (gen_random_uuid(), 'TEST_AUTHORIZED', 'test_authorized', 2015, 'M')
      `);

      console.log('   ✅ PASS - Authorized write succeeded');
      passed++;

      // Clean up
      await client.query("DELETE FROM teams_v2 WHERE display_name = 'TEST_AUTHORIZED'");
      console.log('      (Test record cleaned up)');
    } catch (err) {
      console.log(`   ❌ FAIL - Authorized write failed: ${err.message}`);
      failed++;
    }

    // ============================================================
    // TEST 5: Emergency disable works
    // ============================================================
    console.log('\nTEST 5: Testing emergency disable...');

    try {
      // Disable protection
      await disableWriteProtection(client);

      // Check status
      const { rows: disabledStatus } = await client.query('SELECT is_write_protection_enabled() as enabled');

      if (!disabledStatus[0].enabled) {
        console.log('   ✅ PASS - Emergency disable worked');
        passed++;
      } else {
        console.log('   ❌ FAIL - Emergency disable did not change status');
        failed++;
      }

      // Now writes should work without authorization
      // (We use a fresh client to test since the previous one still has auth)
      const testClient = await pool.connect();
      try {
        await testClient.query(`
          INSERT INTO teams_v2 (id, display_name, canonical_name, birth_year, gender)
          VALUES (gen_random_uuid(), 'TEST_EMERGENCY', 'test_emergency', 2015, 'M')
        `);
        await testClient.query("DELETE FROM teams_v2 WHERE display_name = 'TEST_EMERGENCY'");
        console.log('   ✅ PASS - Write succeeded with protection disabled');
        passed++;
      } catch (err) {
        console.log(`   ❌ FAIL - Write failed even with protection disabled: ${err.message}`);
        failed++;
      } finally {
        testClient.release();
      }

    } catch (err) {
      console.log(`   ❌ FAIL - Emergency disable error: ${err.message}`);
      failed++;
    }

    // ============================================================
    // TEST 6: Re-enable protection
    // ============================================================
    console.log('\nTEST 6: Testing re-enable protection...');

    try {
      await enableWriteProtection(client);

      const { rows: reenabledStatus } = await client.query('SELECT is_write_protection_enabled() as enabled');

      if (reenabledStatus[0].enabled) {
        console.log('   ✅ PASS - Protection re-enabled successfully');
        passed++;
      } else {
        console.log('   ❌ FAIL - Failed to re-enable protection');
        failed++;
      }
    } catch (err) {
      console.log(`   ❌ FAIL - Re-enable error: ${err.message}`);
      failed++;
    }

    // ============================================================
    // Summary
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${passed + failed}`);
    console.log('='.repeat(60));

    if (failed === 0) {
      console.log('\n✅ All tests passed! Write protection is working correctly.');
    } else {
      console.log('\n❌ Some tests failed. Review the output above.');
      process.exit(1);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
