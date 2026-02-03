/**
 * migrateV1ToStaging.cjs
 *
 * Migrates V1 archived matches (match_results_deprecated) to staging_games
 * for processing through the V2 pipeline.
 *
 * V2 ARCHITECTURE COMPLIANCE:
 * - Writes to staging_games ONLY (not directly to matches_v2)
 * - Data flows through: staging → intakeValidator → dataQualityEngine → production
 * - Uses pg Pool for bulk operations
 * - Generates unique source_match_key to prevent duplicates
 *
 * Usage:
 *   node scripts/maintenance/migrateV1ToStaging.cjs --dry-run    # Preview only
 *   node scripts/maintenance/migrateV1ToStaging.cjs --execute    # Execute migration
 *
 * Session 82 - February 3, 2026
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Longer timeout for bulk operations
  statement_timeout: 300000 // 5 minutes
});

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
const BATCH_SIZE = 10000; // Insert in batches for performance
const THREE_YEARS_AGO = '2023-02-03';

async function main() {
  console.log('='.repeat(70));
  console.log('V1 TO STAGING MIGRATION');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : EXECUTE ? 'EXECUTE' : 'PREVIEW'}`);
  console.log(`3-Year Filter: >= ${THREE_YEARS_AGO}`);
  console.log('');

  if (!DRY_RUN && !EXECUTE) {
    console.log('Usage:');
    console.log('  --dry-run    Preview what would be migrated');
    console.log('  --execute    Execute the migration');
    process.exit(0);
  }

  const startTime = Date.now();

  try {
    // ================================================================
    // STEP 1: Count V1 matches to migrate
    // ================================================================
    console.log('Step 1: Counting V1 matches to migrate...');

    const { rows: countResult } = await pool.query(`
      SELECT COUNT(*) as cnt
      FROM match_results_deprecated v1
      WHERE v1.match_date >= $1
        AND NOT EXISTS (
          SELECT 1 FROM matches_v2 m
          WHERE m.match_date = v1.match_date
            AND m.home_team_id = v1.home_team_id
            AND m.away_team_id = v1.away_team_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM staging_games s
          WHERE s.source_match_key = 'v1-legacy-' || v1.id::text
        )
    `, [THREE_YEARS_AGO]);

    const totalToMigrate = parseInt(countResult[0].cnt);
    console.log(`  V1 matches to migrate: ${totalToMigrate.toLocaleString()}`);

    if (totalToMigrate === 0) {
      console.log('\n✅ No V1 matches need migration. All done!');
      return;
    }

    // ================================================================
    // STEP 2: Sample data validation
    // ================================================================
    console.log('\nStep 2: Validating sample data...');

    const { rows: samples } = await pool.query(`
      SELECT
        v1.id,
        v1.match_date,
        v1.match_time,
        v1.home_team_name,
        v1.away_team_name,
        v1.home_score,
        v1.away_score,
        v1.event_name,
        v1.event_id,
        v1.location,
        v1.source_platform
      FROM match_results_deprecated v1
      WHERE v1.match_date >= $1
        AND NOT EXISTS (
          SELECT 1 FROM matches_v2 m
          WHERE m.match_date = v1.match_date
            AND m.home_team_id = v1.home_team_id
            AND m.away_team_id = v1.away_team_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM staging_games s
          WHERE s.source_match_key = 'v1-legacy-' || v1.id::text
        )
      LIMIT 5
    `, [THREE_YEARS_AGO]);

    console.log('  Sample matches to migrate:');
    samples.forEach(s => {
      console.log(`    ${s.match_date}: ${s.home_team_name} vs ${s.away_team_name}`);
      console.log(`      Event: ${s.event_name || 'Unknown'} | Score: ${s.home_score ?? 'NULL'}-${s.away_score ?? 'NULL'}`);
    });

    if (DRY_RUN) {
      console.log('\n' + '='.repeat(70));
      console.log('DRY RUN COMPLETE');
      console.log('='.repeat(70));
      console.log(`Would migrate: ${totalToMigrate.toLocaleString()} matches`);
      console.log('Run with --execute to perform migration');
      return;
    }

    // ================================================================
    // STEP 3: Execute migration in batches
    // ================================================================
    console.log('\nStep 3: Migrating to staging_games...');

    let totalMigrated = 0;
    let batchNum = 0;

    while (totalMigrated < totalToMigrate) {
      batchNum++;
      const batchStart = Date.now();

      // Use INSERT...SELECT for maximum performance
      const result = await pool.query(`
        INSERT INTO staging_games (
          id,
          match_date,
          match_time,
          home_team_name,
          away_team_name,
          home_score,
          away_score,
          event_name,
          event_id,
          venue_name,
          source_platform,
          source_match_key,
          scraped_at,
          processed,
          raw_data
        )
        SELECT
          gen_random_uuid(),
          v1.match_date,
          v1.match_time,
          v1.home_team_name,
          v1.away_team_name,
          v1.home_score,
          v1.away_score,
          v1.event_name,
          v1.event_id,
          v1.location,
          COALESCE(v1.source_platform, 'gotsport'),
          'v1-legacy-' || v1.id::text,
          NOW(),
          false,
          jsonb_build_object(
            'migrated_from', 'match_results_deprecated',
            'original_id', v1.id,
            'migration_session', 82,
            'migration_date', NOW()::text
          )
        FROM match_results_deprecated v1
        WHERE v1.match_date >= $1
          AND NOT EXISTS (
            SELECT 1 FROM matches_v2 m
            WHERE m.match_date = v1.match_date
              AND m.home_team_id = v1.home_team_id
              AND m.away_team_id = v1.away_team_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM staging_games s
            WHERE s.source_match_key = 'v1-legacy-' || v1.id::text
          )
        LIMIT $2
      `, [THREE_YEARS_AGO, BATCH_SIZE]);

      const batchCount = result.rowCount;
      totalMigrated += batchCount;

      const batchTime = ((Date.now() - batchStart) / 1000).toFixed(2);
      const rate = Math.round(batchCount / parseFloat(batchTime));
      const progress = ((totalMigrated / totalToMigrate) * 100).toFixed(1);

      console.log(`  Batch ${batchNum}: +${batchCount.toLocaleString()} (${batchTime}s, ${rate}/sec) | Total: ${totalMigrated.toLocaleString()} (${progress}%)`);

      // If we got fewer than BATCH_SIZE, we're done
      if (batchCount < BATCH_SIZE) break;
    }

    // ================================================================
    // STEP 4: Verify migration
    // ================================================================
    console.log('\nStep 4: Verifying migration...');

    const { rows: stagingCount } = await pool.query(`
      SELECT COUNT(*) FROM staging_games
      WHERE source_match_key LIKE 'v1-legacy-%' AND processed = false
    `);

    console.log(`  staging_games with v1-legacy-* keys: ${stagingCount[0].count}`);

    // ================================================================
    // Summary
    // ================================================================
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const overallRate = Math.round(totalMigrated / parseFloat(elapsed));

    console.log('\n' + '='.repeat(70));
    console.log('MIGRATION COMPLETE');
    console.log('='.repeat(70));
    console.log(`Total migrated: ${totalMigrated.toLocaleString()} matches`);
    console.log(`Execution time: ${elapsed}s (${overallRate} records/sec)`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. node scripts/universal/intakeValidator.js --report');
    console.log('  2. node scripts/universal/dataQualityEngine.js --process-staging');
    console.log('  3. node scripts/maintenance/fixDataDisconnect.cjs --execute');
    console.log('  4. node scripts/refresh_views_manual.js');

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
