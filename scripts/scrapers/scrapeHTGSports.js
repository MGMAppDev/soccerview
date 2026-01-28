/**
 * HTGSports Scraper for Heartland Soccer Tournaments v2.0
 * =======================================================
 *
 * Scrapes tournament match data from events.htgsports.net
 * Uses Puppeteer for JavaScript-rendered pages (SPA)
 *
 * V2 ARCHITECTURE:
 * - Writes to staging_games and staging_events (not production tables)
 * - Validation pipeline moves data to matches_v2 after processing
 *
 * FIXED: Now iterates through ALL divisions in the dropdown
 * (each tournament has 50-100 divisions like U-8 Boys Red, U-12 Girls Blue, etc.)
 *
 * Usage:
 *   node scripts/scrapeHTGSports.js                    # Scrape all known Heartland events
 *   node scripts/scrapeHTGSports.js --eventid 13014   # Scrape specific event
 *
 * Prerequisites:
 *   npm install puppeteer
 */

import puppeteer from "puppeteer";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
  BASE_URL: "https://events.htgsports.net",

  // Complete list of OUTDOOR SOCCER events (Last 3 Seasons: Aug 2023 - Present)
  // EXCLUDES: Futsal, Indoor, 3v3/5v5
  // Updated: January 2026
  HEARTLAND_EVENTS: [
    // ========================================
    // OUTDOOR SOCCER LEAGUES
    // ========================================
    { id: 13593, name: "Fall 2025 KC Youth Development League", year: 2025, type: "league" },
    { id: 13272, name: "Spring 2025 KC Youth Development League", year: 2025, type: "league" },
    { id: 12295, name: "Spring 2024 KC Youth Development League", year: 2024, type: "league" },
    { id: 11708, name: "Fall 2023 KC Youth Development League", year: 2023, type: "league" },

    // ========================================
    // SEASON 25-26 TOURNAMENTS (Current)
    // ========================================
    { id: 14130, name: "2026 Heartland Invitational - Boys", year: 2026, type: "tournament" },
    { id: 14129, name: "2026 Heartland Invitational - Girls", year: 2026, type: "tournament" },
    { id: 14126, name: "2026 Heartland Midwest Classic", year: 2026, type: "tournament" },
    { id: 13516, name: "2026 Heartland Spring Cup", year: 2026, type: "tournament" },
    { id: 13514, name: "2026 Border Battle Soccer Tournament", year: 2026, type: "tournament" },
    { id: 13444, name: "KC Fall Finale 2025", year: 2025, type: "tournament" },
    { id: 13437, name: "Challenger Sports Invitational 2025", year: 2025, type: "tournament" },
    { id: 13371, name: "2025 Sporting Iowa Fall Cup", year: 2025, type: "tournament" },
    { id: 13014, name: "2025 Heartland Invitational - Boys", year: 2025, type: "tournament" },
    { id: 13008, name: "2025 Heartland Open Cup", year: 2025, type: "tournament" },
    { id: 12849, name: "2025 Kansas City Invitational", year: 2025, type: "tournament" },
    { id: 12847, name: "2025 KC Champions Cup", year: 2025, type: "tournament" },

    // ========================================
    // SEASON 24-25 TOURNAMENTS
    // ========================================
    { id: 12922, name: "Omaha Evolution Invitational", year: 2025, type: "tournament" },
    { id: 12846, name: "2025 Heartland Spring Cup", year: 2025, type: "tournament" },
    { id: 12844, name: "2025 Border Battle", year: 2025, type: "tournament" },
    { id: 12653, name: "Champions Cup Soccer Tournament 24", year: 2024, type: "tournament" },
    { id: 12600, name: "Watertown Spring Shootout 2025", year: 2025, type: "tournament" },
    { id: 12548, name: "Winter Magic 2025", year: 2025, type: "tournament" },
    { id: 12544, name: "KC Fall Finale 2024", year: 2024, type: "tournament" },
    { id: 12538, name: "Challenger Sports Invitational 2024", year: 2024, type: "tournament" },
    { id: 12468, name: "2024 Omaha Fall Cup", year: 2024, type: "tournament" },
    { id: 12347, name: "2024 Wolves Spring Cup", year: 2024, type: "tournament" },
    { id: 12215, name: "April Fools Festival Tournament 24", year: 2024, type: "tournament" },
    { id: 12122, name: "Iowa Rush Fall Cup", year: 2024, type: "tournament" },
    { id: 12093, name: "2024 Heartland Invitational - Boys", year: 2024, type: "tournament" },
    { id: 12092, name: "2024 Heartland Invitational - Girls", year: 2024, type: "tournament" },

    // ========================================
    // SEASON 23-24 TOURNAMENTS
    // ========================================
    { id: 12089, name: "2024 Heartland Midwest Classic", year: 2024, type: "tournament" },
    { id: 12087, name: "2024 Heartland Open Cup", year: 2024, type: "tournament" },
    { id: 11919, name: "2024 Capital Classic", year: 2024, type: "tournament" },
    { id: 11891, name: "2024 Wildcat Classic", year: 2024, type: "tournament" },
    { id: 11826, name: "2024 Sporting Classic", year: 2024, type: "tournament" },
    { id: 11807, name: "Emerald Cup Boys 2024", year: 2024, type: "tournament" },
    { id: 11702, name: "2024 South Atlantic Regional - Charlotte", year: 2024, type: "tournament" },
    { id: 11650, name: "2024 Kansas City Invitational", year: 2024, type: "tournament" },
    { id: 11648, name: "2024 KC Champions Cup", year: 2024, type: "tournament" },
    { id: 11647, name: "2024 Heartland Spring Cup", year: 2024, type: "tournament" },
    { id: 11555, name: "Challenger Sports Invitational 2023", year: 2023, type: "tournament" },
    { id: 11300, name: "2023 SDYSA Prairie Cup", year: 2023, type: "tournament" },
    { id: 11219, name: "2023 Heartland Invitational - Boys", year: 2023, type: "tournament" },
    { id: 11218, name: "2023 Heartland Invitational - Girls", year: 2023, type: "tournament" },
    { id: 11215, name: "2023 Heartland Midwest Classic", year: 2023, type: "tournament" },
    { id: 11114, name: "KC Super Cup 2023", year: 2023, type: "tournament" },
    { id: 10727, name: "2023 Heartland Spring Cup", year: 2023, type: "tournament" },
  ],

  // Delays (be respectful to the server)
  PAGE_LOAD_WAIT: 3000,      // Wait for SPA to render
  DIVISION_WAIT: 2000,       // Wait after changing division
  BETWEEN_EVENTS: 2000,      // Delay between events

  // Filter for last 3 seasons (Aug 2023+)
  MIN_DATE: "2023-08-01",
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
  eventsProcessed: 0,
  divisionsProcessed: 0,
  matchesFound: 0,
  matchesInserted: 0,
  errors: 0,
};

// ===========================================
// UTILITIES
// ===========================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseHTGDate(dateStr) {
  if (!dateStr) return null;
  try {
    // Format: MM/DD/YYYY (e.g., "11/08/2024")
    const parts = dateStr.trim().split("/");
    if (parts.length === 3) {
      const [month, day, year] = parts;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return null;
  } catch {
    return null;
  }
}

function inferGenderAndAge(divisionText) {
  if (!divisionText) return { gender: null, age_group: null };
  const lower = divisionText.toLowerCase();

  // Gender detection
  let gender = null;
  if (lower.includes("boys") || lower.includes(" b ") || /\bb\s*\d/.test(lower)) {
    gender = "Boys";
  } else if (lower.includes("girls") || lower.includes(" g ") || /\bg\s*\d/.test(lower)) {
    gender = "Girls";
  }

  // Age group detection
  let age_group = null;
  const ageMatch = lower.match(/u[-]?(\d+)/i);
  if (ageMatch) {
    age_group = `U${ageMatch[1]}`;
  } else {
    // Birth year pattern (2010, 2011, etc.)
    const yearMatch = lower.match(/\b(20[01]\d)\b/);
    if (yearMatch) {
      const birthYear = parseInt(yearMatch[1], 10);
      const currentYear = new Date().getFullYear();
      const age = currentYear - birthYear;
      age_group = `U${age}`;
    }
  }

  return { gender, age_group };
}

// ===========================================
// SCRAPING FUNCTIONS
// ===========================================

async function scrapeEventSchedule(browser, eventId, eventName) {
  const page = await browser.newPage();
  const url = `${CONFIG.BASE_URL}/?eventid=${eventId}#/scheduleresults`;
  const allMatches = [];

  console.log(`\n📋 Scraping: ${eventName}`);
  console.log(`   URL: ${url}`);

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(CONFIG.PAGE_LOAD_WAIT);

    // Get all division options from the dropdown
    const divisions = await page.evaluate(() => {
      const selects = document.querySelectorAll("select.form-control");
      for (const select of selects) {
        const options = Array.from(select.querySelectorAll("option"));
        // Find the dropdown with division names (contains "U-" patterns)
        const divisionOptions = options.filter(opt =>
          opt.textContent.match(/U-\d+|2017|2016|2015|2014|2013|2012|2011|2010|2009|2008|2007|2006/i)
        );
        if (divisionOptions.length > 0) {
          return divisionOptions.map(opt => ({
            value: opt.value,
            text: opt.textContent.trim(),
          }));
        }
      }
      return [];
    });

    console.log(`   Found ${divisions.length} divisions`);

    if (divisions.length === 0) {
      // No division dropdown - try to scrape default view
      const matches = await scrapeCurrentDivision(page, eventId, eventName, "Default");
      allMatches.push(...matches);
    } else {
      // Iterate through each division
      for (let i = 0; i < divisions.length; i++) {
        const division = divisions[i];
        console.log(`   [${i + 1}/${divisions.length}] ${division.text}`);

        // Select this division
        const changed = await page.evaluate((divValue) => {
          const selects = document.querySelectorAll("select.form-control");
          for (const select of selects) {
            const options = Array.from(select.querySelectorAll("option"));
            const hasDiv = options.some(opt =>
              opt.textContent.match(/U-\d+|2017|2016|2015|2014|2013|2012|2011|2010|2009|2008|2007|2006/i)
            );
            if (hasDiv) {
              select.value = divValue;
              select.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
          return false;
        }, division.value);

        if (changed) {
          await sleep(CONFIG.DIVISION_WAIT);
          const matches = await scrapeCurrentDivision(page, eventId, eventName, division.text);
          allMatches.push(...matches);
          stats.divisionsProcessed++;
        }
      }
    }

    console.log(`   Total matches for event: ${allMatches.length}`);
    await page.close();
    return allMatches;

  } catch (error) {
    console.error(`   ❌ Error scraping ${eventName}: ${error.message}`);
    stats.errors++;
    await page.close();
    return allMatches;
  }
}

async function scrapeCurrentDivision(page, eventId, eventName, divisionName) {
  const matches = await page.evaluate((eventId, eventName, divisionName) => {
    const results = [];

    // Find schedule tables (class: table table-striped table-hover table-condensed)
    const tables = document.querySelectorAll("table.table-striped.table-hover.table-condensed");

    tables.forEach(table => {
      const rows = table.querySelectorAll("tr");
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll("td"));

        // Expected format (10 columns):
        // 0: Match ID, 1: Date, 2: Time, 3: Field
        // 4: Home Pool, 5: Home Team, 6: Home Score
        // 7: Away Pool, 8: Away Team, 9: Away Score

        if (cells.length >= 10) {
          const matchId = cells[0].textContent.trim();
          const dateStr = cells[1].textContent.trim();
          const timeStr = cells[2].textContent.trim();
          const field = cells[3].textContent.trim();
          const homeTeam = cells[5].textContent.trim();
          const homeScore = cells[6].textContent.trim();
          const awayTeam = cells[8].textContent.trim();
          const awayScore = cells[9].textContent.trim();

          // Skip if missing team names
          if (!homeTeam || !awayTeam) return;

          // Skip header rows
          if (homeTeam.toLowerCase() === "team" || matchId.toLowerCase() === "game") return;

          results.push({
            match_id: matchId,
            date_str: dateStr,
            time_str: timeStr,
            field: field,
            home_team: homeTeam,
            home_score: homeScore,
            away_team: awayTeam,
            away_score: awayScore,
            division: divisionName,
          });
        }
      });
    });

    return results;
  }, eventId, eventName, divisionName);

  // Post-process matches with proper parsing
  const parsedMatches = matches.map(m => {
    const matchDate = parseHTGDate(m.date_str);
    const homeScore = m.home_score ? parseInt(m.home_score) : null;
    const awayScore = m.away_score ? parseInt(m.away_score) : null;
    const { gender, age_group } = inferGenderAndAge(m.division);

    // Generate unique match key
    const matchKey = `htg-${eventId}-${m.match_id}`.toLowerCase();

    return {
      event_id: eventId.toString(),
      event_name: eventName,
      match_date: matchDate,
      home_team_name: m.home_team,
      away_team_name: m.away_team,
      home_score: isNaN(homeScore) ? null : homeScore,
      away_score: isNaN(awayScore) ? null : awayScore,
      gender: gender,
      age_group: age_group,
      source_platform: "htgsports",
      source_match_key: matchKey,
      location: m.field || "Kansas City, KS",
      status: homeScore !== null && !isNaN(homeScore) ? "completed" : "scheduled",
    };
  }).filter(m => m.home_team_name && m.away_team_name);

  return parsedMatches;
}

// ===========================================
// DATABASE FUNCTIONS (V2 - Staging Tables)
// ===========================================

async function insertMatchesToStaging(matches) {
  if (matches.length === 0) return 0;

  // Filter out matches without required fields
  const validMatches = matches.filter(m => m.home_team_name && m.away_team_name && m.source_match_key);

  if (validMatches.length === 0) return 0;

  // Transform to staging_games schema
  const stagingGames = validMatches.map(m => ({
    match_date: m.match_date,
    match_time: null, // HTGSports time could be added if parsed
    home_team_name: m.home_team_name,
    away_team_name: m.away_team_name,
    home_score: m.home_score,
    away_score: m.away_score,
    event_name: m.event_name,
    event_id: m.event_id,
    venue_name: m.location,
    field_name: null,
    division: `${m.age_group || ""} ${m.gender || ""}`.trim() || null,
    source_platform: "htgsports",
    source_match_key: m.source_match_key,
    raw_data: {
      status: m.status,
      original: m,
    },
    processed: false,
  }));

  // Batch insert in chunks of 500
  const BATCH_SIZE = 500;
  let totalInserted = 0;

  for (let i = 0; i < stagingGames.length; i += BATCH_SIZE) {
    const batch = stagingGames.slice(i, i + BATCH_SIZE);

    try {
      const { data, error } = await supabase
        .from("staging_games")
        .insert(batch)
        .select();

      if (error) {
        console.error(`   ❌ DB error: ${error.message}`);
        stats.errors++;
      } else {
        totalInserted += data?.length || 0;
      }
    } catch (error) {
      console.error(`   ❌ Insert error: ${error.message}`);
      stats.errors++;
    }
  }

  return totalInserted;
}

async function registerEventToStaging(event) {
  try {
    await supabase
      .from("staging_events")
      .insert({
        event_name: event.name,
        event_type: event.type || "tournament",
        source_platform: "htgsports",
        source_event_id: event.id.toString(),
        state: "KS",
        raw_data: {
          year: event.year,
          scraped_at: new Date().toISOString(),
        },
        processed: false,
      });
  } catch (error) {
    // Ignore registration errors (duplicates OK in staging)
  }
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log("🏆 HTGSports Scraper for Heartland Soccer (FIXED VERSION)");
  console.log("==========================================================");

  // Parse command line arguments
  const args = process.argv.slice(2);
  const specificEventId = args.includes("--eventid") ?
    parseInt(args[args.indexOf("--eventid") + 1]) : null;
  const activeOnly = args.includes("--active-only");

  // Filter events
  let eventsToScrape = CONFIG.HEARTLAND_EVENTS;

  if (specificEventId) {
    // Specific event ID provided
    eventsToScrape = eventsToScrape.filter(e => e.id === specificEventId);
  } else if (activeOnly) {
    // Active only: current season (2025-2026) events
    const currentYear = new Date().getFullYear();
    eventsToScrape = eventsToScrape.filter(e =>
      e.year >= currentYear - 1 && e.year <= currentYear + 1
    );
    console.log(`🔄 Active-only mode: filtering to ${currentYear-1}-${currentYear+1} events`);
  }

  console.log(`Events to scrape: ${eventsToScrape.length}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  if (eventsToScrape.length === 0) {
    console.error("❌ No events to scrape");
    process.exit(1);
  }

  // Launch browser
  console.log("🌐 Launching browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (const event of eventsToScrape) {
      const matches = await scrapeEventSchedule(browser, event.id, event.name);
      stats.matchesFound += matches.length;

      if (matches.length > 0) {
        const inserted = await insertMatchesToStaging(matches);
        stats.matchesInserted += inserted;
        console.log(`   ✅ Staged ${inserted} matches`);

        await registerEventToStaging(event);
      }

      stats.eventsProcessed++;
      await sleep(CONFIG.BETWEEN_EVENTS);
    }
  } finally {
    await browser.close();
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 SCRAPE COMPLETE (V2 - Staging)");
  console.log("=".repeat(60));
  console.log(`   Events processed: ${stats.eventsProcessed}`);
  console.log(`   Divisions processed: ${stats.divisionsProcessed}`);
  console.log(`   Matches found: ${stats.matchesFound}`);
  console.log(`   Matches staged: ${stats.matchesInserted}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log(`   Completed: ${new Date().toISOString()}`);
  console.log("\n📋 Next: Run validation pipeline to process staged data");
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
