/**
 * OPTIMIZED rank recalculation
 *
 * Strategy: Process by (birth_year, gender) batches to avoid correlated subqueries
 * For each batch:
 *   1. Get all teams' ELO values sorted (the baseline)
 *   2. For each historical ELO, find its rank position
 *   3. Bulk update
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function recalculateRanks() {
  const startTime = Date.now();
  console.log('Recalculating ranks with CONSISTENT BASELINE (optimized)...\n');

  // Step 1: Add indexes if they don't exist
  console.log('Step 1: Ensuring indexes exist...');
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_teams_v2_elo_ranking
    ON teams_v2 (birth_year, gender, elo_rating DESC)
    WHERE matches_played > 0 AND birth_year IS NOT NULL AND gender IS NOT NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_teams_v2_state_elo_ranking
    ON teams_v2 (state, birth_year, gender, elo_rating DESC)
    WHERE matches_played > 0 AND birth_year IS NOT NULL AND gender IS NOT NULL AND state IS NOT NULL
  `);
  console.log('   Indexes ready');

  // Step 2: Get distinct (birth_year, gender) combinations
  console.log('Step 2: Getting age/gender groups...');
  const groups = await pool.query(`
    SELECT DISTINCT birth_year, gender
    FROM teams_v2
    WHERE birth_year IS NOT NULL AND gender IS NOT NULL AND matches_played > 0
    ORDER BY birth_year, gender
  `);
  console.log('   Found ' + groups.rows.length + ' groups');

  // Step 3: Process each group
  console.log('Step 3: Processing national ranks by group...');
  let totalUpdated = 0;
  for (let i = 0; i < groups.rows.length; i++) {
    const { birth_year, gender } = groups.rows[i];

    // Get sorted ELO values for this group (the baseline)
    const baseline = await pool.query(`
      SELECT elo_rating
      FROM teams_v2
      WHERE birth_year = $1 AND gender = $2 AND matches_played > 0 AND elo_rating IS NOT NULL
      ORDER BY elo_rating DESC
    `, [birth_year, gender]);

    const eloValues = baseline.rows.map(r => r.elo_rating);
    const groupSize = eloValues.length;

    // Function to find rank for an ELO value
    // Rank = number of teams with higher ELO + 1
    const findRank = (elo) => {
      let rank = 1;
      for (const e of eloValues) {
        if (e > elo) rank++;
        else break; // Already sorted DESC, so no more higher values
      }
      return rank;
    };

    // Get all rank_history entries for this group that need updating
    const historyResult = await pool.query(`
      SELECT rh.id, rh.elo_rating
      FROM rank_history_v2 rh
      JOIN teams_v2 t ON rh.team_id = t.id
      WHERE t.birth_year = $1 AND t.gender = $2
        AND rh.elo_rating IS NOT NULL
        AND t.matches_played > 0
    `, [birth_year, gender]);

    if (historyResult.rows.length === 0) continue;

    // Calculate ranks for each entry
    const updates = historyResult.rows.map(row => ({
      id: row.id,
      rank: findRank(row.elo_rating)
    }));

    // Bulk update using CASE statement
    if (updates.length > 0) {
      const caseStmt = updates.map(u => `WHEN '${u.id}'::uuid THEN ${u.rank}`).join(' ');
      const ids = updates.map(u => `'${u.id}'`).join(',');

      await pool.query(`
        UPDATE rank_history_v2
        SET elo_national_rank = CASE id ${caseStmt} END
        WHERE id IN (${ids})
      `);

      totalUpdated += updates.length;
    }

    if ((i + 1) % 10 === 0 || i === groups.rows.length - 1) {
      console.log('   Processed ' + (i + 1) + '/' + groups.rows.length + ' groups, ' + totalUpdated + ' rows updated');
    }
  }

  // Step 4: Process state ranks similarly
  console.log('Step 4: Processing state ranks...');
  const stateGroups = await pool.query(`
    SELECT DISTINCT state, birth_year, gender
    FROM teams_v2
    WHERE birth_year IS NOT NULL AND gender IS NOT NULL AND state IS NOT NULL AND matches_played > 0
    ORDER BY state, birth_year, gender
  `);
  console.log('   Found ' + stateGroups.rows.length + ' state groups');

  let stateUpdated = 0;
  for (let i = 0; i < stateGroups.rows.length; i++) {
    const { state, birth_year, gender } = stateGroups.rows[i];

    const baseline = await pool.query(`
      SELECT elo_rating
      FROM teams_v2
      WHERE state = $1 AND birth_year = $2 AND gender = $3 AND matches_played > 0 AND elo_rating IS NOT NULL
      ORDER BY elo_rating DESC
    `, [state, birth_year, gender]);

    const eloValues = baseline.rows.map(r => r.elo_rating);

    const findRank = (elo) => {
      let rank = 1;
      for (const e of eloValues) {
        if (e > elo) rank++;
        else break;
      }
      return rank;
    };

    const historyResult = await pool.query(`
      SELECT rh.id, rh.elo_rating
      FROM rank_history_v2 rh
      JOIN teams_v2 t ON rh.team_id = t.id
      WHERE t.state = $1 AND t.birth_year = $2 AND t.gender = $3
        AND rh.elo_rating IS NOT NULL
        AND t.matches_played > 0
    `, [state, birth_year, gender]);

    if (historyResult.rows.length === 0) continue;

    const updates = historyResult.rows.map(row => ({
      id: row.id,
      rank: findRank(row.elo_rating)
    }));

    if (updates.length > 0) {
      const caseStmt = updates.map(u => `WHEN '${u.id}'::uuid THEN ${u.rank}`).join(' ');
      const ids = updates.map(u => `'${u.id}'`).join(',');

      await pool.query(`
        UPDATE rank_history_v2
        SET elo_state_rank = CASE id ${caseStmt} END
        WHERE id IN (${ids})
      `);

      stateUpdated += updates.length;
    }

    if ((i + 1) % 50 === 0 || i === stateGroups.rows.length - 1) {
      console.log('   Processed ' + (i + 1) + '/' + stateGroups.rows.length + ' groups, ' + stateUpdated + ' rows');
    }
  }

  // Verify
  console.log('\n--- Sporting BV Pre-NAL 15 (CORRECTED) ---');
  const verify = await pool.query(`
    SELECT TO_CHAR(snapshot_date, 'YYYY-MM-DD') as date, elo_rating, elo_national_rank, elo_state_rank
    FROM rank_history_v2
    WHERE team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    ORDER BY snapshot_date
  `);
  console.log('Date       | ELO  | Nat Rank | State');
  console.log('-'.repeat(40));
  verify.rows.forEach(r => {
    console.log(r.date + ' | ' + Number(r.elo_rating).toFixed(0).padStart(4) + ' | ' +
      String(r.elo_national_rank || '-').padStart(6) + ' | ' + String(r.elo_state_rank || '-').padStart(5));
  });

  const total = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\nTotal time: ' + total + 's');
  await pool.end();
}

recalculateRanks().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
