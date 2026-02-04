/**
 * analyzeRankHistoryGap.cjs
 * Session 83: Check for DISCREPANCIES between V1 and V2 rank_history
 *
 * More records doesn't mean better data. This script checks:
 * 1. Are there teams in V1 that are missing from V2 for the same dates?
 * 2. Are there rank differences where both exist?
 * 3. Should we migrate V1 data to fill gaps?
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 300000,
});

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     RANK HISTORY DISCREPANCY ANALYSIS: V1 vs V2                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // 1. Date range comparison
  console.log('=== 1. DATE RANGE COMPARISON ===\n');

  const { rows: v1Dates } = await pool.query(`
    SELECT
      MIN(snapshot_date)::text as min_date,
      MAX(snapshot_date)::text as max_date,
      COUNT(DISTINCT snapshot_date) as unique_dates
    FROM rank_history_deprecated
  `);

  const { rows: v2Dates } = await pool.query(`
    SELECT
      MIN(snapshot_date)::text as min_date,
      MAX(snapshot_date)::text as max_date,
      COUNT(DISTINCT snapshot_date) as unique_dates
    FROM rank_history_v2
  `);

  console.log('V1 rank_history_deprecated:');
  console.log(`  Date Range: ${v1Dates[0].min_date} to ${v1Dates[0].max_date}`);
  console.log(`  Unique Dates: ${v1Dates[0].unique_dates}`);

  console.log('\nV2 rank_history_v2:');
  console.log(`  Date Range: ${v2Dates[0].min_date} to ${v2Dates[0].max_date}`);
  console.log(`  Unique Dates: ${v2Dates[0].unique_dates}`);

  // 2. Check per-date counts
  console.log('\n=== 2. PER-DATE COMPARISON ===\n');

  const { rows: v1DateCounts } = await pool.query(`
    SELECT snapshot_date::text, COUNT(*) as count
    FROM rank_history_deprecated
    GROUP BY snapshot_date
    ORDER BY snapshot_date
  `);

  console.log('V1 Dates and Counts:');
  for (const row of v1DateCounts) {
    // Check corresponding V2 count
    const { rows: v2Count } = await pool.query(`
      SELECT COUNT(*) as count FROM rank_history_v2
      WHERE snapshot_date = $1::date
    `, [row.snapshot_date]);

    const v1Count = parseInt(row.count);
    const v2CountVal = parseInt(v2Count[0].count);
    const diff = v2CountVal - v1Count;
    const status = v2CountVal >= v1Count ? '✓' : '⚠️ V1 HAS MORE';

    console.log(`  ${row.snapshot_date}: V1=${v1Count.toLocaleString().padStart(8)}, V2=${v2CountVal.toLocaleString().padStart(8)}, diff=${diff.toLocaleString().padStart(8)} ${status}`);
  }

  // 3. Teams in V1 NOT in V2 for same dates
  console.log('\n=== 3. V1 ENTRIES MISSING FROM V2 (SAME DATE) ===\n');

  const { rows: missingCount } = await pool.query(`
    SELECT COUNT(*) as count
    FROM rank_history_deprecated rh1
    WHERE NOT EXISTS (
      SELECT 1 FROM rank_history_v2 rh2
      WHERE rh2.team_id = rh1.team_id
        AND rh2.snapshot_date = rh1.snapshot_date
    )
  `);

  console.log(`  V1 entries with NO matching V2 entry: ${parseInt(missingCount[0].count).toLocaleString()}`);

  // 4. Unique teams comparison
  console.log('\n=== 4. UNIQUE TEAMS ANALYSIS ===\n');

  const { rows: teamAnalysis } = await pool.query(`
    SELECT
      (SELECT COUNT(DISTINCT team_id) FROM rank_history_deprecated) as v1_teams,
      (SELECT COUNT(DISTINCT team_id) FROM rank_history_v2) as v2_teams,
      (SELECT COUNT(DISTINCT rh1.team_id)
       FROM rank_history_deprecated rh1
       WHERE NOT EXISTS (SELECT 1 FROM rank_history_v2 rh2 WHERE rh2.team_id = rh1.team_id)
      ) as v1_only_teams
  `);

  console.log(`  V1 unique teams: ${parseInt(teamAnalysis[0].v1_teams).toLocaleString()}`);
  console.log(`  V2 unique teams: ${parseInt(teamAnalysis[0].v2_teams).toLocaleString()}`);
  console.log(`  Teams in V1 ONLY (not in V2 at all): ${parseInt(teamAnalysis[0].v1_only_teams).toLocaleString()}`);

  // 5. Check if V1-only teams still exist in teams_v2
  console.log('\n=== 5. V1-ONLY TEAMS VALIDITY ===\n');

  const { rows: v1OnlyValidity } = await pool.query(`
    WITH v1_only_teams AS (
      SELECT DISTINCT rh1.team_id
      FROM rank_history_deprecated rh1
      WHERE NOT EXISTS (SELECT 1 FROM rank_history_v2 rh2 WHERE rh2.team_id = rh1.team_id)
    )
    SELECT
      COUNT(*) as total_v1_only,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = v1.team_id)) as valid_in_v2,
      COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = v1.team_id)) as not_in_v2
    FROM v1_only_teams v1
  `);

  console.log(`  V1-only teams total: ${parseInt(v1OnlyValidity[0].total_v1_only).toLocaleString()}`);
  console.log(`  Still valid in teams_v2: ${parseInt(v1OnlyValidity[0].valid_in_v2).toLocaleString()}`);
  console.log(`  NOT in teams_v2: ${parseInt(v1OnlyValidity[0].not_in_v2).toLocaleString()}`);

  // 6. Sample of V1-only entries with valid team_ids
  console.log('\n=== 6. SAMPLE OF RECOVERABLE V1 ENTRIES ===\n');

  const { rows: samples } = await pool.query(`
    SELECT rh1.team_id, rh1.snapshot_date::text, rh1.national_rank, rh1.state_rank, rh1.elo_rating,
           t.display_name as team_name
    FROM rank_history_deprecated rh1
    JOIN teams_v2 t ON t.id = rh1.team_id
    WHERE NOT EXISTS (
      SELECT 1 FROM rank_history_v2 rh2
      WHERE rh2.team_id = rh1.team_id AND rh2.snapshot_date = rh1.snapshot_date
    )
    ORDER BY rh1.national_rank NULLS LAST
    LIMIT 10
  `);

  if (samples.length > 0) {
    console.log('  Entries that COULD be migrated (valid team_id, not in V2):');
    for (const s of samples) {
      console.log(`    ${s.snapshot_date}: ${(s.team_name || 'UNKNOWN').substring(0, 40)} - rank #${s.national_rank || 'N/A'}`);
    }
  } else {
    console.log('  No recoverable entries found (all V1 teams either in V2 or deleted)');
  }

  // 7. Summary and Recommendation
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                       RECOMMENDATION                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const missingTotal = parseInt(missingCount[0].count);
  const v1OnlyValid = parseInt(v1OnlyValidity[0].valid_in_v2);

  if (v1OnlyValid > 0) {
    console.log(`  ⚠️  FOUND ${v1OnlyValid.toLocaleString()} teams in V1 NOT in V2 rank_history`);
    console.log(`      These teams have valid IDs in teams_v2 and could be migrated.`);
    console.log(`\n  ACTION: Create migrateV1RankHistory.cjs to fill gaps`);
  } else if (missingTotal > 0) {
    console.log(`  ⚠️  FOUND ${missingTotal.toLocaleString()} V1 entries missing from V2`);
    console.log(`      But team_ids may not be valid in current teams_v2.`);
    console.log(`\n  ACTION: Investigate further before migrating`);
  } else {
    console.log(`  ✅ V2 rank_history fully covers V1 data`);
    console.log(`     No migration needed.`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('ANALYSIS FAILED:', err);
  process.exit(1);
});
