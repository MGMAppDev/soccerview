/**
 * Recalculate historical ranks using CONSISTENT BASELINE
 *
 * Problem: Previous calculation ranked ELO against only teams with snapshots
 * on that specific date. Early dates had few teams = artificially high ranks.
 *
 * Solution: Rank each historical ELO against the CURRENT full pool of teams.
 * This gives a consistent baseline like GotSport's points system.
 *
 * For each snapshot:
 *   national_rank = count of teams with higher ELO + 1
 *   state_rank = count of teams in same state with higher ELO + 1
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function recalculateRanks() {
  console.log('Recalculating historical ranks using CONSISTENT BASELINE...\n');
  console.log('Methodology: Rank each historical ELO against CURRENT full team pool\n');

  // Get count of teams for progress
  const countResult = await pool.query(`
    SELECT COUNT(DISTINCT rh.id) as total
    FROM rank_history_v2 rh
    JOIN teams_v2 t ON rh.team_id = t.id
    WHERE rh.elo_rating IS NOT NULL
      AND t.birth_year IS NOT NULL
      AND t.gender IS NOT NULL
      AND t.matches_played > 0
  `);
  console.log(`Total rank_history entries to update: ${countResult.rows[0].total}\n`);

  // Update national ranks: count teams with higher ELO in same birth_year + gender
  console.log('Step 1: Calculating national ranks...');
  const natStart = Date.now();
  await pool.query(`
    UPDATE rank_history_v2 rh
    SET elo_national_rank = sub.nat_rank
    FROM (
      SELECT
        rh2.id,
        (
          SELECT COUNT(*) + 1
          FROM teams_v2 t2
          WHERE t2.birth_year = t.birth_year
            AND t2.gender = t.gender
            AND t2.matches_played > 0
            AND t2.elo_rating > rh2.elo_rating
        ) as nat_rank
      FROM rank_history_v2 rh2
      JOIN teams_v2 t ON rh2.team_id = t.id
      WHERE rh2.elo_rating IS NOT NULL
        AND t.birth_year IS NOT NULL
        AND t.gender IS NOT NULL
        AND t.matches_played > 0
    ) sub
    WHERE rh.id = sub.id
  `);
  console.log(`   Done in ${((Date.now() - natStart) / 1000).toFixed(1)}s`);

  // Update state ranks: count teams with higher ELO in same state + birth_year + gender
  console.log('Step 2: Calculating state ranks...');
  const stateStart = Date.now();
  await pool.query(`
    UPDATE rank_history_v2 rh
    SET elo_state_rank = sub.st_rank
    FROM (
      SELECT
        rh2.id,
        (
          SELECT COUNT(*) + 1
          FROM teams_v2 t2
          WHERE t2.state = t.state
            AND t2.birth_year = t.birth_year
            AND t2.gender = t.gender
            AND t2.matches_played > 0
            AND t2.elo_rating > rh2.elo_rating
        ) as st_rank
      FROM rank_history_v2 rh2
      JOIN teams_v2 t ON rh2.team_id = t.id
      WHERE rh2.elo_rating IS NOT NULL
        AND t.birth_year IS NOT NULL
        AND t.gender IS NOT NULL
        AND t.state IS NOT NULL
        AND t.matches_played > 0
    ) sub
    WHERE rh.id = sub.id
  `);
  console.log(`   Done in ${((Date.now() - stateStart) / 1000).toFixed(1)}s`);

  // Verify results for Sporting BV
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
    console.log(`${r.date} | ${elo.padStart(4)} | ${nat} | ${st}`);
  });

  // Show current teams_v2 values for comparison
  const currentTeam = await pool.query(`
    SELECT elo_rating, elo_national_rank, elo_state_rank
    FROM teams_v2
    WHERE id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
  `);
  console.log('\nCurrent teams_v2 values:');
  console.log(`   ELO: ${currentTeam.rows[0].elo_rating}`);
  console.log(`   National Rank: ${currentTeam.rows[0].elo_national_rank}`);
  console.log(`   State Rank: ${currentTeam.rows[0].elo_state_rank}`);

  await pool.end();
  console.log('\nDone!');
}

recalculateRanks().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
