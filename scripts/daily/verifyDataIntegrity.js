/**
 * Data Integrity Verification System v1.0
 * ========================================
 *
 * Automated checks that run after EVERY processing cycle to ensure data quality.
 * Part of V2 Architecture Enforcement (Session 79).
 *
 * CHECKS:
 * 1. Team stats consistency - matches_played should match actual match count
 * 2. No duplicate source_match_keys
 * 2b. No semantic duplicates (same date + team IDs) - Session 85 SoccerView ID Architecture
 * 3. Canonical registry completeness
 * 4. Birth year validity
 * 5. Orphan detection (GotSport ranked teams with 0 matches)
 *
 * EXIT CODES:
 *   0 - All checks pass
 *   1 - One or more checks failed
 *   2 - Critical error (pipeline should halt)
 *
 * Usage:
 *   node scripts/daily/verifyDataIntegrity.js                # Run all checks
 *   node scripts/daily/verifyDataIntegrity.js --quick        # Run fast checks only
 *   node scripts/daily/verifyDataIntegrity.js --fix          # Attempt to fix issues
 *   node scripts/daily/verifyDataIntegrity.js --halt-on-fail # Exit 2 on any failure
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
  // Thresholds for warnings vs failures
  ORPHAN_RATE_WARN: 0.30,       // Warn if >30% orphan rate
  ORPHAN_RATE_FAIL: 0.50,       // Fail if >50% orphan rate
  CANONICAL_COVERAGE_WARN: 0.80, // Warn if <80% canonical coverage
  CANONICAL_COVERAGE_FAIL: 0.50, // Fail if <50% canonical coverage
  STATS_MISMATCH_LIMIT: 100,    // Fail if >100 teams have stats mismatches
  DUPLICATE_KEY_LIMIT: 0,        // Fail if ANY duplicate source_match_keys
  INVALID_BIRTH_YEAR_LIMIT: 1000, // Warn if >1000 invalid birth years
};

// ===========================================
// DATABASE CONNECTION
// ===========================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ===========================================
// CHECK RESULTS TRACKING
// ===========================================

const results = {
  checks: [],
  passed: 0,
  warned: 0,
  failed: 0,
  critical: 0,
};

function addResult(name, status, message, details = null) {
  results.checks.push({ name, status, message, details });
  switch (status) {
    case 'pass':
      results.passed++;
      break;
    case 'warn':
      results.warned++;
      break;
    case 'fail':
      results.failed++;
      break;
    case 'critical':
      results.critical++;
      break;
  }
  const icon =
    status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : status === 'critical' ? '🚨' : '❌';
  console.log(`${icon} ${name}: ${message}`);
  if (details && status !== 'pass') {
    console.log(`   ${details}`);
  }
}

// ===========================================
// CHECK 1: Team Stats Consistency
// ===========================================

async function checkTeamStatsConsistency() {
  console.log('\n--- Check 1: Team Stats Consistency ---');

  // Find teams where matches_played doesn't match actual count
  const { rows } = await pool.query(`
    WITH actual_counts AS (
      SELECT
        t.id,
        t.display_name,
        t.matches_played as stored,
        COUNT(DISTINCT m.id) as actual
      FROM teams_v2 t
      LEFT JOIN matches_v2 m ON (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.deleted_at IS NULL
      WHERE t.matches_played > 0 OR EXISTS (
        SELECT 1 FROM matches_v2 WHERE (home_team_id = t.id OR away_team_id = t.id) AND deleted_at IS NULL
      )
      GROUP BY t.id, t.display_name, t.matches_played
    )
    SELECT id, display_name, stored, actual
    FROM actual_counts
    WHERE stored != actual
    LIMIT 20
  `);

  if (rows.length === 0) {
    addResult('Team Stats Consistency', 'pass', 'All team stats match actual match counts');
  } else if (rows.length <= CONFIG.STATS_MISMATCH_LIMIT) {
    addResult(
      'Team Stats Consistency',
      'warn',
      `${rows.length} teams have stats mismatches`,
      `Example: ${rows[0].display_name} shows ${rows[0].stored} but has ${rows[0].actual}`
    );
  } else {
    addResult(
      'Team Stats Consistency',
      'fail',
      `${rows.length}+ teams have stats mismatches (limit: ${CONFIG.STATS_MISMATCH_LIMIT})`,
      `Example: ${rows[0].display_name} shows ${rows[0].stored} but has ${rows[0].actual}`
    );
  }

  return rows;
}

// ===========================================
// CHECK 2: Duplicate source_match_keys
// ===========================================

async function checkDuplicateSourceMatchKeys() {
  console.log('\n--- Check 2: Duplicate Source Match Keys ---');

  const { rows } = await pool.query(`
    SELECT source_match_key, COUNT(*) as count
    FROM matches_v2
    WHERE source_match_key IS NOT NULL AND deleted_at IS NULL
    GROUP BY source_match_key
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 10
  `);

  if (rows.length === 0) {
    addResult('Duplicate Match Keys', 'pass', 'No duplicate source_match_keys found');
  } else {
    addResult(
      'Duplicate Match Keys',
      'critical',
      `${rows.length} duplicate source_match_key groups found`,
      `Worst: "${rows[0].source_match_key}" appears ${rows[0].count} times`
    );
  }

  return rows;
}

// ===========================================
// CHECK 2b: Semantic Duplicates (Session 85)
// ===========================================
// A match is uniquely identified by (match_date, home_team_id, away_team_id)
// using SoccerView Team IDs. This check ensures no semantic duplicates exist.

async function checkSemanticDuplicates() {
  console.log('\n--- Check 2b: Semantic Duplicates (SoccerView ID Architecture) ---');

  const { rows } = await pool.query(`
    SELECT COUNT(*) as duplicate_groups
    FROM (
      SELECT match_date, home_team_id, away_team_id
      FROM matches_v2
      WHERE deleted_at IS NULL
      GROUP BY match_date, home_team_id, away_team_id
      HAVING COUNT(*) > 1
    ) dups
  `);

  const dupeCount = parseInt(rows[0].duplicate_groups);

  if (dupeCount === 0) {
    addResult(
      'Semantic Duplicates',
      'pass',
      'No semantic duplicates (same date + team IDs)'
    );
  } else {
    addResult(
      'Semantic Duplicates',
      'critical',
      `${dupeCount} semantic duplicate groups found`,
      'Run: node scripts/universal/deduplication/matchDedup.js --execute'
    );
  }

  return dupeCount;
}

// ===========================================
// CHECK 3: Canonical Registry Completeness
// ===========================================

async function checkCanonicalRegistryCompleteness() {
  console.log('\n--- Check 3: Canonical Registry Completeness ---');

  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2) as total_teams,
      (SELECT COUNT(*) FROM canonical_teams) as canonical_teams,
      (SELECT COUNT(*) FROM teams_v2 t
       WHERE NOT EXISTS (SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id)
      ) as teams_not_in_registry
  `);

  const { total_teams, canonical_teams, teams_not_in_registry } = rows[0];
  const coverage = canonical_teams / total_teams;

  if (coverage >= CONFIG.CANONICAL_COVERAGE_WARN) {
    addResult(
      'Canonical Registry',
      'pass',
      `${(coverage * 100).toFixed(1)}% coverage (${canonical_teams}/${total_teams})`
    );
  } else if (coverage >= CONFIG.CANONICAL_COVERAGE_FAIL) {
    addResult(
      'Canonical Registry',
      'warn',
      `${(coverage * 100).toFixed(1)}% coverage - below ${CONFIG.CANONICAL_COVERAGE_WARN * 100}% threshold`,
      `${teams_not_in_registry} teams not in registry`
    );
  } else {
    addResult(
      'Canonical Registry',
      'fail',
      `${(coverage * 100).toFixed(1)}% coverage - critically low`,
      `Run: node scripts/maintenance/populateCanonicalTeams.cjs --execute`
    );
  }

  return rows[0];
}

// ===========================================
// CHECK 4: Birth Year Validity
// ===========================================

async function checkBirthYearValidity() {
  console.log('\n--- Check 4: Birth Year Validity ---');

  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE birth_year < 2005) as too_old,
      COUNT(*) FILTER (WHERE birth_year > 2020) as too_young,
      COUNT(*) FILTER (WHERE birth_year IS NULL) as null_birth_year,
      COUNT(*) as total
    FROM teams_v2
    WHERE matches_played > 0 OR national_rank IS NOT NULL
  `);

  const { too_old, too_young, null_birth_year, total } = rows[0];
  const invalid = parseInt(too_old) + parseInt(too_young);

  if (invalid === 0 && parseInt(null_birth_year) === 0) {
    addResult('Birth Year Validity', 'pass', 'All active teams have valid birth years');
  } else if (invalid <= CONFIG.INVALID_BIRTH_YEAR_LIMIT) {
    addResult(
      'Birth Year Validity',
      'warn',
      `${invalid} teams with invalid birth years, ${null_birth_year} with NULL`,
      `Too old (<2005): ${too_old}, Too young (>2020): ${too_young}`
    );
  } else {
    addResult(
      'Birth Year Validity',
      'fail',
      `${invalid} teams with invalid birth years exceeds limit`,
      `Consider running birth year cleanup scripts`
    );
  }

  return rows[0];
}

// ===========================================
// CHECK 5: Orphan Detection
// ===========================================

async function checkOrphanRate() {
  console.log('\n--- Check 5: Orphan Detection (GotSport ranked, 0 matches) ---');

  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE t.national_rank IS NOT NULL) as gs_ranked,
      COUNT(*) FILTER (
        WHERE t.national_rank IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM matches_v2 m
            WHERE (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.deleted_at IS NULL
          )
      ) as orphans
    FROM teams_v2 t
  `);

  const { gs_ranked, orphans } = rows[0];
  const orphanRate = orphans / gs_ranked;

  if (orphanRate <= CONFIG.ORPHAN_RATE_WARN) {
    addResult(
      'Orphan Detection',
      'pass',
      `${(orphanRate * 100).toFixed(1)}% orphan rate (${orphans}/${gs_ranked} GS-ranked teams)`
    );
  } else if (orphanRate <= CONFIG.ORPHAN_RATE_FAIL) {
    addResult(
      'Orphan Detection',
      'warn',
      `${(orphanRate * 100).toFixed(1)}% orphan rate exceeds ${CONFIG.ORPHAN_RATE_WARN * 100}% threshold`,
      `${orphans} teams have GotSport rankings but 0 matches in our database`
    );
  } else {
    addResult(
      'Orphan Detection',
      'fail',
      `${(orphanRate * 100).toFixed(1)}% orphan rate is critically high`,
      `Root cause: Data coverage gaps - see Session 78 analysis`
    );
  }

  return rows[0];
}

// ===========================================
// CHECK 6: Staging Backlog
// ===========================================

async function checkStagingBacklog() {
  console.log('\n--- Check 6: Staging Backlog ---');

  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE processed = false) as unprocessed,
      COUNT(*) as total,
      MAX(scraped_at) FILTER (WHERE processed = false) as oldest_unprocessed
    FROM staging_games
  `);

  const { unprocessed, total, oldest_unprocessed } = rows[0];

  if (parseInt(unprocessed) === 0) {
    addResult('Staging Backlog', 'pass', 'No unprocessed staging records');
  } else if (parseInt(unprocessed) < 10000) {
    addResult(
      'Staging Backlog',
      'warn',
      `${unprocessed} unprocessed records in staging`,
      oldest_unprocessed ? `Oldest: ${oldest_unprocessed}` : null
    );
  } else {
    addResult(
      'Staging Backlog',
      'fail',
      `${unprocessed} unprocessed staging records - pipeline may be stalled`,
      `Run: node scripts/universal/dataQualityEngine.js --process-staging`
    );
  }

  return rows[0];
}

// ===========================================
// CHECK 7: Rejected Records
// ===========================================

async function checkRejectedRecords() {
  console.log('\n--- Check 7: Rejected Records ---');

  const { rows } = await pool.query(`
    SELECT
      rejection_code,
      COUNT(*) as count,
      MAX(rejected_at) as latest
    FROM staging_rejected
    GROUP BY rejection_code
    ORDER BY count DESC
  `);

  if (rows.length === 0) {
    addResult('Rejected Records', 'pass', 'No rejected records in staging_rejected');
  } else {
    const total = rows.reduce((sum, r) => sum + parseInt(r.count), 0);
    const summary = rows.map((r) => `${r.rejection_code}: ${r.count}`).join(', ');
    addResult(
      'Rejected Records',
      'warn',
      `${total} rejected records: ${summary}`,
      `Review staging_rejected table for patterns`
    );
  }

  return rows;
}

// ===========================================
// CHECK 8: Source Entity Map Coverage (Session 89)
// ===========================================

async function checkSourceEntityMapCoverage() {
  console.log('\n--- Check 8: Source Entity Map Coverage (Session 89) ---');

  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM source_entity_map) as total_mappings,
      (SELECT COUNT(*) FROM source_entity_map WHERE entity_type = 'team') as team_mappings,
      (SELECT COUNT(*) FROM source_entity_map WHERE entity_type = 'league') as league_mappings,
      (SELECT COUNT(*) FROM source_entity_map WHERE entity_type = 'tournament') as tournament_mappings,
      (SELECT COUNT(DISTINCT source_platform) FROM source_entity_map) as platforms
  `);

  const { total_mappings, team_mappings, league_mappings, tournament_mappings, platforms } = rows[0];

  if (parseInt(total_mappings) > 0) {
    addResult(
      'Source Entity Map',
      'pass',
      `${total_mappings} mappings across ${platforms} platforms (${team_mappings} teams, ${league_mappings} leagues, ${tournament_mappings} tournaments)`
    );
  } else {
    addResult(
      'Source Entity Map',
      'warn',
      'No source entity mappings found',
      'Run: node scripts/maintenance/backfillSourceEntityMap.cjs'
    );
  }

  return rows[0];
}

// ===========================================
// QUICK CHECKS (for --quick mode)
// ===========================================

async function runQuickChecks() {
  await checkDuplicateSourceMatchKeys();
  await checkSemanticDuplicates();  // Session 85: SoccerView ID Architecture
  await checkStagingBacklog();
}

// ===========================================
// FULL CHECKS
// ===========================================

async function runFullChecks() {
  await checkTeamStatsConsistency();
  await checkDuplicateSourceMatchKeys();
  await checkSemanticDuplicates();  // Session 85: SoccerView ID Architecture
  await checkCanonicalRegistryCompleteness();
  await checkSourceEntityMapCoverage();  // Session 89: Three-tier resolution
  await checkBirthYearValidity();
  await checkOrphanRate();
  await checkStagingBacklog();
  await checkRejectedRecords();
}

// ===========================================
// FIX MODE
// ===========================================

async function runFixes() {
  console.log('\n🔧 Running automatic fixes...');

  // Authorize writes to protected tables
  await authorizePipelineWrite(pool);

  // Fix 1: Update team stats from actual match counts
  const statsResult = await pool.query(`
    WITH actual_counts AS (
      SELECT
        t.id,
        COUNT(DISTINCT m.id) FILTER (WHERE m.home_score IS NOT NULL) as matches,
        COUNT(DISTINCT m.id) FILTER (
          WHERE (m.home_team_id = t.id AND m.home_score > m.away_score)
             OR (m.away_team_id = t.id AND m.away_score > m.home_score)
        ) as wins,
        COUNT(DISTINCT m.id) FILTER (
          WHERE (m.home_team_id = t.id AND m.home_score < m.away_score)
             OR (m.away_team_id = t.id AND m.away_score < m.home_score)
        ) as losses,
        COUNT(DISTINCT m.id) FILTER (
          WHERE m.home_score IS NOT NULL AND m.home_score = m.away_score
        ) as draws
      FROM teams_v2 t
      LEFT JOIN matches_v2 m ON (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.deleted_at IS NULL
      WHERE t.matches_played IS DISTINCT FROM (
        SELECT COUNT(*) FROM matches_v2
        WHERE (home_team_id = t.id OR away_team_id = t.id) AND deleted_at IS NULL
      )
      GROUP BY t.id
    )
    UPDATE teams_v2 t
    SET
      matches_played = ac.matches,
      wins = ac.wins,
      losses = ac.losses,
      draws = ac.draws
    FROM actual_counts ac
    WHERE t.id = ac.id
  `);

  console.log(`  ✅ Fixed ${statsResult.rowCount} team stats`);
}

// ===========================================
// SUMMARY
// ===========================================

function printSummary() {
  console.log('\n' + '='.repeat(50));
  console.log('DATA INTEGRITY VERIFICATION SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Passed:   ${results.passed}`);
  console.log(`⚠️  Warnings: ${results.warned}`);
  console.log(`❌ Failed:   ${results.failed}`);
  console.log(`🚨 Critical: ${results.critical}`);
  console.log('='.repeat(50));

  if (results.critical > 0) {
    console.log('\n🚨 CRITICAL ISSUES DETECTED - Pipeline should be investigated');
    return 2;
  } else if (results.failed > 0) {
    console.log('\n❌ FAILURES DETECTED - Review and fix before next sync');
    return 1;
  } else if (results.warned > 0) {
    console.log('\n⚠️  WARNINGS - Data quality could be improved');
    return 0;
  } else {
    console.log('\n✅ ALL CHECKS PASSED - Data integrity verified');
    return 0;
  }
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  const args = process.argv.slice(2);
  const quickMode = args.includes('--quick');
  const fixMode = args.includes('--fix');
  const haltOnFail = args.includes('--halt-on-fail');

  console.log('🔍 Data Integrity Verification System v1.0');
  console.log('='.repeat(50));
  console.log(`Mode: ${quickMode ? 'Quick' : 'Full'}`);
  console.log(`Fix: ${fixMode ? 'Enabled' : 'Disabled'}`);
  console.log(`Halt on fail: ${haltOnFail ? 'Yes' : 'No'}`);

  try {
    if (quickMode) {
      await runQuickChecks();
    } else {
      await runFullChecks();
    }

    if (fixMode) {
      await runFixes();
    }

    const exitCode = printSummary();

    if (haltOnFail && exitCode > 0) {
      console.log('\n⛔ Halting pipeline due to integrity check failures');
      process.exit(2);
    }

    process.exit(exitCode);
  } catch (err) {
    console.error('\n🚨 CRITICAL ERROR:', err.message);
    process.exit(2);
  } finally {
    await pool.end();
  }
}

main();
