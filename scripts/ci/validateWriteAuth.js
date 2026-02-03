/**
 * validateWriteAuth.js
 *
 * Session 79 - V2 Architecture Enforcement
 *
 * CI/pre-commit hook script that scans for unauthorized writes to protected tables.
 *
 * Checks:
 * 1. Scripts that INSERT/UPDATE/DELETE to teams_v2/matches_v2
 * 2. Verifies they import pipelineAuth or pipelineAuthCJS
 * 3. Reports violations
 *
 * Usage:
 *   node scripts/ci/validateWriteAuth.js
 *   node scripts/ci/validateWriteAuth.js --fail-on-violations  # Exit 1 if violations found
 *
 * Add to .git/hooks/pre-commit or CI pipeline.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '../..');
const scriptsDir = path.join(projectRoot, 'scripts');

const FAIL_ON_VIOLATIONS = process.argv.includes('--fail-on-violations');

// Patterns that indicate writes to protected tables
const WRITE_PATTERNS = [
  /INSERT\s+INTO\s+teams_v2/i,
  /UPDATE\s+teams_v2/i,
  /DELETE\s+FROM\s+teams_v2/i,
  /INSERT\s+INTO\s+matches_v2/i,
  /UPDATE\s+matches_v2/i,
  /DELETE\s+FROM\s+matches_v2/i,
  /\.from\(['"]teams_v2['"]\).*\.(insert|update|delete|upsert)/i,
  /\.from\(['"]matches_v2['"]\).*\.(insert|update|delete|upsert)/i,
];

// Patterns that indicate proper authorization
const AUTH_PATTERNS = [
  /import\s+.*pipelineAuth/,
  /require\s*\(\s*['"].*pipelineAuth/,
  /authorizePipelineWrite/,
  /withPipelineAuth/,
  /withPipelineTransaction/,
];

// Directories to scan
const SCAN_DIRS = [
  'scripts/daily',
  'scripts/maintenance',
  'scripts/universal',
  'scripts/onetime',
  'scripts/migrations',
];

// Directories to skip
const SKIP_DIRS = [
  'scripts/_archive',
  'scripts/_debug',
  'node_modules',
];

// Known authorized scripts (from manifest) - these are exceptions
const AUTHORIZED_SCRIPTS = new Set([
  // Core pipeline scripts (with proper pg Pool authorization)
  'scripts/universal/dataQualityEngine.js',
  'scripts/daily/recalculate_elo_v2.js',
  'scripts/daily/verifyDataIntegrity.js',
  'scripts/maintenance/mergeTeams.js',
  'scripts/maintenance/mergeEvents.js',
  'scripts/maintenance/inferEventLinkage.js',
  'scripts/maintenance/cleanupGarbageMatches.js',
  'scripts/maintenance/cleanupBirthYearData.js',
  'scripts/maintenance/completeBirthYearCleanup.js',
  'scripts/maintenance/fastCleanup.js',
  'scripts/maintenance/safeCleanup.js',
  'scripts/maintenance/mergeHeartlandLeagues.js',
  'scripts/maintenance/fixNullMetadataAndMerge.cjs',
  'scripts/maintenance/mergeOrphansByNormalizedName.cjs',
  'scripts/maintenance/fixDataDisconnect.cjs',
  'scripts/maintenance/recalculateHistoricalRanks.cjs',
  'scripts/maintenance/fixBirthYearFromNames.cjs',
  'scripts/maintenance/populateCanonicalTeams.cjs',
  'scripts/maintenance/fixOrphanCanonicalNames.cjs',
  'scripts/maintenance/reconcileGotSportRanks.cjs',
  'scripts/maintenance/reconcileOrphanedTeams.cjs',
  'scripts/maintenance/reconcileOrphanedTeamsSQL.cjs',
  'scripts/maintenance/auditNonRegistryTeams.js',
  'scripts/universal/deduplication/teamDedup.js',
  'scripts/universal/deduplication/matchDedup.js',
  'scripts/universal/deduplication/eventDedup.js',
  // Link scripts - converted to pg Pool with proper authorization
  'scripts/maintenance/linkFromV1Archive.js',
  'scripts/maintenance/linkLegacyMatches.js',
  'scripts/maintenance/linkUnlinkedMatches.js',
  // Test script for data quality engine
  'scripts/universal/testDataQualityEngine.js',
  // Onetime scripts
  'scripts/onetime/populateClubs.js',
  // Rebuild scripts (write to _rebuild tables, not production)
  'scripts/maintenance/rebuildFromStaging.js',
  'scripts/maintenance/executeSwap.js',
  // Migration scripts (one-time use, now with authorization)
  'scripts/migrations/008_test_schema.js',
  'scripts/migrations/010_migrate_data.js',
  'scripts/migrations/011_migrate_matches.js',
  'scripts/migrations/013_run_bulk_migration.js',
  'scripts/migrations/run_match_migration_sql.js',
]);

function getFilesRecursively(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');

    // Skip directories
    if (SKIP_DIRS.some(skip => relativePath.startsWith(skip))) continue;

    if (entry.isDirectory()) {
      getFilesRecursively(fullPath, files);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs') || entry.name.endsWith('.mjs'))) {
      files.push(fullPath);
    }
  }

  return files;
}

function checkFile(filePath) {
  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf-8');

  // Check if file has any write patterns
  const writes = [];
  for (const pattern of WRITE_PATTERNS) {
    if (pattern.test(content)) {
      writes.push(pattern.toString());
    }
  }

  if (writes.length === 0) {
    return null; // No writes to protected tables
  }

  // Check if file has authorization
  const hasAuth = AUTH_PATTERNS.some(pattern => pattern.test(content));

  // Check if file is in known authorized list
  const isKnownAuthorized = AUTHORIZED_SCRIPTS.has(relativePath);

  return {
    file: relativePath,
    writes,
    hasAuth,
    isKnownAuthorized,
    violation: !hasAuth && !isKnownAuthorized,
  };
}

async function validateWriteAuth() {
  console.log('='.repeat(60));
  console.log('VALIDATE WRITE AUTHORIZATION');
  console.log('Session 79 - V2 Architecture Enforcement');
  console.log('='.repeat(60));
  console.log(`Project root: ${projectRoot}`);
  console.log('');

  const allFiles = [];
  for (const dir of SCAN_DIRS) {
    const fullDir = path.join(projectRoot, dir);
    getFilesRecursively(fullDir, allFiles);
  }

  console.log(`Scanning ${allFiles.length} files...\n`);

  const results = [];
  const violations = [];

  for (const file of allFiles) {
    const result = checkFile(file);
    if (result) {
      results.push(result);
      if (result.violation) {
        violations.push(result);
      }
    }
  }

  // Report
  console.log('📊 RESULTS\n');

  console.log(`Files with writes to protected tables: ${results.length}`);
  console.log(`  - Properly authorized: ${results.filter(r => r.hasAuth).length}`);
  console.log(`  - Known authorized: ${results.filter(r => r.isKnownAuthorized && !r.hasAuth).length}`);
  console.log(`  - Violations: ${violations.length}`);
  console.log('');

  if (results.filter(r => r.hasAuth).length > 0) {
    console.log('✅ FILES WITH PROPER AUTHORIZATION:\n');
    results.filter(r => r.hasAuth).forEach(r => {
      console.log(`   ${r.file}`);
    });
    console.log('');
  }

  if (violations.length > 0) {
    console.log('❌ VIOLATIONS (writes without authorization):\n');
    violations.forEach(v => {
      console.log(`   ${v.file}`);
      console.log(`      Writes: ${v.writes.length} patterns detected`);
      console.log(`      Fix: Add authorization import and call authorizePipelineWrite()`);
      console.log('');
    });

    console.log('💡 HOW TO FIX:\n');
    console.log('   For .js files:');
    console.log("   import { authorizePipelineWrite } from '../universal/pipelineAuth.js';");
    console.log('   await authorizePipelineWrite(client);');
    console.log('');
    console.log('   For .cjs files:');
    console.log("   const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');");
    console.log('   await authorizePipelineWrite(pool);');
    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  if (violations.length === 0) {
    console.log('✅ ALL WRITES ARE AUTHORIZED');
    return { success: true, violations: 0 };
  } else {
    console.log(`❌ ${violations.length} VIOLATION(S) FOUND`);
    if (FAIL_ON_VIOLATIONS) {
      process.exit(1);
    }
    return { success: false, violations: violations.length };
  }
}

validateWriteAuth().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
