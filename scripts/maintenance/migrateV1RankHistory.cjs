/**
 * migrateV1RankHistory.cjs
 * Session 83: Migrate V1 rank_history gaps to rank_history_v2
 *
 * This script fills GAPS in rank_history_v2 from V1 data.
 * V1 has 49,729 entries for Jan 20-28 that are missing from V2.
 * 3,180 teams have valid team_ids but no rank history in V2.
 *
 * GUARDRAILS:
 * - READ from rank_history_deprecated (V1)
 * - WRITE to rank_history_v2 only (not teams_v2 or matches_v2)
 * - Uses pg Pool with bulk SQL
 * - Only migrates entries where team_id exists in teams_v2
 * - Skips entries that already exist in V2
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
  console.log('║     SESSION 83: MIGRATE V1 RANK HISTORY GAPS TO V2             ║');
  console.log(`║                    ${DRY_RUN ? 'DRY RUN MODE' : 'LIVE EXECUTION'}                            ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Count gaps
    console.log('=== STEP 1: Count V1 Entries Missing from V2 ===\n');

    const { rows: gapCount } = await pool.query(`
      SELECT COUNT(*) as count
      FROM rank_history_deprecated rh1
      JOIN teams_v2 t ON t.id = rh1.team_id  -- Only valid team_ids
      WHERE NOT EXISTS (
        SELECT 1 FROM rank_history_v2 rh2
        WHERE rh2.team_id = rh1.team_id
          AND rh2.snapshot_date = rh1.snapshot_date
      )
    `);

    const totalGaps = parseInt(gapCount[0].count);
    console.log(`  V1 entries with valid team_id missing from V2: ${totalGaps.toLocaleString()}`);

    if (totalGaps === 0) {
      console.log('\n  No gaps to fill. V2 is complete for valid teams.');
      await pool.end();
      return;
    }

    // Step 2: Preview by date
    console.log('\n=== STEP 2: Gaps by Date ===\n');

    const { rows: gapsByDate } = await pool.query(`
      SELECT rh1.snapshot_date::text, COUNT(*) as count
      FROM rank_history_deprecated rh1
      JOIN teams_v2 t ON t.id = rh1.team_id
      WHERE NOT EXISTS (
        SELECT 1 FROM rank_history_v2 rh2
        WHERE rh2.team_id = rh1.team_id
          AND rh2.snapshot_date = rh1.snapshot_date
      )
      GROUP BY rh1.snapshot_date
      ORDER BY rh1.snapshot_date
    `);

    for (const row of gapsByDate) {
      console.log(`  ${row.snapshot_date}: ${parseInt(row.count).toLocaleString()} gaps`);
    }

    // Step 3: Current V2 state
    console.log('\n=== STEP 3: Current V2 State ===\n');

    const { rows: v2State } = await pool.query(`
      SELECT COUNT(*) as total FROM rank_history_v2
    `);
    console.log(`  Current rank_history_v2 entries: ${parseInt(v2State[0].total).toLocaleString()}`);

    if (DRY_RUN) {
      console.log('\n=== DRY RUN COMPLETE - No changes made ===\n');
      console.log(`  Would insert: ${totalGaps.toLocaleString()} entries`);
      return;
    }

    // Step 4: Execute migration
    console.log('\n=== STEP 4: Executing Migration ===\n');

    const startTime = Date.now();

    const { rowCount } = await pool.query(`
      INSERT INTO rank_history_v2 (
        team_id,
        snapshot_date,
        national_rank,
        state_rank,
        elo_rating,
        elo_national_rank,
        elo_state_rank,
        created_at
      )
      SELECT
        rh1.team_id,
        rh1.snapshot_date,
        rh1.national_rank,
        rh1.state_rank,
        rh1.elo_rating,
        NULL,  -- elo_national_rank not in V1
        NULL,  -- elo_state_rank not in V1
        NOW()
      FROM rank_history_deprecated rh1
      JOIN teams_v2 t ON t.id = rh1.team_id
      WHERE NOT EXISTS (
        SELECT 1 FROM rank_history_v2 rh2
        WHERE rh2.team_id = rh1.team_id
          AND rh2.snapshot_date = rh1.snapshot_date
      )
      ON CONFLICT (team_id, snapshot_date) DO NOTHING
    `);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (rowCount / parseFloat(elapsed)).toFixed(0);

    console.log(`  Inserted: ${rowCount.toLocaleString()} entries`);
    console.log(`  Time: ${elapsed}s (${rate} records/sec)`);

    // Step 5: Verify
    console.log('\n=== STEP 5: Verification ===\n');

    const { rows: newState } = await pool.query(`
      SELECT COUNT(*) as total FROM rank_history_v2
    `);

    const { rows: remainingGaps } = await pool.query(`
      SELECT COUNT(*) as count
      FROM rank_history_deprecated rh1
      JOIN teams_v2 t ON t.id = rh1.team_id
      WHERE NOT EXISTS (
        SELECT 1 FROM rank_history_v2 rh2
        WHERE rh2.team_id = rh1.team_id
          AND rh2.snapshot_date = rh1.snapshot_date
      )
    `);

    console.log(`  Before: ${parseInt(v2State[0].total).toLocaleString()} entries`);
    console.log(`  After: ${parseInt(newState[0].total).toLocaleString()} entries`);
    console.log(`  Added: ${(parseInt(newState[0].total) - parseInt(v2State[0].total)).toLocaleString()} entries`);
    console.log(`  Remaining gaps: ${parseInt(remainingGaps[0].count).toLocaleString()}`);

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    MIGRATION COMPLETE                           ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

  } catch (err) {
    console.error('MIGRATION FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
