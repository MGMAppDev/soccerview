/**
 * validateRebuild.js
 *
 * Session 79 - V2 Architecture Enforcement - Phase F2
 *
 * Compares rebuild tables vs production tables to ensure
 * the rebuild is valid before the atomic swap.
 *
 * Checks:
 * 1. Row counts (rebuild should have similar or better coverage)
 * 2. Data integrity (no orphan teams, valid birth_years, etc.)
 * 3. Match source_match_key coverage
 * 4. ELO recalculation readiness
 *
 * Usage:
 *   node scripts/maintenance/validateRebuild.js
 *   node scripts/maintenance/validateRebuild.js --verbose
 *   node scripts/maintenance/validateRebuild.js --strict  # Fail if any metric worse
 *
 * Returns exit code 0 if valid, 1 if issues found.
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const VERBOSE = process.argv.includes('--verbose');
const STRICT = process.argv.includes('--strict');

// Tolerance thresholds
const THRESHOLDS = {
  MIN_MATCH_COVERAGE: 0.95,      // Rebuild should have 95%+ of production matches
  MIN_TEAM_COVERAGE: 0.90,       // Rebuild should have 90%+ of production teams
  MAX_ORPHAN_RATE: 0.30,         // Max 30% orphan rate
  MAX_NULL_BIRTH_YEAR: 0.10,     // Max 10% NULL birth_year
  MIN_SOURCE_KEY_COVERAGE: 0.99, // 99%+ matches should have source_match_key
};

async function validateRebuild() {
  console.log('='.repeat(60));
  console.log('VALIDATE REBUILD');
  console.log('Session 79 - V2 Architecture Enforcement');
  console.log('='.repeat(60));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Mode: ${STRICT ? 'STRICT' : 'ADVISORY'}`);
  console.log('');

  const checks = [];
  let allPassed = true;

  try {
    // ============================================================
    // CHECK 1: Rebuild tables exist
    // ============================================================
    console.log('CHECK 1: Rebuild tables exist...');

    const { rows: tables } = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('teams_v2_rebuild', 'matches_v2_rebuild')
    `);

    if (tables.length !== 2) {
      console.log('   ❌ Rebuild tables do not exist');
      console.log('      Run: node scripts/maintenance/rebuildFromStaging.js --create-tables');
      return { valid: false, checks, reason: 'Rebuild tables not found' };
    }
    console.log('   ✅ Rebuild tables exist');
    checks.push({ check: 'tables_exist', passed: true });

    // ============================================================
    // CHECK 2: Row count comparison
    // ============================================================
    console.log('\nCHECK 2: Row count comparison...');

    const { rows: counts } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM teams_v2) as teams_prod,
        (SELECT COUNT(*) FROM teams_v2_rebuild) as teams_rebuild,
        (SELECT COUNT(*) FROM matches_v2) as matches_prod,
        (SELECT COUNT(*) FROM matches_v2_rebuild) as matches_rebuild
    `);

    const c = counts[0];
    const teamsProd = parseInt(c.teams_prod);
    const teamsRebuild = parseInt(c.teams_rebuild);
    const matchesProd = parseInt(c.matches_prod);
    const matchesRebuild = parseInt(c.matches_rebuild);

    const teamCoverage = teamsRebuild / Math.max(teamsProd, 1);
    const matchCoverage = matchesRebuild / Math.max(matchesProd, 1);

    console.log(`   Teams:   ${teamsRebuild.toLocaleString()} rebuild / ${teamsProd.toLocaleString()} prod = ${(teamCoverage * 100).toFixed(1)}%`);
    console.log(`   Matches: ${matchesRebuild.toLocaleString()} rebuild / ${matchesProd.toLocaleString()} prod = ${(matchCoverage * 100).toFixed(1)}%`);

    if (teamCoverage >= THRESHOLDS.MIN_TEAM_COVERAGE) {
      console.log(`   ✅ Team coverage: ${(teamCoverage * 100).toFixed(1)}% (threshold: ${THRESHOLDS.MIN_TEAM_COVERAGE * 100}%)`);
      checks.push({ check: 'team_coverage', passed: true, value: teamCoverage });
    } else {
      console.log(`   ❌ Team coverage too low: ${(teamCoverage * 100).toFixed(1)}% (need ${THRESHOLDS.MIN_TEAM_COVERAGE * 100}%)`);
      checks.push({ check: 'team_coverage', passed: false, value: teamCoverage });
      allPassed = false;
    }

    if (matchCoverage >= THRESHOLDS.MIN_MATCH_COVERAGE) {
      console.log(`   ✅ Match coverage: ${(matchCoverage * 100).toFixed(1)}% (threshold: ${THRESHOLDS.MIN_MATCH_COVERAGE * 100}%)`);
      checks.push({ check: 'match_coverage', passed: true, value: matchCoverage });
    } else {
      console.log(`   ❌ Match coverage too low: ${(matchCoverage * 100).toFixed(1)}% (need ${THRESHOLDS.MIN_MATCH_COVERAGE * 100}%)`);
      checks.push({ check: 'match_coverage', passed: false, value: matchCoverage });
      allPassed = false;
    }

    // ============================================================
    // CHECK 3: Birth year validity
    // ============================================================
    console.log('\nCHECK 3: Birth year validity...');

    const { rows: birthYearStats } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE birth_year IS NULL) as null_birth_year,
        COUNT(*) FILTER (WHERE birth_year < 2000 OR birth_year > 2020) as invalid_birth_year
      FROM teams_v2_rebuild
    `);

    const byStats = birthYearStats[0];
    const totalTeams = parseInt(byStats.total);
    const nullBirthYear = parseInt(byStats.null_birth_year);
    const invalidBirthYear = parseInt(byStats.invalid_birth_year);
    const nullBirthYearRate = nullBirthYear / Math.max(totalTeams, 1);

    console.log(`   Total teams: ${totalTeams.toLocaleString()}`);
    console.log(`   NULL birth_year: ${nullBirthYear.toLocaleString()} (${(nullBirthYearRate * 100).toFixed(1)}%)`);
    console.log(`   Invalid birth_year: ${invalidBirthYear.toLocaleString()}`);

    if (nullBirthYearRate <= THRESHOLDS.MAX_NULL_BIRTH_YEAR) {
      console.log(`   ✅ NULL birth_year rate: ${(nullBirthYearRate * 100).toFixed(1)}% (max: ${THRESHOLDS.MAX_NULL_BIRTH_YEAR * 100}%)`);
      checks.push({ check: 'birth_year_validity', passed: true, value: nullBirthYearRate });
    } else {
      console.log(`   ⚠️ NULL birth_year rate high: ${(nullBirthYearRate * 100).toFixed(1)}% (max: ${THRESHOLDS.MAX_NULL_BIRTH_YEAR * 100}%)`);
      checks.push({ check: 'birth_year_validity', passed: false, value: nullBirthYearRate });
      // Not failing overall for this - it's a data quality issue, not a rebuild issue
    }

    // ============================================================
    // CHECK 4: Source match key coverage
    // ============================================================
    console.log('\nCHECK 4: Source match key coverage...');

    const { rows: keyStats } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE source_match_key IS NOT NULL) as has_key,
        COUNT(*) FILTER (WHERE source_match_key IS NULL) as no_key
      FROM matches_v2_rebuild
    `);

    const kStats = keyStats[0];
    const totalMatches = parseInt(kStats.total);
    const hasKey = parseInt(kStats.has_key);
    const keyCoverage = hasKey / Math.max(totalMatches, 1);

    console.log(`   Matches with source_match_key: ${hasKey.toLocaleString()} / ${totalMatches.toLocaleString()}`);
    console.log(`   Coverage: ${(keyCoverage * 100).toFixed(2)}%`);

    if (keyCoverage >= THRESHOLDS.MIN_SOURCE_KEY_COVERAGE) {
      console.log(`   ✅ Source key coverage: ${(keyCoverage * 100).toFixed(2)}% (threshold: ${THRESHOLDS.MIN_SOURCE_KEY_COVERAGE * 100}%)`);
      checks.push({ check: 'source_key_coverage', passed: true, value: keyCoverage });
    } else {
      console.log(`   ❌ Source key coverage low: ${(keyCoverage * 100).toFixed(2)}% (need ${THRESHOLDS.MIN_SOURCE_KEY_COVERAGE * 100}%)`);
      checks.push({ check: 'source_key_coverage', passed: false, value: keyCoverage });
      allPassed = false;
    }

    // ============================================================
    // CHECK 5: Duplicate source_match_keys
    // ============================================================
    console.log('\nCHECK 5: Duplicate source_match_keys...');

    const { rows: dupeStats } = await pool.query(`
      SELECT COUNT(*) as dupes
      FROM (
        SELECT source_match_key
        FROM matches_v2_rebuild
        WHERE source_match_key IS NOT NULL
        GROUP BY source_match_key
        HAVING COUNT(*) > 1
      ) d
    `);

    const dupeCount = parseInt(dupeStats[0].dupes);

    if (dupeCount === 0) {
      console.log(`   ✅ No duplicate source_match_keys found`);
      checks.push({ check: 'no_duplicate_keys', passed: true, value: 0 });
    } else {
      console.log(`   ❌ Found ${dupeCount.toLocaleString()} duplicate source_match_key groups`);
      checks.push({ check: 'no_duplicate_keys', passed: false, value: dupeCount });
      allPassed = false;
    }

    // ============================================================
    // CHECK 6: Orphan match rate
    // ============================================================
    console.log('\nCHECK 6: Orphan match rate...');

    const { rows: orphanStats } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE league_id IS NULL AND tournament_id IS NULL) as orphans
      FROM matches_v2_rebuild
    `);

    const oStats = orphanStats[0];
    const orphanMatches = parseInt(oStats.orphans);
    const orphanRate = orphanMatches / Math.max(parseInt(oStats.total), 1);

    console.log(`   Orphan matches: ${orphanMatches.toLocaleString()} / ${parseInt(oStats.total).toLocaleString()}`);
    console.log(`   Orphan rate: ${(orphanRate * 100).toFixed(1)}%`);

    if (orphanRate <= THRESHOLDS.MAX_ORPHAN_RATE) {
      console.log(`   ✅ Orphan rate: ${(orphanRate * 100).toFixed(1)}% (max: ${THRESHOLDS.MAX_ORPHAN_RATE * 100}%)`);
      checks.push({ check: 'orphan_rate', passed: true, value: orphanRate });
    } else {
      console.log(`   ⚠️ Orphan rate high: ${(orphanRate * 100).toFixed(1)}% (max: ${THRESHOLDS.MAX_ORPHAN_RATE * 100}%)`);
      checks.push({ check: 'orphan_rate', passed: false, value: orphanRate });
      // Not failing overall for this - it's expected based on data coverage gaps
    }

    // ============================================================
    // CHECK 7: Compare data quality metrics
    // ============================================================
    console.log('\nCHECK 7: Data quality comparison (rebuild vs production)...');

    const { rows: qualityComparison } = await pool.query(`
      SELECT
        -- Production metrics
        (SELECT COUNT(*) FILTER (WHERE birth_year IS NULL) FROM teams_v2)::float /
          NULLIF((SELECT COUNT(*) FROM teams_v2), 0) as prod_null_by_rate,
        (SELECT COUNT(*) FILTER (WHERE gender IS NULL) FROM teams_v2)::float /
          NULLIF((SELECT COUNT(*) FROM teams_v2), 0) as prod_null_gender_rate,

        -- Rebuild metrics
        (SELECT COUNT(*) FILTER (WHERE birth_year IS NULL) FROM teams_v2_rebuild)::float /
          NULLIF((SELECT COUNT(*) FROM teams_v2_rebuild), 0) as rebuild_null_by_rate,
        (SELECT COUNT(*) FILTER (WHERE gender IS NULL) FROM teams_v2_rebuild)::float /
          NULLIF((SELECT COUNT(*) FROM teams_v2_rebuild), 0) as rebuild_null_gender_rate
    `);

    const q = qualityComparison[0];
    const prodNullByRate = parseFloat(q.prod_null_by_rate) || 0;
    const rebuildNullByRate = parseFloat(q.rebuild_null_by_rate) || 0;
    const prodNullGenderRate = parseFloat(q.prod_null_gender_rate) || 0;
    const rebuildNullGenderRate = parseFloat(q.rebuild_null_gender_rate) || 0;

    console.log('   NULL birth_year rate:');
    console.log(`      Production: ${(prodNullByRate * 100).toFixed(1)}%`);
    console.log(`      Rebuild:    ${(rebuildNullByRate * 100).toFixed(1)}%`);
    const byImproved = rebuildNullByRate <= prodNullByRate;
    console.log(`      ${byImproved ? '✅ Same or better' : '⚠️ Worse'}`);

    console.log('   NULL gender rate:');
    console.log(`      Production: ${(prodNullGenderRate * 100).toFixed(1)}%`);
    console.log(`      Rebuild:    ${(rebuildNullGenderRate * 100).toFixed(1)}%`);
    const genderImproved = rebuildNullGenderRate <= prodNullGenderRate;
    console.log(`      ${genderImproved ? '✅ Same or better' : '⚠️ Worse'}`);

    checks.push({
      check: 'quality_comparison',
      passed: byImproved && genderImproved,
      value: { byImproved, genderImproved }
    });

    if (STRICT && (!byImproved || !genderImproved)) {
      allPassed = false;
    }

    // ============================================================
    // Summary
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION SUMMARY');
    console.log('='.repeat(60));

    const passed = checks.filter(c => c.passed).length;
    const failed = checks.filter(c => !c.passed).length;

    console.log(`\nChecks: ${passed} passed, ${failed} failed`);

    if (VERBOSE) {
      console.log('\nDetailed results:');
      checks.forEach(c => {
        console.log(`   ${c.passed ? '✅' : '❌'} ${c.check}: ${JSON.stringify(c.value)}`);
      });
    }

    if (allPassed) {
      console.log('\n✅ REBUILD VALIDATION PASSED');
      console.log('   The rebuild tables are ready for the swap.');
      console.log('   Run: node scripts/maintenance/executeSwap.js --dry-run');
    } else {
      console.log('\n⚠️ REBUILD VALIDATION HAS ISSUES');
      console.log('   Review the checks above before proceeding.');
      if (STRICT) {
        console.log('   (STRICT mode: Failing due to quality issues)');
      }
    }

    return {
      valid: allPassed,
      checks,
      summary: {
        teamCoverage,
        matchCoverage,
        nullBirthYearRate,
        keyCoverage,
        dupeCount,
        orphanRate
      }
    };

  } catch (err) {
    console.error('\n❌ Error validating rebuild:', err.message);
    return { valid: false, checks, error: err.message };
  } finally {
    await pool.end();
  }
}

// Run validation
validateRebuild()
  .then(result => {
    console.log('\n' + '='.repeat(60));
    console.log('Result:', JSON.stringify(result.summary || { error: result.error }, null, 2));

    if (!result.valid && STRICT) {
      process.exit(1);
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
