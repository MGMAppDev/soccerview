/**
 * FAST rank recalculation using consistent baseline
 *
 * Key insight from GotSport: Use a CONSISTENT baseline
 * For each historical ELO, count how many CURRENT teams have higher ELO
 * This gives stable, meaningful ranks
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function recalculateRanks() {
  const startTime = Date.now();
  console.log('Recalculating ranks with CONSISTENT BASELINE...\n');

  // Step 1: National ranks - for each historical ELO, count current teams with higher ELO
  console.log('Step 1: Calculating national ranks...');
  const natStart = Date.now();

  const natResult = await pool.query(`
    UPDATE rank_history_v2 rh
    SET elo_national_rank = (
      SELECT COUNT(*) + 1
      FROM teams_v2 t2
      WHERE t2.birth_year = t.birth_year
        AND t2.gender = t.gender
        AND t2.matches_played > 0
        AND t2.elo_rating > rh.elo_rating
    )
    FROM teams_v2 t
    WHERE rh.team_id = t.id
      AND rh.elo_rating IS NOT NULL
      AND t.birth_year IS NOT NULL
      AND t.gender IS NOT NULL
      AND t.matches_played > 0
  `);
  const natTime = ((Date.now() - natStart) / 1000).toFixed(1);
  console.log('   Updated ' + natResult.rowCount + ' rows in ' + natTime + 's');

  // Step 2: State ranks
  console.log('Step 2: Calculating state ranks...');
  const stateStart = Date.now();

  const stateResult = await pool.query(`
    UPDATE rank_history_v2 rh
    SET elo_state_rank = (
      SELECT COUNT(*) + 1
      FROM teams_v2 t2
      WHERE t2.state = t.state
        AND t2.birth_year = t.birth_year
        AND t2.gender = t.gender
        AND t2.matches_played > 0
        AND t2.elo_rating > rh.elo_rating
    )
    FROM teams_v2 t
    WHERE rh.team_id = t.id
      AND rh.elo_rating IS NOT NULL
      AND t.birth_year IS NOT NULL
      AND t.gender IS NOT NULL
      AND t.state IS NOT NULL
      AND t.matches_played > 0
  `);
  const stateTime = ((Date.now() - stateStart) / 1000).toFixed(1);
  console.log('   Updated ' + stateResult.rowCount + ' rows in ' + stateTime + 's');

  // Verify results
  console.log('\n--- Sporting BV Pre-NAL 15 Rank History (CORRECTED) ---');
  const verifyResult = await pool.query(`
    SELECT
      TO_CHAR(rh.snapshot_date, 'YYYY-MM-DD') as date,
      rh.elo_rating,
      rh.elo_national_rank,
      rh.elo_state_rank
    FROM rank_history_v2 rh
    WHERE rh.team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    ORDER BY rh.snapshot_date
  `);

  console.log('Date       | ELO  | Nat Rank | State Rank');
  console.log('-'.repeat(45));
  verifyResult.rows.forEach(r => {
    const elo = Number(r.elo_rating).toFixed(0);
    const nat = r.elo_national_rank ? String(r.elo_national_rank).padStart(6) : '     -';
    const st = r.elo_state_rank ? String(r.elo_state_rank).padStart(5) : '    -';
    console.log(r.date + ' | ' + elo.padStart(4) + ' | ' + nat + ' | ' + st);
  });

  // Compare with current
  const currentTeam = await pool.query(`
    SELECT elo_rating, elo_national_rank, elo_state_rank
    FROM teams_v2
    WHERE id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
  `);
  console.log('\nCurrent teams_v2 values (should match latest):');
  console.log('   ELO: ' + currentTeam.rows[0].elo_rating);
  console.log('   National Rank: ' + currentTeam.rows[0].elo_national_rank);
  console.log('   State Rank: ' + currentTeam.rows[0].elo_state_rank);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\nTotal time: ' + totalTime + 's');
  await pool.end();
}

recalculateRanks().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
