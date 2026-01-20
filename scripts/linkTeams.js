/**
 * Automated team linking script v3.1 - BULLETPROOF EDITION
 *
 * CRITICAL FIX: Previous versions made 90,000 individual RPC calls (1 per match).
 * This version processes UNIQUE TEAM NAMES only (~5,000 names vs 90,000 matches).
 *
 * STRATEGY:
 * 1. Get all unique unlinked team names
 * 2. For each unique name, find the best match ONCE
 * 3. Bulk update ALL matches with that name in one query
 *
 * Expected completion: 5-15 minutes (vs 2+ hours before)
 *
 * Usage:
 *   node scripts/linkTeams.js              # Default (45 min timeout)
 *   node scripts/linkTeams.js --timeout=90 # Custom timeout
 *   node scripts/linkTeams.js --threshold=0.5 # Custom similarity threshold
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
const timeoutArg = args.find((a) => a.startsWith("--timeout="));
const thresholdArg = args.find((a) => a.startsWith("--threshold="));

const TIMEOUT_MINUTES = timeoutArg ? parseInt(timeoutArg.split("=")[1]) : 45;
const SIMILARITY_THRESHOLD = thresholdArg
  ? parseFloat(thresholdArg.split("=")[1])
  : 0.4;

const startTime = Date.now();

function getElapsedMinutes() {
  return (Date.now() - startTime) / 60000;
}

function shouldExit() {
  return getElapsedMinutes() >= TIMEOUT_MINUTES - 2; // Exit 2 min before timeout
}

/**
 * Get current linking status
 */
async function getStatus() {
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
  };
}

/**
 * Get unique unlinked team names
 */
async function getUniqueUnlinkedNames(field) {
  const column = field === "home" ? "home_team_id" : "away_team_id";
  const nameCol = field === "home" ? "home_team_name" : "away_team_name";

  // Fetch distinct unlinked names (Supabase doesn't support DISTINCT directly)
  const { data, error } = await supabase
    .from("match_results")
    .select(nameCol)
    .is(column, null)
    .not(nameCol, "is", null)
    .limit(50000);

  if (error) {
    console.error(`❌ Error fetching ${field} names:`, error.message);
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
 * Build team lookup cache from team_elo
 * Key optimization: Load ALL teams into memory for instant lookups
 */
async function buildTeamCache() {
  console.log("📦 Building team lookup cache...");

  const allTeams = [];
  let offset = 0;
  const batchSize = 5000;

  while (true) {
    const { data, error } = await supabase
      .from("team_elo")
      .select("id, team_name")
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("❌ Error loading teams:", error.message);
      break;
    }

    if (!data?.length) break;

    allTeams.push(...data);
    offset += batchSize;

    if (data.length < batchSize) break;
  }

  console.log(`   Loaded ${allTeams.toLocaleString()} teams into cache`);

  // Build lowercase lookup map for exact matching
  const exactMap = new Map();
  for (const team of allTeams) {
    const key = team.team_name.toLowerCase().trim();
    if (!exactMap.has(key)) {
      exactMap.set(key, team);
    }
  }

  return { allTeams, exactMap };
}

/**
 * Simple similarity function (Sørensen–Dice coefficient)
 * Faster than pg_trgm for client-side use
 */
function similarity(s1, s2) {
  if (!s1 || !s2) return 0;
  s1 = s1.toLowerCase().trim();
  s2 = s2.toLowerCase().trim();
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const bigrams1 = new Set();
  for (let i = 0; i < s1.length - 1; i++) {
    bigrams1.add(s1.substring(i, i + 2));
  }

  let matches = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    if (bigrams1.has(s2.substring(i, i + 2))) matches++;
  }

  return (2 * matches) / (s1.length - 1 + s2.length - 1);
}

/**
 * Find best match using RPC (server-side pg_trgm)
 */
async function findBestMatchRPC(teamName) {
  const { data, error } = await supabase.rpc("find_similar_team", {
    search_name: teamName.toLowerCase().trim(),
  });

  if (error || !data?.length) return null;
  return data[0];
}

/**
 * Find best match using local cache (exact + fuzzy)
 */
function findBestMatchLocal(teamName, cache) {
  const searchKey = teamName.toLowerCase().trim();

  // Try exact match first
  const exactMatch = cache.exactMap.get(searchKey);
  if (exactMatch) {
    return { id: exactMatch.id, team_name: exactMatch.team_name, sim: 1.0 };
  }

  // Fuzzy match
  let bestMatch = null;
  let bestSim = 0;

  for (const team of cache.allTeams) {
    const sim = similarity(searchKey, team.team_name);
    if (sim > bestSim) {
      bestSim = sim;
      bestMatch = team;
    }
  }

  if (bestMatch && bestSim >= SIMILARITY_THRESHOLD) {
    return { id: bestMatch.id, team_name: bestMatch.team_name, sim: bestSim };
  }

  return null;
}

/**
 * Process a field (home or away) using bulk updates
 */
async function processField(field, cache) {
  const column = field === "home" ? "home_team_id" : "away_team_id";
  const nameCol = field === "home" ? "home_team_name" : "away_team_name";

  const uniqueNames = await getUniqueUnlinkedNames(field);
  console.log(
    `   Found ${uniqueNames.length.toLocaleString()} unique unlinked ${field} names`,
  );

  if (uniqueNames.length === 0) return 0;

  let linked = 0;
  let notFound = 0;
  let processed = 0;

  for (const teamName of uniqueNames) {
    if (shouldExit()) {
      console.log(`\n   ⏱️ Timeout approaching - stopping early`);
      break;
    }

    // Try local cache first (faster), fall back to RPC
    let match = findBestMatchLocal(teamName, cache);

    // If local didn't find good match, try RPC (uses server-side pg_trgm)
    if (!match || match.sim < SIMILARITY_THRESHOLD) {
      match = await findBestMatchRPC(teamName);
    }

    if (match && match.sim >= SIMILARITY_THRESHOLD) {
      // Bulk update ALL matches with this team name
      const { error, count } = await supabase
        .from("match_results")
        .update({ [column]: match.id })
        .eq(nameCol, teamName)
        .is(column, null);

      if (!error) {
        linked++;
      }
    } else {
      notFound++;
    }

    processed++;

    // Progress update every 50 names
    if (processed % 50 === 0) {
      const pct = ((processed / uniqueNames.length) * 100).toFixed(1);
      const elapsed = getElapsedMinutes().toFixed(1);
      process.stdout.write(
        `   Progress: ${processed}/${uniqueNames.length} (${pct}%) | Linked: ${linked} | Elapsed: ${elapsed}m\r`,
      );
    }

    // Small delay to avoid rate limits
    if (processed % 10 === 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  console.log(`\n   Completed: ${linked} linked, ${notFound} not found`);
  return linked;
}

/**
 * Main execution
 */
async function main() {
  console.log("=".repeat(60));
  console.log("🔗 TEAM LINKING v3.1 - BULLETPROOF EDITION");
  console.log("=".repeat(60));
  console.log(`Timeout: ${TIMEOUT_MINUTES} minutes`);
  console.log(`Similarity threshold: ${SIMILARITY_THRESHOLD}`);
  console.log("");

  // Initial status
  const startStatus = await getStatus();
  console.log("📊 STARTING STATUS:");
  console.log(`   Total matches: ${startStatus.total.toLocaleString()}`);
  console.log(
    `   Home linked: ${startStatus.homeLinked.toLocaleString()} (${((startStatus.homeLinked / startStatus.total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `   Away linked: ${startStatus.awayLinked.toLocaleString()} (${((startStatus.awayLinked / startStatus.total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `   Fully linked: ${startStatus.fullyLinked.toLocaleString()} (${((startStatus.fullyLinked / startStatus.total) * 100).toFixed(1)}%)`,
  );
  console.log("");

  // Build team lookup cache
  const cache = await buildTeamCache();
  console.log("");

  // Process home teams
  console.log("🏠 Processing HOME teams...");
  const homeLinked = await processField("home", cache);
  console.log("");

  // Check for timeout
  if (shouldExit()) {
    console.log("⏱️ Timeout approaching - will continue away teams next run");
  } else {
    // Process away teams
    console.log("🚗 Processing AWAY teams...");
    const awayLinked = await processField("away", cache);
    console.log("");
  }

  // Final status
  const endStatus = await getStatus();
  const elapsed = getElapsedMinutes().toFixed(1);

  console.log("=".repeat(60));
  console.log("📊 FINAL STATUS:");
  console.log("=".repeat(60));
  console.log(`   Total matches: ${endStatus.total.toLocaleString()}`);
  console.log(
    `   Home linked: ${endStatus.homeLinked.toLocaleString()} (${((endStatus.homeLinked / endStatus.total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `   Away linked: ${endStatus.awayLinked.toLocaleString()} (${((endStatus.awayLinked / endStatus.total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `   Fully linked: ${endStatus.fullyLinked.toLocaleString()} (${((endStatus.fullyLinked / endStatus.total) * 100).toFixed(1)}%)`,
  );
  console.log("");
  console.log("📈 SESSION IMPROVEMENT:");
  console.log(
    `   Home: +${(endStatus.homeLinked - startStatus.homeLinked).toLocaleString()}`,
  );
  console.log(
    `   Away: +${(endStatus.awayLinked - startStatus.awayLinked).toLocaleString()}`,
  );
  console.log(
    `   Fully linked: +${(endStatus.fullyLinked - startStatus.fullyLinked).toLocaleString()}`,
  );
  console.log(`   Elapsed time: ${elapsed} minutes`);
  console.log("=".repeat(60));
  console.log("✅ Done!");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
