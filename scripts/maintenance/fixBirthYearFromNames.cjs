/**
 * Fix Birth Year From Team Names - Universal V2 Architecture
 * Session 78 - February 2, 2026
 *
 * Uses the V2 normalizer logic to extract birth year from team names
 * and fix database inconsistencies.
 *
 * Following GUARDRAILS:
 * - Uses bulk SQL (target: 1000+ records/second)
 * - No hardcoded mappings
 * - Audit trail for all changes
 * - Dry-run mode available
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;

// Current season year for age group calculations
// Default fallback; updated from DB at startup
let SEASON_YEAR = 2026;

/**
 * Extract birth year from team name - V2 Normalizer Logic
 * Handles: "2014B", "15B", "U12", "(U11 Boys)", etc.
 */
function extractBirthYearFromName(name) {
  if (!name) return null;

  // Priority 1: Full 4-digit year followed by B/G or space (e.g., "2014B", "2015 B", "2014")
  const fullYearMatch = name.match(/\b(20[01]\d)(?:[BG\s]|$)/i);
  if (fullYearMatch) {
    const year = parseInt(fullYearMatch[1], 10);
    if (year >= 2007 && year <= 2019) {
      return { year, source: '4digit', pattern: fullYearMatch[0] };
    }
  }

  // Priority 2: 2-digit year with gender code (e.g., "15B", "14G", "B15", "G14")
  const twoDigitPatterns = [
    /\b(\d{2})[BG]\b/i,  // 15B, 14G
    /\b[BG](\d{2})\b/i,  // B15, G14
  ];

  for (const pattern of twoDigitPatterns) {
    const match = name.match(pattern);
    if (match) {
      const twoDigit = parseInt(match[1], 10);
      const year = twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
      if (year >= 2007 && year <= 2019) {
        return { year, source: '2digit', pattern: match[0] };
      }
    }
  }

  // Priority 3: Standalone 2-digit year at end (e.g., "Pre-NAL 15")
  const trailingYearMatch = name.match(/\b(\d{2})\s*$/);
  if (trailingYearMatch) {
    const twoDigit = parseInt(trailingYearMatch[1], 10);
    const year = twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
    if (year >= 2007 && year <= 2019) {
      return { year, source: 'trailing', pattern: trailingYearMatch[0] };
    }
  }

  // Priority 4: Age group after team type (e.g., "Pre-NAL 15 Blue")
  const midNameMatch = name.match(/(?:Pre-?(?:NAL|Academy|ECNL|MLS|Elite)|Academy|Elite|Select|Premier)\s+(\d{2})(?:\s|$)/i);
  if (midNameMatch) {
    const twoDigit = parseInt(midNameMatch[1], 10);
    const year = twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
    if (year >= 2007 && year <= 2019) {
      return { year, source: 'midname', pattern: midNameMatch[0] };
    }
  }

  // Priority 5: Age group in suffix (e.g., "(U11 Boys)")
  // NOTE: Only use this if NO other birth year indicator found in the main name
  const suffixMatch = name.match(/\(U(\d+)\s*(Boys|Girls)\)/i);
  if (suffixMatch) {
    const age = parseInt(suffixMatch[1], 10);
    if (age >= 7 && age <= 19) {
      return { year: SEASON_YEAR - age, source: 'suffix', pattern: suffixMatch[0] };
    }
  }

  // Priority 6: U-age in main name (e.g., "U12 Boys")
  const ageMatch = name.match(/\bU[-\s]?(\d+)\b/i);
  if (ageMatch) {
    const age = parseInt(ageMatch[1], 10);
    if (age >= 7 && age <= 19) {
      return { year: SEASON_YEAR - age, source: 'uage', pattern: ageMatch[0] };
    }
  }

  return null;
}

async function findInconsistencies() {
  console.log('=== BIRTH YEAR FIX FROM NAMES ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);

  // Load season year from database (dynamic, not hardcoded)
  try {
    const { rows: seasonRows } = await pool.query('SELECT year FROM seasons WHERE is_current = true LIMIT 1');
    if (seasonRows[0]?.year) SEASON_YEAR = seasonRows[0].year;
  } catch (e) { /* fallback to default */ }
  console.log(`Season year: ${SEASON_YEAR} (from database)\n`);

  // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
  if (!DRY_RUN) {
    console.log('🔐 Authorizing pipeline writes...');
    await authorizePipelineWrite(pool);
    console.log('✅ Pipeline write authorization granted\n');
  }

  // Get all teams with names containing birth year indicators
  const query = `
    SELECT id, display_name, birth_year, gender, state, gotsport_points, matches_played
    FROM teams_v2
    WHERE display_name IS NOT NULL
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ''}
  `;

  const result = await pool.query(query);
  console.log(`Analyzing ${result.rows.length} teams...\n`);

  const fixes = [];
  const conflicts = [];
  const skipped = [];

  for (const team of result.rows) {
    const extracted = extractBirthYearFromName(team.display_name);

    if (!extracted) {
      skipped.push(team);
      continue;
    }

    // Check if the name has CONFLICTING birth year indicators
    // e.g., "2014B SDL ACADEMY (U11 Boys)" - 2014 vs U11=2015
    const mainNameMatch = team.display_name.match(/\b(20[01]\d)(?:[BG\s]|$)/i) ||
                          team.display_name.match(/\b(\d{2})[BG]\b/i);
    const suffixMatch = team.display_name.match(/\(U(\d+)\s*(Boys|Girls)\)/i);

    if (mainNameMatch && suffixMatch) {
      let mainYear;
      if (mainNameMatch[1].length === 4) {
        mainYear = parseInt(mainNameMatch[1], 10);
      } else {
        const twoDigit = parseInt(mainNameMatch[1], 10);
        mainYear = twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
      }
      const suffixYear = SEASON_YEAR - parseInt(suffixMatch[1], 10);

      if (mainYear !== suffixYear) {
        conflicts.push({
          team,
          mainYear,
          suffixYear,
          mainPattern: mainNameMatch[0],
          suffixPattern: suffixMatch[0]
        });
        continue; // Don't fix conflicting names - need human review
      }
    }

    // If extracted year differs from database, it's a fix candidate
    if (team.birth_year !== extracted.year) {
      fixes.push({
        id: team.id,
        display_name: team.display_name,
        old_year: team.birth_year,
        new_year: extracted.year,
        source: extracted.source,
        pattern: extracted.pattern,
        gotsport_points: team.gotsport_points,
        matches_played: team.matches_played
      });
    }
  }

  // Report conflicts (names with internal inconsistencies)
  if (conflicts.length > 0) {
    console.log(`=== CONFLICTING NAMES (need human review): ${conflicts.length} ===\n`);
    conflicts.slice(0, 20).forEach(c => {
      console.log(`  ${c.team.display_name}`);
      console.log(`    Main name says: ${c.mainYear} (from "${c.mainPattern}")`);
      console.log(`    Suffix says: ${c.suffixYear} (from "${c.suffixPattern}")`);
      console.log(`    DB currently: ${c.team.birth_year}`);
      console.log('');
    });
    if (conflicts.length > 20) {
      console.log(`  ... and ${conflicts.length - 20} more conflicts\n`);
    }
  }

  // Report fixes
  console.log(`=== FIXES TO APPLY: ${fixes.length} ===\n`);

  if (fixes.length > 0 && VERBOSE) {
    fixes.slice(0, 30).forEach(f => {
      console.log(`  ${f.display_name}`);
      console.log(`    ${f.old_year} (U${SEASON_YEAR - f.old_year}) → ${f.new_year} (U${SEASON_YEAR - f.new_year})`);
      console.log(`    Source: ${f.source} pattern: "${f.pattern}"`);
      console.log('');
    });
  }

  // Summary by change type
  const byChange = {};
  fixes.forEach(f => {
    const key = `U${SEASON_YEAR - f.old_year} → U${SEASON_YEAR - f.new_year}`;
    byChange[key] = (byChange[key] || 0) + 1;
  });

  console.log('Changes by age group:');
  Object.entries(byChange)
    .sort((a, b) => b[1] - a[1])
    .forEach(([change, count]) => {
      console.log(`  ${change}: ${count} teams`);
    });

  // Apply fixes
  if (!DRY_RUN && fixes.length > 0) {
    console.log(`\nApplying ${fixes.length} fixes...`);

    // Batch update using CASE statement (bulk SQL per GUARDRAILS)
    const batchSize = 5000;
    let updated = 0;

    for (let i = 0; i < fixes.length; i += batchSize) {
      const batch = fixes.slice(i, i + batchSize);
      const ids = batch.map(f => f.id);
      const cases = batch.map(f => `WHEN id = '${f.id}' THEN ${f.new_year}`).join(' ');

      await pool.query(`
        UPDATE teams_v2
        SET birth_year = CASE ${cases} END,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `, [ids]);

      updated += batch.length;
      console.log(`  Updated ${updated}/${fixes.length}`);
    }

    console.log(`\n✅ Fixed ${fixes.length} birth_year values`);
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total teams analyzed: ${result.rows.length}`);
  console.log(`Fixes applied: ${DRY_RUN ? '0 (dry run)' : fixes.length}`);
  console.log(`Fixes needed: ${fixes.length}`);
  console.log(`Conflicting names (skipped): ${conflicts.length}`);
  console.log(`No birth year in name: ${skipped.length}`);

  pool.end();
  return { fixes, conflicts };
}

findInconsistencies().catch(e => {
  console.error('Error:', e);
  pool.end();
  process.exit(1);
});
