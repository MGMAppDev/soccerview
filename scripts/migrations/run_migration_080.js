/**
 * Migration 080 Runner: Remove Recreational Data
 * ===============================================
 *
 * Session 84: SoccerView is Premier-Only
 *
 * This script executes the recreational data cleanup migration.
 * It handles proper authorization per GUARDRAILS §13 and logging.
 *
 * Usage:
 *   node scripts/migrations/run_migration_080.js              # Execute migration
 *   node scripts/migrations/run_migration_080.js --dry-run    # Preview only
 *
 * See:
 * - CLAUDE.md Principle 28: Premier-Only Data Policy
 * - docs/SESSION_84_PREMIER_ONLY_PLAN.md
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const DRY_RUN = process.argv.includes('--dry-run');

async function runMigration() {
  console.log('='.repeat(70));
  console.log('Migration 080: Remove Recreational Data (Premier-Only Policy)');
  console.log('Session 84: SoccerView focuses on premier/competitive soccer');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'EXECUTE'}`);
  console.log();

  const client = await pool.connect();

  try {
    // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes
    if (!DRY_RUN) {
      console.log('🔐 Authorizing pipeline writes...');
      await authorizePipelineWrite(client);
      console.log('✅ Pipeline write authorization granted\n');
    }

    // Step 1: Pre-migration counts
    console.log('📊 Pre-migration counts:');

    const recMatchesBefore = await client.query(`
      SELECT COUNT(*) as count FROM matches_v2
      WHERE source_match_key LIKE 'heartland-recreational-%'
    `);
    console.log(`   Recreational matches in matches_v2: ${recMatchesBefore.rows[0].count}`);

    const recLeaguesBefore = await client.query(`
      SELECT COUNT(*) as count FROM leagues
      WHERE name ILIKE '%recreational%' OR source_event_id LIKE 'heartland-recreational-%'
    `);
    console.log(`   Recreational leagues: ${recLeaguesBefore.rows[0].count}`);

    const recStagingBefore = await client.query(`
      SELECT COUNT(*) as count FROM staging_games
      WHERE source_match_key LIKE 'heartland-recreational-%'
    `);
    console.log(`   Recreational staging records: ${recStagingBefore.rows[0].count}`);

    const recCanonicalBefore = await client.query(`
      SELECT COUNT(*) as count FROM canonical_events
      WHERE canonical_name ILIKE '%recreational%'
    `);
    console.log(`   Recreational canonical events: ${recCanonicalBefore.rows[0].count}`);

    if (DRY_RUN) {
      console.log('\n🔍 DRY RUN - No changes made. Run without --dry-run to execute.');
      return;  // Will release in finally block
    }

    console.log('\n🚀 Executing migration...\n');

    // Step 2: Create backup table
    console.log('Step 1/5: Creating backup table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS _archived_recreational_matches AS
      SELECT * FROM matches_v2
      WHERE source_match_key LIKE 'heartland-recreational-%'
    `);
    const backupCount = await client.query(`SELECT COUNT(*) as count FROM _archived_recreational_matches`);
    console.log(`   ✅ Backed up ${backupCount.rows[0].count} matches to _archived_recreational_matches`);

    // Step 3: Delete recreational matches
    console.log('Step 2/5: Deleting recreational matches...');
    const deleteMatches = await client.query(`
      DELETE FROM matches_v2
      WHERE source_match_key LIKE 'heartland-recreational-%'
    `);
    console.log(`   ✅ Deleted ${deleteMatches.rowCount} matches from matches_v2`);

    // Step 4: Delete recreational leagues
    console.log('Step 3/5: Deleting recreational leagues...');
    const deleteLeagues = await client.query(`
      DELETE FROM leagues
      WHERE name ILIKE '%recreational%' OR source_event_id LIKE 'heartland-recreational-%'
    `);
    console.log(`   ✅ Deleted ${deleteLeagues.rowCount} leagues`);

    // Step 5: Delete from staging
    console.log('Step 4/5: Cleaning staging_games...');
    const deleteStaging = await client.query(`
      DELETE FROM staging_games
      WHERE source_match_key LIKE 'heartland-recreational-%'
    `);
    console.log(`   ✅ Deleted ${deleteStaging.rowCount} staging records`);

    // Step 6: Clean canonical registries
    console.log('Step 5/5: Cleaning canonical_events...');
    const deleteCanonical = await client.query(`
      DELETE FROM canonical_events
      WHERE canonical_name ILIKE '%recreational%'
    `);
    console.log(`   ✅ Deleted ${deleteCanonical.rowCount} canonical events`);

    // Step 7: Post-migration verification
    console.log('\n📊 Post-migration verification:');

    const recMatchesAfter = await client.query(`
      SELECT COUNT(*) as count FROM matches_v2
      WHERE source_match_key LIKE 'heartland-recreational-%'
    `);
    const recLeaguesAfter = await client.query(`
      SELECT COUNT(*) as count FROM leagues
      WHERE name ILIKE '%recreational%'
    `);

    console.log(`   Recreational matches remaining: ${recMatchesAfter.rows[0].count} (should be 0)`);
    console.log(`   Recreational leagues remaining: ${recLeaguesAfter.rows[0].count} (should be 0)`);

    if (parseInt(recMatchesAfter.rows[0].count) === 0 && parseInt(recLeaguesAfter.rows[0].count) === 0) {
      console.log('\n✅ Migration 080 completed successfully!');
    } else {
      console.log('\n⚠️ Migration completed but some recreational data may remain.');
    }

    console.log('\n📝 Next steps:');
    console.log('   1. Run: node scripts/daily/recalculate_elo_v2.js');
    console.log('   2. Run: node scripts/refresh_views_manual.js');
    console.log('   3. Run: node scripts/audit/verifyPremierOnly.cjs');
    console.log('   4. After 30 days: DROP TABLE _archived_recreational_matches');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
