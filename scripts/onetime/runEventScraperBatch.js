/**
 * SoccerView Event Scraper v1.0 - BULLETPROOF EDITION
 * ====================================================
 * 
 * PURPOSE: Phase 2 of data collection
 * - Reads tournament/league IDs from event_registry (populated by Phase 1 Team Scraper)
 * - Scrapes actual match SCORES from GotSport event pages
 * - Updates match_results with scored matches
 * - Tracks scrape status in event_registry (last_scraped_at, match_count)
 * 
 * USAGE:
 *   node scripts/runEventScraperBatch.js --count 50           # Process 50 events
 *   node scripts/runEventScraperBatch.js --count 50 --force   # Re-scrape even if recently scraped
 *   node scripts/runEventScraperBatch.js --event 30789        # Scrape single event by ID
 *   node scripts/runEventScraperBatch.js --resume             # Resume from checkpoint
 * 
 * BULLETPROOF FEATURES:
 * ✅ Uses SERVICE_ROLE_KEY for database writes
 * ✅ Tests database write capability at startup
 * ✅ Saves checkpoint after EVERY event (resumable)
 * ✅ Exponential backoff retry logic
 * ✅ Rate limit detection and cooldown
 * ✅ Graceful handling of missing/invalid events
 * ✅ Updates event_registry with scrape status
 * ✅ Final verification and summary
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===========================================
// CONFIGURATION
// ===========================================
const CONFIG = {
  // Delays (HTML scraping is heavier than API calls)
  REQUEST_DELAY_MIN: 1500,
  REQUEST_DELAY_MAX: 3000,
  GROUP_DELAY: 800,           // Delay between group scrapes within an event
  EVENT_DELAY: 3000,          // Delay between events
  
  // Retry logic
  MAX_RETRIES: 3,
  RETRY_DELAYS: [5000, 15000, 30000],
  
  // Rate limit handling
  COOL_DOWN_ON_500: 60000,    // 1 minute on server error
  COOL_DOWN_ON_429: 180000,   // 3 minutes on rate limit
  
  // Data policy
  MIN_DATE: "2023-01-01",
  
  // Scrape freshness (don't re-scrape events scraped within this many days)
  SCRAPE_FRESHNESS_DAYS: 7,
  
  // Checkpoint
  CHECKPOINT_FILE: path.join(__dirname, ".event_scraper_checkpoint.json"),
  
  // Batch defaults
  DEFAULT_BATCH_SIZE: 50,
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
];

const BASE_URL = "https://system.gotsport.com";

// ===========================================
// SUPABASE CLIENT - USING SERVICE ROLE KEY!
// ===========================================
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ FATAL: Missing Supabase environment variables!");
  console.error("   Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const isServiceRole = SUPABASE_KEY.length > 100;
if (!isServiceRole) {
  console.warn("⚠️  WARNING: May be using ANON key instead of SERVICE_ROLE key!");
  console.warn("   Database writes may fail due to RLS policies.");
  console.warn("   Set SUPABASE_SERVICE_ROLE_KEY environment variable.\n");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===========================================
// STATS TRACKING
// ===========================================
const stats = {
  eventsProcessed: 0,
  eventsSuccessful: 0,
  eventsFailed: 0,
  eventsSkipped: 0,
  totalMatchesFound: 0,
  totalMatchesSaved: 0,
  totalGroupsScraped: 0,
  errors: [],
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

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// ===========================================
// CHECKPOINT MANAGEMENT
// ===========================================

function loadCheckpoint() {
  try {
    if (fs.existsSync(CONFIG.CHECKPOINT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.CHECKPOINT_FILE, "utf8"));
      return data;
    }
  } catch (error) {
    console.warn("⚠️  Could not load checkpoint:", error.message);
  }
  return null;
}

function saveCheckpoint(lastEventId, processedEventIds) {
  const checkpoint = {
    lastEventId,
    processedEventIds: Array.from(processedEventIds),
    lastRun: new Date().toISOString(),
    stats: { ...stats },
  };
  
  try {
    fs.writeFileSync(CONFIG.CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
  } catch (error) {
    console.error("⚠️  Failed to save checkpoint:", error.message);
  }
}

function clearCheckpoint() {
  try {
    if (fs.existsSync(CONFIG.CHECKPOINT_FILE)) {
      fs.unlinkSync(CONFIG.CHECKPOINT_FILE);
      console.log("🗑️  Checkpoint cleared");
    }
  } catch (error) {
    console.warn("⚠️  Could not clear checkpoint:", error.message);
  }
}

// ===========================================
// HTML FETCHING WITH RETRY
// ===========================================

async function fetchHTML(url, retries = CONFIG.MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });

      if (response.status === 429) {
        console.log(`   ⏳ Rate limited! Cooling down ${CONFIG.COOL_DOWN_ON_429 / 1000}s...`);
        await sleep(CONFIG.COOL_DOWN_ON_429);
        continue;
      }

      if (response.status >= 500) {
        if (attempt < retries) {
          console.log(`   ⚠️  Server error ${response.status}, retrying in ${CONFIG.COOL_DOWN_ON_500 / 1000}s...`);
          await sleep(CONFIG.COOL_DOWN_ON_500);
          continue;
        }
        throw new Error(`HTTP ${response.status}: Server error`);
      }

      if (response.status === 404) {
        return { html: null, status: 404 };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      return { html, status: response.status };
      
    } catch (error) {
      if (attempt < retries) {
        const delay = CONFIG.RETRY_DELAYS[attempt] || 30000;
        console.log(`   ⚠️  Attempt ${attempt + 1}/${retries + 1} failed: ${error.message}`);
        console.log(`   ⏳ Retrying in ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}

// ===========================================
// PARSING FUNCTIONS
// ===========================================

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

function parseTime(dateStr) {
  if (!dateStr) return null;
  const lines = dateStr.split("\n");
  if (lines.length < 2) return null;

  const timePart = lines[1].trim();
  const timeMatch = timePart.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1]);
  const minutes = timeMatch[2];
  const ampm = timeMatch[3].toUpperCase();

  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}:00`;
}

function parseScore(scoreStr) {
  if (!scoreStr) return [null, null];
  const match = scoreStr.trim().match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return [null, null];
  return [parseInt(match[1]), parseInt(match[2])];
}

function extractAgeGroup(divisionText, teamName) {
  const patterns = [divisionText, teamName];
  for (const text of patterns) {
    if (!text) continue;
    const match = text.match(/\bU-?(\d{1,2})\b/i) ||
                  text.match(/\b(\d{1,2})B\b/) ||
                  text.match(/\b(\d{1,2})G\b/);
    if (match) {
      const age = parseInt(match[1]);
      if (age >= 8 && age <= 19) return `U${age}`;
    }
  }
  return null;
}

function extractGender(divisionText, teamName) {
  const text = `${divisionText || ""} ${teamName || ""}`.toLowerCase();
  if (text.includes("boys") || text.includes(" b ") || text.match(/\d+b\b/) || text.includes("male")) return "Boys";
  if (text.includes("girls") || text.includes(" g ") || text.match(/\d+g\b/) || text.includes("female")) return "Girls";
  return null;
}

// ===========================================
// CORE SCRAPING FUNCTIONS
// ===========================================

async function discoverGroups(eventId) {
  const url = `${BASE_URL}/org_event/events/${eventId}`;
  
  const { html, status } = await fetchHTML(url);
  
  if (status === 404 || !html) {
    return { groups: [], error: "Event not found (404)" };
  }
  
  const $ = cheerio.load(html);
  const groups = new Set();
  
  $('a[href*="schedules?group="]').each((_, el) => {
    const href = $(el).attr("href");
    const match = href.match(/group=(\d+)/);
    if (match) groups.add(match[1]);
  });

  return { groups: Array.from(groups), error: null };
}

async function scrapeGroupSchedule(eventId, groupId, eventName) {
  const url = `${BASE_URL}/org_event/events/${eventId}/schedules?group=${groupId}`;

  try {
    const { html, status } = await fetchHTML(url);
    
    if (status === 404 || !html) {
      return [];
    }
    
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
        const division = $(cells[6]).text().trim();

        if (!scoreText.includes("-")) return;

        const [homeScore, awayScore] = parseScore(scoreText);
        const matchDate = parseDate(dateTime);
        const matchTime = parseTime(dateTime);

        // Apply 3-year data policy
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
          match_time: matchTime,
          home_team_name: homeTeam,
          home_score: homeScore,
          away_team_name: awayTeam,
          away_score: awayScore,
          status,
          age_group: extractAgeGroup(division, homeTeam),
          gender: extractGender(division, homeTeam),
          location,
          source_platform: "gotsport",
        });
      }
    });

    return matches;
  } catch (error) {
    console.error(`   ❌ Error scraping group ${groupId}: ${error.message}`);
    return [];
  }
}

async function getEventName(eventId) {
  const url = `${BASE_URL}/org_event/events/${eventId}`;
  
  try {
    const { html } = await fetchHTML(url);
    if (!html) return `Event ${eventId}`;
    
    const $ = cheerio.load(html);
    return $("title").text().split("|")[0].trim() ||
           $("h1").first().text().trim() ||
           `Event ${eventId}`;
  } catch {
    return `Event ${eventId}`;
  }
}

// ===========================================
// DATABASE FUNCTIONS
// ===========================================

async function testDatabaseWrite() {
  console.log("🔍 Testing database write capability...");

  const { count: eventCount, error: countError } = await supabase
    .from("event_registry")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.error("❌ FATAL: Cannot read event_registry table!");
    console.error(`   Error: ${countError.message}`);
    return false;
  }

  console.log(`   Events in event_registry: ${eventCount}`);

  // Try a test upsert to match_results
  const testMatch = {
    event_id: "TEST_EVENT_999999",
    match_number: "TEST_999",
    match_date: "2025-01-01",
    home_team_name: "Test Home",
    away_team_name: "Test Away",
    source_platform: "test",
  };

  const { error: writeError } = await supabase
    .from("match_results")
    .upsert([testMatch], { onConflict: "event_id,match_number" });

  if (writeError) {
    console.error("❌ FATAL: Cannot write to match_results table!");
    console.error(`   Error: ${writeError.message}`);
    return false;
  }

  // Clean up
  await supabase
    .from("match_results")
    .delete()
    .eq("event_id", "TEST_EVENT_999999");

  console.log("✅ Database write test PASSED!\n");
  return true;
}

async function upsertMatches(matches) {
  if (matches.length === 0) return { success: true, inserted: 0 };

  const { data, error } = await supabase
    .from("match_results")
    .upsert(matches, {
      onConflict: "event_id,match_number",
      ignoreDuplicates: false,
    })
    .select();

  if (error) {
    console.error(`   ❌ Database error: ${error.message}`);
    stats.errors.push(`Matches: ${error.message}`);
    return { success: false, inserted: 0, error: error.message };
  }

  return { success: true, inserted: data?.length || 0 };
}

async function updateEventScrapeStatus(eventId, matchCount) {
  const { error } = await supabase
    .from("event_registry")
    .update({
      last_scraped_at: new Date().toISOString(),
      match_count: matchCount,
    })
    .eq("event_id", eventId);

  if (error) {
    console.warn(`   ⚠️  Could not update scrape status: ${error.message}`);
  }
}

async function fetchEventsToScrape(count, force = false) {
  console.log(`📥 Fetching events to scrape (count: ${count}, force: ${force})...`);

  let query = supabase
    .from("event_registry")
    .select("event_id, event_name, source_type, last_scraped_at")
    .eq("source_platform", "gotsport")
    .order("event_id", { ascending: true })
    .limit(count);

  // If not forcing, only get events that haven't been scraped recently
  if (!force) {
    const freshnessDate = new Date();
    freshnessDate.setDate(freshnessDate.getDate() - CONFIG.SCRAPE_FRESHNESS_DAYS);
    
    query = query.or(`last_scraped_at.is.null,last_scraped_at.lt.${freshnessDate.toISOString()}`);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`❌ Error fetching events: ${error.message}`);
    return [];
  }

  console.log(`   Found ${data?.length || 0} events to scrape`);
  return data || [];
}

async function fetchSingleEvent(eventId) {
  const { data, error } = await supabase
    .from("event_registry")
    .select("event_id, event_name, source_type, last_scraped_at")
    .eq("event_id", eventId)
    .single();

  if (error) {
    console.error(`❌ Error fetching event ${eventId}: ${error.message}`);
    return null;
  }

  return data;
}

// ===========================================
// MAIN SCRAPE FUNCTION
// ===========================================

async function scrapeEvent(event) {
  const eventId = event.event_id;
  const eventName = event.event_name || `Event ${eventId}`;
  
  console.log(`\n📋 Scraping: ${eventName} (ID: ${eventId})`);
  console.log(`   Type: ${event.source_type || "unknown"}`);
  
  if (event.last_scraped_at) {
    console.log(`   Last scraped: ${new Date(event.last_scraped_at).toLocaleDateString()}`);
  }

  // Discover groups
  const { groups, error: groupError } = await discoverGroups(eventId);
  
  if (groupError) {
    console.log(`   ❌ ${groupError}`);
    return { success: false, matches: 0, error: groupError };
  }
  
  if (groups.length === 0) {
    console.log(`   ⚠️  No groups found (event may not have schedules)`);
    await updateEventScrapeStatus(eventId, 0);
    return { success: true, matches: 0, skipped: true };
  }

  console.log(`   Found ${groups.length} groups`);

  // Scrape each group
  let allMatches = [];
  for (let i = 0; i < groups.length; i++) {
    process.stdout.write(`\r   Scraping group ${i + 1}/${groups.length}...`);
    
    const matches = await scrapeGroupSchedule(eventId, groups[i], eventName);
    allMatches = allMatches.concat(matches);
    stats.totalGroupsScraped++;
    
    await sleep(CONFIG.GROUP_DELAY);
  }

  console.log(`\n   📊 Found ${allMatches.length} matches`);

  // Deduplicate
  const uniqueMatches = Array.from(
    new Map(allMatches.map(m => [`${m.event_id}-${m.match_number}`, m])).values()
  );
  
  if (uniqueMatches.length < allMatches.length) {
    console.log(`   📊 ${uniqueMatches.length} unique (${allMatches.length - uniqueMatches.length} duplicates removed)`);
  }

  // Status breakdown
  const byStatus = uniqueMatches.reduce((acc, m) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`   Status: ${JSON.stringify(byStatus)}`);

  // Save to database
  if (uniqueMatches.length > 0) {
    console.log(`   💾 Saving to database...`);
    const result = await upsertMatches(uniqueMatches);
    
    if (result.success) {
      console.log(`   ✅ ${result.inserted} matches saved`);
      stats.totalMatchesSaved += result.inserted;
    } else {
      return { success: false, matches: 0, error: result.error };
    }
  }

  stats.totalMatchesFound += uniqueMatches.length;
  
  // Update event registry
  await updateEventScrapeStatus(eventId, uniqueMatches.length);

  return { success: true, matches: uniqueMatches.length };
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log("🚀 SoccerView Event Scraper v1.0 - BULLETPROOF EDITION");
  console.log("═".repeat(60));
  console.log("✅ Uses SERVICE_ROLE_KEY for database writes");
  console.log("✅ Saves checkpoint after every event (resumable)");
  console.log("✅ Exponential backoff retry logic");
  console.log("✅ Updates event_registry with scrape status");
  console.log("");

  // Parse arguments
  const args = process.argv.slice(2);
  let batchCount = CONFIG.DEFAULT_BATCH_SIZE;
  let forceRescrape = false;
  let singleEventId = null;
  let resumeFromCheckpoint = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count" && args[i + 1]) {
      batchCount = parseInt(args[i + 1]);
    }
    if (args[i] === "--force") {
      forceRescrape = true;
    }
    if (args[i] === "--event" && args[i + 1]) {
      singleEventId = args[i + 1];
    }
    if (args[i] === "--resume") {
      resumeFromCheckpoint = true;
    }
    if (args[i] === "--clear-checkpoint") {
      clearCheckpoint();
      console.log("Checkpoint cleared. Exiting.");
      process.exit(0);
    }
    if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: node scripts/runEventScraperBatch.js [options]");
      console.log("");
      console.log("Options:");
      console.log("  --count N          Process N events (default: 50)");
      console.log("  --force            Re-scrape even if recently scraped");
      console.log("  --event ID         Scrape single event by ID");
      console.log("  --resume           Resume from checkpoint");
      console.log("  --clear-checkpoint Clear checkpoint file");
      console.log("  --help, -h         Show this help");
      process.exit(0);
    }
  }

  console.log(`📊 Batch size: ${batchCount} events`);
  console.log(`🔄 Force re-scrape: ${forceRescrape ? "YES" : "NO"}`);
  console.log(`📆 3-Year Policy: Only data from ${CONFIG.MIN_DATE} forward`);
  console.log(`⏱️  Freshness: Skip events scraped within ${CONFIG.SCRAPE_FRESHNESS_DAYS} days`);
  console.log("");

  // Test database write capability
  const canWrite = await testDatabaseWrite();
  if (!canWrite) {
    console.error("\n❌ ABORTING: Database write test failed!");
    process.exit(1);
  }

  // Get initial match count
  const { count: initialMatchCount } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true });

  console.log(`📊 Initial match count: ${initialMatchCount}\n`);

  // Determine events to process
  let events = [];
  let processedEventIds = new Set();

  if (singleEventId) {
    // Single event mode
    const event = await fetchSingleEvent(singleEventId);
    if (event) {
      events = [event];
    } else {
      console.error(`❌ Event ${singleEventId} not found in event_registry`);
      process.exit(1);
    }
  } else if (resumeFromCheckpoint) {
    // Resume mode
    const checkpoint = loadCheckpoint();
    if (checkpoint) {
      console.log(`📂 Resuming from checkpoint (last event: ${checkpoint.lastEventId})`);
      processedEventIds = new Set(checkpoint.processedEventIds || []);
      console.log(`   Already processed: ${processedEventIds.size} events`);
    }
    events = await fetchEventsToScrape(batchCount + processedEventIds.size, forceRescrape);
    // Filter out already processed
    events = events.filter(e => !processedEventIds.has(e.event_id));
    events = events.slice(0, batchCount);
  } else {
    // Normal batch mode
    events = await fetchEventsToScrape(batchCount, forceRescrape);
  }

  if (events.length === 0) {
    console.log("✅ No events need scraping!");
    console.log("   Use --force to re-scrape recently scraped events.");
    process.exit(0);
  }

  console.log(`\n🎯 Processing ${events.length} events...\n`);
  console.log("═".repeat(60));

  stats.startTime = Date.now();

  // Process events
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    
    try {
      const result = await scrapeEvent(event);
      
      if (result.success) {
        if (result.skipped) {
          stats.eventsSkipped++;
        } else {
          stats.eventsSuccessful++;
        }
      } else {
        stats.eventsFailed++;
        stats.errors.push(`Event ${event.event_id}: ${result.error}`);
      }
      
      processedEventIds.add(event.event_id);
      stats.eventsProcessed++;
      
      // Save checkpoint after each event
      saveCheckpoint(event.event_id, processedEventIds);
      
      // Progress report
      const elapsed = Date.now() - stats.startTime;
      const rate = stats.eventsProcessed / (elapsed / 60000);
      const remaining = events.length - stats.eventsProcessed;
      const eta = rate > 0 ? remaining / rate : 0;
      
      console.log(`\n📊 Progress: ${stats.eventsProcessed}/${events.length} (${((stats.eventsProcessed / events.length) * 100).toFixed(1)}%)`);
      console.log(`   ✅ Successful: ${stats.eventsSuccessful} | ⏭️  Skipped: ${stats.eventsSkipped} | ❌ Failed: ${stats.eventsFailed}`);
      console.log(`   📋 Matches found: ${stats.totalMatchesFound} | 💾 Saved: ${stats.totalMatchesSaved}`);
      console.log(`   ⏱️  Rate: ${rate.toFixed(1)} events/min | ETA: ${eta.toFixed(1)} min`);
      
      // Delay between events
      if (i < events.length - 1) {
        await sleep(CONFIG.EVENT_DELAY);
      }
      
    } catch (error) {
      console.error(`\n❌ CRITICAL ERROR processing event ${event.event_id}: ${error.message}`);
      stats.eventsFailed++;
      stats.errors.push(`Event ${event.event_id}: ${error.message}`);
      
      // Save checkpoint even on error
      processedEventIds.add(event.event_id);
      saveCheckpoint(event.event_id, processedEventIds);
      
      // Continue to next event
      await sleep(CONFIG.EVENT_DELAY);
    }
  }

  // Final verification
  const { count: finalMatchCount } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true });

  const actualMatchesAdded = (finalMatchCount || 0) - (initialMatchCount || 0);
  const totalTime = Date.now() - stats.startTime;

  // Final summary
  console.log("\n" + "═".repeat(60));
  console.log("✅ BATCH COMPLETE");
  console.log("═".repeat(60));
  console.log(`   Events processed: ${stats.eventsProcessed}`);
  console.log(`   Events successful: ${stats.eventsSuccessful}`);
  console.log(`   Events skipped (no groups): ${stats.eventsSkipped}`);
  console.log(`   Events failed: ${stats.eventsFailed}`);
  console.log(`   Groups scraped: ${stats.totalGroupsScraped}`);
  console.log(`   Matches found: ${stats.totalMatchesFound}`);
  console.log(`   Matches saved: ${stats.totalMatchesSaved}`);
  console.log(`   Total runtime: ${formatDuration(totalTime)}`);
  console.log("");
  console.log("💾 DATABASE VERIFICATION:");
  console.log(`   Matches before: ${initialMatchCount}`);
  console.log(`   Matches after: ${finalMatchCount}`);
  console.log(`   Actually added: ${actualMatchesAdded}`);

  if (stats.eventsFailed > 0) {
    console.log("");
    console.log("❌ ERRORS:");
    for (const error of stats.errors.slice(0, 5)) {
      console.log(`   - ${error}`);
    }
    if (stats.errors.length > 5) {
      console.log(`   ... and ${stats.errors.length - 5} more`);
    }
  }

  // Clear checkpoint if all successful
  if (stats.eventsFailed === 0) {
    clearCheckpoint();
    console.log("\n🎉 All events processed successfully! Checkpoint cleared.");
  } else {
    console.log("\n⚠️  Some events failed. Checkpoint preserved for --resume.");
  }

  console.log("");
  console.log("📍 NEXT STEPS:");
  if (stats.eventsFailed > 0) {
    console.log(`   node scripts/runEventScraperBatch.js --resume --count ${batchCount}`);
  } else {
    console.log(`   node scripts/runEventScraperBatch.js --count ${batchCount}`);
  }
}

main().catch(error => {
  console.error("❌ FATAL ERROR:", error.message);
  process.exit(1);
});
