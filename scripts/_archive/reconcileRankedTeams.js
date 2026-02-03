/**
 * Reconcile Ranked Teams v2.0
 * ===========================
 *
 * PROBLEM: GotSport Official Rankings use different team names than Match Data
 *   - "Strikers Miami FC 2009 Elite Rios (U17 Boys)" - Rank #1, 0 matches
 *   - "Strikers Miami FC 2009 Black" - No rank, 43 matches
 *
 * SOLUTION: Find teams with Official Rank but 0 matches, search for similar
 * team names that DO have matches, and transfer the ranking data to them.
 *
 * v2.0: Uses PostgreSQL pg_trgm for proper similarity matching
 *
 * Usage:
 *   node scripts/reconcileRankedTeams.js --limit 100 --dry-run   # Preview only
 *   node scripts/reconcileRankedTeams.js --limit 100              # Actually update
 *   node scripts/reconcileRankedTeams.js                          # All priority teams
 */

import pg from "pg";
import "dotenv/config";

// ===========================================
// CONFIGURATION
// ===========================================
const DATABASE_URL = process.env.DATABASE_URL;
const MIN_SIMILARITY = 0.5;  // Lowered to find more matches, will validate more carefully

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable!");
  process.exit(1);
}

/**
 * Normalize team name for matching:
 * - Remove age/gender suffix like "(U17 Boys)"
 * - Lowercase and trim
 */
function normalizeTeamName(name) {
  if (!name) return "";
  return name
    .replace(/\s*\([^)]+\)\s*$/g, "")  // Remove (U17 Boys) suffix
    .toLowerCase()
    .trim();
}

/**
 * Extract birth year from team name
 * Handles: 2009, 2014, "09B", "14G" (but NOT "G13", "B10" which are age groups)
 */
function extractYear(name) {
  if (!name) return null;

  // First try 4-digit years 2005-2019
  const fullMatch = name.match(/\b(20[01][0-9])\b/);
  if (fullMatch) return fullMatch[1];

  // Try 2-digit year patterns like "09G", "14B", "Elite 09"
  // IMPORTANT: Match ##G or ##B (number BEFORE letter), NOT G## or B##
  // G13/B10 = age group (U13, U10), NOT birth year
  const shortMatch = name.match(/\b(0[5-9]|1[0-9])[GB]\b/i);
  if (shortMatch) {
    const year = parseInt(shortMatch[1]);
    return `20${year.toString().padStart(2, '0')}`;
  }

  // Also try standalone 2-digit years NOT preceded by G/B
  // e.g., "Elite 09 Gold" but not "G09"
  const standaloneMatch = name.match(/(?<![GB])\b(0[5-9]|1[0-9])\b(?![GB])/i);
  if (standaloneMatch) {
    const year = parseInt(standaloneMatch[1]);
    return `20${year.toString().padStart(2, '0')}`;
  }

  return null;
}

/**
 * Extract age group (U13, U17, etc)
 * Handles: U13, U-13, G13, B10 (where G/B = Girls/Boys age division)
 */
function extractAgeGroup(name) {
  if (!name) return null;

  // Standard U## format
  const uMatch = name.match(/\bU-?(\d{1,2})\b/i);
  if (uMatch) return `U${uMatch[1]}`;

  // G##/B## format (age division indicator)
  // IMPORTANT: G13 = Girls U13, B10 = Boys U10
  const gbMatch = name.match(/\b[GB](\d{1,2})\b/i);
  if (gbMatch) return `U${gbMatch[1]}`;

  return null;
}

/**
 * Extract gender from name
 */
function extractGender(name) {
  if (!name) return null;
  const lowerName = name.toLowerCase();
  if (lowerName.includes('boys') || lowerName.includes(' b ') || /\d+b\b/.test(lowerName)) return 'Boys';
  if (lowerName.includes('girls') || lowerName.includes(' g ') || /\d+g\b/.test(lowerName)) return 'Girls';
  return null;
}

async function main() {
  console.log("=".repeat(60));
  console.log("RECONCILE RANKED TEAMS v2.0");
  console.log("=".repeat(60));
  console.log("Goal: Link Official Rankings to teams with match data\n");

  // Parse arguments
  const args = process.argv.slice(2);
  let limit = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1]);
    }
    if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  console.log(`Mode: ${dryRun ? "DRY RUN (preview only)" : "LIVE UPDATE"}`);
  console.log(`Limit: ${limit || "ALL"}`);
  console.log(`Min similarity: ${MIN_SIMILARITY}\n`);

  // Connect to database
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120000,
  });

  await client.connect();
  console.log("Connected to database\n");

  // Step 1: Get priority teams (ranked but no matches)
  console.log("Step 1: Fetching priority teams (ranked, 0 matches)...");

  const priorityQuery = limit
    ? `SELECT id, team_name, national_rank, state_rank, age_group, gender, state, gotsport_team_id, matches_played
       FROM team_elo
       WHERE national_rank IS NOT NULL AND matches_played = 0
       ORDER BY national_rank ASC
       LIMIT ${limit}`
    : `SELECT id, team_name, national_rank, state_rank, age_group, gender, state, gotsport_team_id, matches_played
       FROM team_elo
       WHERE national_rank IS NOT NULL AND matches_played = 0
       ORDER BY national_rank ASC`;

  const { rows: priorityTeams } = await client.query(priorityQuery);

  console.log(`Found ${priorityTeams.length} priority teams\n`);

  if (priorityTeams.length === 0) {
    console.log("No priority teams to process!");
    await client.end();
    process.exit(0);
  }

  // Step 2: Process each priority team
  console.log("Step 2: Finding matches using pg_trgm similarity...\n");
  console.log("-".repeat(60));

  const matches = [];
  const noMatches = [];
  let processed = 0;

  for (const pt of priorityTeams) {
    // Normalize the team name (strip suffix)
    const searchName = normalizeTeamName(pt.team_name);
    const rankedYear = extractYear(pt.team_name);
    const rankedAge = extractAgeGroup(pt.team_name) || pt.age_group;
    const rankedGender = extractGender(pt.team_name) || pt.gender;

    // Use pg_trgm to find similar teams WITH matches
    const similarQuery = `
      SELECT
        id, team_name, age_group, gender, state, matches_played, elo_rating, national_rank,
        similarity(LOWER(team_name), $1) as sim
      FROM team_elo
      WHERE matches_played > 0
        AND similarity(LOWER(team_name), $1) > $2
        AND id != $3
      ORDER BY sim DESC
      LIMIT 10
    `;

    const { rows: candidates } = await client.query(similarQuery, [searchName, MIN_SIMILARITY, pt.id]);

    // Find best match with validation
    let bestMatch = null;

    for (const candidate of candidates) {
      const candYear = extractYear(candidate.team_name);
      const candAge = extractAgeGroup(candidate.team_name) || candidate.age_group;
      const candGender = extractGender(candidate.team_name) || candidate.gender;

      // CRITICAL: Year must match if both have years
      if (rankedYear && candYear && rankedYear !== candYear) continue;

      // CRITICAL: Gender must match if both have genders
      if (rankedGender && candGender && rankedGender !== candGender) continue;

      // Age group should be close (within 2 years) if both specified
      if (rankedAge && candAge) {
        const rankedAgeNum = parseInt(rankedAge.replace('U', ''));
        const candAgeNum = parseInt(candAge.replace('U', ''));
        if (Math.abs(rankedAgeNum - candAgeNum) > 2) continue;
      }

      // State should match if both have states
      if (pt.state && candidate.state && pt.state !== candidate.state) continue;

      // Don't match to a team that already has a rank
      if (candidate.national_rank && candidate.national_rank !== pt.national_rank) continue;

      bestMatch = candidate;
      break;  // First valid candidate is best (sorted by similarity)
    }

    if (bestMatch) {
      matches.push({
        ranked: pt,
        matched: bestMatch,
      });

      if (matches.length <= 25) {
        console.log(`#${pt.national_rank} "${pt.team_name.substring(0, 45)}"`);
        console.log(`   -> "${bestMatch.team_name.substring(0, 45)}" (${bestMatch.matches_played} matches)`);
        console.log(`   Similarity: ${(bestMatch.sim * 100).toFixed(1)}%\n`);
      }
    } else {
      noMatches.push(pt);
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(`... processed ${processed}/${priorityTeams.length} teams, found ${matches.length} matches`);
    }
  }

  console.log("-".repeat(60));
  console.log(`\nMatches found: ${matches.length}/${priorityTeams.length} (${(matches.length/priorityTeams.length*100).toFixed(1)}%)`);
  console.log(`No match found: ${noMatches.length}\n`);

  if (matches.length === 0) {
    console.log("No matches to update!");
    await client.end();
    process.exit(0);
  }

  // Step 3: Update database (if not dry run)
  if (dryRun) {
    console.log("DRY RUN - no database changes made.\n");
    console.log("Sample matches that WOULD be updated:");
    for (const m of matches.slice(0, 15)) {
      console.log(`  Rank #${m.ranked.national_rank}: "${m.ranked.team_name.substring(0, 35)}..."`);
      console.log(`       -> "${m.matched.team_name.substring(0, 35)}..." (${m.matched.matches_played} matches)`);
    }
    console.log(`\nRun without --dry-run to apply ${matches.length} updates.`);
    await client.end();
    return;
  }

  console.log("Step 3: Updating database...\n");

  let updated = 0;
  let errors = 0;

  for (const m of matches) {
    try {
      // Transfer ranking data to the matched team
      await client.query(`
        UPDATE team_elo SET
          national_rank = $1,
          state_rank = $2,
          gotsport_team_id = COALESCE(gotsport_team_id, $3)
        WHERE id = $4
      `, [m.ranked.national_rank, m.ranked.state_rank, m.ranked.gotsport_team_id, m.matched.id]);

      // Clear rank from old team to avoid duplicates
      await client.query(`
        UPDATE team_elo SET
          national_rank = NULL,
          state_rank = NULL
        WHERE id = $1
      `, [m.ranked.id]);

      updated++;
    } catch (e) {
      errors++;
      if (errors <= 5) {
        console.error(`Error updating ${m.matched.id}: ${e.message}`);
      }
    }

    if (updated % 100 === 0 && updated > 0) {
      console.log(`  Updated ${updated}/${matches.length}...`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("RECONCILIATION COMPLETE");
  console.log("=".repeat(60));
  console.log(`Teams processed: ${priorityTeams.length}`);
  console.log(`Matches found: ${matches.length}`);
  console.log(`Successfully updated: ${updated}`);
  console.log(`Errors: ${errors}`);
  console.log(`No match found: ${noMatches.length}`);

  if (noMatches.length > 0 && noMatches.length <= 15) {
    console.log("\nTeams without matches (may need manual review):");
    for (const nm of noMatches.slice(0, 15)) {
      console.log(`  #${nm.national_rank}: ${nm.team_name}`);
    }
  }

  await client.end();

  console.log("\nNEXT STEP: Recalculate ELO ratings");
  console.log("  node scripts/recalculate_elo_v2.js");
}

main().catch(console.error);
