/**
 * Migration Runner: 070_create_write_protection_triggers.sql
 *
 * Session 79 - V2 Architecture Enforcement Phase 3
 *
 * This migration creates database triggers that block direct writes to
 * production tables (teams_v2, matches_v2) unless the session is authorized.
 *
 * Usage:
 *   node scripts/migrations/run_migration_070.js
 *   node scripts/migrations/run_migration_070.js --dry-run
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function runMigration() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('='.repeat(60));
  console.log('Migration 070: Write Protection Triggers');
  console.log('Session 79 - V2 Architecture Enforcement Phase 3');
  console.log('='.repeat(60));
  console.log();

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  const client = await pool.connect();

  try {
    // Read the migration SQL file
    const sqlPath = path.join(__dirname, '070_create_write_protection_triggers.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('📋 Migration will create:');
    console.log('   - pipeline_config table (stores protection status)');
    console.log('   - authorize_pipeline_write() function');
    console.log('   - revoke_pipeline_write() function');
    console.log('   - is_pipeline_authorized() function');
    console.log('   - disable_write_protection() function (emergency)');
    console.log('   - enable_write_protection() function');
    console.log('   - 6 protection triggers on teams_v2 and matches_v2');
    console.log('   - pipeline_blocked_writes audit table');
    console.log();

    if (dryRun) {
      console.log('✅ Dry run complete - SQL validated');
      console.log('\nTo apply this migration, run without --dry-run flag');
      return;
    }

    // Check current state
    const { rows: existingTriggers } = await client.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_name LIKE 'trg_protect_%'
        AND event_object_schema = 'public'
      ORDER BY trigger_name
    `);

    if (existingTriggers.length > 0) {
      console.log('⚠️  Found existing protection triggers:');
      existingTriggers.forEach(t => console.log(`   - ${t.trigger_name} on ${t.event_object_table}`));
      console.log('   These will be replaced.\n');
    }

    // Execute the migration
    console.log('🚀 Applying migration...\n');
    await client.query(sql);

    // Verify installation
    const { rows: newTriggers } = await client.query(`
      SELECT trigger_name, event_object_table, event_manipulation
      FROM information_schema.triggers
      WHERE trigger_name LIKE 'trg_protect_%'
        AND event_object_schema = 'public'
      ORDER BY event_object_table, event_manipulation
    `);

    console.log('✅ Migration applied successfully!\n');
    console.log('📊 Installed triggers:');
    newTriggers.forEach(t => {
      console.log(`   - ${t.trigger_name} (${t.event_manipulation} on ${t.event_object_table})`);
    });

    // Check protection status
    const { rows: status } = await client.query(`
      SELECT is_write_protection_enabled() as enabled
    `);

    console.log();
    console.log('🛡️  Write Protection Status:', status[0].enabled ? '✅ ENABLED' : '❌ DISABLED');
    console.log();
    console.log('='.repeat(60));
    console.log('IMPORTANT: Update authorized scripts to call:');
    console.log('  await pool.query("SELECT authorize_pipeline_write()");');
    console.log('before any writes to teams_v2 or matches_v2.');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error(err);
  process.exit(1);
});
