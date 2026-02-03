/**
 * IMPROVED Team Linking Script v4.0
 * 
 * FIXES: Previous version only fetched 50K rows, missing 150K+ unique team names.
 * This version uses proper pagination and batching.
 * 
 * Usage:
 *   node scripts/linkTeamsV2.js
 *   node scripts/linkTeamsV2.js --batch=10000   # Custom batch size
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Parse CLI args
const args = process.argv.slice(2);
const batchArg = args.find(a => a.startsWith("--batch="));
const BATCH_SIZE = batchArg ? parseInt(batchArg.split("=")[1]) : 5000;

const SIMILARITY_THRESHOLD = 0.4;
const startTime = Date.now();

function elapsed() {
  return ((Date.now() - startTime) / 60000).toFixed(1);
}

/**
 * Get linking status
 */
async function getStatus() {
  const { count: total } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true });

  const { count: fullyLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null);

  const { count: homeLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("home_team_id", "is", null);

  const { count: awayLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("away_team_id", "is", null);

  return {
    total: total || 0,
    fullyLinked: fullyLinked || 0,
    homeLinked: homeLinked || 0,
    awayLinked: awayLinked || 0
  };
}

/**
 * Get ALL unique unlinked names using pagination
 */
async function getAllUniqueNames(field) {
  const column = field === "home" ? "home_team_id" : "away_team_id";
  const nameCol = field === "home" ? "home_team_name" : "away_team_name";
  
  const uniqueNames = new Set();
  let offset = 0;
  const pageSize = 50000;
  let hasMore = true;
  
  console.log(`   Fetching all unique ${field} team names (paginated)...`);
  
  while (hasMore) {
    const { data, error } = await supabase
      .from("match_results")
      .select(nameCol)
      .is(column, null)
      .not(nameCol, "is", null)
      .range(offset, offset + pageSize - 1);
    
    if (error) {
      console.error(`   Error fetching page at offset ${offset}:`, error.message);
      break;
    }
    
    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }
    
    data.forEach(row => {
      const name = row[nameCol];
      if (name && name.trim()) {
        uniqueNames.add(name.trim());
      }
    });
    
    offset += pageSize;
    process.stdout.write(`   Fetched ${offset.toLocaleString()} rows, ${uniqueNames.size.toLocaleString()} unique names...\r`);
    
    if (data.length < pageSize) {
      hasMore = false;
    }
    
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`   Found ${uniqueNames.size.toLocaleString()} unique unlinked ${field} names`);
  return Array.from(uniqueNames);
}

/**
 * Build team lookup cache
 */
async function buildTeamCache() {
  console.log("📦 Building team lookup cache...");
  
  const allTeams = [];
  let offset = 0;
  const batchSize = 10000;
  
  while (true) {
    const { data, error } = await supabase
      .from("team_elo")
      .select("id, team_name")
      .range(offset, offset + batchSize - 1);
    
    if (error) {
      console.error("   Error loading teams:", error.message);
      break;
    }
    
    if (!data || data.length === 0) break;
    
    allTeams.push(...data);
    offset += batchSize;
    
    if (data.length < batchSize) break;
  }
  
  console.log(`   Loaded ${allTeams.toLocaleString()} teams into cache`);
  
  // Build exact match map (lowercase)
  const exactMap = new Map();
  for (const team of allTeams) {
    if (team.team_name) {
      const key = team.team_name.toLowerCase().trim();
      if (!exactMap.has(key)) {
        exactMap.set(key, team);
      }
    }
  }
  
  return { allTeams, exactMap };
}

/**
 * Simple bigram similarity (Dice coefficient)
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
  try {
    const { data, error } = await supabase.rpc("find_similar_team", {
      search_name: teamName.toLowerCase().trim()
    });
    
    if (error || !data || data.length === 0) return null;
    return data[0];
  } catch {
    return null;
  }
}

/**
 * Find best match using local cache
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
 * Process a batch of names
 */
async function processBatch(names, field, cache, stats) {
  const column = field === "home" ? "home_team_id" : "away_team_id";
  const nameCol = field === "home" ? "home_team_name" : "away_team_name";
  
  for (const teamName of names) {
    // Try local cache first
    let match = findBestMatchLocal(teamName, cache);
    
    // If not found locally, try RPC
    if (!match) {
      match = await findBestMatchRPC(teamName);
    }
    
    if (match && match.sim >= SIMILARITY_THRESHOLD) {
      // Bulk update all matches with this name
      const { error } = await supabase
        .from("match_results")
        .update({ [column]: match.id })
        .eq(nameCol, teamName)
        .is(column, null);
      
      if (!error) {
        stats.linked++;
      } else {
        stats.errors++;
      }
    } else {
      stats.notFound++;
    }
    
    stats.processed++;
  }
}

/**
 * Process a field (home or away)
 */
async function processField(field, cache) {
  console.log(`\n${"🏠" === field ? "🏠" : "🚗"} Processing ${field.toUpperCase()} teams...`);
  
  const uniqueNames = await getAllUniqueNames(field);
  
  if (uniqueNames.length === 0) {
    console.log("   No unlinked names found!");
    return { linked: 0, notFound: 0, errors: 0 };
  }
  
  const stats = { processed: 0, linked: 0, notFound: 0, errors: 0 };
  const totalBatches = Math.ceil(uniqueNames.length / BATCH_SIZE);
  
  console.log(`   Processing ${uniqueNames.length.toLocaleString()} names in ${totalBatches} batches...`);
  
  for (let i = 0; i < uniqueNames.length; i += BATCH_SIZE) {
    const batch = uniqueNames.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    
    await processBatch(batch, field, cache, stats);
    
    const pct = ((stats.processed / uniqueNames.length) * 100).toFixed(1);
    console.log(`   Batch ${batchNum}/${totalBatches} | Progress: ${stats.processed.toLocaleString()}/${uniqueNames.length.toLocaleString()} (${pct}%) | Linked: ${stats.linked.toLocaleString()} | Elapsed: ${elapsed()}m`);
    
    // Small delay between batches
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`   ✅ Completed: ${stats.linked.toLocaleString()} linked, ${stats.notFound.toLocaleString()} not found, ${stats.errors} errors`);
  
  return stats;
}

/**
 * Main execution
 */
async function main() {
  console.log("=".repeat(60));
  console.log("🔗 TEAM LINKING v4.0 - FULL COVERAGE EDITION");
  console.log("=".repeat(60));
  console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}`);
  console.log(`Similarity threshold: ${SIMILARITY_THRESHOLD}`);
  console.log("");
  
  // Initial status
  const startStatus = await getStatus();
  console.log("📊 STARTING STATUS:");
  console.log(`   Total matches: ${startStatus.total.toLocaleString()}`);
  console.log(`   Fully linked: ${startStatus.fullyLinked.toLocaleString()} (${((startStatus.fullyLinked / startStatus.total) * 100).toFixed(1)}%)`);
  console.log(`   Home linked: ${startStatus.homeLinked.toLocaleString()} (${((startStatus.homeLinked / startStatus.total) * 100).toFixed(1)}%)`);
  console.log(`   Away linked: ${startStatus.awayLinked.toLocaleString()} (${((startStatus.awayLinked / startStatus.total) * 100).toFixed(1)}%)`);
  
  // Build cache
  const cache = await buildTeamCache();
  
  // Process both fields
  const homeStats = await processField("home", cache);
  const awayStats = await processField("away", cache);
  
  // Final status
  const endStatus = await getStatus();
  
  console.log("\n" + "=".repeat(60));
  console.log("📊 FINAL STATUS:");
  console.log("=".repeat(60));
  console.log(`   Total matches: ${endStatus.total.toLocaleString()}`);
  console.log(`   Fully linked: ${endStatus.fullyLinked.toLocaleString()} (${((endStatus.fullyLinked / endStatus.total) * 100).toFixed(1)}%)`);
  console.log(`   Home linked: ${endStatus.homeLinked.toLocaleString()} (${((endStatus.homeLinked / endStatus.total) * 100).toFixed(1)}%)`);
  console.log(`   Away linked: ${endStatus.awayLinked.toLocaleString()} (${((endStatus.awayLinked / endStatus.total) * 100).toFixed(1)}%)`);
  console.log("");
  console.log("📈 SESSION IMPROVEMENT:");
  console.log(`   Fully linked: +${(endStatus.fullyLinked - startStatus.fullyLinked).toLocaleString()}`);
  console.log(`   Home: +${(endStatus.homeLinked - startStatus.homeLinked).toLocaleString()}`);
  console.log(`   Away: +${(endStatus.awayLinked - startStatus.awayLinked).toLocaleString()}`);
  console.log(`   Total time: ${elapsed()} minutes`);
  console.log("=".repeat(60));
  console.log("✅ Done!");
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
