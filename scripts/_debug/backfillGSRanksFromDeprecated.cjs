/**
 * Backfill GotSport ranks from rank_history_deprecated into rank_history_v2
 *
 * This copies national_rank and state_rank from the deprecated table
 * to the V2 table, matching by team_id and snapshot_date.
 *
 * Usage:
 *   node scripts/_debug/backfillGSRanksFromDeprecated.cjs --dry-run
 *   node scripts/_debug/backfillGSRanksFromDeprecated.cjs
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.argv.includes('--dry-run');

async function backfill() {
  console.log('='.repeat(70));
  console.log('BACKFILL GotSport Ranks from rank_history_deprecated');
  console.log('Mode:', DRY_RUN ? 'DRY RUN' : 'LIVE');
  console.log('='.repeat(70));

  // Step 1: Check what data exists
  console.log('\n1. Checking data availability...');

  const sourceData = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT team_id) as teams,
      COUNT(DISTINCT snapshot_date) as dates,
      MIN(snapshot_date)::text as earliest,
      MAX(snapshot_date)::text as latest
    FROM rank_history_deprecated
    WHERE national_rank IS NOT NULL
  `);
  console.log('Source (rank_history_deprecated):', sourceData.rows[0]);

  // Step 2: Check how many already exist in V2
  const existingV2 = await pool.query(`
    SELECT COUNT(*) as total
    FROM rank_history_v2
    WHERE national_rank IS NOT NULL
  `);
  console.log('Existing V2 records with GS ranks:', existingV2.rows[0].total);

  // Step 3: Find records that need updating (exist in both tables but V2 missing GS ranks)
  const toUpdate = await pool.query(`
    SELECT COUNT(*) as total
    FROM rank_history_v2 v2
    JOIN rank_history_deprecated dep ON v2.team_id = dep.team_id AND v2.snapshot_date = dep.snapshot_date
    WHERE v2.national_rank IS NULL
      AND dep.national_rank IS NOT NULL
  `);
  console.log('Records to update (exist in V2, need GS ranks):', toUpdate.rows[0].total);

  // Step 4: Find records that need inserting (exist in deprecated but not V2)
  const toInsert = await pool.query(`
    SELECT COUNT(*) as total
    FROM rank_history_deprecated dep
    LEFT JOIN rank_history_v2 v2 ON dep.team_id = v2.team_id AND dep.snapshot_date = v2.snapshot_date
    WHERE v2.id IS NULL
      AND dep.national_rank IS NOT NULL
  `);
  console.log('Records to insert (not in V2 yet):', toInsert.rows[0].total);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would update', toUpdate.rows[0].total, 'records');
    console.log('[DRY RUN] Would insert', toInsert.rows[0].total, 'records');
    await pool.end();
    return;
  }

  // Step 5: Perform the UPDATE for existing records
  console.log('\n2. Updating existing V2 records with GS ranks...');
  const updateResult = await pool.query(`
    UPDATE rank_history_v2 v2
    SET
      national_rank = dep.national_rank,
      state_rank = dep.state_rank
    FROM rank_history_deprecated dep
    WHERE v2.team_id = dep.team_id
      AND v2.snapshot_date = dep.snapshot_date
      AND v2.national_rank IS NULL
      AND dep.national_rank IS NOT NULL
  `);
  console.log('Updated:', updateResult.rowCount, 'records');

  // Step 6: Insert missing records (only for teams that exist in teams_v2)
  console.log('\n3. Inserting missing records...');
  const insertResult = await pool.query(`
    INSERT INTO rank_history_v2 (team_id, snapshot_date, national_rank, state_rank, elo_rating)
    SELECT
      dep.team_id,
      dep.snapshot_date,
      dep.national_rank,
      dep.state_rank,
      dep.elo_rating
    FROM rank_history_deprecated dep
    LEFT JOIN rank_history_v2 v2 ON dep.team_id = v2.team_id AND dep.snapshot_date = v2.snapshot_date
    JOIN teams_v2 t ON dep.team_id = t.id  -- Only insert for teams that exist in teams_v2
    WHERE v2.id IS NULL
      AND dep.national_rank IS NOT NULL
    ON CONFLICT (team_id, snapshot_date) DO UPDATE SET
      national_rank = EXCLUDED.national_rank,
      state_rank = EXCLUDED.state_rank
  `);
  console.log('Inserted:', insertResult.rowCount, 'records');

  // Step 7: Verify
  console.log('\n4. Verifying...');
  const finalCount = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(national_rank) as with_gs_rank,
      COUNT(DISTINCT snapshot_date) as unique_dates
    FROM rank_history_v2
    WHERE national_rank IS NOT NULL
  `);
  console.log('Final V2 GotSport data:', finalCount.rows[0]);

  // Check test team
  const testTeam = await pool.query(`
    SELECT snapshot_date::text, national_rank, state_rank, elo_national_rank
    FROM rank_history_v2
    WHERE team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
      AND national_rank IS NOT NULL
    ORDER BY snapshot_date
  `);
  console.log('\nSporting BV Pre-NAL 15 GotSport history in V2:');
  for (const row of testTeam.rows) {
    console.log(`  ${row.snapshot_date}: GS National #${row.national_rank}, GS State #${row.state_rank}, SV #${row.elo_national_rank}`);
  }

  console.log('\n✅ Backfill complete!');
  await pool.end();
}

backfill().catch(err => {
  console.error('Error:', err.message);
  pool.end();
  process.exit(1);
});
