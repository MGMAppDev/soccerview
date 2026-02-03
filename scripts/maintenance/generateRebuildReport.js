/**
 * generateRebuildReport.js
 *
 * Session 79 - V2 Architecture Enforcement - Phase F3
 *
 * Generates a detailed comparison report between rebuild and production tables.
 * Use this to understand the differences before executing the swap.
 *
 * Reports include:
 * 1. Row count comparison by source
 * 2. Data quality metrics side-by-side
 * 3. Sample differences (records in production but not rebuild)
 * 4. Sample improvements (better data quality in rebuild)
 *
 * Usage:
 *   node scripts/maintenance/generateRebuildReport.js
 *   node scripts/maintenance/generateRebuildReport.js --output report.md
 *   node scripts/maintenance/generateRebuildReport.js --sample-size 20
 *
 * Outputs markdown report to console or file.
 */

import pg from 'pg';
import fs from 'fs';
import 'dotenv/config';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const OUTPUT_FILE = process.argv.find(a => a.startsWith('--output='))?.split('=')[1];
const SAMPLE_SIZE = parseInt(process.argv.find(a => a.startsWith('--sample-size='))?.split('=')[1] || '10');

let report = '';

function log(text = '') {
  report += text + '\n';
  console.log(text);
}

async function generateReport() {
  log('# SoccerView Rebuild Report');
  log('');
  log(`**Generated:** ${new Date().toISOString()}`);
  log('');
  log('---');
  log('');

  try {
    // ============================================================
    // Section 1: Overview
    // ============================================================
    log('## 1. Overview');
    log('');

    const { rows: overviewData } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM teams_v2) as teams_prod,
        (SELECT COUNT(*) FROM teams_v2_rebuild) as teams_rebuild,
        (SELECT COUNT(*) FROM matches_v2) as matches_prod,
        (SELECT COUNT(*) FROM matches_v2_rebuild) as matches_rebuild,
        (SELECT COUNT(*) FROM staging_games) as staging_total,
        (SELECT COUNT(*) FROM staging_games WHERE processed = true) as staging_processed
    `);

    const o = overviewData[0];

    log('| Table | Production | Rebuild | Difference |');
    log('|-------|------------|---------|------------|');
    log(`| teams | ${parseInt(o.teams_prod).toLocaleString()} | ${parseInt(o.teams_rebuild).toLocaleString()} | ${(parseInt(o.teams_rebuild) - parseInt(o.teams_prod)).toLocaleString()} |`);
    log(`| matches | ${parseInt(o.matches_prod).toLocaleString()} | ${parseInt(o.matches_rebuild).toLocaleString()} | ${(parseInt(o.matches_rebuild) - parseInt(o.matches_prod)).toLocaleString()} |`);
    log('');

    const teamCoverage = parseInt(o.teams_rebuild) / Math.max(parseInt(o.teams_prod), 1) * 100;
    const matchCoverage = parseInt(o.matches_rebuild) / Math.max(parseInt(o.matches_prod), 1) * 100;

    log(`**Team Coverage:** ${teamCoverage.toFixed(1)}%`);
    log(`**Match Coverage:** ${matchCoverage.toFixed(1)}%`);
    log('');

    // ============================================================
    // Section 2: Data by Source
    // ============================================================
    log('## 2. Data by Source');
    log('');

    const { rows: sourceComparison } = await pool.query(`
      SELECT
        COALESCE(p.source, r.source) as source,
        COALESCE(p.prod_count, 0) as prod_count,
        COALESCE(r.rebuild_count, 0) as rebuild_count
      FROM (
        SELECT source, COUNT(*) as prod_count
        FROM matches_v2
        GROUP BY source
      ) p
      FULL OUTER JOIN (
        SELECT source, COUNT(*) as rebuild_count
        FROM matches_v2_rebuild
        GROUP BY source
      ) r ON p.source = r.source
      ORDER BY COALESCE(p.source, r.source)
    `);

    log('| Source | Production | Rebuild | Coverage |');
    log('|--------|------------|---------|----------|');
    for (const row of sourceComparison) {
      const coverage = parseInt(row.rebuild_count) / Math.max(parseInt(row.prod_count), 1) * 100;
      log(`| ${row.source || 'unknown'} | ${parseInt(row.prod_count).toLocaleString()} | ${parseInt(row.rebuild_count).toLocaleString()} | ${coverage.toFixed(1)}% |`);
    }
    log('');

    // ============================================================
    // Section 3: Data Quality Metrics
    // ============================================================
    log('## 3. Data Quality Metrics');
    log('');

    log('### Teams');
    log('');

    const { rows: teamQuality } = await pool.query(`
      SELECT
        'Production' as dataset,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE birth_year IS NULL) as null_birth_year,
        COUNT(*) FILTER (WHERE gender IS NULL) as null_gender,
        COUNT(*) FILTER (WHERE display_name IS NULL OR display_name = '') as invalid_name,
        COUNT(*) FILTER (WHERE matches_played = 0) as no_matches
      FROM teams_v2
      UNION ALL
      SELECT
        'Rebuild' as dataset,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE birth_year IS NULL) as null_birth_year,
        COUNT(*) FILTER (WHERE gender IS NULL) as null_gender,
        COUNT(*) FILTER (WHERE display_name IS NULL OR display_name = '') as invalid_name,
        COUNT(*) FILTER (WHERE matches_played = 0) as no_matches
      FROM teams_v2_rebuild
    `);

    log('| Metric | Production | Rebuild | Better? |');
    log('|--------|------------|---------|---------|');

    const prod = teamQuality.find(r => r.dataset === 'Production');
    const rebuild = teamQuality.find(r => r.dataset === 'Rebuild');

    if (prod && rebuild) {
      const metrics = [
        { name: 'NULL birth_year', prod: prod.null_birth_year, rebuild: rebuild.null_birth_year, lowerBetter: true },
        { name: 'NULL gender', prod: prod.null_gender, rebuild: rebuild.null_gender, lowerBetter: true },
        { name: 'Invalid name', prod: prod.invalid_name, rebuild: rebuild.invalid_name, lowerBetter: true },
        { name: 'No matches (orphans)', prod: prod.no_matches, rebuild: rebuild.no_matches, lowerBetter: true },
      ];

      for (const m of metrics) {
        const prodVal = parseInt(m.prod);
        const rebuildVal = parseInt(m.rebuild);
        const better = m.lowerBetter
          ? (rebuildVal <= prodVal ? '✅' : '❌')
          : (rebuildVal >= prodVal ? '✅' : '❌');
        log(`| ${m.name} | ${prodVal.toLocaleString()} | ${rebuildVal.toLocaleString()} | ${better} |`);
      }
    }
    log('');

    log('### Matches');
    log('');

    const { rows: matchQuality } = await pool.query(`
      SELECT
        'Production' as dataset,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE source_match_key IS NULL) as null_key,
        COUNT(*) FILTER (WHERE home_team_id IS NULL OR away_team_id IS NULL) as orphan_team,
        COUNT(*) FILTER (WHERE league_id IS NULL AND tournament_id IS NULL) as unlinked,
        COUNT(*) FILTER (WHERE match_date < '2020-01-01' OR match_date > '2027-12-31') as invalid_date
      FROM matches_v2
      UNION ALL
      SELECT
        'Rebuild' as dataset,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE source_match_key IS NULL) as null_key,
        COUNT(*) FILTER (WHERE home_team_id IS NULL OR away_team_id IS NULL) as orphan_team,
        COUNT(*) FILTER (WHERE league_id IS NULL AND tournament_id IS NULL) as unlinked,
        COUNT(*) FILTER (WHERE match_date < '2020-01-01' OR match_date > '2027-12-31') as invalid_date
      FROM matches_v2_rebuild
    `);

    log('| Metric | Production | Rebuild | Better? |');
    log('|--------|------------|---------|---------|');

    const prodMatch = matchQuality.find(r => r.dataset === 'Production');
    const rebuildMatch = matchQuality.find(r => r.dataset === 'Rebuild');

    if (prodMatch && rebuildMatch) {
      const metrics = [
        { name: 'NULL source_match_key', prod: prodMatch.null_key, rebuild: rebuildMatch.null_key, lowerBetter: true },
        { name: 'Orphan teams', prod: prodMatch.orphan_team, rebuild: rebuildMatch.orphan_team, lowerBetter: true },
        { name: 'Unlinked (no event)', prod: prodMatch.unlinked, rebuild: rebuildMatch.unlinked, lowerBetter: true },
        { name: 'Invalid date', prod: prodMatch.invalid_date, rebuild: rebuildMatch.invalid_date, lowerBetter: true },
      ];

      for (const m of metrics) {
        const prodVal = parseInt(m.prod);
        const rebuildVal = parseInt(m.rebuild);
        const better = m.lowerBetter
          ? (rebuildVal <= prodVal ? '✅' : '❌')
          : (rebuildVal >= prodVal ? '✅' : '❌');
        log(`| ${m.name} | ${prodVal.toLocaleString()} | ${rebuildVal.toLocaleString()} | ${better} |`);
      }
    }
    log('');

    // ============================================================
    // Section 4: Sample Missing Records
    // ============================================================
    log('## 4. Sample Records (Production only, not in Rebuild)');
    log('');

    const { rows: missingMatches } = await pool.query(`
      SELECT
        p.id,
        p.source_match_key,
        p.match_date,
        p.source
      FROM matches_v2 p
      WHERE NOT EXISTS (
        SELECT 1 FROM matches_v2_rebuild r
        WHERE r.source_match_key = p.source_match_key
      )
      AND p.source_match_key IS NOT NULL
      LIMIT $1
    `, [SAMPLE_SIZE]);

    if (missingMatches.length === 0) {
      log('No matches found in production that are missing from rebuild (good!)');
    } else {
      log(`Found matches in production missing from rebuild (showing ${missingMatches.length} samples):`);
      log('');
      log('| ID | Source Key | Date | Source |');
      log('|----|------------|------|--------|');
      for (const m of missingMatches) {
        log(`| ${m.id.substring(0, 8)}... | ${m.source_match_key?.substring(0, 30) || 'NULL'}... | ${m.match_date?.toISOString()?.substring(0, 10) || 'NULL'} | ${m.source || 'unknown'} |`);
      }
    }
    log('');

    // ============================================================
    // Section 5: Sample Improvements
    // ============================================================
    log('## 5. Sample Data Quality Improvements');
    log('');

    // Teams with better birth_year in rebuild
    const { rows: birthYearFixes } = await pool.query(`
      SELECT
        p.id as prod_id,
        p.display_name,
        p.birth_year as prod_by,
        r.birth_year as rebuild_by
      FROM teams_v2 p
      JOIN teams_v2_rebuild r ON LOWER(p.display_name) = LOWER(r.display_name)
      WHERE p.birth_year IS NULL AND r.birth_year IS NOT NULL
      LIMIT $1
    `, [SAMPLE_SIZE]);

    if (birthYearFixes.length === 0) {
      log('No birth_year improvements found (rebuild has same or fewer filled).');
    } else {
      log(`Found ${birthYearFixes.length} teams with birth_year improved in rebuild:`);
      log('');
      log('| Team | Prod birth_year | Rebuild birth_year |');
      log('|------|-----------------|-------------------|');
      for (const t of birthYearFixes) {
        log(`| ${t.display_name?.substring(0, 40) || 'Unknown'}... | ${t.prod_by || 'NULL'} | ${t.rebuild_by} |`);
      }
    }
    log('');

    // ============================================================
    // Section 6: Duplicate Detection
    // ============================================================
    log('## 6. Duplicate Detection');
    log('');

    const { rows: prodDupes } = await pool.query(`
      SELECT COUNT(*) as cnt FROM (
        SELECT source_match_key FROM matches_v2
        WHERE source_match_key IS NOT NULL
        GROUP BY source_match_key HAVING COUNT(*) > 1
      ) d
    `);

    const { rows: rebuildDupes } = await pool.query(`
      SELECT COUNT(*) as cnt FROM (
        SELECT source_match_key FROM matches_v2_rebuild
        WHERE source_match_key IS NOT NULL
        GROUP BY source_match_key HAVING COUNT(*) > 1
      ) d
    `);

    log('| Table | Duplicate Key Groups |');
    log('|-------|---------------------|');
    log(`| Production (matches_v2) | ${parseInt(prodDupes[0].cnt).toLocaleString()} |`);
    log(`| Rebuild (matches_v2_rebuild) | ${parseInt(rebuildDupes[0].cnt).toLocaleString()} |`);
    log('');

    // ============================================================
    // Section 7: Recommendations
    // ============================================================
    log('## 7. Recommendations');
    log('');

    const recommendations = [];

    if (matchCoverage < 95) {
      recommendations.push('⚠️ Match coverage below 95% - investigate missing staging data');
    }
    if (parseInt(rebuildDupes[0].cnt) > 0) {
      recommendations.push('⚠️ Rebuild has duplicate source_match_keys - run deduplication');
    }
    if (rebuildMatch && parseInt(rebuildMatch.unlinked) > parseInt(prodMatch?.unlinked || 0)) {
      recommendations.push('⚠️ Rebuild has more unlinked matches - check event linkage');
    }
    if (teamCoverage < 90) {
      recommendations.push('⚠️ Team coverage below 90% - check team creation in rebuild');
    }

    if (recommendations.length === 0) {
      log('✅ **No critical issues found.** The rebuild appears ready for swap.');
      log('');
      log('Next steps:');
      log('1. Run `node scripts/maintenance/validateRebuild.js --strict`');
      log('2. If passed, run `node scripts/maintenance/executeSwap.js --dry-run`');
      log('3. Review dry-run output, then run `node scripts/maintenance/executeSwap.js`');
    } else {
      log('Issues to address before swap:');
      log('');
      for (const rec of recommendations) {
        log(`- ${rec}`);
      }
    }
    log('');

    // ============================================================
    // Footer
    // ============================================================
    log('---');
    log('');
    log('*Report generated by Session 79 V2 Architecture Enforcement tools*');

    // Write to file if specified
    if (OUTPUT_FILE) {
      fs.writeFileSync(OUTPUT_FILE, report);
      console.log(`\n📄 Report saved to: ${OUTPUT_FILE}`);
    }

  } catch (err) {
    console.error('❌ Error generating report:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

generateReport();
