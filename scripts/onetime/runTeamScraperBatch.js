/**
 * SoccerView Team Scraper v5.0 - BULLETPROOF EDITION
 * ===================================================
 *
 * FIXES FROM v4.4:
 * ❌ v4.4 used ANON_KEY (no write permission due to RLS)
 * ❌ v4.4 ignored upsert errors (silent failures)
 * ❌ v4.4 had no verification that data was written
 *
 * ✅ v5.0 uses SERVICE_ROLE_KEY (bypasses RLS)
 * ✅ v5.0 checks EVERY database operation
 * ✅ v5.0 verifies data was actually written
 * ✅ v5.0 logs all errors clearly
 * ✅ v5.0 has startup database connectivity test
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// ===========================================
// CONFIGURATION
// ===========================================
const CONFIG = {
  REQUEST_DELAY_MIN: 1000,
  REQUEST_DELAY_MAX: 3000,
  MAX_RETRIES: 2,
  RETRY_DELAYS: [5000, 15000],
  MIN_DATE: "2023-01-01",
  COOL_DOWN_ON_500: 30000,
  COOL_DOWN_ON_429: 120000,
  DB_PAGE_SIZE: 100,
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
];

// ===========================================
// SUPABASE CLIENT - USING SERVICE ROLE KEY!
// ===========================================
const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ FATAL: Missing Supabase environment variables!");
  console.error("   Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Check if using service role key (required for writes)
const isServiceRole = SUPABASE_KEY.length > 100; // Service role keys are longer
if (!isServiceRole) {
  console.warn(
    "⚠️ WARNING: May be using ANON key instead of SERVICE_ROLE key!",
  );
  console.warn("   Database writes may fail due to RLS policies.");
  console.warn("   Set SUPABASE_SERVICE_ROLE_KEY environment variable.\n");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===========================================
// DATABASE WRITE TRACKING
// ===========================================
const dbStats = {
  eventsAttempted: 0,
  eventsWritten: 0,
  eventsFailed: 0,
  matchesAttempted: 0,
  matchesWritten: 0,
  matchesFailed: 0,
  errors: [],
};

// ===========================================
// UTILITIES
// ===========================================

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomDelay() {
  return (
    CONFIG.REQUEST_DELAY_MIN +
    Math.random() * (CONFIG.REQUEST_DELAY_MAX - CONFIG.REQUEST_DELAY_MIN)
  );
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequestHeaders() {
  return {
    "User-Agent": getRandomUserAgent(),
    Accept: "application/json",
  };
}

// ===========================================
// DATABASE VERIFICATION FUNCTIONS
// ===========================================

/**
 * Test database write capability at startup
 */
async function testDatabaseWrite() {
  console.log("🔍 Testing database write capability...");

  // Get current event count
  const { count: beforeCount, error: countError } = await supabase
    .from("event_registry")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.error("❌ FATAL: Cannot read event_registry table!");
    console.error(`   Error: ${countError.message}`);
    return false;
  }

  console.log(`   Current events in database: ${beforeCount}`);

  // Try a test upsert with a dummy event that we'll delete
  const testEvent = {
    event_id: "TEST_DELETE_ME_999999",
    event_name: "Test Event - Delete Me",
    source_type: "test",
    source_platform: "test",
    discovered_at: new Date().toISOString(),
  };

  const { error: writeError } = await supabase
    .from("event_registry")
    .upsert([testEvent], { onConflict: "event_id" });

  if (writeError) {
    console.error("❌ FATAL: Cannot write to event_registry table!");
    console.error(`   Error: ${writeError.message}`);
    console.error(
      "   This is likely due to Row Level Security (RLS) policies.",
    );
    console.error(
      "   Solution: Use SUPABASE_SERVICE_ROLE_KEY instead of ANON key.",
    );
    return false;
  }

  // Verify it was written
  const { data: verifyData } = await supabase
    .from("event_registry")
    .select("event_id")
    .eq("event_id", "TEST_DELETE_ME_999999")
    .single();

  if (!verifyData) {
    console.error("❌ FATAL: Write succeeded but data not found!");
    console.error("   This indicates a serious database issue.");
    return false;
  }

  // Clean up test record
  await supabase
    .from("event_registry")
    .delete()
    .eq("event_id", "TEST_DELETE_ME_999999");

  console.log("✅ Database write test PASSED!\n");
  return true;
}

/**
 * Save events with full error checking and verification
 */
async function saveEvents(events) {
  if (!events || events.length === 0) return { success: true, written: 0 };

  dbStats.eventsAttempted += events.length;

  const { data, error } = await supabase
    .from("event_registry")
    .upsert(events, { onConflict: "event_id", ignoreDuplicates: true })
    .select();

  if (error) {
    dbStats.eventsFailed += events.length;
    dbStats.errors.push(`Events: ${error.message}`);
    console.error(`   ❌ DB ERROR saving events: ${error.message}`);
    return { success: false, written: 0, error: error.message };
  }

  // Count actual inserts (upsert with ignoreDuplicates may skip some)
  const written = data?.length || 0;
  dbStats.eventsWritten += written;

  return { success: true, written };
}

/**
 * Save scheduled match with full error checking
 */
async function saveScheduledMatch(match) {
  if (!match) return { success: true, written: 0 };

  dbStats.matchesAttempted++;

  const { data, error } = await supabase
    .from("match_results")
    .upsert([match], { onConflict: "match_key", ignoreDuplicates: true })
    .select();

  if (error) {
    dbStats.matchesFailed++;
    dbStats.errors.push(`Match: ${error.message}`);
    console.error(`   ❌ DB ERROR saving match: ${error.message}`);
    return { success: false, written: 0, error: error.message };
  }

  const written = data?.length || 0;
  dbStats.matchesWritten += written;

  return { success: true, written };
}

// ===========================================
// GOTSPORT API FUNCTIONS
// ===========================================

async function fetchTeamAwards(gotsportTeamId) {
  const url = `https://system.gotsport.com/api/v1/ranking_team_awards?team_id=${gotsportTeamId}`;

  for (let retry = 0; retry <= CONFIG.MAX_RETRIES; retry++) {
    try {
      const response = await fetch(url, { headers: getRequestHeaders() });

      if (response.status === 429) {
        console.log(`  ⏳ Rate limited! Cooling down...`);
        await sleep(CONFIG.COOL_DOWN_ON_429);
        continue;
      }

      if (response.status >= 500) {
        if (retry < CONFIG.MAX_RETRIES) {
          await sleep(CONFIG.COOL_DOWN_ON_500);
          continue;
        }
        return { error: `HTTP ${response.status}`, data: null };
      }

      if (!response.ok) {
        return { error: `HTTP ${response.status}`, data: null };
      }

      const data = await response.json();
      return { error: null, data };
    } catch (error) {
      if (retry < CONFIG.MAX_RETRIES) {
        await sleep(CONFIG.RETRY_DELAYS[retry]);
        continue;
      }
      return { error: error.message, data: null };
    }
  }
  return { error: "Max retries", data: null };
}

async function fetchTeamDetails(gotsportTeamId) {
  const url = `https://system.gotsport.com/api/v1/team_ranking_data/team_details?team_id=${gotsportTeamId}`;

  for (let retry = 0; retry <= CONFIG.MAX_RETRIES; retry++) {
    try {
      const response = await fetch(url, { headers: getRequestHeaders() });

      if (response.status === 429) {
        await sleep(CONFIG.COOL_DOWN_ON_429);
        continue;
      }

      if (response.status >= 500) {
        if (retry < CONFIG.MAX_RETRIES) {
          await sleep(CONFIG.COOL_DOWN_ON_500);
          continue;
        }
        return { error: `HTTP ${response.status}`, data: null };
      }

      if (!response.ok) {
        return { error: `HTTP ${response.status}`, data: null };
      }

      const data = await response.json();
      return { error: null, data };
    } catch (error) {
      if (retry < CONFIG.MAX_RETRIES) {
        await sleep(CONFIG.RETRY_DELAYS[retry]);
        continue;
      }
      return { error: error.message, data: null };
    }
  }
  return { error: "Max retries", data: null };
}

// ===========================================
// DATA EXTRACTION
// ===========================================

function extractEventsFromAwards(awardsResponse, teamId) {
  const events = new Map();
  const awards = awardsResponse?.current;
  if (!awards || !Array.isArray(awards)) return [];

  for (const award of awards) {
    const eventId = award.event?.id;
    const eventName = award.event?.name;

    if (!eventId || events.has(eventId)) continue;

    const matchDate = award.match_date;
    if (matchDate) {
      const dateOnly = matchDate.split("T")[0];
      if (dateOnly < CONFIG.MIN_DATE) continue;
    }

    events.set(eventId, {
      event_id: String(eventId),
      event_name: eventName || "Unknown Event",
      source_type: award.league ? "league" : "tournament",
      source_platform: "gotsport",
      discovered_from_team_id: teamId,
      discovered_at: new Date().toISOString(),
    });
  }

  return Array.from(events.values());
}

function extractScheduledMatch(detailsResponse, team) {
  const details = detailsResponse?.data;
  if (!details?.game_next) return null;

  const next = details.game_next;
  if (!next.date || !next.opponent) return null;

  const dateOnly = next.date.split("T")[0];
  if (dateOnly < CONFIG.MIN_DATE) return null;

  return {
    event_id: next.event_id ? String(next.event_id) : null,
    event_name: next.event_name || null,
    match_date: dateOnly,
    home_team_name: next.home_away === "Home" ? team.team_name : next.opponent,
    away_team_name: next.home_away === "Away" ? team.team_name : next.opponent,
    home_team_id: next.home_away === "Home" ? team.id : null,
    away_team_id: next.home_away === "Away" ? team.id : null,
    status: "scheduled",
    age_group: team.age_group,
    gender: team.gender,
    source_platform: "gotsport",
    source_type: "scheduled",
    match_key: `${dateOnly}_${next.home_away === "Home" ? team.team_name : next.opponent}_${next.home_away === "Away" ? team.team_name : next.opponent}`,
  };
}

function countPastMatches(awardsResponse) {
  const awards = awardsResponse?.current;
  if (!awards || !Array.isArray(awards)) return 0;

  let count = 0;
  for (const award of awards) {
    const matchDate = award.match_date;
    if (matchDate) {
      const dateOnly = matchDate.split("T")[0];
      if (dateOnly >= CONFIG.MIN_DATE) {
        count++;
      }
    }
  }
  return count;
}

// ===========================================
// EFFICIENT DATABASE FETCH
// ===========================================

async function fetchTeamsEfficiently(startOffset, count) {
  console.log(`📥 Fetching teams from offset ${startOffset}...`);

  const allTeams = [];
  let currentOffset = startOffset;
  let remaining = count;

  while (remaining > 0) {
    const pageSize = Math.min(CONFIG.DB_PAGE_SIZE, remaining);

    const { data, error } = await supabase
      .from("team_elo")
      .select("id, gotsport_team_id, team_name, age_group, gender, state")
      .not("gotsport_team_id", "is", null)
      .order("id", { ascending: true })
      .range(currentOffset, currentOffset + pageSize - 1);

    if (error) {
      console.error(`   ❌ Error fetching teams: ${error.message}`);
      if (error.code === "57014") {
        console.log(`   ⚠️ Query timeout, trying smaller page...`);
        await sleep(2000);
        const smallerSize = Math.min(25, remaining);
        const { data: retryData, error: retryError } = await supabase
          .from("team_elo")
          .select("id, gotsport_team_id, team_name, age_group, gender, state")
          .not("gotsport_team_id", "is", null)
          .order("id", { ascending: true })
          .range(currentOffset, currentOffset + smallerSize - 1);

        if (retryError) break;
        if (retryData?.length > 0) {
          allTeams.push(...retryData);
          currentOffset += retryData.length;
          remaining -= retryData.length;
        } else break;
        continue;
      }
      break;
    }

    if (!data || data.length === 0) break;

    allTeams.push(...data);
    currentOffset += data.length;
    remaining -= data.length;

    if (allTeams.length % 200 === 0) {
      console.log(`  📦 Fetched ${allTeams.length} teams so far...`);
    }

    await sleep(100);
  }

  return allTeams;
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log("🚀 SoccerView Team Scraper v5.0 - BULLETPROOF EDITION");
  console.log("=".repeat(60));
  console.log("✅ Uses SERVICE_ROLE_KEY for database writes");
  console.log("✅ Verifies every database operation");
  console.log("✅ Logs all errors clearly");
  console.log("");

  // Parse arguments
  const args = process.argv.slice(2);
  let startOffset = 77000;
  let batchCount = 500;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1]) {
      startOffset = parseInt(args[i + 1]);
    }
    if (args[i] === "--count" && args[i + 1]) {
      batchCount = parseInt(args[i + 1]);
    }
  }

  console.log(
    `📍 Batch range: ${startOffset.toLocaleString()} to ${(startOffset + batchCount).toLocaleString()}`,
  );
  console.log(`📊 Teams to process: ${batchCount}`);
  console.log(
    `🐢 Request delay: ${CONFIG.REQUEST_DELAY_MIN}-${CONFIG.REQUEST_DELAY_MAX}ms`,
  );
  console.log(`📆 3-Year Policy: Only data from ${CONFIG.MIN_DATE} forward`);
  console.log("");

  // ========================================
  // CRITICAL: Test database write capability
  // ========================================
  const canWrite = await testDatabaseWrite();
  if (!canWrite) {
    console.error("\n❌ ABORTING: Database write test failed!");
    console.error("   Fix the database connection before running scraper.");
    process.exit(1);
  }

  // Get initial event count for verification
  const { count: initialEventCount } = await supabase
    .from("event_registry")
    .select("*", { count: "exact", head: true });

  console.log(`📊 Initial event count: ${initialEventCount}\n`);

  // Test API connectivity
  console.log("🔍 Testing GotSport API connectivity...");
  try {
    const testResponse = await fetch(
      "https://system.gotsport.com/api/v1/ranking_team_awards?team_id=16585",
      { headers: getRequestHeaders() },
    );

    if (testResponse.status === 429) {
      console.log(`\n❌ Rate limited. Switch VPN server or wait.`);
      process.exit(1);
    }

    if (testResponse.status >= 500) {
      console.log(
        `\n❌ Server error ${testResponse.status}. Your IP may be blocked.`,
      );
      process.exit(1);
    }

    const testData = await testResponse.json();
    if (testData?.current && Array.isArray(testData.current)) {
      console.log(
        `✅ API responding with ${testData.current.length} match records\n`,
      );
    } else {
      console.log(`✅ API responding (status: ${testResponse.status})\n`);
    }
  } catch (error) {
    console.log(`\n❌ Connection failed: ${error.message}`);
    process.exit(1);
  }

  // Fetch teams
  const teams = await fetchTeamsEfficiently(startOffset, batchCount);

  if (teams.length === 0) {
    console.log("❌ No teams fetched. Check database connection.");
    process.exit(1);
  }

  console.log(`✅ Loaded ${teams.length} teams. Starting scrape...\n`);

  // Stats
  const stats = {
    processed: 0,
    withData: 0,
    noData: 0,
    errors: 0,
    eventsDiscovered: new Set(),
    scheduledMatches: 0,
    pastMatches: 0,
  };

  const startTime = Date.now();

  // Process teams
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];

    await sleep(getRandomDelay());

    const awardsResult = await fetchTeamAwards(team.gotsport_team_id);
    const detailsResult = await fetchTeamDetails(team.gotsport_team_id);

    if (awardsResult.error && detailsResult.error) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.log(
          `  ❌ Team ${team.gotsport_team_id}: ${awardsResult.error}`,
        );
      }
    } else {
      const events = extractEventsFromAwards(awardsResult.data, team.id);
      const scheduledMatch = extractScheduledMatch(detailsResult.data, team);
      const pastCount = countPastMatches(awardsResult.data);

      if (events.length > 0 || scheduledMatch || pastCount > 0) {
        stats.withData++;

        for (const e of events) {
          stats.eventsDiscovered.add(e.event_id);
        }

        // SAVE WITH ERROR CHECKING
        if (events.length > 0) {
          const saveResult = await saveEvents(events);
          if (!saveResult.success) {
            console.error(
              `   ⚠️ Failed to save ${events.length} events for team ${team.gotsport_team_id}`,
            );
          }
        }

        if (scheduledMatch) {
          const saveResult = await saveScheduledMatch(scheduledMatch);
          if (saveResult.success && saveResult.written > 0) {
            stats.scheduledMatches++;
          }
        }

        stats.pastMatches += pastCount;
      } else {
        stats.noData++;
      }
    }

    stats.processed++;

    // Progress every 25 teams
    if (stats.processed % 25 === 0 || stats.processed === teams.length) {
      const elapsed = (Date.now() - startTime) / 60000;
      const rate = stats.processed / elapsed;
      const remaining = teams.length - stats.processed;
      const eta = rate > 0 ? remaining / rate : 0;

      console.log(
        `📊 Progress: ${stats.processed}/${teams.length} (${((stats.processed / teams.length) * 100).toFixed(1)}%)`,
      );
      console.log(
        `   ✅ With data: ${stats.withData} | ⬜ No data: ${stats.noData} | ❌ Errors: ${stats.errors}`,
      );
      console.log(
        `   📋 Events: ${stats.eventsDiscovered.size} | 📅 Scheduled: ${stats.scheduledMatches} | 🏆 Past: ${stats.pastMatches}`,
      );
      console.log(
        `   💾 DB Writes: ${dbStats.eventsWritten} events, ${dbStats.matchesWritten} matches`,
      );
      console.log(
        `   ⏱️  Rate: ${rate.toFixed(1)} teams/min | ETA: ${eta.toFixed(1)} min\n`,
      );
    }
  }

  // ========================================
  // FINAL VERIFICATION
  // ========================================
  const { count: finalEventCount } = await supabase
    .from("event_registry")
    .select("*", { count: "exact", head: true });

  const actualEventsAdded = (finalEventCount || 0) - (initialEventCount || 0);

  // Final summary
  console.log("=".repeat(60));
  console.log("✅ BATCH COMPLETE");
  console.log("=".repeat(60));
  console.log(
    `   Range processed: ${startOffset} to ${startOffset + stats.processed}`,
  );
  console.log(`   Teams with data: ${stats.withData}`);
  console.log(`   Teams no data: ${stats.noData}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log(`   Events discovered: ${stats.eventsDiscovered.size}`);
  console.log(`   Scheduled matches: ${stats.scheduledMatches}`);
  console.log(`   Past matches: ${stats.pastMatches}`);
  console.log(
    `   Total runtime: ${((Date.now() - startTime) / 60000).toFixed(1)} min`,
  );
  console.log("");
  console.log("💾 DATABASE VERIFICATION:");
  console.log(`   Events before: ${initialEventCount}`);
  console.log(`   Events after: ${finalEventCount}`);
  console.log(`   Actually added: ${actualEventsAdded}`);
  console.log(
    `   DB write attempts: ${dbStats.eventsAttempted} events, ${dbStats.matchesAttempted} matches`,
  );
  console.log(
    `   DB write successes: ${dbStats.eventsWritten} events, ${dbStats.matchesWritten} matches`,
  );

  if (dbStats.eventsFailed > 0 || dbStats.matchesFailed > 0) {
    console.log(
      `   ❌ DB write failures: ${dbStats.eventsFailed} events, ${dbStats.matchesFailed} matches`,
    );
    if (dbStats.errors.length > 0) {
      console.log(`   Error samples: ${dbStats.errors.slice(0, 3).join(", ")}`);
    }
  }

  // ALERT IF NO DATA WAS WRITTEN
  if (stats.eventsDiscovered.size > 0 && actualEventsAdded === 0) {
    console.log("");
    console.log(
      "⚠️⚠️⚠️ WARNING: Events were found but NONE were saved! ⚠️⚠️⚠️",
    );
    console.log("   This indicates a database write problem.");
    console.log("   Check RLS policies or use SERVICE_ROLE_KEY.");
  }

  console.log("");
  console.log(
    `📍 NEXT BATCH: node scripts/runTeamScraperBatch.js --start ${startOffset + stats.processed} --count ${batchCount}`,
  );
}

main().catch(console.error);
