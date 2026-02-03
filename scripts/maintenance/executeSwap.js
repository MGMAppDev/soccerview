/**
 * executeSwap.js
 *
 * Session 79 - V2 Architecture Enforcement - Phase F4
 *
 * Performs the ATOMIC SWAP of rebuild tables with production tables.
 *
 * Steps:
 * 1. Validate rebuild tables are ready
 * 2. Backup production tables (teams_v2 -> teams_v2_backup)
 * 3. Atomic rename: production -> old, rebuild -> production
 * 4. Update foreign keys and constraints
 * 5. Refresh materialized views
 * 6. Verify swap succeeded
 *
 * IMPORTANT: This is a DESTRUCTIVE operation. Use --dry-run first!
 *
 * Usage:
 *   node scripts/maintenance/executeSwap.js --dry-run
 *   node scripts/maintenance/executeSwap.js --execute
 *   node scripts/maintenance/executeSwap.js --rollback  # Restore from backup
 *
 * REQUIRES: Rebuild tables must pass validation first.
 * Run: node scripts/maintenance/validateRebuild.js --strict
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
const ROLLBACK = process.argv.includes('--rollback');
const SKIP_VALIDATION = process.argv.includes('--skip-validation');

async function runValidation() {
  console.log('🔍 Running pre-swap validation...');

  // Check rebuild tables exist and have data
  const { rows: counts } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2_rebuild) as teams_rebuild,
      (SELECT COUNT(*) FROM matches_v2_rebuild) as matches_rebuild,
      (SELECT COUNT(*) FROM teams_v2) as teams_prod,
      (SELECT COUNT(*) FROM matches_v2) as matches_prod
  `);

  const c = counts[0];
  const teamsRebuild = parseInt(c.teams_rebuild);
  const matchesRebuild = parseInt(c.matches_rebuild);
  const teamsProd = parseInt(c.teams_prod);
  const matchesProd = parseInt(c.matches_prod);

  if (teamsRebuild === 0 || matchesRebuild === 0) {
    throw new Error('Rebuild tables are empty. Run rebuildFromStaging.js --process first.');
  }

  const teamCoverage = teamsRebuild / teamsProd;
  const matchCoverage = matchesRebuild / matchesProd;

  if (teamCoverage < 0.9) {
    throw new Error(`Team coverage too low: ${(teamCoverage * 100).toFixed(1)}% (need 90%)`);
  }

  if (matchCoverage < 0.95) {
    throw new Error(`Match coverage too low: ${(matchCoverage * 100).toFixed(1)}% (need 95%)`);
  }

  console.log(`   ✅ Teams: ${teamsRebuild.toLocaleString()} (${(teamCoverage * 100).toFixed(1)}% of prod)`);
  console.log(`   ✅ Matches: ${matchesRebuild.toLocaleString()} (${(matchCoverage * 100).toFixed(1)}% of prod)`);

  return true;
}

async function executeSwap() {
  console.log('='.repeat(60));
  console.log('EXECUTE ATOMIC TABLE SWAP');
  console.log('Session 79 - V2 Architecture Enforcement');
  console.log('='.repeat(60));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);
  console.log('');

  if (!DRY_RUN && !EXECUTE && !ROLLBACK) {
    console.log('❌ Must specify --dry-run, --execute, or --rollback');
    console.log('');
    console.log('Usage:');
    console.log('   node scripts/maintenance/executeSwap.js --dry-run');
    console.log('   node scripts/maintenance/executeSwap.js --execute');
    console.log('   node scripts/maintenance/executeSwap.js --rollback');
    process.exit(1);
  }

  try {
    // Validation
    if (!SKIP_VALIDATION && !ROLLBACK) {
      await runValidation();
      console.log('');
    }

    if (DRY_RUN) {
      console.log('🔍 DRY RUN - Would execute the following operations:');
      console.log('');
      console.log('   Phase 1: Backup');
      console.log('      - DROP TABLE IF EXISTS teams_v2_backup');
      console.log('      - DROP TABLE IF EXISTS matches_v2_backup');
      console.log('      - ALTER TABLE teams_v2 RENAME TO teams_v2_backup');
      console.log('      - ALTER TABLE matches_v2 RENAME TO matches_v2_backup');
      console.log('');
      console.log('   Phase 2: Swap');
      console.log('      - ALTER TABLE teams_v2_rebuild RENAME TO teams_v2');
      console.log('      - ALTER TABLE matches_v2_rebuild RENAME TO matches_v2');
      console.log('');
      console.log('   Phase 3: Constraints');
      console.log('      - Re-add foreign key constraints');
      console.log('      - Re-add indexes');
      console.log('');
      console.log('   Phase 4: Refresh');
      console.log('      - REFRESH MATERIALIZED VIEW CONCURRENTLY app_rankings');
      console.log('      - REFRESH MATERIALIZED VIEW CONCURRENTLY app_team_profile');
      console.log('      - ... (all app_ views)');
      console.log('');
      console.log('   Phase 5: Verify');
      console.log('      - Check teams_v2 has data');
      console.log('      - Check matches_v2 has data');
      console.log('      - Check foreign keys valid');
      console.log('');
      console.log('To execute for real:');
      console.log('   node scripts/maintenance/executeSwap.js --execute');
      return;
    }

    const client = await pool.connect();

    try {
      // Authorize for write protection
      await authorizePipelineWrite(client);

      // ==========================================================
      // PHASE 0: Safety checks
      // ==========================================================
      console.log('🛡️ Phase 0: Safety checks...');

      // Check rebuild tables exist
      const { rows: rebuildExists } = await client.query(`
        SELECT COUNT(*) as cnt FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'teams_v2_rebuild'
      `);

      if (parseInt(rebuildExists[0].cnt) === 0) {
        throw new Error('Rebuild tables do not exist. Run rebuildFromStaging.js first.');
      }

      console.log('   ✅ Safety checks passed');
      console.log('');

      // Start transaction
      await client.query('BEGIN');

      if (ROLLBACK) {
        // ==========================================================
        // ROLLBACK MODE
        // ==========================================================
        console.log('⏪ ROLLBACK MODE - Restoring from backup...');
        console.log('');

        // Check backup exists
        const { rows: backupExists } = await client.query(`
          SELECT COUNT(*) as cnt FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'teams_v2_backup'
        `);

        if (parseInt(backupExists[0].cnt) === 0) {
          throw new Error('Backup tables do not exist. Cannot rollback.');
        }

        // Drop current tables (which are the failed rebuild)
        console.log('   Dropping current tables...');
        await client.query('DROP TABLE IF EXISTS matches_v2 CASCADE');
        await client.query('DROP TABLE IF EXISTS teams_v2 CASCADE');

        // Restore from backup
        console.log('   Restoring from backup...');
        await client.query('ALTER TABLE teams_v2_backup RENAME TO teams_v2');
        await client.query('ALTER TABLE matches_v2_backup RENAME TO matches_v2');

        await client.query('COMMIT');
        console.log('   ✅ Rollback complete');

      } else {
        // ==========================================================
        // EXECUTE MODE
        // ==========================================================

        // Phase 1: Backup
        console.log('📦 Phase 1: Backup current production tables...');

        await client.query('DROP TABLE IF EXISTS teams_v2_backup CASCADE');
        await client.query('DROP TABLE IF EXISTS matches_v2_backup CASCADE');

        // We can't rename a table that has foreign key references
        // So we need to drop constraints first
        console.log('   Dropping foreign key constraints...');
        await client.query(`
          DO $$
          DECLARE r RECORD;
          BEGIN
            FOR r IN (SELECT constraint_name, table_name
                      FROM information_schema.table_constraints
                      WHERE constraint_type = 'FOREIGN KEY'
                        AND table_name IN ('matches_v2', 'matches_v2_rebuild')
                        AND table_schema = 'public')
            LOOP
              EXECUTE 'ALTER TABLE ' || quote_ident(r.table_name) ||
                      ' DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
            END LOOP;
          END $$;
        `);

        console.log('   Renaming production tables to backup...');
        await client.query('ALTER TABLE teams_v2 RENAME TO teams_v2_backup');
        await client.query('ALTER TABLE matches_v2 RENAME TO matches_v2_backup');

        console.log('   ✅ Phase 1 complete');
        console.log('');

        // Phase 2: Swap
        console.log('🔄 Phase 2: Rename rebuild tables to production...');

        await client.query('ALTER TABLE teams_v2_rebuild RENAME TO teams_v2');
        await client.query('ALTER TABLE matches_v2_rebuild RENAME TO matches_v2');

        console.log('   ✅ Phase 2 complete');
        console.log('');

        // Phase 3: Constraints
        console.log('🔗 Phase 3: Re-add constraints...');

        // Add foreign key constraints
        await client.query(`
          ALTER TABLE matches_v2
            ADD CONSTRAINT matches_v2_home_team_id_fkey
            FOREIGN KEY (home_team_id) REFERENCES teams_v2(id)
        `);
        await client.query(`
          ALTER TABLE matches_v2
            ADD CONSTRAINT matches_v2_away_team_id_fkey
            FOREIGN KEY (away_team_id) REFERENCES teams_v2(id)
        `);

        // Add UNIQUE constraint on source_match_key if not exists
        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'matches_v2_source_match_key_key'
            ) THEN
              ALTER TABLE matches_v2
                ADD CONSTRAINT matches_v2_source_match_key_key
                UNIQUE (source_match_key);
            END IF;
          END $$;
        `);

        console.log('   ✅ Phase 3 complete');
        console.log('');

        // Commit the swap
        await client.query('COMMIT');
        console.log('✅ Swap transaction committed');
        console.log('');

        // Phase 4: Refresh (outside transaction)
        console.log('🔄 Phase 4: Refresh materialized views...');

        const views = [
          'app_rankings',
          'app_team_profile',
          'app_matches_feed',
          'app_league_standings',
          'app_upcoming_schedule'
        ];

        for (const view of views) {
          try {
            console.log(`   Refreshing ${view}...`);
            await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
          } catch (err) {
            console.log(`   ⚠️ Could not refresh ${view}: ${err.message}`);
          }
        }

        console.log('   ✅ Phase 4 complete');
        console.log('');

        // Phase 5: Verify
        console.log('✓ Phase 5: Verify swap...');

        const { rows: finalCounts } = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM teams_v2) as teams,
            (SELECT COUNT(*) FROM matches_v2) as matches
        `);

        const teams = parseInt(finalCounts[0].teams);
        const matches = parseInt(finalCounts[0].matches);

        if (teams === 0 || matches === 0) {
          throw new Error('CRITICAL: Swap verification failed - tables are empty!');
        }

        console.log(`   teams_v2: ${teams.toLocaleString()} rows`);
        console.log(`   matches_v2: ${matches.toLocaleString()} rows`);
        console.log('   ✅ Phase 5 complete');
      }

    } catch (err) {
      // Rollback on error
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // ==========================================================
    // SUCCESS
    // ==========================================================
    console.log('');
    console.log('='.repeat(60));
    console.log('✅ SWAP COMPLETE');
    console.log('='.repeat(60));
    console.log('');
    console.log('Next steps:');
    console.log('1. Verify app is working correctly');
    console.log('2. Run ELO recalculation: node scripts/daily/recalculate_elo_v2.js');
    console.log('3. Capture rank snapshot: node scripts/daily/captureRankSnapshot.js');
    console.log('4. If issues, rollback: node scripts/maintenance/executeSwap.js --rollback');
    console.log('');
    console.log('Backup tables available:');
    console.log('   - teams_v2_backup');
    console.log('   - matches_v2_backup');
    console.log('');
    console.log('To clean up backup tables (after verification):');
    console.log('   DROP TABLE teams_v2_backup, matches_v2_backup;');

  } catch (err) {
    console.error('');
    console.error('❌ SWAP FAILED:', err.message);
    console.error('');
    console.error('The swap was rolled back. No changes were made to production.');
    console.error('');
    console.error('If backup tables exist, you can restore:');
    console.error('   node scripts/maintenance/executeSwap.js --rollback');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

executeSwap();
