/**
 * Recalculate historical ranks from ELO data
 *
 * Rank = position when all teams sorted by ELO descending
 * National rank = rank among all teams with same birth_year + gender
 * State rank = rank among teams in same state + birth_year + gender
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function recalculateRanks() {
  console.log('Recalculating historical ranks from ELO data...\n');

  // Get distinct snapshot dates
  const datesResult = await pool.query(`
    SELECT DISTINCT snapshot_date
    FROM rank_history_v2
    WHERE elo_rating IS NOT NULL
    ORDER BY snapshot_date
  `);

  console.log(`Found ${datesResult.rows.length} snapshot dates to process\n`);

  let processed = 0;
  for (const row of datesResult.rows) {
    const snapshotDate = row.snapshot_date;

    // Calculate and update ranks for this snapshot date
    // MUST match nightly logic: only teams with matches_played > 0
    // National rank: rank among active teams with same birth_year + gender
    // State rank: rank among active teams in same state + birth_year + gender
    const updateResult = await pool.query(`
      WITH ranked AS (
        SELECT
          rh.id,
          rh.team_id,
          rh.elo_rating,
          t.birth_year,
          t.gender,
          t.state,
          ROW_NUMBER() OVER (
            PARTITION BY t.birth_year, t.gender
            ORDER BY rh.elo_rating DESC NULLS LAST
          ) as national_rank,
          ROW_NUMBER() OVER (
            PARTITION BY t.state, t.birth_year, t.gender
            ORDER BY rh.elo_rating DESC NULLS LAST
          ) as state_rank
        FROM rank_history_v2 rh
        JOIN teams_v2 t ON rh.team_id = t.id
        WHERE rh.snapshot_date = $1
          AND rh.elo_rating IS NOT NULL
          AND t.birth_year IS NOT NULL
          AND t.gender IS NOT NULL
          AND t.matches_played > 0
      )
      UPDATE rank_history_v2 r
      SET
        elo_national_rank = ranked.national_rank,
        elo_state_rank = ranked.state_rank
      FROM ranked
      WHERE r.id = ranked.id
    `, [snapshotDate]);

    processed++;
    if (processed % 10 === 0 || processed === datesResult.rows.length) {
      const dateStr = new Date(snapshotDate).toISOString().split('T')[0];
      console.log(`Processed ${processed}/${datesResult.rows.length} dates (${dateStr}): ${updateResult.rowCount} teams ranked`);
    }
  }

  // Verify results for Sporting BV
  const verifyResult = await pool.query(`
    SELECT
      rh.snapshot_date,
      rh.elo_rating,
      rh.elo_national_rank,
      rh.elo_state_rank,
      rh.national_rank as gs_national,
      rh.state_rank as gs_state
    FROM rank_history_v2 rh
    WHERE rh.team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    ORDER BY rh.snapshot_date
  `);

  console.log('\n--- Sporting BV Pre-NAL 15 Rank History ---');
  console.log('Date       | ELO    | SV Nat | SV St | GS Nat | GS St');
  console.log('-'.repeat(60));
  verifyResult.rows.forEach(r => {
    const date = new Date(r.snapshot_date).toISOString().split('T')[0];
    console.log(
      `${date} | ${r.elo_rating?.toFixed(0).padStart(6)} | ${String(r.elo_national_rank || '-').padStart(6)} | ${String(r.elo_state_rank || '-').padStart(5)} | ${String(r.gs_national || '-').padStart(6)} | ${String(r.gs_state || '-').padStart(5)}`
    );
  });

  await pool.end();
  console.log('\nDone!');
}

recalculateRanks().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
