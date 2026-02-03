/**
 * recalculateHistoricalRanks.cjs - UNIVERSAL rank recalculation
 *
 * Uses CONSISTENT BASELINE: For each historical ELO, calculate what rank
 * that ELO would be against TODAY's team pool.
 *
 * OPTIMIZED: Process by (birth_year, gender) groups with bulk updates
 *
 * Usage:
 *   node scripts/maintenance/recalculateHistoricalRanks.cjs
 *   node scripts/maintenance/recalculateHistoricalRanks.cjs --dry-run
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.argv.includes('--dry-run');

async function recalculateRanks() {
  const startTime = Date.now();
  console.log('Recalculating historical ranks with CONSISTENT BASELINE');
  console.log('Mode:', DRY_RUN ? 'DRY RUN' : 'LIVE');
  console.log('');

  // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
  // Note: rank_history_v2 is not protected by triggers, but we add auth for consistency
  if (!DRY_RUN) {
    console.log('🔐 Authorizing pipeline writes...');
    await authorizePipelineWrite(pool);
    console.log('✅ Pipeline write authorization granted\n');
  }

  // Step 1: Get all (birth_year, gender) groups
  const groups = await pool.query(`
    SELECT DISTINCT birth_year, gender, COUNT(*) as team_count
    FROM teams_v2
    WHERE birth_year IS NOT NULL AND gender IS NOT NULL AND matches_played > 0
    GROUP BY birth_year, gender
    ORDER BY birth_year, gender
  `);
  console.log('Found ' + groups.rows.length + ' (birth_year, gender) groups\n');

  let totalUpdated = 0;

  // Step 2: Process each group
  for (let i = 0; i < groups.rows.length; i++) {
    const { birth_year, gender, team_count } = groups.rows[i];
    const groupStart = Date.now();

    // Get sorted ELO values for this group (the baseline)
    const baseline = await pool.query(`
      SELECT elo_rating FROM teams_v2
      WHERE birth_year = $1 AND gender = $2 AND matches_played > 0 AND elo_rating IS NOT NULL
      ORDER BY elo_rating DESC
    `, [birth_year, gender]);

    const sortedElos = baseline.rows.map(r => parseFloat(r.elo_rating));

    // Binary search to find rank for any ELO value
    const findRank = (elo) => {
      let low = 0, high = sortedElos.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (sortedElos[mid] > elo) low = mid + 1;
        else high = mid;
      }
      return low + 1; // 1-indexed rank
    };

    // Get all rank_history entries for this group
    const historyResult = await pool.query(`
      SELECT rh.id, rh.elo_rating
      FROM rank_history_v2 rh
      JOIN teams_v2 t ON rh.team_id = t.id
      WHERE t.birth_year = $1 AND t.gender = $2
        AND rh.elo_rating IS NOT NULL
        AND t.matches_played > 0
    `, [birth_year, gender]);

    if (historyResult.rows.length === 0) continue;

    // Calculate ranks and batch update
    const BATCH_SIZE = 5000;
    for (let j = 0; j < historyResult.rows.length; j += BATCH_SIZE) {
      const batch = historyResult.rows.slice(j, j + BATCH_SIZE);

      // Build CASE statement for bulk update
      const cases = batch.map(row => {
        const rank = findRank(parseFloat(row.elo_rating));
        return `WHEN '${row.id}'::uuid THEN ${rank}`;
      }).join(' ');

      const ids = batch.map(r => `'${r.id}'`).join(',');

      if (!DRY_RUN) {
        await pool.query(`
          UPDATE rank_history_v2
          SET elo_national_rank = CASE id ${cases} END
          WHERE id IN (${ids})
        `);
      }

      totalUpdated += batch.length;
    }

    const groupTime = ((Date.now() - groupStart) / 1000).toFixed(1);
    console.log(`[${i+1}/${groups.rows.length}] ${birth_year} ${gender}: ${historyResult.rows.length} rows in ${groupTime}s`);
  }

  // Step 3: State ranks - similar approach but grouped by (state, birth_year, gender)
  console.log('\nProcessing state ranks...');

  const stateGroups = await pool.query(`
    SELECT DISTINCT state, birth_year, gender
    FROM teams_v2
    WHERE state IS NOT NULL AND birth_year IS NOT NULL AND gender IS NOT NULL AND matches_played > 0
    ORDER BY state, birth_year, gender
  `);

  for (let i = 0; i < stateGroups.rows.length; i++) {
    const { state, birth_year, gender } = stateGroups.rows[i];

    const baseline = await pool.query(`
      SELECT elo_rating FROM teams_v2
      WHERE state = $1 AND birth_year = $2 AND gender = $3 AND matches_played > 0 AND elo_rating IS NOT NULL
      ORDER BY elo_rating DESC
    `, [state, birth_year, gender]);

    const sortedElos = baseline.rows.map(r => parseFloat(r.elo_rating));

    const findRank = (elo) => {
      let low = 0, high = sortedElos.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (sortedElos[mid] > elo) low = mid + 1;
        else high = mid;
      }
      return low + 1;
    };

    const historyResult = await pool.query(`
      SELECT rh.id, rh.elo_rating
      FROM rank_history_v2 rh
      JOIN teams_v2 t ON rh.team_id = t.id
      WHERE t.state = $1 AND t.birth_year = $2 AND t.gender = $3
        AND rh.elo_rating IS NOT NULL AND t.matches_played > 0
    `, [state, birth_year, gender]);

    if (historyResult.rows.length === 0) continue;

    const BATCH_SIZE = 5000;
    for (let j = 0; j < historyResult.rows.length; j += BATCH_SIZE) {
      const batch = historyResult.rows.slice(j, j + BATCH_SIZE);
      const cases = batch.map(row => {
        const rank = findRank(parseFloat(row.elo_rating));
        return `WHEN '${row.id}'::uuid THEN ${rank}`;
      }).join(' ');
      const ids = batch.map(r => `'${r.id}'`).join(',');

      if (!DRY_RUN) {
        await pool.query(`
          UPDATE rank_history_v2
          SET elo_state_rank = CASE id ${cases} END
          WHERE id IN (${ids})
        `);
      }
    }

    if ((i + 1) % 100 === 0) {
      console.log(`   State groups: ${i+1}/${stateGroups.rows.length}`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n✅ Complete!');
  console.log('   Total updated: ' + totalUpdated + ' national ranks');
  console.log('   Time: ' + totalTime + 's');

  await pool.end();
}

recalculateRanks().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
