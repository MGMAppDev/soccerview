/**
 * fixZeroZeroScores.cjs - Fix systemic 0-0 score bug
 *
 * Root Cause: V1 migration (Session 82) imported scheduled matches with 0-0 scores
 * (Session 72 bug in V1 data). Pipeline COALESCE preserved these bad 0-0 values
 * when scrapers re-imported with correct NULLs.
 *
 * Scope: 26,182 matches with 0-0 scores (6.7% of scored — abnormally high)
 *
 * Steps:
 *   1. Fix matches where staging says NULL (~4,300)
 *   2. Fix matches where staging has actual goals (138)
 *   3. Fix future-dated 0-0 matches (definitely scheduled)
 *   4. Report remaining for review
 *
 * Usage:
 *   node scripts/maintenance/fixZeroZeroScores.cjs --dry-run
 *   node scripts/maintenance/fixZeroZeroScores.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const execute = args.includes('--execute');

if (!dryRun && !execute) {
  console.log('Usage: node fixZeroZeroScores.cjs [--dry-run | --execute]');
  process.exit(1);
}

(async () => {
  const client = await pool.connect();

  try {
    // Authorize pipeline writes
    await client.query('SELECT authorize_pipeline_write()');

    console.log('=== Fix Zero-Zero Scores ===');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}\n`);

    // Pre-fix count
    const { rows: [before] } = await client.query(`
      SELECT COUNT(*) as total_zero_zero
      FROM matches_v2
      WHERE home_score = 0 AND away_score = 0 AND deleted_at IS NULL
    `);
    console.log(`Before: ${before.total_zero_zero} matches with 0-0 scores\n`);

    // ============================================================
    // Step 1: Fix matches where staging says NULL
    // ============================================================
    console.log('--- Step 1: Staging says NULL, production has 0-0 ---');

    const step1Query = `
      SELECT m.id, m.source_match_key, m.match_date
      FROM matches_v2 m
      JOIN staging_games sg ON sg.source_match_key = m.source_match_key
      WHERE sg.home_score IS NULL
        AND m.home_score = 0 AND m.away_score = 0
        AND m.deleted_at IS NULL
    `;
    const { rows: step1Candidates } = await client.query(step1Query);
    console.log(`  Found: ${step1Candidates.length} matches`);

    if (step1Candidates.length > 0 && execute) {
      const { rowCount } = await client.query(`
        UPDATE matches_v2 m
        SET home_score = NULL, away_score = NULL
        FROM staging_games sg
        WHERE sg.source_match_key = m.source_match_key
          AND sg.home_score IS NULL
          AND m.home_score = 0 AND m.away_score = 0
          AND m.deleted_at IS NULL
      `);
      console.log(`  Fixed: ${rowCount} matches → NULL scores`);
    } else {
      console.log(`  Would fix: ${step1Candidates.length} matches → NULL scores`);
    }

    // ============================================================
    // Step 2: Fix matches where staging has actual goals
    // ============================================================
    console.log('\n--- Step 2: Staging has goals, production has 0-0 ---');

    const step2Query = `
      SELECT m.id, m.source_match_key, m.match_date,
             sg.home_score as correct_home, sg.away_score as correct_away
      FROM matches_v2 m
      JOIN staging_games sg ON sg.source_match_key = m.source_match_key
      WHERE sg.home_score IS NOT NULL
        AND (sg.home_score > 0 OR sg.away_score > 0)
        AND m.home_score = 0 AND m.away_score = 0
        AND m.deleted_at IS NULL
    `;
    const { rows: step2Candidates } = await client.query(step2Query);
    console.log(`  Found: ${step2Candidates.length} matches`);

    if (step2Candidates.length > 0) {
      // Show sample
      step2Candidates.slice(0, 5).forEach(r => {
        console.log(`    ${r.source_match_key}: 0-0 → ${r.correct_home}-${r.correct_away}`);
      });

      if (execute) {
        const { rowCount } = await client.query(`
          UPDATE matches_v2 m
          SET home_score = sg.home_score, away_score = sg.away_score
          FROM staging_games sg
          WHERE sg.source_match_key = m.source_match_key
            AND sg.home_score IS NOT NULL
            AND (sg.home_score > 0 OR sg.away_score > 0)
            AND m.home_score = 0 AND m.away_score = 0
            AND m.deleted_at IS NULL
        `);
        console.log(`  Fixed: ${rowCount} matches → correct scores`);
      } else {
        console.log(`  Would fix: ${step2Candidates.length} matches → correct scores`);
      }
    }

    // ============================================================
    // Step 3: Fix future-dated 0-0 matches (definitely scheduled)
    // ============================================================
    console.log('\n--- Step 3: Future-dated 0-0 matches ---');

    const step3Query = `
      SELECT COUNT(*) as cnt
      FROM matches_v2
      WHERE home_score = 0 AND away_score = 0
        AND match_date > CURRENT_DATE
        AND deleted_at IS NULL
    `;
    const { rows: [step3Count] } = await client.query(step3Query);
    console.log(`  Found: ${step3Count.cnt} future matches with 0-0`);

    if (parseInt(step3Count.cnt) > 0 && execute) {
      const { rowCount } = await client.query(`
        UPDATE matches_v2
        SET home_score = NULL, away_score = NULL
        WHERE home_score = 0 AND away_score = 0
          AND match_date > CURRENT_DATE
          AND deleted_at IS NULL
      `);
      console.log(`  Fixed: ${rowCount} future matches → NULL scores`);
    } else {
      console.log(`  Would fix: ${step3Count.cnt} future matches → NULL scores`);
    }

    // ============================================================
    // Step 4: Report remaining 0-0 matches
    // ============================================================
    console.log('\n--- Step 4: Remaining 0-0 matches (post-fix) ---');

    const { rows: [after] } = await client.query(`
      SELECT COUNT(*) as total_zero_zero
      FROM matches_v2
      WHERE home_score = 0 AND away_score = 0 AND deleted_at IS NULL
    `);

    const { rows: remaining } = await client.query(`
      SELECT
        CASE
          WHEN source_match_key LIKE 'v1-legacy%' THEN 'v1-legacy'
          WHEN source_match_key LIKE 'legacy-%' THEN 'legacy'
          ELSE source_platform
        END as source,
        COUNT(*) as cnt
      FROM matches_v2
      WHERE home_score = 0 AND away_score = 0 AND deleted_at IS NULL
      GROUP BY 1 ORDER BY 2 DESC
    `);

    console.log(`  Remaining: ${after.total_zero_zero} matches with 0-0`);
    console.log(`  Breakdown:`);
    remaining.forEach(r => console.log(`    ${r.source}: ${r.cnt}`));

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Before: ${before.total_zero_zero} matches with 0-0`);
    console.log(`After:  ${after.total_zero_zero} matches with 0-0`);
    console.log(`Fixed:  ${parseInt(before.total_zero_zero) - parseInt(after.total_zero_zero)} matches`);

    if (dryRun) {
      console.log('\n⚠️  DRY RUN — no changes made. Use --execute to apply fixes.');
    }

  } catch (err) {
    console.error('Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();
