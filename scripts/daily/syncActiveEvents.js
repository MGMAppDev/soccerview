/**
 * Daily Active Events Sync v2.0
 * =============================
 *
 * Called by GitHub Actions daily-data-sync.yml
 *
 * PURPOSE:
 * 1. Find events with recent activity (matches in last 7 days or upcoming matches)
 * 2. Re-scrape those events to get latest scores
 * 3. Write to STAGING TABLES for validation pipeline processing
 *
 * V2 ARCHITECTURE:
 * - Writes to staging_games and staging_events (not production tables)
 * - Validation pipeline moves data to matches_v2 after processing
 *
 * USAGE:
 *   node scripts/syncActiveEvents.js              # Default (scrape active events)
 *   node scripts/syncActiveEvents.js --days 14   # Look back 14 days instead of 7
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import "dotenv/config";

// ===========================================
// CONFIGURATION
// ===========================================
const CONFIG = {
  // Look for events with matches in last N days
  ACTIVE_DAYS_LOOKBACK: 7,
  
  // Also get events with upcoming matches in next N days
  UPCOMING_DAYS_FORWARD: 7,
  
  // Delays
  REQUEST_DELAY_MIN: 1500,
  REQUEST_DELAY_MAX: 3000,
  GROUP_DELAY: 800,
  EVENT_DELAY: 3000,
  
  // Retry logic
  MAX_RETRIES: 3,
  RETRY_DELAYS: [5000, 15000, 30000],
  
  // Data policy
  MIN_DATE: "2023-01-01",
  
  // Max events per run (to stay within GitHub Actions timeout)
  MAX_EVENTS_PER_RUN: 100,
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
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
// STATS
// ===========================================
const stats = {
  eventsFound: 0,
  eventsProcessed: 0,
  eventsSuccessful: 0,
  eventsFailed: 0,
  matchesUpdated: 0,
  startTime: null,
};

// ===========================================
// UTILITIES
// ===========================================
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomDelay(min = CONFIG.REQUEST_DELAY_MIN, max = CONFIG.REQUEST_DELAY_MAX) {
  return min + Math.random() * (max - min);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===========================================
// HTML FETCHING
// ===========================================
async function fetchHTML(url, retries = CONFIG.MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept": "text/html,application/xhtml+xml",
        },
      });

      if (response.status === 429) {
        console.log(`   ⏳ Rate limited, waiting 60s...`);
        await sleep(60000);
        continue;
      }

      if (!response.ok) {
        if (attempt < retries) {
          await sleep(CONFIG.RETRY_DELAYS[attempt] || 5000);
          continue;
        }
        return null;
      }

      return await response.text();
    } catch (error) {
      if (attempt < retries) {
        await sleep(CONFIG.RETRY_DELAYS[attempt] || 5000);
        continue;
      }
      return null;
    }
  }
  return null;
}

// ===========================================
// PARSING
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
  const url = `${BASE_URL}/org_event/events/${eventId}/schedules?group=${groupId}`;
  const html = await fetchHTML(url);
  if (!html) return [];
  
  const $ = cheerio.load(html);
  const matches = [];

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

// ===========================================
// DATABASE (V2 Architecture - Staging Tables)
// ===========================================
async function findActiveEvents() {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - CONFIG.ACTIVE_DAYS_LOOKBACK);

  const forwardDate = new Date();
  forwardDate.setDate(forwardDate.getDate() + CONFIG.UPCOMING_DAYS_FORWARD);

  // Find events with recent or upcoming matches from v2 schema
  // Query matches_v2 joined with leagues/tournaments for event info
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

  // Collect unique league and tournament IDs
  const leagueIds = new Set();
  const tournamentIds = new Set();
  for (const match of recentMatches || []) {
    if (match.league_id) leagueIds.add(match.league_id);
    if (match.tournament_id) tournamentIds.add(match.tournament_id);
  }

  // Fetch league names
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

  // Fetch tournament names
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

async function upsertMatchesToStaging(matches) {
  if (matches.length === 0) return 0;

  // Transform to staging_games schema
  const stagingGames = matches.map(m => ({
    match_date: m.match_date,
    match_time: null, // GotSport doesn't provide structured time
    home_team_name: m.home_team_name,
    away_team_name: m.away_team_name,
    home_score: m.home_score,
    away_score: m.away_score,
    event_name: m.event_name,
    event_id: m.event_id,
    venue_name: m.location,
    field_name: null,
    division: null, // Could extract from event_name if needed
    source_platform: "gotsport",
    source_match_key: `gotsport-${m.event_id}-${m.match_number}`,
    raw_data: {
      match_number: m.match_number,
      status: m.status,
      original: m,
    },
    processed: false,
  }));

  // Insert to staging (use insert, not upsert - staging accepts duplicates)
  // Deduplication happens in validation pipeline
  const { data, error } = await supabase
    .from("staging_games")
    .insert(stagingGames)
    .select();

  if (error) {
    console.error(`   ❌ DB error: ${error.message}`);
    return 0;
  }

  return data?.length || 0;
}

async function registerEventToStaging(eventId, eventName, matchCount) {
  // Insert event to staging_events for validation pipeline
  const { error } = await supabase
    .from("staging_events")
    .insert({
      event_name: eventName,
      event_type: "tournament", // GotSport events are typically tournaments
      source_platform: "gotsport",
      source_event_id: eventId,
      raw_data: {
        match_count: matchCount,
        scraped_at: new Date().toISOString(),
      },
      processed: false,
    });

  if (error && !error.message.includes("duplicate")) {
    console.error(`   ⚠️ Event registration error: ${error.message}`);
  }
}

// ===========================================
// MAIN
// ===========================================
async function main() {
  console.log("🔄 Daily Active Events Sync");
  console.log("=".repeat(50));
  console.log(`Lookback: ${CONFIG.ACTIVE_DAYS_LOOKBACK} days`);
  console.log(`Forward: ${CONFIG.UPCOMING_DAYS_FORWARD} days`);
  console.log(`Max events: ${CONFIG.MAX_EVENTS_PER_RUN}`);
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

  // Process each event
  for (const event of eventsToProcess) {
    console.log(`\n📋 ${event.event_name || event.event_id}`);
    
    try {
      const groups = await discoverGroups(event.event_id);
      if (groups.length === 0) {
        console.log("   ⚠️ No groups found");
        stats.eventsProcessed++;
        continue;
      }

      let allMatches = [];
      for (const groupId of groups) {
        const matches = await scrapeGroupMatches(event.event_id, groupId, event.event_name);
        allMatches = allMatches.concat(matches);
        await sleep(CONFIG.GROUP_DELAY);
      }

      // Dedupe
      const uniqueMatches = Array.from(
        new Map(allMatches.map(m => [`${m.event_id}-${m.match_number}`, m])).values()
      );

      // Save to staging tables
      const saved = await upsertMatchesToStaging(uniqueMatches);
      stats.matchesUpdated += saved;
      stats.eventsSuccessful++;

      await registerEventToStaging(event.event_id, event.event_name, uniqueMatches.length);

      console.log(`   ✅ ${saved} matches staged`);

    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      stats.eventsFailed++;
    }

    stats.eventsProcessed++;
    await sleep(CONFIG.EVENT_DELAY);
  }

  // Summary
  const elapsed = Date.now() - stats.startTime;
  console.log("\n" + "=".repeat(50));
  console.log("✅ SYNC COMPLETE (V2 - Staging)");
  console.log("=".repeat(50));
  console.log(`   Events found: ${stats.eventsFound}`);
  console.log(`   Events processed: ${stats.eventsProcessed}`);
  console.log(`   Events successful: ${stats.eventsSuccessful}`);
  console.log(`   Events failed: ${stats.eventsFailed}`);
  console.log(`   Matches staged: ${stats.matchesUpdated}`);
  console.log(`   Runtime: ${Math.round(elapsed / 1000)}s`);
  console.log("\n📋 Next: Run validation pipeline to process staged data");
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
