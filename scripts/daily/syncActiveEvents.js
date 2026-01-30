/**
 * Daily Active Events Sync v3.0 - PARALLEL OPTIMIZED
 * ===================================================
 *
 * Called by GitHub Actions daily-data-sync.yml
 *
 * V3.0 OPTIMIZATIONS:
 * - Parallel event processing (5 concurrent)
 * - Parallel group fetching (3 concurrent per event)
 * - Reactive rate limiting with exponential backoff
 * - Batch DB writes at end (single bulk insert)
 * - Target: 79 events in under 20 minutes
 *
 * V2 ARCHITECTURE:
 * - Writes to staging_games and staging_events (not production tables)
 * - Validation pipeline moves data to matches_v2 after processing
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import "dotenv/config";

// ===========================================
// CONFIGURATION
// ===========================================
const CONFIG = {
  // Look for events with matches in last N days
  ACTIVE_DAYS_LOOKBACK: 7,

  // Also get events with upcoming matches in next N days
  UPCOMING_DAYS_FORWARD: 7,

  // PARALLELIZATION
  EVENT_CONCURRENCY: 5,    // Process 5 events at once
  GROUP_CONCURRENCY: 3,    // Fetch 3 groups at once per event

  // REACTIVE RATE LIMITING
  BASE_DELAY: 300,         // Minimum delay between requests (ms)
  BACKOFF_MULTIPLIER: 2,   // Exponential backoff multiplier
  MAX_BACKOFF: 60000,      // Max backoff (60s)

  // Retry logic
  MAX_RETRIES: 3,

  // Data policy
  MIN_DATE: "2023-01-01",

  // Max events per run
  MAX_EVENTS_PER_RUN: 100,

  // Batch size for DB writes
  DB_BATCH_SIZE: 500,

  // Progress logging interval
  PROGRESS_INTERVAL: 10,
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
];

const BASE_URL = "https://system.gotsport.com";

// ===========================================
// SUPABASE CLIENT
// ===========================================
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===========================================
// RATE LIMITER STATE
// ===========================================
let currentBackoff = CONFIG.BASE_DELAY;
let consecutiveSuccesses = 0;
let totalRequests = 0;
let rateLimitHits = 0;

// ===========================================
// STATS
// ===========================================
const stats = {
  eventsFound: 0,
  eventsProcessed: 0,
  eventsSuccessful: 0,
  eventsFailed: 0,
  matchesStaged: 0,
  groupsScraped: 0,
  startTime: null,
};

// ===========================================
// UTILITIES
// ===========================================
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Reactive delay based on rate limit status
async function smartDelay() {
  await sleep(currentBackoff);
}

function onRequestSuccess() {
  consecutiveSuccesses++;
  // After 10 consecutive successes, reduce backoff
  if (consecutiveSuccesses >= 10 && currentBackoff > CONFIG.BASE_DELAY) {
    currentBackoff = Math.max(CONFIG.BASE_DELAY, currentBackoff / CONFIG.BACKOFF_MULTIPLIER);
    consecutiveSuccesses = 0;
  }
}

function onRateLimit() {
  consecutiveSuccesses = 0;
  rateLimitHits++;
  currentBackoff = Math.min(CONFIG.MAX_BACKOFF, currentBackoff * CONFIG.BACKOFF_MULTIPLIER);
  console.log(`   ⏳ Rate limited! Backoff now ${currentBackoff / 1000}s`);
}

// ===========================================
// HTML FETCHING WITH REACTIVE RATE LIMITING
// ===========================================
async function fetchHTML(url, retries = CONFIG.MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      totalRequests++;

      const response = await fetch(url, {
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
        },
      });

      if (response.status === 429) {
        onRateLimit();
        await sleep(currentBackoff);
        continue;
      }

      if (response.status >= 500) {
        // Server error - wait and retry
        if (attempt < retries) {
          await sleep(5000 * (attempt + 1));
          continue;
        }
        return null;
      }

      if (!response.ok) {
        if (attempt < retries) {
          await sleep(2000);
          continue;
        }
        return null;
      }

      onRequestSuccess();
      return await response.text();

    } catch (error) {
      if (attempt < retries) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

// ===========================================
// PARSING (unchanged)
// ===========================================
function parseScore(scoreStr) {
  if (!scoreStr) return [null, null];
  const match = scoreStr.trim().match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return [null, null];
  return [parseInt(match[1]), parseInt(match[2])];
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const datePart = dateStr.split("\n")[0].trim();
  try {
    const date = new Date(datePart);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

// ===========================================
// SCRAPING
// ===========================================
async function discoverGroups(eventId) {
  await smartDelay();

  const url = `${BASE_URL}/org_event/events/${eventId}`;
  const html = await fetchHTML(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const groups = new Set();

  $('a[href*="schedules?group="]').each((_, el) => {
    const href = $(el).attr("href");
    const match = href.match(/group=(\d+)/);
    if (match) groups.add(match[1]);
  });

  return Array.from(groups);
}

async function scrapeGroupMatches(eventId, groupId, eventName) {
  await smartDelay();

  const url = `${BASE_URL}/org_event/events/${eventId}/schedules?group=${groupId}`;
  const html = await fetchHTML(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const matches = [];
  stats.groupsScraped++;

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length === 7) {
      const matchNum = $(cells[0]).text().trim();
      const dateTime = $(cells[1]).text().trim();
      const homeTeam = $(cells[2]).text().trim();
      const scoreText = $(cells[3]).text().trim();
      const awayTeam = $(cells[4]).text().trim();
      const location = $(cells[5]).text().trim();

      if (!scoreText.includes("-")) return;

      const [homeScore, awayScore] = parseScore(scoreText);
      const matchDate = parseDate(dateTime);

      if (matchDate && matchDate < CONFIG.MIN_DATE) return;

      let status = "scheduled";
      if (homeScore !== null && awayScore !== null && matchDate) {
        if (new Date(matchDate) < new Date()) status = "completed";
      }

      matches.push({
        event_id: eventId.toString(),
        event_name: eventName,
        match_number: matchNum,
        match_date: matchDate,
        home_team_name: homeTeam,
        home_score: homeScore,
        away_team_name: awayTeam,
        away_score: awayScore,
        status,
        location,
        source_platform: "gotsport",
      });
    }
  });

  return matches;
}

// Process a single event (groups in parallel)
async function processEvent(event, groupLimit) {
  const groups = await discoverGroups(event.event_id);
  if (groups.length === 0) {
    return { event, matches: [], noGroups: true };
  }

  // Fetch all groups in parallel (limited concurrency)
  const groupPromises = groups.map(groupId =>
    groupLimit(() => scrapeGroupMatches(event.event_id, groupId, event.event_name))
  );

  const groupResults = await Promise.all(groupPromises);
  const allMatches = groupResults.flat();

  // Dedupe within event
  const uniqueMatches = Array.from(
    new Map(allMatches.map(m => [`${m.event_id}-${m.match_number}`, m])).values()
  );

  return { event, matches: uniqueMatches, noGroups: false };
}

// ===========================================
// DATABASE (V2 Architecture - Staging Tables)
// ===========================================
async function findActiveEvents() {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - CONFIG.ACTIVE_DAYS_LOOKBACK);

  const forwardDate = new Date();
  forwardDate.setDate(forwardDate.getDate() + CONFIG.UPCOMING_DAYS_FORWARD);

  const { data: recentMatches, error } = await supabase
    .from("matches_v2")
    .select("league_id, tournament_id")
    .gte("match_date", lookbackDate.toISOString().split("T")[0])
    .lte("match_date", forwardDate.toISOString().split("T")[0])
    .limit(5000);

  if (error) {
    console.error("❌ Error finding active events:", error.message);
    return [];
  }

  const leagueIds = new Set();
  const tournamentIds = new Set();
  for (const match of recentMatches || []) {
    if (match.league_id) leagueIds.add(match.league_id);
    if (match.tournament_id) tournamentIds.add(match.tournament_id);
  }

  const events = [];
  if (leagueIds.size > 0) {
    const { data: leagues } = await supabase
      .from("leagues")
      .select("id, name, source_event_id")
      .in("id", Array.from(leagueIds));
    for (const lg of leagues || []) {
      events.push({ event_id: lg.source_event_id || lg.id, event_name: lg.name });
    }
  }

  if (tournamentIds.size > 0) {
    const { data: tournaments } = await supabase
      .from("tournaments")
      .select("id, name, source_event_id")
      .in("id", Array.from(tournamentIds));
    for (const t of tournaments || []) {
      events.push({ event_id: t.source_event_id || t.id, event_name: t.name });
    }
  }

  return events;
}

async function bulkInsertToStaging(allMatches) {
  if (allMatches.length === 0) return 0;

  // Transform to staging_games schema
  const stagingGames = allMatches.map(m => ({
    match_date: m.match_date,
    match_time: null,
    home_team_name: m.home_team_name,
    away_team_name: m.away_team_name,
    home_score: m.home_score,
    away_score: m.away_score,
    event_name: m.event_name,
    event_id: m.event_id,
    venue_name: m.location,
    field_name: null,
    division: null,
    source_platform: "gotsport",
    source_match_key: `gotsport-${m.event_id}-${m.match_number}`,
    raw_data: {
      match_number: m.match_number,
      status: m.status,
      original: m,
    },
    processed: false,
  }));

  // Global dedupe by source_match_key
  const uniqueGames = Array.from(
    new Map(stagingGames.map(g => [g.source_match_key, g])).values()
  );

  console.log(`\n📦 Bulk inserting ${uniqueGames.length} matches to staging...`);

  // Insert in batches
  let totalInserted = 0;
  for (let i = 0; i < uniqueGames.length; i += CONFIG.DB_BATCH_SIZE) {
    const batch = uniqueGames.slice(i, i + CONFIG.DB_BATCH_SIZE);

    const { data, error } = await supabase
      .from("staging_games")
      .insert(batch)
      .select();

    if (error) {
      console.error(`   ❌ Batch ${Math.floor(i / CONFIG.DB_BATCH_SIZE) + 1} error: ${error.message}`);
    } else {
      totalInserted += data?.length || 0;
    }
  }

  return totalInserted;
}

async function bulkRegisterEvents(eventResults) {
  const successfulEvents = eventResults.filter(r => r.matches.length > 0);
  if (successfulEvents.length === 0) return;

  const stagingEvents = successfulEvents.map(r => ({
    event_name: r.event.event_name,
    event_type: "tournament",
    source_platform: "gotsport",
    source_event_id: r.event.event_id,
    raw_data: {
      match_count: r.matches.length,
      scraped_at: new Date().toISOString(),
    },
    processed: false,
  }));

  const { error } = await supabase
    .from("staging_events")
    .insert(stagingEvents);

  if (error && !error.message.includes("duplicate")) {
    console.error(`   ⚠️ Event registration error: ${error.message}`);
  }
}

// ===========================================
// MAIN - PARALLEL PROCESSING
// ===========================================
async function main() {
  console.log("🔄 Daily Active Events Sync v3.0 (PARALLEL)");
  console.log("=".repeat(50));
  console.log(`Lookback: ${CONFIG.ACTIVE_DAYS_LOOKBACK} days`);
  console.log(`Forward: ${CONFIG.UPCOMING_DAYS_FORWARD} days`);
  console.log(`Max events: ${CONFIG.MAX_EVENTS_PER_RUN}`);
  console.log(`Event concurrency: ${CONFIG.EVENT_CONCURRENCY}`);
  console.log(`Group concurrency: ${CONFIG.GROUP_CONCURRENCY}`);
  console.log("");

  stats.startTime = Date.now();

  // Find active events
  console.log("🔍 Finding active events...");
  const events = await findActiveEvents();
  stats.eventsFound = events.length;
  console.log(`   Found ${events.length} active events\n`);

  if (events.length === 0) {
    console.log("✅ No active events to sync");
    return;
  }

  // Limit to max per run
  const eventsToProcess = events.slice(0, CONFIG.MAX_EVENTS_PER_RUN);

  // Create limiters
  const eventLimit = pLimit(CONFIG.EVENT_CONCURRENCY);
  const groupLimit = pLimit(CONFIG.GROUP_CONCURRENCY);

  // Process all events in parallel (with limit)
  console.log(`🚀 Processing ${eventsToProcess.length} events in parallel...\n`);

  let completed = 0;
  const eventPromises = eventsToProcess.map((event, index) =>
    eventLimit(async () => {
      try {
        const result = await processEvent(event, groupLimit);
        completed++;

        // Progress logging
        if (completed % CONFIG.PROGRESS_INTERVAL === 0 || completed === eventsToProcess.length) {
          const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
          const rate = (completed / elapsed * 60).toFixed(1);
          console.log(`   📊 Progress: ${completed}/${eventsToProcess.length} events (${rate}/min, backoff: ${currentBackoff}ms)`);
        }

        if (result.noGroups) {
          console.log(`📋 ${event.event_name || event.event_id} - ⚠️ No groups`);
          stats.eventsFailed++;
        } else if (result.matches.length > 0) {
          console.log(`📋 ${event.event_name || event.event_id} - ✅ ${result.matches.length} matches`);
          stats.eventsSuccessful++;
        } else {
          stats.eventsSuccessful++;
        }

        stats.eventsProcessed++;
        return result;

      } catch (error) {
        console.error(`📋 ${event.event_name || event.event_id} - ❌ ${error.message}`);
        stats.eventsFailed++;
        stats.eventsProcessed++;
        return { event, matches: [], error: true };
      }
    })
  );

  const results = await Promise.all(eventPromises);

  // Collect all matches
  const allMatches = results.flatMap(r => r.matches);
  console.log(`\n📊 Total matches collected: ${allMatches.length}`);

  // Bulk insert to staging
  const inserted = await bulkInsertToStaging(allMatches);
  stats.matchesStaged = inserted;

  // Bulk register events
  await bulkRegisterEvents(results);

  // Summary
  const elapsed = Date.now() - stats.startTime;
  console.log("\n" + "=".repeat(50));
  console.log("✅ SYNC COMPLETE (V3 - Parallel)");
  console.log("=".repeat(50));
  console.log(`   Events found: ${stats.eventsFound}`);
  console.log(`   Events processed: ${stats.eventsProcessed}`);
  console.log(`   Events successful: ${stats.eventsSuccessful}`);
  console.log(`   Events failed: ${stats.eventsFailed}`);
  console.log(`   Groups scraped: ${stats.groupsScraped}`);
  console.log(`   Matches staged: ${stats.matchesStaged}`);
  console.log(`   Total requests: ${totalRequests}`);
  console.log(`   Rate limit hits: ${rateLimitHits}`);
  console.log(`   Runtime: ${Math.round(elapsed / 1000)}s (${(elapsed / 60000).toFixed(1)} min)`);
  console.log("\n📋 Next: Run validation pipeline to process staged data");
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
