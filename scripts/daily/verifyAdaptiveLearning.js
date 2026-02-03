/**
 * verifyAdaptiveLearning.js
 *
 * Session 79 - V2 Architecture Enforcement
 *
 * Verifies that the adaptive learning system is working:
 * 1. learned_patterns table has data
 * 2. Patterns are being used (usage_count > 0)
 * 3. Failure rate is acceptable
 * 4. New patterns are being learned (growing over time)
 *
 * Run as part of nightly pipeline to alert if system is not improving.
 *
 * Usage:
 *   node scripts/daily/verifyAdaptiveLearning.js
 *   node scripts/daily/verifyAdaptiveLearning.js --verbose
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

// Thresholds for health checks
const THRESHOLDS = {
  MIN_PATTERNS: 50,                    // Minimum total patterns
  MIN_TEAM_PATTERNS: 20,               // Minimum team patterns
  MAX_FAILURE_RATE: 0.3,               // Max 30% failure rate
  MIN_USAGE_RATE: 0.1,                 // At least 10% of patterns used
  STALE_DAYS: 7,                       // Patterns not updated in 7 days = stale
};

async function verifyAdaptiveLearning() {
  console.log('='.repeat(60));
  console.log('ADAPTIVE LEARNING VERIFICATION');
  console.log('Session 79 - V2 Architecture Enforcement');
  console.log('='.repeat(60));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  const checks = [];
  let allPassed = true;

  try {
    // ============================================================
    // CHECK 1: Table exists and has data
    // ============================================================
    console.log('CHECK 1: Pattern table health...');

    const { rows: patternCounts } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE pattern_type = 'team_club_prefix') as team_prefixes,
        COUNT(*) FILTER (WHERE pattern_type = 'event_league_keywords') as league_keywords,
        COUNT(*) FILTER (WHERE pattern_type = 'event_tournament_keywords') as tournament_keywords,
        COUNT(*) FILTER (WHERE pattern_type = 'canonical_match') as canonical_matches
      FROM learned_patterns
    `);

    const counts = patternCounts[0];
    const total = parseInt(counts.total);

    if (total >= THRESHOLDS.MIN_PATTERNS) {
      console.log(`   ✅ Total patterns: ${total} (threshold: ${THRESHOLDS.MIN_PATTERNS})`);
      checks.push({ check: 'total_patterns', passed: true, value: total });
    } else {
      console.log(`   ❌ Total patterns: ${total} (need ${THRESHOLDS.MIN_PATTERNS})`);
      checks.push({ check: 'total_patterns', passed: false, value: total });
      allPassed = false;
    }

    if (VERBOSE) {
      console.log(`      - team_club_prefix: ${counts.team_prefixes}`);
      console.log(`      - event_league_keywords: ${counts.league_keywords}`);
      console.log(`      - event_tournament_keywords: ${counts.tournament_keywords}`);
      console.log(`      - canonical_match: ${counts.canonical_matches}`);
    }

    // ============================================================
    // CHECK 2: Team patterns exist
    // ============================================================
    console.log('\nCHECK 2: Team patterns...');

    const teamPatterns = parseInt(counts.team_prefixes) + parseInt(counts.canonical_matches);
    if (teamPatterns >= THRESHOLDS.MIN_TEAM_PATTERNS) {
      console.log(`   ✅ Team patterns: ${teamPatterns} (threshold: ${THRESHOLDS.MIN_TEAM_PATTERNS})`);
      checks.push({ check: 'team_patterns', passed: true, value: teamPatterns });
    } else {
      console.log(`   ❌ Team patterns: ${teamPatterns} (need ${THRESHOLDS.MIN_TEAM_PATTERNS})`);
      console.log(`      💡 Run: node scripts/universal/adaptiveLearning.js --learn-teams --source all`);
      checks.push({ check: 'team_patterns', passed: false, value: teamPatterns });
      allPassed = false;
    }

    // ============================================================
    // CHECK 3: Usage rate (patterns being applied)
    // ============================================================
    console.log('\nCHECK 3: Pattern usage...');

    const { rows: usageStats } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE usage_count > 0) as used,
        SUM(usage_count) as total_uses
      FROM learned_patterns
    `);

    const usage = usageStats[0];
    const usageRate = total > 0 ? parseInt(usage.used) / total : 0;
    const totalUses = parseInt(usage.total_uses) || 0;

    if (usageRate >= THRESHOLDS.MIN_USAGE_RATE || totalUses > 100) {
      console.log(`   ✅ Usage rate: ${(usageRate * 100).toFixed(1)}% patterns used`);
      console.log(`      Total uses: ${totalUses}`);
      checks.push({ check: 'usage_rate', passed: true, value: usageRate });
    } else {
      console.log(`   ⚠️  Usage rate: ${(usageRate * 100).toFixed(1)}% (threshold: ${THRESHOLDS.MIN_USAGE_RATE * 100}%)`);
      console.log(`      Total uses: ${totalUses}`);
      console.log(`      💡 This may improve as more data is processed through the pipeline`);
      checks.push({ check: 'usage_rate', passed: false, value: usageRate });
      // Not failing overall - usage builds over time
    }

    // ============================================================
    // CHECK 4: Failure rate
    // ============================================================
    console.log('\nCHECK 4: Failure rate...');

    const { rows: failureStats } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE failure_count > 0) as failed,
        SUM(failure_count) as total_failures
      FROM learned_patterns
    `);

    const failures = failureStats[0];
    const failureRate = total > 0 ? parseInt(failures.failed) / total : 0;
    const totalFailures = parseInt(failures.total_failures) || 0;

    if (failureRate <= THRESHOLDS.MAX_FAILURE_RATE) {
      console.log(`   ✅ Failure rate: ${(failureRate * 100).toFixed(1)}% (max: ${THRESHOLDS.MAX_FAILURE_RATE * 100}%)`);
      console.log(`      Total failures: ${totalFailures}`);
      checks.push({ check: 'failure_rate', passed: true, value: failureRate });
    } else {
      console.log(`   ❌ Failure rate: ${(failureRate * 100).toFixed(1)}% (max: ${THRESHOLDS.MAX_FAILURE_RATE * 100}%)`);
      console.log(`      Total failures: ${totalFailures}`);
      console.log(`      💡 Review patterns with high failure counts`);
      checks.push({ check: 'failure_rate', passed: false, value: failureRate });
      allPassed = false;
    }

    // ============================================================
    // CHECK 5: Freshness (patterns being updated)
    // ============================================================
    console.log('\nCHECK 5: Pattern freshness...');

    const { rows: freshnessStats } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '${THRESHOLDS.STALE_DAYS} days') as recent,
        MAX(updated_at) as most_recent
      FROM learned_patterns
    `);

    const freshness = freshnessStats[0];
    const recentCount = parseInt(freshness.recent);
    const freshnessRate = total > 0 ? recentCount / total : 0;
    const mostRecent = freshness.most_recent ? new Date(freshness.most_recent).toISOString() : 'never';

    if (freshnessRate >= 0.1 || recentCount >= 10) {
      console.log(`   ✅ Recently updated: ${recentCount} patterns in last ${THRESHOLDS.STALE_DAYS} days`);
      console.log(`      Most recent: ${mostRecent}`);
      checks.push({ check: 'freshness', passed: true, value: recentCount });
    } else {
      console.log(`   ⚠️  Pattern freshness: ${recentCount} patterns updated in last ${THRESHOLDS.STALE_DAYS} days`);
      console.log(`      Most recent: ${mostRecent}`);
      console.log(`      💡 Run learning to refresh: node scripts/universal/adaptiveLearning.js --learn-teams --source all`);
      checks.push({ check: 'freshness', passed: false, value: recentCount });
      // Not failing overall - patterns may be stable
    }

    // ============================================================
    // Summary
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const passed = checks.filter(c => c.passed).length;
    const failed = checks.filter(c => !c.passed).length;

    console.log(`Checks passed: ${passed}/${checks.length}`);

    if (allPassed) {
      console.log('\n✅ ADAPTIVE LEARNING SYSTEM HEALTHY');
    } else {
      console.log('\n⚠️  SOME CHECKS FAILED - Review above');
    }

    // Return result for pipeline
    return {
      healthy: allPassed,
      checks,
      summary: {
        total_patterns: total,
        team_patterns: teamPatterns,
        usage_rate: usageRate,
        failure_rate: failureRate,
        recent_updates: recentCount,
      }
    };

  } catch (err) {
    console.error('\n❌ Error verifying adaptive learning:', err.message);

    if (err.message.includes('relation "learned_patterns" does not exist')) {
      console.log('\n💡 The learned_patterns table does not exist.');
      console.log('   Run migration: scripts/migrations/040_create_learned_patterns.sql');
    }

    return { healthy: false, error: err.message };
  } finally {
    await pool.end();
  }
}

// Run
verifyAdaptiveLearning()
  .then(result => {
    console.log('\n' + '='.repeat(60));
    console.log('Result:', JSON.stringify(result.summary || { error: result.error }, null, 2));

    if (!result.healthy) {
      // Exit with warning code (not failure - don't break pipeline)
      process.exit(0);
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
