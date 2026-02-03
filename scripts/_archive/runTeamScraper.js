/**
 * runTeamScraper.js v3.0 - BULLETPROOF Team-Centric Data Collection
 *
 * PURPOSE: Query each team's match history to discover events and collect scheduled matches
 *
 * KEY IMPROVEMENT IN v3.0:
 * - SKIP AND CONTINUE: Failed teams are logged and skipped, NEVER stops the run
 * - Failed teams logged to .failed_teams.json for later retry
 * - Unified error handling at team level - no silent crashes
 *
 * FEATURES:
 * - Retry logic: 3 retries per request with exponential backoff
 * - Checkpointing: Saves progress every 500 teams to resume on crash
 * - Rate limit handling: 30s wait on HTTP 429
 * - Time-based exit: Clean exit at configurable timeout
 * - 3-Year filter: Only processes matches from 2023-01-01 forward
 * - Batch inserts: Bulk database operations for efficiency
 * - Failed team tracking: Logs all failures for later analysis
 *
 * USAGE:
 *   node scripts/runTeamScraper.js                    # Start from beginning or resume from checkpoint
 *   node scripts/runTeamScraper.js --resume 77200    # Resume from specific team offset
 *   node scripts/runTeamScraper.js --reset           # Clear checkpoint and start fresh
 *
 * @version 3.0.0
 * @date January 19, 2026
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// ES Module path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Supabase connection
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,

  // Processing limits
  BATCH_SIZE: 50, // Teams per batch for DB operations
  CHECKPOINT_INTERVAL: 500, // Save checkpoint every N teams
  MAX_TEAMS_PER_RUN: 50000, // Max teams to process in one run (safety limit)

  // Timing
  REQUEST_DELAY_MS: 100, // Delay between API requests (rate limiting)
  TIMEOUT_MINUTES: 110, // Exit cleanly before GitHub's 120 min timeout

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 5000, // Initial retry delay (doubles each retry)
  RATE_LIMIT_DELAY_MS: 30000, // Wait time on 429 response

  // Data policy
  MIN_DATE: "2023-01-01", // 3-year data policy - no data before this date

  // Files
  CHECKPOINT_FILE: path.join(__dirname, ".team_scraper_checkpoint.json"),
  FAILED_TEAMS_FILE: path.join(__dirname, ".failed_teams.json"),
};

// Validate configuration
if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
  console.error(
    "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment",
  );
  process.exit(1);
}

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// ============================================================================
// STATISTICS TRACKING
// ============================================================================

const stats = {
  startTime: Date.now(),
  teamsProcessed: 0,
  teamsSkipped: 0,
  teamsFailed: 0,
  eventsDiscovered: 0,
  eventsInserted: 0,
  scheduledMatchesFound: 0,
  scheduledMatchesInserted: 0,
  pastMatchesFound: 0,
  requestsMade: 0,
  retriesPerformed: 0,
  rateLimitsHit: 0,
};

// Track failed teams for later retry
const failedTeams = [];

// ============================================================================
// CHECKPOINT MANAGEMENT
// ============================================================================

function loadCheckpoint() {
  try {
    if (fs.existsSync(CONFIG.CHECKPOINT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.CHECKPOINT_FILE, "utf8"));
      console.log(
        `📁 Loaded checkpoint: offset=${data.offset}, lastTeamId=${data.lastTeamId}`,
      );
      return data;
    }
  } catch (err) {
    console.warn("⚠️ Could not load checkpoint:", err.message);
  }
  return { offset: 0, lastTeamId: null, lastRun: null };
}

function saveCheckpoint(offset, lastTeamId) {
  const checkpoint = {
    offset,
    lastTeamId,
    lastRun: new Date().toISOString(),
    stats: { ...stats },
  };
  try {
    fs.writeFileSync(
      CONFIG.CHECKPOINT_FILE,
      JSON.stringify(checkpoint, null, 2),
    );
    console.log(`💾 Checkpoint saved: offset=${offset}, team=${lastTeamId}`);
  } catch (err) {
    console.error("⚠️ Failed to save checkpoint:", err.message);
  }
}

function clearCheckpoint() {
  try {
    if (fs.existsSync(CONFIG.CHECKPOINT_FILE)) {
      fs.unlinkSync(CONFIG.CHECKPOINT_FILE);
      console.log("🗑️ Checkpoint cleared");
    }
  } catch (err) {
    console.warn("⚠️ Could not clear checkpoint:", err.message);
  }
}

function saveFailedTeams() {
  if (failedTeams.length === 0) return;

  try {
    // Load existing failed teams and merge
    let existingFailed = [];
    if (fs.existsSync(CONFIG.FAILED_TEAMS_FILE)) {
      existingFailed = JSON.parse(
        fs.readFileSync(CONFIG.FAILED_TEAMS_FILE, "utf8"),
      );
    }

    const allFailed = [...existingFailed, ...failedTeams];
    fs.writeFileSync(
      CONFIG.FAILED_TEAMS_FILE,
      JSON.stringify(allFailed, null, 2),
    );
    console.log(
      `📝 Saved ${failedTeams.length} failed teams to ${CONFIG.FAILED_TEAMS_FILE}`,
    );
  } catch (err) {
    console.error("⚠️ Failed to save failed teams log:", err.message);
  }
}

// ============================================================================
// RETRY-ENABLED FETCH (Returns null on failure instead of throwing)
// ============================================================================

async function fetchWithRetry(url, options = {}, retryCount = 0) {
  stats.requestsMade++;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "User-Agent": "SoccerView/3.0 TeamScraper",
        ...options.headers,
      },
    });

    // Handle rate limiting
    if (response.status === 429) {
      stats.rateLimitsHit++;
      console.log(
        `⏳ Rate limited (429). Waiting ${CONFIG.RATE_LIMIT_DELAY_MS / 1000}s...`,
      );
      await sleep(CONFIG.RATE_LIMIT_DELAY_MS);
      return fetchWithRetry(url, options, retryCount);
    }

    // Handle server errors with retry
    if (response.status >= 500 && retryCount < CONFIG.MAX_RETRIES) {
      stats.retriesPerformed++;
      const delay = CONFIG.RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(
        `⚠️ Server error ${response.status}. Retry ${retryCount + 1}/${CONFIG.MAX_RETRIES} in ${delay / 1000}s...`,
      );
      await sleep(delay);
      return fetchWithRetry(url, options, retryCount + 1);
    }

    // After all retries exhausted, return null instead of throwing
    if (!response.ok) {
      return {
        error: `HTTP ${response.status}: ${response.statusText}`,
        data: null,
      };
    }

    const data = await response.json();
    return { error: null, data };
  } catch (err) {
    // Network errors - retry with backoff
    if (retryCount < CONFIG.MAX_RETRIES) {
      stats.retriesPerformed++;
      const delay = CONFIG.RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(
        `⚠️ Network error: ${err.message}. Retry ${retryCount + 1}/${CONFIG.MAX_RETRIES} in ${delay / 1000}s...`,
      );
      await sleep(delay);
      return fetchWithRetry(url, options, retryCount + 1);
    }
    // Return null with error instead of throwing
    return { error: err.message, data: null };
  }
}

// ============================================================================
// GOTSPORT API FUNCTIONS
// ============================================================================

async function fetchTeamAwards(gotsportTeamId) {
  const url = `https://system.gotsport.com/api/v1/ranking_team_awards?team_id=${gotsportTeamId}`;
  const result = await fetchWithRetry(url);

  if (result.error) {
    console.error(
      `  ❌ Awards fetch failed for team ${gotsportTeamId}: ${result.error}`,
    );
    return null;
  }
  return result.data;
}

async function fetchTeamDetails(gotsportTeamId) {
  const url = `https://system.gotsport.com/api/v1/team_ranking_data/team_details?team_id=${gotsportTeamId}`;
  const result = await fetchWithRetry(url);

  if (result.error) {
    console.error(
      `  ❌ Details fetch failed for team ${gotsportTeamId}: ${result.error}`,
    );
    return null;
  }
  return result.data;
}

// ============================================================================
// DATA EXTRACTION
// ============================================================================

function extractEventsFromAwards(awards, teamId) {
  const events = new Map();

  if (!awards?.data) return [];

  for (const award of awards.data) {
    const eventId = award.event_id;
    if (!eventId || events.has(eventId)) continue;

    // Check date filter (3-year policy)
    const awardDate = award.date || award.event_date;
    if (awardDate && awardDate < CONFIG.MIN_DATE) continue;

    events.set(eventId, {
      event_id: eventId,
      event_name: award.event_name || "Unknown Event",
      source_type: award.event_type === "League" ? "league" : "tournament",
      source_platform: "gotsport",
      discovered_from_team_id: teamId,
      discovered_at: new Date().toISOString(),
    });
  }

  return Array.from(events.values());
}

function extractScheduledMatch(details, team) {
  if (!details?.data?.game_next) return null;

  const next = details.data.game_next;
  if (!next.date || !next.opponent) return null;

  // Check date filter
  if (next.date < CONFIG.MIN_DATE) return null;

  return {
    event_id: next.event_id || null,
    event_name: next.event_name || null,
    match_date: next.date,
    home_team_name: next.home_away === "Home" ? team.team_name : next.opponent,
    away_team_name: next.home_away === "Away" ? team.team_name : next.opponent,
    home_team_id: next.home_away === "Home" ? team.id : null,
    away_team_id: next.home_away === "Away" ? team.id : null,
    source_platform: "gotsport",
    source_type: "scheduled",
  };
}

function countPastMatches(awards) {
  if (!awards?.data) return 0;

  let count = 0;
  for (const award of awards.data) {
    // Check date filter
    const awardDate = award.date || award.event_date;
    if (awardDate && awardDate < CONFIG.MIN_DATE) continue;

    count += (award.wins || 0) + (award.losses || 0) + (award.draws || 0);
  }
  return count;
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function saveEvents(events) {
  if (events.length === 0) return 0;

  try {
    const { data, error } = await supabase
      .from("event_registry")
      .upsert(events, { onConflict: "event_id", ignoreDuplicates: true });

    if (error) {
      console.error("  ⚠️ Event save error:", error.message);
      return 0;
    }

    return events.length;
  } catch (err) {
    console.error("  ⚠️ Event save exception:", err.message);
    return 0;
  }
}

async function saveScheduledMatches(matches) {
  if (matches.length === 0) return 0;

  try {
    // Create a unique key for deduplication
    const matchesWithKey = matches.map((m) => ({
      ...m,
      match_key: `${m.match_date}_${m.home_team_name}_${m.away_team_name}`,
    }));

    const { data, error } = await supabase
      .from("match_results")
      .upsert(matchesWithKey, {
        onConflict: "match_key",
        ignoreDuplicates: true,
      });

    if (error) {
      console.error("  ⚠️ Scheduled match save error:", error.message);
      return 0;
    }

    return matches.length;
  } catch (err) {
    console.error("  ⚠️ Scheduled match save exception:", err.message);
    return 0;
  }
}

// ============================================================================
// TEAM PROCESSING (With bulletproof error handling)
// ============================================================================

async function processTeam(team) {
  const teamId = team.gotsport_team_id;

  // Fetch both endpoints - handle failures gracefully
  let awards = null;
  let details = null;

  try {
    awards = await fetchTeamAwards(teamId);
  } catch (err) {
    console.error(
      `  ❌ Unexpected error fetching awards for team ${teamId}: ${err.message}`,
    );
  }

  try {
    details = await fetchTeamDetails(teamId);
  } catch (err) {
    console.error(
      `  ❌ Unexpected error fetching details for team ${teamId}: ${err.message}`,
    );
  }

  // If BOTH failed, mark as failed but still return empty result
  if (awards === null && details === null) {
    return { events: [], scheduledMatch: null, pastMatches: 0, failed: true };
  }

  // Extract data (these functions handle null inputs safely)
  const events = extractEventsFromAwards(awards, team.id);
  const scheduledMatch = extractScheduledMatch(details, team);
  const pastMatchCount = countPastMatches(awards);

  return { events, scheduledMatch, pastMatches: pastMatchCount, failed: false };
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getElapsedMinutes() {
  return (Date.now() - stats.startTime) / 60000;
}

function shouldExit() {
  return getElapsedMinutes() >= CONFIG.TIMEOUT_MINUTES;
}

function printProgress(current, total) {
  const elapsed = getElapsedMinutes().toFixed(1);
  const pct = ((current / total) * 100).toFixed(1);
  const rate = (stats.teamsProcessed / (elapsed || 1)).toFixed(1);

  console.log(
    `\n📊 Progress: ${current.toLocaleString()}/${total.toLocaleString()} (${pct}%)`,
  );
  console.log(`   ⏱️ Elapsed: ${elapsed} min | Rate: ${rate} teams/min`);
  console.log(
    `   📋 Events: ${stats.eventsDiscovered} discovered, ${stats.eventsInserted} new`,
  );
  console.log(
    `   📅 Scheduled: ${stats.scheduledMatchesFound} found, ${stats.scheduledMatchesInserted} new`,
  );
  console.log(
    `   🏆 Past matches: ${stats.pastMatchesFound.toLocaleString()} (within 3-year window)`,
  );
  console.log(
    `   🔄 Retries: ${stats.retriesPerformed} | Rate limits: ${stats.rateLimitsHit}`,
  );
  console.log(`   ❌ Failed teams: ${stats.teamsFailed} (logged for retry)`);
}

function printFinalStats(exitReason) {
  const elapsed = getElapsedMinutes().toFixed(2);

  console.log("\n" + "=".repeat(60));
  console.log(`🏁 RUN ${exitReason}`);
  console.log("=".repeat(60));
  console.log(`⏱️ Total runtime: ${elapsed} minutes`);
  console.log(`👥 Teams processed: ${stats.teamsProcessed.toLocaleString()}`);
  console.log(`⏭️ Teams skipped: ${stats.teamsSkipped}`);
  console.log(
    `❌ Teams failed: ${stats.teamsFailed} (${((stats.teamsFailed / stats.teamsProcessed) * 100).toFixed(2)}%)`,
  );
  console.log(`📋 Events discovered: ${stats.eventsDiscovered}`);
  console.log(`📋 Events inserted: ${stats.eventsInserted}`);
  console.log(`📅 Scheduled matches found: ${stats.scheduledMatchesFound}`);
  console.log(
    `📅 Scheduled matches inserted: ${stats.scheduledMatchesInserted}`,
  );
  console.log(
    `🏆 Past matches found: ${stats.pastMatchesFound.toLocaleString()} (3-year window)`,
  );
  console.log(`🌐 API requests: ${stats.requestsMade.toLocaleString()}`);
  console.log(`🔄 Retries: ${stats.retriesPerformed}`);
  console.log(`⚠️ Rate limits hit: ${stats.rateLimitsHit}`);

  if (stats.teamsFailed > 0) {
    console.log(`\n📝 Failed teams logged to: ${CONFIG.FAILED_TEAMS_FILE}`);
    console.log(`   Run with these team IDs later to retry them`);
  }

  console.log("=".repeat(60));
}

async function main() {
  console.log("\n🚀 SoccerView Team Scraper v3.0 - BULLETPROOF EDITION");
  console.log("=====================================================");
  console.log(`⏱️ Timeout: ${CONFIG.TIMEOUT_MINUTES} minutes`);
  console.log(`📊 Checkpoint interval: ${CONFIG.CHECKPOINT_INTERVAL} teams`);
  console.log(`📆 3-Year Policy: Only data from ${CONFIG.MIN_DATE} forward`);
  console.log(`🛡️ Failed teams will be SKIPPED and logged for later retry`);

  // Parse command line arguments
  const args = process.argv.slice(2);
  let startOffset = 0;

  if (args.includes("--reset")) {
    clearCheckpoint();
    console.log("🔄 Starting fresh (checkpoint cleared)");
  } else if (args.includes("--resume")) {
    const resumeIdx = args.indexOf("--resume");
    if (args[resumeIdx + 1]) {
      startOffset = parseInt(args[resumeIdx + 1], 10);
      console.log(`▶️ Manual resume from offset: ${startOffset}`);
    }
  } else {
    // Try to load checkpoint
    const checkpoint = loadCheckpoint();
    if (checkpoint.offset > 0) {
      startOffset = checkpoint.offset;
      console.log(`▶️ Resuming from checkpoint: offset ${startOffset}`);
    }
  }

  // Get total team count
  const { count: totalTeams, error: countError } = await supabase
    .from("team_elo")
    .select("*", { count: "exact", head: true })
    .not("gotsport_team_id", "is", null);

  if (countError) {
    console.error("❌ Failed to get team count:", countError.message);
    process.exit(1);
  }

  console.log(
    `\n📈 Total teams with GotSport IDs: ${totalTeams.toLocaleString()}`,
  );
  console.log(`📍 Starting from offset: ${startOffset}`);
  console.log(
    `🎯 Teams remaining: ${Math.max(0, totalTeams - startOffset).toLocaleString()}`,
  );

  let currentOffset = startOffset;
  let batchEvents = [];
  let batchScheduledMatches = [];
  let exitReason = "COMPLETE";

  // Main processing loop
  while (currentOffset < totalTeams) {
    // Check timeout
    if (shouldExit()) {
      exitReason = "TIMEOUT - Clean exit before GitHub limit";
      saveCheckpoint(currentOffset, null);
      break;
    }

    // Check max teams per run
    if (stats.teamsProcessed >= CONFIG.MAX_TEAMS_PER_RUN) {
      exitReason = `MAX_TEAMS (${CONFIG.MAX_TEAMS_PER_RUN}) - Split run`;
      saveCheckpoint(currentOffset, null);
      break;
    }

    // Fetch batch of teams
    let teams;
    try {
      const { data, error: fetchError } = await supabase
        .from("team_elo")
        .select("id, team_name, gotsport_team_id, gender, age_group, state")
        .not("gotsport_team_id", "is", null)
        .order("id")
        .range(currentOffset, currentOffset + CONFIG.BATCH_SIZE - 1);

      if (fetchError) {
        console.error(
          `❌ Error fetching teams at offset ${currentOffset}:`,
          fetchError.message,
        );
        stats.teamsFailed += CONFIG.BATCH_SIZE;
        currentOffset += CONFIG.BATCH_SIZE;
        continue;
      }

      teams = data;
    } catch (err) {
      console.error(`❌ Unexpected error fetching team batch: ${err.message}`);
      stats.teamsFailed += CONFIG.BATCH_SIZE;
      currentOffset += CONFIG.BATCH_SIZE;
      continue;
    }

    if (!teams || teams.length === 0) {
      console.log("📭 No more teams to process");
      break;
    }

    // Process each team in the batch
    for (const team of teams) {
      // BULLETPROOF: Wrap ENTIRE team processing in try-catch
      try {
        const result = await processTeam(team);

        // Track if this team failed
        if (result.failed) {
          stats.teamsFailed++;
          failedTeams.push({
            teamId: team.id,
            gotsportTeamId: team.gotsport_team_id,
            teamName: team.team_name,
            failedAt: new Date().toISOString(),
            reason: "Both awards and details fetch failed",
          });
          // CONTINUE TO NEXT TEAM - don't stop!
          stats.teamsProcessed++;
          continue;
        }

        // Accumulate results
        if (result.events.length > 0) {
          batchEvents.push(...result.events);
          stats.eventsDiscovered += result.events.length;
        }

        if (result.scheduledMatch) {
          batchScheduledMatches.push(result.scheduledMatch);
          stats.scheduledMatchesFound++;
        }

        stats.pastMatchesFound += result.pastMatches;
        stats.teamsProcessed++;

        // Rate limiting delay
        await sleep(CONFIG.REQUEST_DELAY_MS);
      } catch (err) {
        // CATCH-ALL: Log error, record failure, and CONTINUE
        console.error(
          `  ❌ UNEXPECTED error processing team ${team.id} (${team.team_name}): ${err.message}`,
        );
        stats.teamsFailed++;
        stats.teamsProcessed++;
        failedTeams.push({
          teamId: team.id,
          gotsportTeamId: team.gotsport_team_id,
          teamName: team.team_name,
          failedAt: new Date().toISOString(),
          reason: err.message,
        });
        // CONTINUE - never stop the run for a single team failure
      }
    }

    currentOffset += teams.length;

    // Save batched data periodically
    if (batchEvents.length >= 100 || batchScheduledMatches.length >= 50) {
      if (batchEvents.length > 0) {
        const inserted = await saveEvents(batchEvents);
        stats.eventsInserted += inserted;
        batchEvents = [];
      }

      if (batchScheduledMatches.length > 0) {
        const inserted = await saveScheduledMatches(batchScheduledMatches);
        stats.scheduledMatchesInserted += inserted;
        batchScheduledMatches = [];
      }
    }

    // Checkpoint and progress report
    if (stats.teamsProcessed % CONFIG.CHECKPOINT_INTERVAL === 0) {
      saveCheckpoint(currentOffset, teams[teams.length - 1]?.id);
      saveFailedTeams(); // Also save failed teams log
      printProgress(currentOffset, totalTeams);
    }
  }

  // Final batch save
  if (batchEvents.length > 0) {
    const inserted = await saveEvents(batchEvents);
    stats.eventsInserted += inserted;
  }

  if (batchScheduledMatches.length > 0) {
    const inserted = await saveScheduledMatches(batchScheduledMatches);
    stats.scheduledMatchesInserted += inserted;
  }

  // Save failed teams log
  saveFailedTeams();

  // Clear checkpoint if completed successfully
  if (exitReason === "COMPLETE") {
    clearCheckpoint();
  }

  printFinalStats(exitReason);
}

// Run with error handling
main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err);
  saveCheckpoint(stats.teamsProcessed, null);
  saveFailedTeams();
  printFinalStats("FATAL ERROR - " + err.message);
  process.exit(1);
});
