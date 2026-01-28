/**
 * SoccerView Priority Team Scraper v1.0
 * =====================================
 *
 * TARGETED SCRAPER: Focuses on teams with Official GotSport Rank but 0 match data
 *
 * Strategy:
 * 1. Query teams with national_rank but matches_played = 0
 * 2. Prioritize top-ranked teams first (top-100, then top-500, etc.)
 * 3. Fetch events from GotSport API using team's gotsport_team_id
 * 4. Save discovered events to event_registry for Phase 2 scraping
 *
 * Usage:
 *   node scripts/scrapePriorityTeams.js --limit 100      # Top 100 only
 *   node scripts/scrapePriorityTeams.js --limit 500      # Top 500
 *   node scripts/scrapePriorityTeams.js --limit 1000     # Top 1000
 *   node scripts/scrapePriorityTeams.js                  # All priority teams
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// ===========================================
// CONFIGURATION
// ===========================================
const CONFIG = {
  REQUEST_DELAY_MIN: 1500,
  REQUEST_DELAY_MAX: 3500,
  MAX_RETRIES: 3,
  RETRY_DELAYS: [5000, 15000, 30000],
  MIN_DATE: "2023-01-01",
  COOL_DOWN_ON_500: 30000,
  COOL_DOWN_ON_429: 120000,
  BATCH_SIZE: 50, // Save events every 50 teams
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
];

// ===========================================
// SUPABASE CLIENT
// ===========================================
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing Supabase environment variables!");
  process.exit(1);
}

const isServiceRole = SUPABASE_KEY.length > 100;
if (!isServiceRole) {
  console.warn("WARNING: May be using ANON key. Database writes may fail due to RLS.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===========================================
// UTILITIES
// ===========================================
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomDelay() {
  return CONFIG.REQUEST_DELAY_MIN + Math.random() * (CONFIG.REQUEST_DELAY_MAX - CONFIG.REQUEST_DELAY_MIN);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===========================================
// FETCH PRIORITY TEAMS
// ===========================================
async function fetchPriorityTeams(limit) {
  console.log("\nFetching priority teams (ranked but no matches)...");

  // Query teams with official rank but no match data
  // Priority: sort by national_rank ASC (top ranked first)
  let query = supabase
    .from("team_elo")
    .select("id, gotsport_team_id, team_name, age_group, gender, state, national_rank")
    .not("gotsport_team_id", "is", null)
    .not("national_rank", "is", null)
    .eq("matches_played", 0)
    .order("national_rank", { ascending: true });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`Error fetching priority teams: ${error.message}`);
    return [];
  }

  return data || [];
}

// ===========================================
// GOTSPORT API
// ===========================================
async function fetchTeamAwards(gotsportTeamId) {
  const url = `https://system.gotsport.com/api/v1/ranking_team_awards?team_id=${gotsportTeamId}`;

  for (let retry = 0; retry <= CONFIG.MAX_RETRIES; retry++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept": "application/json",
        },
      });

      if (response.status === 429) {
        console.log(`  Rate limited! Cooling down ${CONFIG.COOL_DOWN_ON_429 / 1000}s...`);
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
// EXTRACT EVENTS
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

// ===========================================
// SAVE EVENTS
// ===========================================
async function saveEvents(events) {
  if (!events || events.length === 0) return { success: true, written: 0 };

  const { data, error } = await supabase
    .from("event_registry")
    .upsert(events, { onConflict: "event_id", ignoreDuplicates: true })
    .select();

  if (error) {
    console.error(`DB ERROR saving events: ${error.message}`);
    return { success: false, written: 0, error: error.message };
  }

  return { success: true, written: data?.length || 0 };
}

// ===========================================
// MAIN
// ===========================================
async function main() {
  console.log("=".repeat(60));
  console.log("SOCCERVIEW PRIORITY TEAM SCRAPER v1.0");
  console.log("=".repeat(60));
  console.log("Target: Teams with Official Rank but 0 match data");
  console.log("Strategy: Discover events from GotSport API");

  // Parse arguments
  const args = process.argv.slice(2);
  let limit = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1]);
    }
  }

  if (limit) {
    console.log(`\nLimit: Top ${limit} ranked teams`);
  } else {
    console.log("\nLimit: ALL priority teams");
  }

  // Test database write
  console.log("\nTesting database connectivity...");
  const { count: initialEventCount, error: countError } = await supabase
    .from("event_registry")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.error(`Cannot read event_registry: ${countError.message}`);
    process.exit(1);
  }
  console.log(`Current events in database: ${initialEventCount}`);

  // Fetch priority teams
  const teams = await fetchPriorityTeams(limit);

  if (teams.length === 0) {
    console.log("\nNo priority teams found matching criteria.");
    process.exit(0);
  }

  console.log(`\nLoaded ${teams.length} priority teams to process`);
  console.log(`Top team: #${teams[0].national_rank} - ${teams[0].team_name}`);
  console.log(`Bottom team: #${teams[teams.length - 1].national_rank} - ${teams[teams.length - 1].team_name}`);

  // Stats
  const stats = {
    processed: 0,
    withEvents: 0,
    noEvents: 0,
    errors: 0,
    eventsDiscovered: new Set(),
    totalMatchRecords: 0,
  };

  const pendingEvents = [];
  const startTime = Date.now();

  console.log("\n" + "-".repeat(60));
  console.log("Starting scrape...\n");

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];

    await sleep(getRandomDelay());

    const awardsResult = await fetchTeamAwards(team.gotsport_team_id);

    if (awardsResult.error) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.log(`  Error: Team #${team.national_rank} (${team.gotsport_team_id}): ${awardsResult.error}`);
      }
    } else {
      const events = extractEventsFromAwards(awardsResult.data, team.id);
      const matchCount = awardsResult.data?.current?.length || 0;

      if (events.length > 0) {
        stats.withEvents++;
        for (const e of events) {
          if (!stats.eventsDiscovered.has(e.event_id)) {
            stats.eventsDiscovered.add(e.event_id);
            pendingEvents.push(e);
          }
        }
        stats.totalMatchRecords += matchCount;
      } else {
        stats.noEvents++;
      }
    }

    stats.processed++;

    // Save events in batches
    if (pendingEvents.length >= CONFIG.BATCH_SIZE) {
      const saveResult = await saveEvents(pendingEvents);
      if (saveResult.success) {
        console.log(`  Saved ${saveResult.written} events to database`);
      }
      pendingEvents.length = 0;
    }

    // Progress every 25 teams
    if (stats.processed % 25 === 0 || stats.processed === teams.length) {
      const elapsed = (Date.now() - startTime) / 60000;
      const rate = stats.processed / elapsed;
      const remaining = teams.length - stats.processed;
      const eta = rate > 0 ? remaining / rate : 0;

      console.log(`Progress: ${stats.processed}/${teams.length} (${((stats.processed / teams.length) * 100).toFixed(1)}%)`);
      console.log(`  Teams with events: ${stats.withEvents} | No events: ${stats.noEvents} | Errors: ${stats.errors}`);
      console.log(`  Unique events discovered: ${stats.eventsDiscovered.size}`);
      console.log(`  Match records found: ${stats.totalMatchRecords.toLocaleString()}`);
      console.log(`  Rate: ${rate.toFixed(1)} teams/min | ETA: ${eta.toFixed(1)} min\n`);
    }
  }

  // Save any remaining events
  if (pendingEvents.length > 0) {
    const saveResult = await saveEvents(pendingEvents);
    if (saveResult.success) {
      console.log(`  Saved final ${saveResult.written} events to database`);
    }
  }

  // Final verification
  const { count: finalEventCount } = await supabase
    .from("event_registry")
    .select("*", { count: "exact", head: true });

  const actualEventsAdded = (finalEventCount || 0) - (initialEventCount || 0);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SCRAPE COMPLETE");
  console.log("=".repeat(60));
  console.log(`Teams processed: ${stats.processed}`);
  console.log(`Teams with events: ${stats.withEvents}`);
  console.log(`Teams without events: ${stats.noEvents}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Unique events discovered: ${stats.eventsDiscovered.size}`);
  console.log(`Total match records referenced: ${stats.totalMatchRecords.toLocaleString()}`);
  console.log(`Runtime: ${((Date.now() - startTime) / 60000).toFixed(1)} min`);
  console.log("");
  console.log("DATABASE VERIFICATION:");
  console.log(`  Events before: ${initialEventCount}`);
  console.log(`  Events after: ${finalEventCount}`);
  console.log(`  New events added: ${actualEventsAdded}`);

  if (stats.eventsDiscovered.size > 0 && actualEventsAdded === 0) {
    console.log("\nWARNING: Events were found but NONE were saved!");
    console.log("Check RLS policies or use SERVICE_ROLE_KEY.");
  }

  console.log("\n" + "-".repeat(60));
  console.log("NEXT STEP: Run the event scraper to get match scores");
  console.log(`  node scripts/runEventScraperBatch.js --count ${Math.min(100, stats.eventsDiscovered.size)}`);
}

main().catch(console.error);
