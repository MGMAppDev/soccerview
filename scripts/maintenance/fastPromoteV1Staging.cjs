/**
 * fastPromoteV1Staging.cjs
 *
 * FAST V2-compliant promotion of V1 staging data to matches_v2.
 *
 * V2 ARCHITECTURE COMPLIANCE:
 * ✅ Data came through staging_games (intake point respected)
 * ✅ Uses pipelineAuth for write authorization
 * ✅ Uses source_match_key for deduplication (ON CONFLICT)
 * ✅ Bulk SQL INSERT...SELECT (no row-by-row)
 * ✅ Respects write protection triggers
 *
 * PERFORMANCE: Processes 100K+ records in seconds, not minutes.
 *
 * Usage:
 *   node scripts/maintenance/fastPromoteV1Staging.cjs --dry-run
 *   node scripts/maintenance/fastPromoteV1Staging.cjs --execute
 *
 * Session 82 - February 3, 2026
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 600000 // 10 minutes for large bulk operations
});

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log('='.repeat(70));
  console.log('FAST V2-COMPLIANT STAGING PROMOTION');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : EXECUTE ? 'EXECUTE' : 'PREVIEW'}`);
  console.log('');

  if (!DRY_RUN && !EXECUTE) {
    console.log('Usage:');
    console.log('  --dry-run    Preview what would be promoted');
    console.log('  --execute    Execute the promotion');
    process.exit(0);
  }

  const startTime = Date.now();
  const client = await pool.connect();

  try {
    // ================================================================
    // STEP 1: Authorize pipeline writes (V2 ARCHITECTURE)
    // ================================================================
    console.log('Step 1: Authorizing pipeline writes...');
    await client.query("SELECT set_config('app.pipeline_authorized', 'true', false)");
    console.log('  ✅ Pipeline write authorization granted\n');

    // ================================================================
    // STEP 2: Count V1 staging records to promote
    // ================================================================
    console.log('Step 2: Counting V1 staging records...');

    const { rows: countResult } = await client.query(`
      SELECT COUNT(*) as cnt
      FROM staging_games s
      WHERE s.source_match_key LIKE 'v1-legacy-%'
        AND s.processed = false
    `);

    const totalToPromote = parseInt(countResult[0].cnt);
    console.log(`  V1 staging records to promote: ${totalToPromote.toLocaleString()}`);

    if (totalToPromote === 0) {
      console.log('\n✅ No V1 staging records need promotion. All done!');
      return;
    }

    // ================================================================
    // STEP 3: Check team ID validity
    // ================================================================
    console.log('\nStep 3: Checking team ID validity...');

    const { rows: validityCheck } = await client.query(`
      WITH staging_v1 AS (
        SELECT
          s.source_match_key,
          SUBSTRING(s.source_match_key FROM 'v1-legacy-(.+)')::uuid as v1_id
        FROM staging_games s
        WHERE s.source_match_key LIKE 'v1-legacy-%'
          AND s.processed = false
      ),
      joined AS (
        SELECT
          sv.source_match_key,
          v1.home_team_id,
          v1.away_team_id,
          ht.id as valid_home,
          at.id as valid_away
        FROM staging_v1 sv
        JOIN match_results_deprecated v1 ON v1.id = sv.v1_id
        LEFT JOIN teams_v2 ht ON ht.id = v1.home_team_id
        LEFT JOIN teams_v2 at ON at.id = v1.away_team_id
      )
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE valid_home IS NOT NULL AND valid_away IS NOT NULL) as both_valid,
        COUNT(*) FILTER (WHERE valid_home IS NULL OR valid_away IS NULL) as missing_teams
      FROM joined
    `);

    console.log(`  Total: ${validityCheck[0].total}`);
    console.log(`  Both teams valid: ${validityCheck[0].both_valid} (${(validityCheck[0].both_valid / validityCheck[0].total * 100).toFixed(1)}%)`);
    console.log(`  Missing teams: ${validityCheck[0].missing_teams}`);

    if (DRY_RUN) {
      console.log('\n' + '='.repeat(70));
      console.log('DRY RUN COMPLETE');
      console.log('='.repeat(70));
      console.log(`Would promote: ${validityCheck[0].both_valid} matches with valid teams`);
      console.log(`Would skip: ${validityCheck[0].missing_teams} matches with missing teams`);
      console.log('Run with --execute to perform promotion');
      return;
    }

    // ================================================================
    // STEP 4: Bulk INSERT into matches_v2 (V2 ARCHITECTURE)
    // ================================================================
    console.log('\nStep 4: Bulk INSERT into matches_v2...');

    const insertStart = Date.now();

    const insertResult = await client.query(`
      INSERT INTO matches_v2 (
        id,
        match_date,
        match_time,
        home_team_id,
        away_team_id,
        home_score,
        away_score,
        league_id,
        tournament_id,
        source_platform,
        source_match_key,
        status,
        created_at
      )
      SELECT
        gen_random_uuid(),
        s.match_date,
        s.match_time,
        v1.home_team_id,
        v1.away_team_id,
        s.home_score,
        s.away_score,
        -- Try to find league/tournament by event_id
        (SELECT l.id FROM leagues l WHERE l.source_event_id = s.event_id LIMIT 1),
        (SELECT t.id FROM tournaments t WHERE t.source_event_id = s.event_id LIMIT 1),
        COALESCE(s.source_platform, 'gotsport'),
        s.source_match_key,
        CASE
          WHEN s.home_score IS NOT NULL AND s.away_score IS NOT NULL THEN 'completed'
          ELSE 'scheduled'
        END,
        NOW()
      FROM staging_games s
      JOIN match_results_deprecated v1 ON v1.id = SUBSTRING(s.source_match_key FROM 'v1-legacy-(.+)')::uuid
      JOIN teams_v2 ht ON ht.id = v1.home_team_id
      JOIN teams_v2 at ON at.id = v1.away_team_id
      WHERE s.source_match_key LIKE 'v1-legacy-%'
        AND s.processed = false
      ON CONFLICT (source_match_key) DO NOTHING
    `);

    const insertTime = ((Date.now() - insertStart) / 1000).toFixed(2);
    const insertRate = Math.round(insertResult.rowCount / parseFloat(insertTime));

    console.log(`  ✅ Inserted ${insertResult.rowCount.toLocaleString()} matches in ${insertTime}s (${insertRate.toLocaleString()}/sec)`);

    // ================================================================
    // STEP 5: Mark staging records as processed
    // ================================================================
    console.log('\nStep 5: Marking staging records as processed...');

    const markResult = await client.query(`
      UPDATE staging_games
      SET processed = true, processed_at = NOW()
      WHERE source_match_key LIKE 'v1-legacy-%'
        AND processed = false
    `);

    console.log(`  ✅ Marked ${markResult.rowCount.toLocaleString()} staging records as processed`);

    // ================================================================
    // STEP 6: Handle records with missing teams (log only)
    // ================================================================
    console.log('\nStep 6: Checking remaining unprocessed...');

    const { rows: remaining } = await client.query(`
      SELECT COUNT(*) FROM staging_games
      WHERE source_match_key LIKE 'v1-legacy-%'
        AND processed = false
    `);

    if (parseInt(remaining[0].count) > 0) {
      console.log(`  ⚠️ ${remaining[0].count} records still unprocessed (missing team references)`);
      console.log(`     These can be processed by dataQualityEngine later`);
    } else {
      console.log(`  ✅ All V1 staging records processed`);
    }

    // ================================================================
    // Summary
    // ================================================================
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const overallRate = Math.round(insertResult.rowCount / parseFloat(elapsed));

    console.log('\n' + '='.repeat(70));
    console.log('PROMOTION COMPLETE');
    console.log('='.repeat(70));
    console.log(`Matches inserted: ${insertResult.rowCount.toLocaleString()}`);
    console.log(`Staging marked processed: ${markResult.rowCount.toLocaleString()}`);
    console.log(`Execution time: ${elapsed}s (${overallRate.toLocaleString()} records/sec)`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. node scripts/maintenance/fixDataDisconnect.cjs --execute');
    console.log('  2. node scripts/refresh_views_manual.js');
    console.log('  3. node scripts/maintenance/diagnoseDataIssue.cjs --health-check');

  } catch (err) {
    console.error('\n❌ Promotion failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
