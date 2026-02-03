/**
 * Fix Duplicate Team Names V2
 *
 * Comprehensive fix for team names where parts are duplicated:
 * - "DERBY UNITED DERBY UNITED 15B GREEN" → "DERBY UNITED 15B GREEN"
 * - "AZTECA AZTECA ACADEMY 15B" → "AZTECA ACADEMY 15B"
 * - "FC Barcelona FC Barcelona U12" → "FC Barcelona U12"
 *
 * Improvements over V1:
 * - Checks 1-word duplicates (V1 only checked 2-5 words)
 * - Also fixes match_results table (home_team_name, away_team_name)
 * - More robust pattern detection
 * - Dry-run mode for safety
 *
 * Usage:
 *   node scripts/fixDuplicateTeamNamesV2.js           # Dry run (preview only)
 *   node scripts/fixDuplicateTeamNamesV2.js --apply   # Actually apply fixes
 *
 * Run periodically after data ingestion to catch new duplicates.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DRY_RUN = !process.argv.includes("--apply");

/**
 * Detect and fix duplicate patterns in team names
 * Returns cleaned name if duplicate found, null otherwise
 */
function fixDuplicateName(name) {
  if (!name || typeof name !== "string") return null;

  const original = name.trim();
  const words = original.split(/\s+/);

  // Need at least 2 words to have a duplicate
  if (words.length < 2) return null;

  // Pattern 1: Consecutive word duplication (1-6 word prefixes)
  // "DERBY UNITED DERBY UNITED 15B" → "DERBY UNITED 15B"
  // "AZTECA AZTECA ACADEMY" → "AZTECA ACADEMY"
  for (let len = 1; len <= 6; len++) {
    if (words.length >= len * 2) {
      const prefix = words.slice(0, len).join(" ");
      const nextChunk = words.slice(len, len * 2).join(" ");

      // Check if next chunk matches prefix (case insensitive)
      if (prefix.toLowerCase() === nextChunk.toLowerCase()) {
        // Remove the duplicate
        const cleaned = [...words.slice(0, len), ...words.slice(len * 2)].join(" ");
        // Recursively check for more duplicates
        const furtherCleaned = fixDuplicateName(cleaned);
        return furtherCleaned || cleaned;
      }
    }
  }

  // Pattern 2: Prefix appears again later (not necessarily consecutive)
  // "Club Name XYZ Club Name U12" → "Club Name XYZ U12"
  for (let len = 2; len <= 4; len++) {
    if (words.length > len * 2) {
      const prefix = words.slice(0, len).join(" ").toLowerCase();

      // Search for prefix appearing later in the name
      for (let i = len + 1; i <= words.length - len; i++) {
        const chunk = words.slice(i, i + len).join(" ").toLowerCase();
        if (prefix === chunk) {
          // Found duplicate later - remove it
          const cleaned = [
            ...words.slice(0, i),
            ...words.slice(i + len),
          ].join(" ");
          const furtherCleaned = fixDuplicateName(cleaned);
          return furtherCleaned || cleaned;
        }
      }
    }
  }

  return null;
}

async function fixTeamsTable() {
  console.log("\n📋 PROCESSING TEAMS TABLE");
  console.log("═".repeat(50));

  const { count: totalCount } = await supabase
    .from("teams")
    .select("*", { count: "exact", head: true });

  console.log(`Total teams: ${totalCount?.toLocaleString()}`);

  const BATCH_SIZE = 1000;
  let offset = 0;
  let scanned = 0;
  const fixes = [];

  while (offset < totalCount) {
    const { data: teams, error } = await supabase
      .from("teams")
      .select("id, team_name")
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("Error fetching teams:", error);
      break;
    }
    if (!teams || teams.length === 0) break;

    for (const team of teams) {
      const cleaned = fixDuplicateName(team.team_name);
      if (cleaned && cleaned !== team.team_name) {
        fixes.push({
          id: team.id,
          oldName: team.team_name,
          newName: cleaned,
        });
      }
    }

    scanned += teams.length;
    process.stdout.write(
      `\r   Scanned: ${scanned.toLocaleString()} | Duplicates found: ${fixes.length}`
    );
    offset += BATCH_SIZE;
  }

  console.log("\n");

  if (fixes.length === 0) {
    console.log("   ✅ No duplicate team names found!");
    return 0;
  }

  console.log(`   Found ${fixes.length} teams with duplicate names\n`);
  console.log("   Examples:");
  fixes.slice(0, 10).forEach((fix, i) => {
    console.log(`   ${i + 1}. "${fix.oldName}"`);
    console.log(`      → "${fix.newName}"\n`);
  });

  if (DRY_RUN) {
    console.log("   ⚠️  DRY RUN - No changes applied");
    console.log("   Run with --apply to fix these teams");
    return fixes.length;
  }

  console.log("   Applying fixes...");
  let fixed = 0;

  for (const fix of fixes) {
    const { error } = await supabase
      .from("teams")
      .update({ team_name: fix.newName })
      .eq("id", fix.id);

    if (error) {
      console.error(`   ❌ Error updating ${fix.id}: ${error.message}`);
    } else {
      fixed++;
    }

    if (fixed % 100 === 0) {
      process.stdout.write(`\r   Fixed: ${fixed} / ${fixes.length}`);
    }
  }

  console.log(`\n   ✅ Fixed ${fixed} team names`);
  return fixed;
}

async function fixMatchResultsTable() {
  console.log("\n📋 PROCESSING MATCH_RESULTS TABLE");
  console.log("═".repeat(50));

  const { count: totalCount } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true });

  console.log(`Total matches: ${totalCount?.toLocaleString()}`);

  const BATCH_SIZE = 2000;
  let offset = 0;
  let scanned = 0;
  const homeFixes = [];
  const awayFixes = [];

  while (offset < totalCount) {
    const { data: matches, error } = await supabase
      .from("match_results")
      .select("id, home_team_name, away_team_name")
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("Error fetching matches:", error);
      break;
    }
    if (!matches || matches.length === 0) break;

    for (const match of matches) {
      const cleanedHome = fixDuplicateName(match.home_team_name);
      if (cleanedHome && cleanedHome !== match.home_team_name) {
        homeFixes.push({
          id: match.id,
          oldName: match.home_team_name,
          newName: cleanedHome,
        });
      }

      const cleanedAway = fixDuplicateName(match.away_team_name);
      if (cleanedAway && cleanedAway !== match.away_team_name) {
        awayFixes.push({
          id: match.id,
          oldName: match.away_team_name,
          newName: cleanedAway,
        });
      }
    }

    scanned += matches.length;
    process.stdout.write(
      `\r   Scanned: ${scanned.toLocaleString()} | Home: ${homeFixes.length} | Away: ${awayFixes.length}`
    );
    offset += BATCH_SIZE;
  }

  console.log("\n");

  const totalFixes = homeFixes.length + awayFixes.length;

  if (totalFixes === 0) {
    console.log("   ✅ No duplicate team names found in matches!");
    return 0;
  }

  console.log(`   Found ${totalFixes} duplicate names (${homeFixes.length} home, ${awayFixes.length} away)\n`);

  if (homeFixes.length > 0) {
    console.log("   Home team examples:");
    homeFixes.slice(0, 3).forEach((fix, i) => {
      console.log(`   ${i + 1}. "${fix.oldName}" → "${fix.newName}"`);
    });
  }

  if (awayFixes.length > 0) {
    console.log("\n   Away team examples:");
    awayFixes.slice(0, 3).forEach((fix, i) => {
      console.log(`   ${i + 1}. "${fix.oldName}" → "${fix.newName}"`);
    });
  }

  if (DRY_RUN) {
    console.log("\n   ⚠️  DRY RUN - No changes applied");
    console.log("   Run with --apply to fix these matches");
    return totalFixes;
  }

  console.log("\n   Applying home team fixes...");
  let homeFixed = 0;
  for (const fix of homeFixes) {
    const { error } = await supabase
      .from("match_results")
      .update({ home_team_name: fix.newName })
      .eq("id", fix.id);

    if (!error) homeFixed++;
  }

  console.log(`   ✅ Fixed ${homeFixed} home team names`);

  console.log("   Applying away team fixes...");
  let awayFixed = 0;
  for (const fix of awayFixes) {
    const { error } = await supabase
      .from("match_results")
      .update({ away_team_name: fix.newName })
      .eq("id", fix.id);

    if (!error) awayFixed++;
  }

  console.log(`   ✅ Fixed ${awayFixed} away team names`);

  return homeFixed + awayFixed;
}

async function main() {
  console.log("\n🔧 FIX DUPLICATE TEAM NAMES V2");
  console.log("═".repeat(50));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (preview only)" : "APPLY CHANGES"}`);
  console.log(`Started: ${new Date().toISOString()}`);

  const teamsFixed = await fixTeamsTable();
  const matchesFixed = await fixMatchResultsTable();

  console.log("\n" + "═".repeat(50));
  console.log("📊 SUMMARY");
  console.log("═".repeat(50));

  if (DRY_RUN) {
    console.log(`Teams with duplicates: ${teamsFixed}`);
    console.log(`Match names with duplicates: ${matchesFixed}`);
    console.log(`\n⚠️  This was a DRY RUN. Run with --apply to fix.`);
  } else {
    console.log(`Teams fixed: ${teamsFixed}`);
    console.log(`Match names fixed: ${matchesFixed}`);
    console.log(`\n✅ All duplicates have been fixed!`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
