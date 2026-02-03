/**
 * Analyze Orphan Root Cause
 * Session 78 - February 2, 2026
 *
 * Key insight: Orphans are NOT duplicates - they're teams in leagues we don't scrape.
 * Also checking for birth_year inconsistencies between name and database.
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Extract birth year from team name
 * "Pre-NAL 2014B" -> 2014
 * "Pre-NAL 15" -> 2015
 */
function extractBirthYearFromName(name) {
  if (!name) return null;

  // Full 4-digit year: "2014", "2015B", "2014 B"
  const fullYearMatch = name.match(/\b(20[01]\d)\b/);
  if (fullYearMatch) {
    return parseInt(fullYearMatch[1], 10);
  }

  // 2-digit year with gender code: "15B", "14G"
  const twoDigitMatch = name.match(/\b(\d{2})[BG]\b/i);
  if (twoDigitMatch) {
    const twoDigit = parseInt(twoDigitMatch[1], 10);
    return twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
  }

  // U-age: "(U11 Boys)" -> 2026-11=2015
  const ageMatch = name.match(/\bU[-\s]?(\d+)/i);
  if (ageMatch) {
    const age = parseInt(ageMatch[1], 10);
    if (age >= 7 && age <= 19) {
      return 2026 - age;
    }
  }

  return null;
}

async function analyzeOrphans() {
  console.log('=== ORPHAN ROOT CAUSE ANALYSIS ===\n');

  // 1. Get orphans with high GS points
  const orphans = await pool.query(`
    SELECT id, display_name, gotsport_points, birth_year, gender, state
    FROM teams_v2
    WHERE gotsport_points > 0 AND matches_played = 0
    ORDER BY gotsport_points DESC
    LIMIT 100
  `);

  console.log('Checking top 100 orphans for birth_year inconsistencies...\n');

  let inconsistentCount = 0;
  const inconsistentExamples = [];

  for (const orphan of orphans.rows) {
    const nameYear = extractBirthYearFromName(orphan.display_name);
    const dbYear = orphan.birth_year;

    if (nameYear && dbYear && nameYear !== dbYear) {
      inconsistentCount++;
      inconsistentExamples.push({
        name: orphan.display_name,
        nameYear,
        dbYear,
        gsPoints: orphan.gotsport_points
      });
    }
  }

  console.log(`Found ${inconsistentCount}/100 orphans with birth_year INCONSISTENCY:\n`);

  inconsistentExamples.slice(0, 15).forEach(ex => {
    console.log(`  Name: ${ex.name}`);
    console.log(`    Name says: ${ex.nameYear} (U${2026 - ex.nameYear})`);
    console.log(`    DB says:   ${ex.dbYear} (U${2026 - ex.dbYear})`);
    console.log(`    GS pts:    ${ex.gsPoints}`);
    console.log('');
  });

  // 2. Check what states have the most orphans
  console.log('=== ORPHANS BY STATE (coverage gap analysis) ===\n');
  const byState = await pool.query(`
    SELECT state, COUNT(*) as orphan_count,
           SUM(gotsport_points) as total_gs_points,
           AVG(gotsport_points) as avg_gs_points
    FROM teams_v2
    WHERE gotsport_points > 0 AND matches_played = 0
    GROUP BY state
    ORDER BY orphan_count DESC
    LIMIT 15
  `);

  byState.rows.forEach(s => {
    console.log(`  ${s.state || 'NULL'}: ${s.orphan_count} orphans, avg GS pts: ${parseFloat(s.avg_gs_points).toFixed(0)}`);
  });

  // 3. Compare coverage: what % of GS-ranked teams have matches by state?
  console.log('\n=== COVERAGE RATE BY STATE ===\n');
  const coverage = await pool.query(`
    SELECT state,
           COUNT(*) FILTER (WHERE gotsport_points > 0) as gs_teams,
           COUNT(*) FILTER (WHERE gotsport_points > 0 AND matches_played > 0) as gs_with_matches,
           ROUND(100.0 * COUNT(*) FILTER (WHERE gotsport_points > 0 AND matches_played > 0) /
                 NULLIF(COUNT(*) FILTER (WHERE gotsport_points > 0), 0), 1) as coverage_pct
    FROM teams_v2
    WHERE state IS NOT NULL
    GROUP BY state
    HAVING COUNT(*) FILTER (WHERE gotsport_points > 0) > 100
    ORDER BY coverage_pct ASC
    LIMIT 15
  `);

  console.log('States with LOWEST coverage (highest orphan rate):');
  coverage.rows.forEach(s => {
    console.log(`  ${s.state}: ${s.coverage_pct}% coverage (${s.gs_with_matches}/${s.gs_teams} teams)`);
  });

  // 4. Check specific Kansas orphans - are they in leagues we scrape?
  console.log('\n=== KANSAS U11 BOYS ORPHAN ANALYSIS ===\n');
  const kansasOrphans = await pool.query(`
    SELECT id, display_name, gotsport_points, birth_year
    FROM teams_v2
    WHERE state = 'KS' AND gender = 'M' AND gotsport_points > 500 AND matches_played = 0
    ORDER BY gotsport_points DESC
    LIMIT 10
  `);

  for (const orphan of kansasOrphans.rows) {
    const nameYear = extractBirthYearFromName(orphan.display_name);
    console.log(`Orphan: ${orphan.display_name}`);
    console.log(`  GS pts: ${orphan.gotsport_points}`);
    console.log(`  DB birth_year: ${orphan.birth_year} (U${2026 - orphan.birth_year})`);
    console.log(`  Name birth_year: ${nameYear} (U${nameYear ? 2026 - nameYear : '?'})`);
    if (nameYear && orphan.birth_year && nameYear !== orphan.birth_year) {
      console.log(`  ⚠️  INCONSISTENT!`);
    }

    // Check if there are ANY matches for this exact team name pattern
    const clubWords = orphan.display_name.split(/\s+/).slice(0, 3).join('%');
    const matchCheck = await pool.query(`
      SELECT COUNT(*) as match_count
      FROM matches_v2 m
      JOIN teams_v2 t ON (t.id = m.home_team_id OR t.id = m.away_team_id)
      WHERE t.display_name ILIKE $1
    `, ['%' + clubWords + '%']);

    console.log(`  Matches for similar teams: ${matchCheck.rows[0].match_count}`);
    console.log('');
  }

  pool.end();
}

analyzeOrphans().catch(console.error);
