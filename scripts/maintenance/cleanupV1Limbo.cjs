/**
 * cleanupV1Limbo.cjs
 * Session 83: Move unrecoverable V1 records from staging_games to staging_rejected
 *
 * 84,036 V1 records are stuck in staging_games marked as processed but
 * NOT in matches_v2. These have NULL team_ids in the original V1 data
 * and are truly unrecoverable.
 *
 * This script moves them to staging_rejected with a clear rejection reason.
 *
 * GUARDRAILS:
 * - READ from staging_games
 * - WRITE to staging_rejected only
 * - DELETE from staging_games (cleanup)
 * - Does NOT touch teams_v2 or matches_v2
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 300000, // 5 minutes
});

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     SESSION 83: CLEANUP V1 LIMBO RECORDS                       ║');
  console.log(`║                    ${DRY_RUN ? 'DRY RUN MODE' : 'LIVE EXECUTION'}                            ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Count limbo records
    console.log('=== STEP 1: Count V1 Limbo Records ===\n');

    const { rows: limboCount } = await pool.query(`
      SELECT COUNT(*) as count
      FROM staging_games sg
      WHERE sg.source_match_key LIKE 'v1-legacy-%'
        AND sg.processed = true
        AND NOT EXISTS (
          SELECT 1 FROM matches_v2 m
          WHERE m.source_match_key = sg.source_match_key
        )
    `);

    const totalLimbo = parseInt(limboCount[0].count);
    console.log(`  V1 limbo records (processed but not in matches_v2): ${totalLimbo.toLocaleString()}`);

    if (totalLimbo === 0) {
      console.log('\n  No limbo records to clean up.');
      await pool.end();
      return;
    }

    // Step 2: Preview sample
    console.log('\n=== STEP 2: Sample of Limbo Records ===\n');

    const { rows: samples } = await pool.query(`
      SELECT sg.source_match_key, sg.home_team_name, sg.away_team_name, sg.match_date
      FROM staging_games sg
      WHERE sg.source_match_key LIKE 'v1-legacy-%'
        AND sg.processed = true
        AND NOT EXISTS (
          SELECT 1 FROM matches_v2 m
          WHERE m.source_match_key = sg.source_match_key
        )
      LIMIT 5
    `);

    for (const s of samples) {
      console.log(`  ${s.match_date}: ${(s.home_team_name || 'NULL').substring(0, 25)} vs ${(s.away_team_name || 'NULL').substring(0, 25)}`);
    }

    // Step 3: Check staging_rejected table exists
    console.log('\n=== STEP 3: Verify staging_rejected Table ===\n');

    const { rows: tableCheck } = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'staging_rejected'
      ) as exists
    `);

    if (!tableCheck[0].exists) {
      console.log('  ⚠️ staging_rejected table does not exist. Creating...');

      await pool.query(`
        CREATE TABLE IF NOT EXISTS staging_rejected (
          id BIGSERIAL PRIMARY KEY,
          source_match_key TEXT,
          home_team_name TEXT,
          away_team_name TEXT,
          match_date TEXT,
          rejection_reason TEXT NOT NULL,
          rejected_at TIMESTAMPTZ DEFAULT NOW(),
          original_staging_id BIGINT
        )
      `);

      console.log('  ✅ staging_rejected table created');
    } else {
      console.log('  ✅ staging_rejected table exists');
    }

    if (DRY_RUN) {
      console.log('\n=== DRY RUN COMPLETE - No changes made ===\n');
      console.log(`  Would move: ${totalLimbo.toLocaleString()} records to staging_rejected`);
      return;
    }

    // Step 4: Move to staging_rejected
    console.log('\n=== STEP 4: Moving to staging_rejected ===\n');

    const { rowCount: insertedCount } = await pool.query(`
      INSERT INTO staging_rejected (
        source_match_key,
        home_team_name,
        away_team_name,
        match_date,
        rejection_reason,
        rejection_code,
        rejected_at,
        original_staging_id
      )
      SELECT
        sg.source_match_key,
        sg.home_team_name,
        sg.away_team_name,
        sg.match_date,
        'V1_NULL_TEAM_ID: Original V1 archive has NULL home_team_id or away_team_id - unrecoverable',
        'V1_NULL_TEAM_ID',
        NOW(),
        sg.id
      FROM staging_games sg
      WHERE sg.source_match_key LIKE 'v1-legacy-%'
        AND sg.processed = true
        AND NOT EXISTS (
          SELECT 1 FROM matches_v2 m
          WHERE m.source_match_key = sg.source_match_key
        )
    `);

    console.log(`  Inserted ${insertedCount.toLocaleString()} records into staging_rejected`);

    // Step 5: Delete from staging_games
    console.log('\n=== STEP 5: Deleting from staging_games ===\n');

    const { rowCount: deletedCount } = await pool.query(`
      DELETE FROM staging_games sg
      WHERE sg.source_match_key LIKE 'v1-legacy-%'
        AND sg.processed = true
        AND NOT EXISTS (
          SELECT 1 FROM matches_v2 m
          WHERE m.source_match_key = sg.source_match_key
        )
    `);

    console.log(`  Deleted ${deletedCount.toLocaleString()} records from staging_games`);

    // Step 6: Verify
    console.log('\n=== STEP 6: Verification ===\n');

    const { rows: rejectedCount } = await pool.query(`
      SELECT COUNT(*) as count FROM staging_rejected
      WHERE rejection_reason LIKE 'V1_NULL_TEAM_ID%'
    `);

    const { rows: remainingLimbo } = await pool.query(`
      SELECT COUNT(*) as count
      FROM staging_games sg
      WHERE sg.source_match_key LIKE 'v1-legacy-%'
        AND sg.processed = true
        AND NOT EXISTS (
          SELECT 1 FROM matches_v2 m
          WHERE m.source_match_key = sg.source_match_key
        )
    `);

    console.log(`  staging_rejected (V1_NULL_TEAM_ID): ${parseInt(rejectedCount[0].count).toLocaleString()}`);
    console.log(`  Remaining V1 limbo in staging_games: ${parseInt(remainingLimbo[0].count).toLocaleString()}`);

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    CLEANUP COMPLETE                             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

  } catch (err) {
    console.error('CLEANUP FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
