/**
 * verifyPremierOnly.cjs
 * =====================
 * Session 84: Post-migration verification for Premier-Only policy
 *
 * This script verifies that all recreational data has been removed
 * and the database is now Premier-only.
 *
 * All checks should return 0 for a successful migration.
 *
 * Usage: node scripts/audit/verifyPremierOnly.cjs
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verify() {
  console.log('='.repeat(70));
  console.log('SESSION 84: Premier-Only Verification');
  console.log('Post-migration checks - all should return 0');
  console.log('='.repeat(70));
  console.log();

  const checks = [];
  let allPassed = true;

  // Check 1: Recreational matches in matches_v2
  console.log('1. Recreational matches in matches_v2...');
  const recMatches = await pool.query(`
    SELECT COUNT(*) as count FROM matches_v2
    WHERE source_match_key LIKE 'heartland-recreational-%'
  `);
  const recMatchCount = parseInt(recMatches.rows[0].count);
  const check1 = recMatchCount === 0;
  checks.push({ name: 'Recreational matches', expected: 0, actual: recMatchCount, passed: check1 });
  console.log(`   ${check1 ? '✅' : '❌'} Count: ${recMatchCount} (expected: 0)`);

  // Check 2: Recreational leagues
  console.log('\n2. Recreational leagues...');
  const recLeagues = await pool.query(`
    SELECT COUNT(*) as count FROM leagues
    WHERE name ILIKE '%recreational%'
  `);
  const recLeagueCount = parseInt(recLeagues.rows[0].count);
  const check2 = recLeagueCount === 0;
  checks.push({ name: 'Recreational leagues', expected: 0, actual: recLeagueCount, passed: check2 });
  console.log(`   ${check2 ? '✅' : '❌'} Count: ${recLeagueCount} (expected: 0)`);

  // Check 3: Recreational in staging_games
  console.log('\n3. Recreational in staging_games...');
  const recStaging = await pool.query(`
    SELECT COUNT(*) as count FROM staging_games
    WHERE source_match_key LIKE 'heartland-recreational-%'
  `);
  const recStagingCount = parseInt(recStaging.rows[0].count);
  const check3 = recStagingCount === 0;
  checks.push({ name: 'Recreational staging', expected: 0, actual: recStagingCount, passed: check3 });
  console.log(`   ${check3 ? '✅' : '❌'} Count: ${recStagingCount} (expected: 0)`);

  // Check 4: Recreational in canonical_events
  console.log('\n4. Recreational in canonical_events...');
  const recCanonical = await pool.query(`
    SELECT COUNT(*) as count FROM canonical_events
    WHERE canonical_name ILIKE '%recreational%'
  `);
  const recCanonicalCount = parseInt(recCanonical.rows[0].count);
  const check4 = recCanonicalCount === 0;
  checks.push({ name: 'Recreational canonical', expected: 0, actual: recCanonicalCount, passed: check4 });
  console.log(`   ${check4 ? '✅' : '❌'} Count: ${recCanonicalCount} (expected: 0)`);

  // Check 5: Stats integrity (wins + losses + draws = matches_played)
  console.log('\n5. Stats integrity check...');
  const statsIntegrity = await pool.query(`
    SELECT COUNT(*) as count FROM teams_v2
    WHERE matches_played > 0
      AND matches_played != wins + losses + draws
  `);
  const statsIntegrityCount = parseInt(statsIntegrity.rows[0].count);
  const check5 = statsIntegrityCount === 0;
  checks.push({ name: 'Stats integrity', expected: 0, actual: statsIntegrityCount, passed: check5 });
  console.log(`   ${check5 ? '✅' : '❌'} Mismatches: ${statsIntegrityCount} (expected: 0)`);

  // Check 6: Backup table exists
  console.log('\n6. Backup table exists...');
  const backupExists = await pool.query(`
    SELECT COUNT(*) as count FROM information_schema.tables
    WHERE table_name = '_archived_recreational_matches'
  `);
  const backupCount = parseInt(backupExists.rows[0].count);
  const check6 = backupCount === 1;
  checks.push({ name: 'Backup table exists', expected: 1, actual: backupCount, passed: check6 });
  console.log(`   ${check6 ? '✅' : '❌'} Found: ${backupCount} (expected: 1)`);

  // Check 7: Backup table has correct count
  if (backupCount === 1) {
    console.log('\n7. Backup table record count...');
    const backupRecords = await pool.query(`
      SELECT COUNT(*) as count FROM _archived_recreational_matches
    `);
    const backupRecordCount = parseInt(backupRecords.rows[0].count);
    const check7 = backupRecordCount > 0;
    checks.push({ name: 'Backup has records', expected: '>0', actual: backupRecordCount, passed: check7 });
    console.log(`   ${check7 ? '✅' : '❌'} Records: ${backupRecordCount} (expected: >0 for rollback safety)`);
  }

  // Check 8: Teams with recreational in name but 0 matches (informational)
  console.log('\n8. Teams with "rec" in name (informational)...');
  const teamsWithRec = await pool.query(`
    SELECT COUNT(*) as count FROM teams_v2
    WHERE display_name ILIKE '%rec%'
      AND matches_played = 0
  `);
  const teamsWithRecCount = parseInt(teamsWithRec.rows[0].count);
  console.log(`   ℹ️ Teams with "rec" in name and 0 matches: ${teamsWithRecCount}`);
  console.log(`      (These are recreational teams that had their matches deleted)`);

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(70));

  const passedCount = checks.filter(c => c.passed).length;
  const totalCount = checks.length;
  allPassed = passedCount === totalCount;

  checks.forEach(c => {
    console.log(`  ${c.passed ? '✅' : '❌'} ${c.name}: ${c.actual} (expected: ${c.expected})`);
  });

  console.log();
  if (allPassed) {
    console.log('✅ ALL CHECKS PASSED - Premier-Only migration successful!');
  } else {
    console.log('❌ SOME CHECKS FAILED - Review issues above');
  }

  // Database totals
  console.log('\n' + '='.repeat(70));
  console.log('CURRENT DATABASE STATE');
  console.log('='.repeat(70));

  const totalMatches = await pool.query(`SELECT COUNT(*) as count FROM matches_v2`);
  const totalTeams = await pool.query(`SELECT COUNT(*) as count FROM teams_v2`);
  const teamsWithMatches = await pool.query(`SELECT COUNT(*) as count FROM teams_v2 WHERE matches_played > 0`);
  const totalLeagues = await pool.query(`SELECT COUNT(*) as count FROM leagues`);

  console.log(`  matches_v2: ${parseInt(totalMatches.rows[0].count).toLocaleString()}`);
  console.log(`  teams_v2: ${parseInt(totalTeams.rows[0].count).toLocaleString()}`);
  console.log(`  teams with matches: ${parseInt(teamsWithMatches.rows[0].count).toLocaleString()}`);
  console.log(`  leagues: ${parseInt(totalLeagues.rows[0].count).toLocaleString()}`);

  console.log('\n' + '='.repeat(70));

  await pool.end();
  return allPassed;
}

verify()
  .then(passed => {
    console.log('\nVerification complete.');
    process.exit(passed ? 0 : 1);
  })
  .catch(err => {
    console.error('Verification failed:', err);
    process.exit(1);
  });
