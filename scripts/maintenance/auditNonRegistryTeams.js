/**
 * auditNonRegistryTeams.js
 *
 * Session 79 - V2 Architecture Enforcement
 *
 * Reports on teams not in the canonical_teams registry.
 * These teams should be added to ensure deduplication works.
 *
 * Categories:
 * 1. Teams with matches but not in registry (DATA GAP - fix required)
 * 2. Teams with GS rank but no matches (orphans - coverage gap)
 * 3. Teams with NULL birth_year (can't be properly registered)
 *
 * Usage:
 *   node scripts/maintenance/auditNonRegistryTeams.js
 *   node scripts/maintenance/auditNonRegistryTeams.js --fix   # Run populateCanonicalTeams
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

const FIX_MODE = process.argv.includes('--fix');

async function auditNonRegistryTeams() {
  console.log('='.repeat(60));
  console.log('AUDIT: TEAMS NOT IN CANONICAL REGISTRY');
  console.log('Session 79 - V2 Architecture Enforcement');
  console.log('='.repeat(60));
  console.log(`Mode: ${FIX_MODE ? 'FIX (will populate registry)' : 'REPORT ONLY'}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  try {
    // ============================================================
    // Summary Statistics
    // ============================================================
    console.log('📊 SUMMARY STATISTICS\n');

    const { rows: [summary] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM teams_v2) as total_teams,
        (SELECT COUNT(*) FROM canonical_teams) as total_canonical,
        COUNT(*) as not_in_registry,
        COUNT(*) FILTER (WHERE matches_played = 0) as orphans_no_matches,
        COUNT(*) FILTER (WHERE matches_played > 0) as has_matches,
        COUNT(*) FILTER (WHERE gotsport_points > 0 AND matches_played = 0) as gs_orphans,
        COUNT(*) FILTER (WHERE birth_year IS NULL) as null_birth_year,
        COUNT(*) FILTER (WHERE gender IS NULL) as null_gender,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND gender IS NOT NULL AND matches_played > 0) as fixable
      FROM teams_v2 t
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
      )
    `);

    const totalTeams = parseInt(summary.total_teams);
    const notInRegistry = parseInt(summary.not_in_registry);
    const gapPct = (notInRegistry / totalTeams * 100).toFixed(1);
    const fixable = parseInt(summary.fixable);

    console.log(`Total teams_v2:           ${totalTeams.toLocaleString()}`);
    console.log(`Total canonical_teams:    ${parseInt(summary.total_canonical).toLocaleString()}`);
    console.log(`Coverage:                 ${(100 - parseFloat(gapPct)).toFixed(1)}%`);
    console.log('');
    console.log(`Not in registry:          ${notInRegistry.toLocaleString()} (${gapPct}%)`);
    console.log(`  ├─ Has matches (gap):   ${parseInt(summary.has_matches).toLocaleString()} ⚠️  DATA GAP`);
    console.log(`  ├─ Orphans (0 matches): ${parseInt(summary.orphans_no_matches).toLocaleString()}`);
    console.log(`  ├─ GS rank orphans:     ${parseInt(summary.gs_orphans).toLocaleString()}`);
    console.log(`  ├─ NULL birth_year:     ${parseInt(summary.null_birth_year).toLocaleString()}`);
    console.log(`  └─ NULL gender:         ${parseInt(summary.null_gender).toLocaleString()}`);
    console.log('');
    console.log(`Fixable (has data):       ${fixable.toLocaleString()} ✅ Can be added to registry`);

    // ============================================================
    // Breakdown by State
    // ============================================================
    console.log('\n📍 BREAKDOWN BY STATE (top 10)\n');

    const { rows: byState } = await pool.query(`
      SELECT
        t.state,
        COUNT(*) as not_in_registry,
        COUNT(*) FILTER (WHERE matches_played > 0) as has_matches
      FROM teams_v2 t
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
      )
      GROUP BY t.state
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);

    console.log('State    | Not in Registry | Has Matches (gap)');
    console.log('---------|-----------------|------------------');
    byState.forEach(r => {
      console.log(`${(r.state || 'NULL').padEnd(8)} | ${parseInt(r.not_in_registry).toLocaleString().padStart(15)} | ${parseInt(r.has_matches).toLocaleString().padStart(17)}`);
    });

    // ============================================================
    // Sample Teams with Matches but Not in Registry
    // ============================================================
    if (parseInt(summary.has_matches) > 0) {
      console.log('\n⚠️  SAMPLE TEAMS WITH MATCHES BUT NOT IN REGISTRY\n');

      const { rows: samples } = await pool.query(`
        SELECT
          t.id, t.display_name, t.canonical_name, t.birth_year, t.gender, t.state,
          t.matches_played, t.wins, t.losses, t.draws
        FROM teams_v2 t
        WHERE NOT EXISTS (
          SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
        )
        AND t.matches_played > 0
        ORDER BY t.matches_played DESC
        LIMIT 10
      `);

      samples.forEach(t => {
        console.log(`${t.display_name}`);
        console.log(`  ID: ${t.id.slice(0, 8)}... | ${t.matches_played} matches | ${t.wins}W-${t.losses}L-${t.draws}D`);
        console.log(`  birth_year: ${t.birth_year || 'NULL'} | gender: ${t.gender || 'NULL'} | state: ${t.state || 'NULL'}`);
        console.log('');
      });
    }

    // ============================================================
    // Fix: Run populateCanonicalTeams
    // ============================================================
    if (FIX_MODE && fixable > 0) {
      console.log('\n🔧 FIXING: Adding teams to canonical registry...\n');

      const startTime = Date.now();

      const result = await pool.query(`
        INSERT INTO canonical_teams (canonical_name, birth_year, gender, state, team_v2_id, aliases)
        SELECT
          t.canonical_name,
          t.birth_year,
          t.gender,
          t.state,
          t.id,
          ARRAY[t.display_name]
        FROM teams_v2 t
        WHERE t.birth_year IS NOT NULL
          AND t.gender IS NOT NULL
          AND t.canonical_name IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
          )
        ON CONFLICT (canonical_name, birth_year, gender, state)
        DO UPDATE SET
          team_v2_id = COALESCE(canonical_teams.team_v2_id, EXCLUDED.team_v2_id),
          aliases = CASE
            WHEN EXCLUDED.aliases[1] = ANY(canonical_teams.aliases) THEN canonical_teams.aliases
            ELSE array_cat(canonical_teams.aliases, EXCLUDED.aliases)
          END
      `);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Added/updated ${result.rowCount} canonical_teams entries in ${duration}s`);

      // Re-run summary
      const { rows: [newSummary] } = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM canonical_teams) as total_canonical,
          COUNT(*) as still_not_in_registry
        FROM teams_v2 t
        WHERE NOT EXISTS (
          SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
        )
      `);

      console.log(`\nAfter fix:`);
      console.log(`  Total canonical_teams: ${parseInt(newSummary.total_canonical).toLocaleString()}`);
      console.log(`  Still not in registry: ${parseInt(newSummary.still_not_in_registry).toLocaleString()}`);
      const newCoverage = ((totalTeams - parseInt(newSummary.still_not_in_registry)) / totalTeams * 100).toFixed(1);
      console.log(`  Coverage: ${newCoverage}%`);

    } else if (FIX_MODE && fixable === 0) {
      console.log('\n⚠️  No fixable teams found (all missing teams have NULL birth_year or gender)');
    } else if (!FIX_MODE && fixable > 0) {
      console.log('\n💡 To fix, run: node scripts/maintenance/auditNonRegistryTeams.js --fix');
    }

    // ============================================================
    // Recommendations
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('RECOMMENDATIONS');
    console.log('='.repeat(60));

    if (parseInt(summary.has_matches) > 0) {
      console.log('⚠️  CRITICAL: Teams with matches not in registry');
      console.log('   → Run with --fix to add them to canonical_teams');
    }

    if (parseInt(summary.null_birth_year) > 0) {
      console.log('⚠️  Teams with NULL birth_year cannot be registered');
      console.log('   → Run: node scripts/maintenance/fixBirthYearFromNames.cjs --execute');
    }

    if (parseInt(summary.orphans_no_matches) > parseInt(summary.has_matches)) {
      console.log('ℹ️  Most unregistered teams are orphans (0 matches)');
      console.log('   → These are coverage gaps, not data quality issues');
      console.log('   → Will resolve as more data sources are added');
    }

    console.log('');

  } finally {
    await pool.end();
  }
}

auditNonRegistryTeams().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
