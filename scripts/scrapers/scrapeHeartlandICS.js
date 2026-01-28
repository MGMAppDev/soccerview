/**
 * Heartland Soccer ICS/WebCal Scraper
 * ====================================
 *
 * Extracts match data from Blue Sombrero/Stack Sports calendar feeds.
 * Uses the webcal API endpoint discovered via reverse engineering.
 *
 * API Endpoint Pattern:
 *   https://calendar.bluesombrero.com/api/v1/Calendar?instancekey=sports&portalId=XXX&id=XXX&key=XXX
 *
 * ICS Data Fields:
 *   - DTSTART: Match date/time
 *   - DTEND: End time
 *   - SUMMARY: "Team1 Vs Team2" format
 *   - DESCRIPTION: Location/venue info
 *   - LOCATION: Field/venue
 *
 * Usage:
 *   node scripts/scrapeHeartlandICS.js --discover      # Discover calendar feeds
 *   node scripts/scrapeHeartlandICS.js --url "webcal://..."  # Parse specific feed
 *
 * Prerequisites:
 *   npm install ical node-fetch
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import https from "https";
import http from "http";

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
  // Known Blue Sombrero/Stack Sports calendar endpoints
  // These would be discovered by inspecting team calendar pages
  CALENDAR_API_BASE: "https://calendar.bluesombrero.com/api/v1/Calendar",

  // Alternative: Direct heartlandsoccer.net calendar
  HEARTLAND_CALENDAR_BASE: "https://calendar.heartlandsoccer.net",

  // Request settings
  REQUEST_TIMEOUT: 30000,
  BETWEEN_REQUESTS: 1000,
};

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
  feedsProcessed: 0,
  eventsFound: 0,
  matchesExtracted: 0,
  matchesInserted: 0,
  errors: 0,
};

// ===========================================
// ICS PARSING
// ===========================================

/**
 * Simple ICS parser - extracts VEVENT components
 */
function parseICS(icsData) {
  const events = [];
  const lines = icsData.split(/\r?\n/);

  let currentEvent = null;
  let currentKey = null;
  let currentValue = "";

  for (const line of lines) {
    // Handle line folding (continuation lines start with space or tab)
    if (line.startsWith(" ") || line.startsWith("\t")) {
      currentValue += line.substring(1);
      continue;
    }

    // Process previous key-value if we have one
    if (currentKey && currentEvent) {
      currentEvent[currentKey] = currentValue;
    }

    // Parse new line
    if (line === "BEGIN:VEVENT") {
      currentEvent = {};
    } else if (line === "END:VEVENT") {
      if (currentEvent) {
        events.push(currentEvent);
      }
      currentEvent = null;
    } else if (currentEvent) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        // Handle properties with parameters like DTSTART;TZID=America/Chicago:20260115T190000
        let key = line.substring(0, colonIndex);
        const semiIndex = key.indexOf(";");
        if (semiIndex > 0) {
          key = key.substring(0, semiIndex);
        }
        currentKey = key;
        currentValue = line.substring(colonIndex + 1);
      }
    }
  }

  return events;
}

/**
 * Parse ICS datetime to ISO format
 */
function parseICSDateTime(dtString) {
  if (!dtString) return null;

  // Format: 20260115T190000 or 20260115T190000Z
  const match = dtString.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (match) {
    const [_, year, month, day, hour, min, sec] = match;
    return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  }

  // Format: 20260115 (date only)
  const dateMatch = dtString.match(/(\d{4})(\d{2})(\d{2})/);
  if (dateMatch) {
    const [_, year, month, day] = dateMatch;
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Extract teams from event summary
 * Common formats: "Team A Vs Team B", "Team A vs Team B", "Team A @ Team B"
 */
function parseTeamsFromSummary(summary) {
  if (!summary) return { homeTeam: null, awayTeam: null };

  // Try "Vs" or "vs" separator
  let match = summary.match(/(.+?)\s+[Vv][Ss]\.?\s+(.+)/);
  if (match) {
    return {
      homeTeam: match[1].trim(),
      awayTeam: match[2].trim(),
    };
  }

  // Try "@" separator (away @ home)
  match = summary.match(/(.+?)\s+@\s+(.+)/);
  if (match) {
    return {
      homeTeam: match[2].trim(),  // Team after @ is home
      awayTeam: match[1].trim(),
    };
  }

  // Try "at" separator
  match = summary.match(/(.+?)\s+at\s+(.+)/i);
  if (match) {
    return {
      homeTeam: match[2].trim(),
      awayTeam: match[1].trim(),
    };
  }

  return { homeTeam: null, awayTeam: null };
}

/**
 * Infer gender and age group from text
 */
function inferGenderAndAge(text) {
  if (!text) return { gender: null, age_group: null };
  const lower = text.toLowerCase();

  let gender = null;
  if (lower.includes("boys") || lower.includes(" b ") || /\bb\d{2}\b/.test(lower) || lower.includes("boy")) {
    gender = "Boys";
  } else if (lower.includes("girls") || lower.includes(" g ") || /\bg\d{2}\b/.test(lower) || lower.includes("girl")) {
    gender = "Girls";
  }

  let age_group = null;
  const ageMatch = lower.match(/u[-]?(\d+)/i);
  if (ageMatch) {
    age_group = `U${ageMatch[1]}`;
  } else {
    // Birth year pattern
    const yearMatch = lower.match(/\b(20[01]\d)\b/);
    if (yearMatch) {
      const birthYear = parseInt(yearMatch[1], 10);
      const currentYear = new Date().getFullYear();
      age_group = `U${currentYear - birthYear}`;
    }
  }

  return { gender, age_group };
}

// ===========================================
// HTTP FETCHING
// ===========================================

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    // Convert webcal:// to https://
    if (url.startsWith("webcal://")) {
      url = url.replace("webcal://", "https://");
    }

    const protocol = url.startsWith("https") ? https : http;

    const request = protocol.get(url, {
      timeout: CONFIG.REQUEST_TIMEOUT,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SoccerView/1.0)",
        "Accept": "text/calendar, text/plain, */*",
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Handle redirects
        fetchURL(response.headers.location).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let data = "";
      response.on("data", chunk => data += chunk);
      response.on("end", () => resolve(data));
    });

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Timeout"));
    });
  });
}

// ===========================================
// MAIN PROCESSING
// ===========================================

async function processCalendarFeed(url, feedName = "Unknown") {
  console.log(`\n📅 Processing: ${feedName}`);
  console.log(`   URL: ${url.substring(0, 80)}...`);

  try {
    const icsData = await fetchURL(url);
    const events = parseICS(icsData);

    console.log(`   Found ${events.length} calendar events`);
    stats.feedsProcessed++;
    stats.eventsFound += events.length;

    const matches = [];

    for (const event of events) {
      const { homeTeam, awayTeam } = parseTeamsFromSummary(event.SUMMARY);

      if (!homeTeam || !awayTeam) {
        continue; // Skip non-game events
      }

      const matchDate = parseICSDateTime(event.DTSTART);
      if (!matchDate) continue;

      const { gender, age_group } = inferGenderAndAge(event.SUMMARY);
      const location = event.LOCATION || event.DESCRIPTION || null;

      // Generate unique key
      const dateStr = matchDate.split("T")[0];
      const matchKey = `heartland-ics-${dateStr}-${homeTeam}-${awayTeam}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

      matches.push({
        event_id: `heartland-league-${new Date(matchDate).getFullYear()}`,
        event_name: `Heartland Soccer League`,
        match_date: dateStr,
        home_team_name: homeTeam,
        away_team_name: awayTeam,
        home_score: null,  // ICS typically doesn't have scores
        away_score: null,
        gender: gender,
        age_group: age_group,
        location: location,
        source_platform: "heartland",
        source_match_key: matchKey,
        status: "scheduled",
      });
    }

    console.log(`   Extracted ${matches.length} matches`);
    stats.matchesExtracted += matches.length;

    return matches;

  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    stats.errors++;
    return [];
  }
}

async function upsertMatches(matches) {
  if (matches.length === 0) return 0;

  try {
    const { data, error } = await supabase
      .from("match_results")
      .upsert(matches, {
        onConflict: "source_match_key",
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      console.error(`   ❌ DB error: ${error.message}`);
      stats.errors++;
      return 0;
    }

    return data?.length || 0;
  } catch (error) {
    console.error(`   ❌ Upsert error: ${error.message}`);
    stats.errors++;
    return 0;
  }
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log("📆 Heartland Soccer ICS/WebCal Scraper");
  console.log("=====================================\n");

  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.includes("--url")) {
    // Process specific URL
    const urlIndex = args.indexOf("--url");
    const url = args[urlIndex + 1];

    if (!url) {
      console.error("❌ Please provide a URL after --url");
      process.exit(1);
    }

    const matches = await processCalendarFeed(url, "User-provided feed");

    if (matches.length > 0) {
      const inserted = await upsertMatches(matches);
      stats.matchesInserted += inserted;
      console.log(`\n✅ Inserted ${inserted} matches`);
    }

  } else if (args.includes("--discover")) {
    // Discovery mode - try to find calendar feeds
    console.log("🔍 Discovery mode - attempting to find calendar feeds...\n");

    console.log("To use this scraper, you need to:");
    console.log("1. Log into a Heartland Soccer team portal");
    console.log("2. Go to Team Central > Calendar > Export");
    console.log("3. Copy the webcal:// URL");
    console.log("4. Run: node scripts/scrapeHeartlandICS.js --url 'webcal://...'");
    console.log("\nAlternatively, inspect the page source for calendar URLs.");

    // Try common patterns
    const testUrls = [
      "https://calendar.heartlandsoccer.net/ical/",
      "https://calendar.heartlandsoccer.net/feed/",
      "https://calendar.heartlandsoccer.net/export/",
    ];

    for (const url of testUrls) {
      console.log(`\nTrying: ${url}`);
      try {
        const data = await fetchURL(url);
        if (data.includes("VCALENDAR")) {
          console.log("✅ Found ICS feed!");
          console.log(data.substring(0, 500));
        }
      } catch (e) {
        console.log(`   ❌ ${e.message}`);
      }
    }

  } else {
    // Show usage
    console.log("Usage:");
    console.log("  node scripts/scrapeHeartlandICS.js --discover");
    console.log("  node scripts/scrapeHeartlandICS.js --url 'webcal://calendar.bluesombrero.com/...'");
    console.log("\nThe webcal URL can be obtained from:");
    console.log("  - Team portal Calendar > Export button");
    console.log("  - Inspecting page source for 'webcal://' or 'calendar' URLs");
    console.log("  - Network tab when loading team schedule pages");
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("📊 SUMMARY");
  console.log("=".repeat(50));
  console.log(`   Feeds processed: ${stats.feedsProcessed}`);
  console.log(`   Events found: ${stats.eventsFound}`);
  console.log(`   Matches extracted: ${stats.matchesExtracted}`);
  console.log(`   Matches inserted: ${stats.matchesInserted}`);
  console.log(`   Errors: ${stats.errors}`);
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
