/**
 * diagnoseDataIssue.cjs
 *
 * UNIVERSAL DATA ISSUE DIAGNOSTIC TOOL
 *
 * V2 ARCHITECTURE COMPLIANT - This is the FIRST script to run when
 * a data issue is reported. It diagnoses the problem and recommends
 * the correct V2-compliant fix.
 *
 * Usage:
 *   node scripts/maintenance/diagnoseDataIssue.cjs --team "Team Name"
 *   node scripts/maintenance/diagnoseDataIssue.cjs --team-id "uuid-here"
 *   node scripts/maintenance/diagnoseDataIssue.cjs --health-check
 *   node scripts/maintenance/diagnoseDataIssue.cjs --staging-status
 *
 * GUARDRAILS ENFORCEMENT:
 * - This script is READ-ONLY - it never modifies data
 * - It recommends V2-compliant scripts for fixes
 * - It prevents ad-hoc fuzzy matching (GUARDRAILS line 38)
 * - It uses canonical registries for deduplication (GUARDRAILS line 43)
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const TEAM_NAME = args.includes('--team') ? args[args.indexOf('--team') + 1] : null;
const TEAM_ID = args.includes('--team-id') ? args[args.indexOf('--team-id') + 1] : null;
const HEALTH_CHECK = args.includes('--health-check');
const STAGING_STATUS = args.includes('--staging-status');

// ============================================================
// DIAGNOSTIC FUNCTIONS
// ============================================================

async function diagnoseTeamByName(teamName) {
  console.log('=== V2 DATA ISSUE DIAGNOSTIC ===\n');
  console.log(`Searching for: "${teamName}"\n`);

  // Find matching teams
  const { rows: teams } = await pool.query(`
    SELECT
      t.id,
      t.display_name,
      t.birth_year,
      t.gender,
      t.state,
      t.elo_rating,
      t.elo_national_rank,
      t.matches_played,
      t.wins,
      t.losses,
      t.draws,
      t.national_rank as gs_national_rank,
      (SELECT COUNT(*) FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id) as actual_matches
    FROM teams_v2 t
    WHERE t.display_name ILIKE $1
    ORDER BY actual_matches DESC
    LIMIT 20
  `, [`%${teamName}%`]);

  if (teams.length === 0) {
    console.log('❌ NO TEAMS FOUND\n');
    console.log('Possible causes:');
    console.log('  1. Team name spelled differently in database');
    console.log('  2. Team exists only in staging (not yet processed)');
    console.log('  3. Team from a league we don\'t scrape yet\n');
    console.log('RECOMMENDED ACTION:');
    console.log('  node scripts/maintenance/diagnoseDataIssue.cjs --staging-status');
    return;
  }

  console.log(`Found ${teams.length} matching team(s):\n`);

  const issues = [];

  for (const team of teams) {
    console.log(`─────────────────────────────────────────────`);
    console.log(`Team: ${team.display_name}`);
    console.log(`ID: ${team.id}`);
    console.log(`Birth Year: ${team.birth_year || 'NULL ⚠️'}`);
    console.log(`Gender: ${team.gender || 'NULL ⚠️'}`);
    console.log(`State: ${team.state || 'NULL'}`);
    console.log(`Stored Matches: ${team.matches_played || 0}`);
    console.log(`Actual Matches: ${team.actual_matches}`);
    console.log(`Record: ${team.wins || 0}W-${team.losses || 0}L-${team.draws || 0}D`);
    console.log(`ELO: ${team.elo_rating || 'NULL'} | National Rank: #${team.elo_national_rank || 'N/A'}`);
    console.log(`GotSport Rank: #${team.gs_national_rank || 'N/A'}`);

    // Detect issues
    if (!team.birth_year) issues.push({ team, issue: 'NULL_BIRTH_YEAR' });
    if (!team.gender) issues.push({ team, issue: 'NULL_GENDER' });
    if (parseInt(team.matches_played || 0) !== parseInt(team.actual_matches)) {
      issues.push({ team, issue: 'STATS_MISMATCH', stored: team.matches_played, actual: team.actual_matches });
    }
    if (team.gs_national_rank && parseInt(team.actual_matches) === 0) {
      issues.push({ team, issue: 'ORPHAN_TEAM' });
    }
  }

  // Check for duplicates via canonical registry
  if (teams.length > 0) {
    const { rows: dupes } = await pool.query(`
      SELECT
        canonical_name,
        birth_year,
        gender,
        COUNT(*) as count,
        array_agg(team_v2_id) as team_ids
      FROM canonical_teams
      WHERE team_v2_id = ANY($1)
      GROUP BY canonical_name, birth_year, gender
      HAVING COUNT(*) > 1
    `, [teams.map(t => t.id)]);

    if (dupes.length > 0) {
      dupes.forEach(d => {
        issues.push({
          canonical_name: d.canonical_name,
          issue: 'DUPLICATE_IN_CANONICAL',
          count: d.count,
          team_ids: d.team_ids
        });
      });
    }
  }

  // Report issues and recommendations
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`DIAGNOSIS SUMMARY`);
  console.log(`═══════════════════════════════════════════════\n`);

  if (issues.length === 0) {
    console.log('✅ NO ISSUES DETECTED\n');
    console.log('Team data appears healthy. If you still see problems in the app:');
    console.log('  1. Check if views need refresh: node scripts/maintenance/ensureViewIndexes.js');
    console.log('  2. Verify app is querying V2 tables (not deprecated V1)');
    console.log('  3. Check staging for pending data: --staging-status');
  } else {
    console.log(`⚠️  ${issues.length} ISSUE(S) DETECTED:\n`);

    for (const issue of issues) {
      switch (issue.issue) {
        case 'NULL_BIRTH_YEAR':
        case 'NULL_GENDER':
          console.log(`❌ ${issue.issue}: ${issue.team.display_name}`);
          console.log(`   FIX: node scripts/maintenance/fixNullMetadataAndMerge.cjs --dry-run`);
          console.log(`        node scripts/maintenance/fixNullMetadataAndMerge.cjs\n`);
          break;

        case 'STATS_MISMATCH':
          console.log(`❌ STATS_MISMATCH: ${issue.team.display_name}`);
          console.log(`   Stored: ${issue.stored || 0} matches, Actual: ${issue.actual} matches`);
          console.log(`   FIX: node scripts/maintenance/fixDataDisconnect.cjs --dry-run`);
          console.log(`        node scripts/maintenance/fixDataDisconnect.cjs\n`);
          break;

        case 'ORPHAN_TEAM':
          console.log(`⚠️  ORPHAN_TEAM: ${issue.team.display_name}`);
          console.log(`   Has GotSport rank but 0 matches - likely plays in a league we don't scrape`);
          console.log(`   This is a COVERAGE GAP, not a data quality issue.`);
          console.log(`   FIX: Expand scrapers to cover more leagues (see docs/3-DATA_EXPANSION_ROADMAP.md)\n`);
          break;

        case 'DUPLICATE_IN_CANONICAL':
          console.log(`❌ DUPLICATE_IN_CANONICAL: ${issue.canonical_name}`);
          console.log(`   ${issue.count} teams with same canonical identity`);
          console.log(`   FIX: node scripts/maintenance/mergeCanonicalDuplicates.cjs --dry-run`);
          console.log(`        node scripts/maintenance/mergeCanonicalDuplicates.cjs --execute\n`);
          break;
      }
    }
  }
}

async function diagnoseTeamById(teamId) {
  const { rows } = await pool.query(`
    SELECT display_name FROM teams_v2 WHERE id = $1
  `, [teamId]);

  if (rows.length === 0) {
    console.log(`❌ Team ID not found: ${teamId}`);
    return;
  }

  await diagnoseTeamByName(rows[0].display_name);
}

async function runHealthCheck() {
  console.log('=== V2 DATA ARCHITECTURE HEALTH CHECK ===\n');

  const checks = [];

  // 1. Canonical registry coverage
  const { rows: [coverage] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2) as total_teams,
      (SELECT COUNT(*) FROM canonical_teams) as canonical_count,
      ROUND(100.0 * (SELECT COUNT(*) FROM canonical_teams) / NULLIF((SELECT COUNT(*) FROM teams_v2), 0), 1) as coverage_pct
  `);
  checks.push({
    name: 'Canonical Registry Coverage',
    value: `${coverage.coverage_pct}%`,
    status: parseFloat(coverage.coverage_pct) >= 90 ? '✅' : '⚠️',
    fix: coverage.coverage_pct < 90 ? 'node scripts/maintenance/populateCanonicalTeams.cjs --execute' : null
  });

  // 2. Duplicate groups
  const { rows: [dupes] } = await pool.query(`
    SELECT COUNT(*) as dupe_groups FROM (
      SELECT canonical_name, birth_year, gender
      FROM canonical_teams
      WHERE birth_year IS NOT NULL AND gender IS NOT NULL
      GROUP BY canonical_name, birth_year, gender
      HAVING COUNT(*) > 1
    ) d
  `);
  checks.push({
    name: 'Duplicate Groups',
    value: dupes.dupe_groups,
    status: parseInt(dupes.dupe_groups) === 0 ? '✅' : '❌',
    fix: dupes.dupe_groups > 0 ? 'node scripts/maintenance/mergeCanonicalDuplicates.cjs --execute' : null
  });

  // 3. NULL birth_year
  const { rows: [nullBY] } = await pool.query(`
    SELECT COUNT(*) as count FROM teams_v2 WHERE birth_year IS NULL
  `);
  const nullByPct = (100 * nullBY.count / coverage.total_teams).toFixed(1);
  checks.push({
    name: 'NULL Birth Year',
    value: `${nullBY.count} (${nullByPct}%)`,
    status: parseFloat(nullByPct) < 5 ? '✅' : '⚠️',
    fix: nullBY.count > 0 ? 'node scripts/maintenance/fixNullMetadataAndMerge.cjs' : null
  });

  // 4. NULL gender
  const { rows: [nullG] } = await pool.query(`
    SELECT COUNT(*) as count FROM teams_v2 WHERE gender IS NULL
  `);
  const nullGPct = (100 * nullG.count / coverage.total_teams).toFixed(1);
  checks.push({
    name: 'NULL Gender',
    value: `${nullG.count} (${nullGPct}%)`,
    status: parseFloat(nullGPct) < 5 ? '✅' : '⚠️',
    fix: nullG.count > 0 ? 'node scripts/maintenance/fixNullMetadataAndMerge.cjs' : null
  });

  // 5. Stats consistency
  const { rows: [statsMismatch] } = await pool.query(`
    SELECT COUNT(*) as count FROM teams_v2 t
    WHERE t.matches_played != (
      SELECT COUNT(*) FROM matches_v2 m
      WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
      AND m.home_score IS NOT NULL
    )
    AND t.matches_played > 0
  `);
  checks.push({
    name: 'Stats Mismatches',
    value: statsMismatch.count,
    status: parseInt(statsMismatch.count) < 100 ? '✅' : '⚠️',
    fix: statsMismatch.count > 0 ? 'node scripts/maintenance/fixDataDisconnect.cjs' : null
  });

  // 6. Staging backlog
  const { rows: [staging] } = await pool.query(`
    SELECT COUNT(*) as count FROM staging_games WHERE processed = false
  `);
  checks.push({
    name: 'Staging Backlog',
    value: staging.count,
    status: parseInt(staging.count) < 1000 ? '✅' : '⚠️',
    fix: staging.count > 0 ? 'node scripts/universal/dataQualityEngine.js --process-staging' : null
  });

  // 7. Orphan rate
  const { rows: [orphans] } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND matches_played = 0) as orphan_count,
      COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as gs_ranked_count
    FROM teams_v2
  `);
  const orphanRate = orphans.gs_ranked_count > 0
    ? (100 * orphans.orphan_count / orphans.gs_ranked_count).toFixed(1)
    : 0;
  checks.push({
    name: 'Orphan Rate (GS ranked, no matches)',
    value: `${orphans.orphan_count} (${orphanRate}%)`,
    status: parseFloat(orphanRate) < 30 ? '✅' : '⚠️',
    fix: orphanRate > 30 ? 'Coverage gap - add more league scrapers (see docs/3-DATA_EXPANSION_ROADMAP.md)' : null
  });

  // 8. Write protection status
  const { rows: [wp] } = await pool.query(`
    SELECT is_write_protection_enabled() as enabled
  `).catch(() => ({ rows: [{ enabled: null }] }));
  checks.push({
    name: 'Write Protection',
    value: wp.enabled === null ? 'Not installed' : (wp.enabled ? 'Enabled' : 'Disabled'),
    status: wp.enabled === true ? '✅' : '⚠️',
    fix: wp.enabled !== true ? 'node scripts/migrations/run_migration_070.js' : null
  });

  // Print results
  console.log('┌─────────────────────────────────────┬───────────────────┬────────┐');
  console.log('│ Check                               │ Value             │ Status │');
  console.log('├─────────────────────────────────────┼───────────────────┼────────┤');

  for (const check of checks) {
    const name = check.name.padEnd(35);
    const value = String(check.value).padEnd(17);
    console.log(`│ ${name} │ ${value} │ ${check.status}     │`);
  }

  console.log('└─────────────────────────────────────┴───────────────────┴────────┘');

  // Print fixes needed
  const fixes = checks.filter(c => c.fix);
  if (fixes.length > 0) {
    console.log('\n📋 RECOMMENDED FIXES:\n');
    fixes.forEach((f, i) => {
      console.log(`${i + 1}. ${f.name}:`);
      console.log(`   ${f.fix}\n`);
    });
  } else {
    console.log('\n✅ All checks passed - data is healthy!\n');
  }
}

async function checkStagingStatus() {
  console.log('=== STAGING PIPELINE STATUS ===\n');

  const { rows: [counts] } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE processed = true) as processed,
      COUNT(*) FILTER (WHERE processed = false) as pending,
      MIN(scraped_at) FILTER (WHERE processed = false) as oldest_pending,
      MAX(scraped_at) as newest
    FROM staging_games
  `);

  console.log(`Total staging records: ${counts.total}`);
  console.log(`Processed: ${counts.processed}`);
  console.log(`Pending: ${counts.pending}`);
  console.log(`Oldest pending: ${counts.oldest_pending || 'N/A'}`);
  console.log(`Newest record: ${counts.newest || 'N/A'}`);

  if (parseInt(counts.pending) > 0) {
    console.log(`\n📋 TO PROCESS STAGING BACKLOG:`);
    console.log(`   node scripts/universal/dataQualityEngine.js --process-staging`);
    console.log(`   (Or wait for nightly pipeline)`);
  }

  // Check rejected
  const { rows: [rejected] } = await pool.query(`
    SELECT COUNT(*) as count FROM staging_rejected
  `).catch(() => ({ rows: [{ count: 0 }] }));

  if (parseInt(rejected.count) > 0) {
    console.log(`\n⚠️  Rejected records: ${rejected.count}`);
    console.log(`   Review: SELECT * FROM staging_rejected ORDER BY rejected_at DESC LIMIT 10;`);
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  try {
    if (TEAM_NAME) {
      await diagnoseTeamByName(TEAM_NAME);
    } else if (TEAM_ID) {
      await diagnoseTeamById(TEAM_ID);
    } else if (HEALTH_CHECK) {
      await runHealthCheck();
    } else if (STAGING_STATUS) {
      await checkStagingStatus();
    } else {
      console.log('V2 DATA ISSUE DIAGNOSTIC TOOL\n');
      console.log('Usage:');
      console.log('  --team "Name"     Search for team and diagnose issues');
      console.log('  --team-id "uuid"  Diagnose specific team by ID');
      console.log('  --health-check    Run full system health check');
      console.log('  --staging-status  Check staging pipeline status\n');
      console.log('Examples:');
      console.log('  node scripts/maintenance/diagnoseDataIssue.cjs --team "Sporting BV"');
      console.log('  node scripts/maintenance/diagnoseDataIssue.cjs --health-check');
    }

    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

main();
