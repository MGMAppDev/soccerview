/**
 * Automated team linking script v2.0
 * Links match_results records to team_elo using fuzzy matching
 *
 * KEY OPTIMIZATIONS:
 * 1. Cache unique team names → avoids repeated fuzzy lookups
 * 2. Bulk updates instead of one-by-one
 * 3. Time-based exit (90 min) to avoid GitHub Actions timeout
 * 4. Process unlinked names, not unlinked matches
 *
 * Usage:
 *   node scripts/linkTeams.js              # Default: 90 min timeout
 *   node scripts/linkTeams.js --max=1000   # Limit to 1000 unique names
 *   node scripts/linkTeams.js --timeout=60 # Custom timeout in minutes
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Parse CLI args
const args = process.argv.slice(2);
const maxArg = args.find((a) => a.startsWith("--max="));
const timeoutArg = args.find((a) => a.startsWith("--timeout="));

const MAX_UNIQUE_NAMES = maxArg ? parseInt(maxArg.split("=")[1]) : 10000;
const TIMEOUT_MINUTES = timeoutArg ? parseInt(timeoutArg.split("=")[1]) : 90;
const BATCH_SIZE = 500; // Records per bulk update

const startTime = Date.now();

function getElapsedMinutes() {
  return (Date.now() - startTime) / 60000;
}

function shouldExit() {
  return getElapsedMinutes() >= TIMEOUT_MINUTES - 2; // Exit 2 min before timeout
}

/**
 * Get all unique unlinked team names for a field (home or away)
 */
async function getUniqueUnlinkedNames(field) {
  const column = field === "home" ? "home_team_id" : "away_team_id";
  const nameCol = field === "home" ? "home_team_name" : "away_team_name";

  // Get distinct unlinked team names
  const { data, error } = await supabase
    .from("match_results")
    .select(nameCol)
    .is(column, null)
    .not(nameCol, "is", null)
    .limit(50000); // Get a large sample

  if (error) {
    console.error(`❌ Error fetching unlinked ${field} names:`, error.message);
    return [];
  }

  // Deduplicate and clean
  const uniqueNames = [
    ...new Set(
      (data || [])
        .map((r) => r[nameCol])
        .filter((n) => n && n.trim().length > 0),
    ),
  ];

  return uniqueNames;
}

/**
 * Find team ID for a given name using fuzzy matching
 */
async function findTeamId(teamName) {
  const { data: teams, error } = await supabase.rpc("find_similar_team", {
    search_name: teamName.toLowerCase(),
  });

  if (error) {
    console.error(`❌ RPC error for "${teamName}":`, error.message);
    return null;
  }

  return teams?.[0]?.id || null;
}

/**
 * Bulk update all matches with a specific team name
 */
async function bulkUpdateMatches(field, teamName, teamId) {
  const column = field === "home" ? "home_team_id" : "away_team_id";
  const nameCol = field === "home" ? "home_team_name" : "away_team_name";

  const { error, count } = await supabase
    .from("match_results")
    .update({ [column]: teamId })
    .eq(nameCol, teamName)
    .is(column, null);

  if (error) {
    console.error(`❌ Bulk update error for "${teamName}":`, error.message);
    return 0;
  }

  return count || 0;
}

/**
 * Process all unlinked names for a field
 */
async function processField(field, nameCache) {
  const column = field === "home" ? "home" : "away";
  console.log(`\n📋 Processing ${column} teams...`);

  const uniqueNames = await getUniqueUnlinkedNames(field);
  console.log(
    `   Found ${uniqueNames.length} unique unlinked ${column} team names`,
  );

  let processed = 0;
  let matched = 0;
  let matchesUpdated = 0;

  for (const teamName of uniqueNames) {
    if (shouldExit()) {
      console.log(
        `\n⏰ Time limit approaching (${Math.round(getElapsedMinutes())} min), saving progress...`,
      );
      break;
    }

    if (processed >= MAX_UNIQUE_NAMES) {
      console.log(`\n📊 Reached max unique names limit (${MAX_UNIQUE_NAMES})`);
      break;
    }

    // Check cache first
    let teamId = nameCache.get(teamName.toLowerCase());

    if (teamId === undefined) {
      // Not in cache - do fuzzy lookup
      teamId = await findTeamId(teamName);
      nameCache.set(teamName.toLowerCase(), teamId); // Cache even nulls to avoid re-lookup
    }

    if (teamId) {
      const updated = await bulkUpdateMatches(field, teamName, teamId);
      matchesUpdated += updated;
      matched++;
      process.stdout.write(".");
    } else {
      process.stdout.write("x");
    }

    processed++;

    // Progress report every 100 names
    if (processed % 100 === 0) {
      console.log(
        `\n   Progress: ${processed}/${uniqueNames.length} names, ${matched} matched, ${matchesUpdated} matches updated (${Math.round(getElapsedMinutes())} min elapsed)`,
      );
    }

    // Small delay to avoid rate limits
    if (processed % 50 === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log(
    `\n   ✅ ${column}: ${processed} names processed, ${matched} matched, ${matchesUpdated} matches updated`,
  );

  return { processed, matched, matchesUpdated };
}

async function getProgress() {
  const { count: total } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true });

  const { count: homeLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("home_team_id", "is", null);

  const { count: awayLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("away_team_id", "is", null);

  const { count: fullyLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null);

  return {
    total: total || 0,
    homeLinked: homeLinked || 0,
    awayLinked: awayLinked || 0,
    fullyLinked: fullyLinked || 0,
    homeUnlinked: (total || 0) - (homeLinked || 0),
    awayUnlinked: (total || 0) - (awayLinked || 0),
  };
}

async function main() {
  console.log("🔗 Starting automated team linking v2.0...");
  console.log(`⏱️  Timeout: ${TIMEOUT_MINUTES} minutes`);
  console.log(`📊 Max unique names per field: ${MAX_UNIQUE_NAMES}\n`);

  // Shared cache across home and away (same team names appear in both)
  const nameCache = new Map();

  const startProgress = await getProgress();
  console.log("📈 Starting state:");
  console.log(`   Total matches: ${startProgress.total}`);
  console.log(
    `   Home linked: ${startProgress.homeLinked} (${startProgress.homeUnlinked} unlinked)`,
  );
  console.log(
    `   Away linked: ${startProgress.awayLinked} (${startProgress.awayUnlinked} unlinked)`,
  );
  console.log(`   Fully linked: ${startProgress.fullyLinked}`);

  // Process home teams first
  const homeResult = await processField("home", nameCache);

  // Check if we should continue
  if (!shouldExit()) {
    // Process away teams (benefits from cache built during home processing)
    const awayResult = await processField("away", nameCache);
  } else {
    console.log("\n⏰ Skipping away teams due to time limit");
  }

  // Final summary
  const finalProgress = await getProgress();
  const elapsed = Math.round(getElapsedMinutes());

  console.log("\n" + "=".repeat(60));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total matches: ${finalProgress.total}`);
  console.log(
    `Home linked: ${finalProgress.homeLinked} (${finalProgress.homeUnlinked} remaining)`,
  );
  console.log(
    `Away linked: ${finalProgress.awayLinked} (${finalProgress.awayUnlinked} remaining)`,
  );
  console.log(`Fully linked: ${finalProgress.fullyLinked}`);
  console.log(`Cache size: ${nameCache.size} unique team names`);
  console.log(`Time elapsed: ${elapsed} minutes`);
  console.log("=".repeat(60));

  // Calculate improvement
  const homeImprovement = finalProgress.homeLinked - startProgress.homeLinked;
  const awayImprovement = finalProgress.awayLinked - startProgress.awayLinked;
  console.log(
    `\n✅ This run linked: +${homeImprovement} home, +${awayImprovement} away`,
  );

  if (finalProgress.homeUnlinked === 0 && finalProgress.awayUnlinked === 0) {
    console.log("🎉 All matches fully linked!");
  } else if (shouldExit()) {
    console.log("⏰ Exited due to time limit - will continue in next run");
  }

  console.log("✅ Done!");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
