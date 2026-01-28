/**
 * Heartland Soccer League Results Scraper v2.0
 * =============================================
 *
 * Scrapes match results with SCORES from Heartland's CGI reporting system.
 * This is the AUTHORITATIVE source for Heartland League match results.
 *
 * V2 ARCHITECTURE:
 * - Writes to staging_games and staging_events (not production tables)
 * - Validation pipeline moves data to matches_v2 after processing
 *
 * Discovered endpoints:
 * - https://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi
 * - https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi
 *
 * Usage:
 *   node scripts/scrapeHeartlandResults.js                     # Full scrape all divisions
 *   node scripts/scrapeHeartlandResults.js --level Premier     # Premier only
 *   node scripts/scrapeHeartlandResults.js --age U-13          # Specific age
 *
 * Prerequisites:
 *   npm install cheerio
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
  RESULTS_URL: "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi",
  STANDINGS_URL: "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi",

  // Premier League parameters
  PREMIER: {
    level: "Premier",
    genders: ["Boys", "Girls"],
    ages: ["U-9", "U-10", "U-11", "U-12", "U-13", "U-14", "U-15", "U-16", "U-17", "U-18"],
    subdivisions: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"],
    paramNames: { gender: "b_g", age: "age", subdiv: "subdivison" },
  },

  // Recreational League parameters
  RECREATIONAL: {
    level: "Recreational",
    genders: ["Boys", "Girls"],
    ages: [
      "U-9/3rd Grade 7v7",
      "U-9/10-3rd/4th Grade 9v9",
      "U-10/4th Grade 7v7",
      "U-10/4th Grade 9v9",
      "U-11/5th Grade 9v9",
      "U-12/6th Grade 9v9",
      "U-13/7th Grade",
      "U-14/8th Grade",
      "U-14/15-8th/9th Grade",
    ],
    subdivisions: ["CANADA", "MEXICO", "USA", "1", "2", "3"],
    paramNames: { gender: "b_g3", age: "age1", subdiv: "subdivison1" },
  },

  // Rate limiting
  REQUEST_DELAY: 500, // ms between requests
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
  divisionsScraped: 0,
  divisionsWithData: 0,
  matchesFound: 0,
  matchesInserted: 0,
  matchesUpdated: 0,
  errors: 0,
};

// ===========================================
// UTILITIES
// ===========================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAgeGroup(ageStr) {
  // Convert "U-13/7th Grade" to "U13"
  const match = ageStr.match(/U-?(\d+)/i);
  return match ? `U${match[1]}` : ageStr;
}

function parseHeartlandDate(dateStr) {
  // Format: "Aug 16 (Sat)" or "Sep 5 (Fri)"
  if (!dateStr || dateStr.trim() === "") return null;

  const months = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  const match = dateStr.match(/([A-Za-z]+)\s+(\d+)/);
  if (!match) return null;

  const month = months[match[1]];
  const day = parseInt(match[2], 10);

  if (month === undefined || isNaN(day)) return null;

  // Soccer season runs Aug 1 - Jul 31
  // Current date is Jan 2026, so:
  // - Aug-Dec = 2025 (previous calendar year)
  // - Jan-Jul = 2026 (current calendar year)
  const currentYear = new Date().getFullYear();
  const year = month >= 7 ? currentYear - 1 : currentYear; // Aug(7) through Dec(11) = last year

  const date = new Date(year, month, day);
  return date.toISOString().split("T")[0];
}

// ===========================================
// SCRAPING FUNCTIONS
// ===========================================

async function fetchDivisionResults(level, gender, age, subdiv, paramNames) {
  const url = new URL(CONFIG.RESULTS_URL);
  url.searchParams.set("level", level);
  url.searchParams.set(paramNames.gender, gender);
  url.searchParams.set(paramNames.age, age);
  url.searchParams.set(paramNames.subdiv, subdiv);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      console.log(`   ⚠️ HTTP ${response.status} for ${gender} ${age} Div ${subdiv}`);
      return [];
    }

    const html = await response.text();

    // Check for error page
    if (html.includes("Select Subdivision Error") || html.includes("could not match")) {
      return [];
    }

    return parseResultsHtml(html, level, gender, age, subdiv);
  } catch (error) {
    console.error(`   ❌ Fetch error: ${error.message}`);
    stats.errors++;
    return [];
  }
}

function parseResultsHtml(html, level, gender, age, subdiv) {
  const $ = cheerio.load(html);
  const matches = [];

  // Get current year from context
  const currentYear = new Date().getFullYear();
  let lastDate = null;

  // Find results table rows
  $("table tr").each((i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 7) return;

    const dateCell = $(cells[0]).text().trim();
    const gameNum = $(cells[1]).text().trim();
    const time = $(cells[2]).text().trim();
    const homeTeam = $(cells[3]).text().trim();
    const homeScore = $(cells[4]).text().trim();
    const awayTeam = $(cells[5]).text().trim();
    const awayScore = $(cells[6]).text().trim();

    // Skip header rows
    if (homeTeam === "Home" || homeScore === "") return;

    // Parse date - some rows may have empty date (same day as previous)
    const matchDate = dateCell ? parseHeartlandDate(dateCell, currentYear) : lastDate;
    if (dateCell) lastDate = matchDate;

    // Extract team IDs from format "7311 DASC 2013 Black"
    const homeMatch = homeTeam.match(/^(\d+)\s+(.+)$/);
    const awayMatch = awayTeam.match(/^(\d+)\s+(.+)$/);

    if (!homeMatch || !awayMatch) return;

    const homeId = homeMatch[1];
    const homeName = homeMatch[2].trim();
    const awayId = awayMatch[1];
    const awayName = awayMatch[2].trim();

    // Parse scores
    const homeScoreNum = parseInt(homeScore, 10);
    const awayScoreNum = parseInt(awayScore, 10);

    if (isNaN(homeScoreNum) || isNaN(awayScoreNum)) return;

    // Generate unique match key
    const normalizedAge = normalizeAgeGroup(age);
    const matchKey = `heartland-${level.toLowerCase()}-${homeId}-${awayId}-${matchDate}-${gameNum}`;

    matches.push({
      event_id: `heartland-${level.toLowerCase()}-2025`,
      event_name: `Heartland ${level} League 2025`,
      match_date: matchDate,
      match_time: time,
      match_number: gameNum,
      home_team_name: homeName,
      away_team_name: awayName,
      home_score: homeScoreNum,
      away_score: awayScoreNum,
      gender: gender,
      age_group: normalizedAge,
      location: "Kansas City Area",
      source_platform: "heartland",
      source_match_key: matchKey,
      status: "completed",
      heartland_home_id: homeId,
      heartland_away_id: awayId,
      heartland_subdivision: subdiv,
      heartland_level: level,
    });
  });

  return matches;
}

// ===========================================
// DATABASE FUNCTIONS (V2 - Staging Tables)
// ===========================================

async function insertMatchesToStaging(matches) {
  if (matches.length === 0) return { inserted: 0 };

  // Transform to staging_games schema
  const stagingGames = matches.map((m) => ({
    match_date: m.match_date,
    match_time: m.match_time ? m.match_time : null,
    home_team_name: m.home_team_name,
    away_team_name: m.away_team_name,
    home_score: m.home_score,
    away_score: m.away_score,
    event_name: m.event_name,
    event_id: m.event_id,
    venue_name: m.location,
    field_name: null,
    division: `${m.age_group || ""} ${m.gender || ""}`.trim() || null,
    source_platform: "heartland",
    source_match_key: m.source_match_key,
    raw_data: {
      match_number: m.match_number,
      status: m.status,
      heartland_home_id: m.heartland_home_id,
      heartland_away_id: m.heartland_away_id,
      heartland_subdivision: m.heartland_subdivision,
      heartland_level: m.heartland_level,
      original: m,
    },
    processed: false,
  }));

  const BATCH_SIZE = 500;
  let inserted = 0;

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
        inserted += data?.length || 0;
      }
    } catch (error) {
      console.error(`   ❌ Insert error: ${error.message}`);
      stats.errors++;
    }
  }

  return { inserted };
}

async function registerLeagueToStaging(level) {
  // Insert Heartland league to staging_events
  const year = new Date().getFullYear();
  try {
    await supabase
      .from("staging_events")
      .insert({
        event_name: `Heartland ${level} League ${year}`,
        event_type: "league",
        source_platform: "heartland",
        source_event_id: `heartland-${level.toLowerCase()}-${year}`,
        state: "KS",
        region: "Kansas City",
        raw_data: {
          level: level,
          scraped_at: new Date().toISOString(),
        },
        processed: false,
      });
  } catch (error) {
    // Ignore duplicate errors in staging
  }
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log("⚽ Heartland Soccer League Results Scraper");
  console.log("==========================================");
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const levelFilter = args.includes("--level") ? args[args.indexOf("--level") + 1] : null;
  const ageFilter = args.includes("--age") ? args[args.indexOf("--age") + 1] : null;

  const levels = levelFilter
    ? [levelFilter === "Premier" ? CONFIG.PREMIER : CONFIG.RECREATIONAL]
    : [CONFIG.PREMIER, CONFIG.RECREATIONAL];

  console.log(`Mode: V2 Staging (validation pipeline processes data)`);
  console.log(`Levels: ${levels.map((l) => l.level).join(", ")}`);
  if (ageFilter) console.log(`Age filter: ${ageFilter}`);
  console.log("");

  const allMatches = [];

  for (const levelConfig of levels) {
    console.log(`\n📋 Scraping ${levelConfig.level} League...`);

    for (const gender of levelConfig.genders) {
      const ages = ageFilter
        ? levelConfig.ages.filter((a) => a.includes(ageFilter))
        : levelConfig.ages;

      for (const age of ages) {
        console.log(`   ${gender} ${age}...`);

        for (const subdiv of levelConfig.subdivisions) {
          stats.divisionsScraped++;

          const matches = await fetchDivisionResults(
            levelConfig.level,
            gender,
            age,
            subdiv,
            levelConfig.paramNames
          );

          if (matches.length > 0) {
            stats.divisionsWithData++;
            stats.matchesFound += matches.length;
            allMatches.push(...matches);
            process.stdout.write(`     Div ${subdiv}: ${matches.length} matches\r`);
          }

          await sleep(CONFIG.REQUEST_DELAY);
        }
        console.log(`     Total: ${allMatches.length} matches so far`);
      }
    }
  }

  // Deduplicate
  const uniqueMatches = [];
  const seenKeys = new Set();
  for (const match of allMatches) {
    if (!seenKeys.has(match.source_match_key)) {
      seenKeys.add(match.source_match_key);
      uniqueMatches.push(match);
    }
  }

  console.log(`\n📊 Total unique matches: ${uniqueMatches.length}`);

  // Insert to staging
  if (uniqueMatches.length > 0) {
    console.log("\n💾 Staging matches...");
    const { inserted } = await insertMatchesToStaging(uniqueMatches);
    stats.matchesInserted = inserted;
    console.log(`   ✅ Staged ${inserted} matches`);

    // Register leagues to staging
    for (const levelConfig of levels) {
      await registerLeagueToStaging(levelConfig.level);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("📊 SCRAPE COMPLETE (V2 - Staging)");
  console.log("=".repeat(50));
  console.log(`   Divisions scraped: ${stats.divisionsScraped}`);
  console.log(`   Divisions with data: ${stats.divisionsWithData}`);
  console.log(`   Matches found: ${stats.matchesFound}`);
  console.log(`   Matches staged: ${stats.matchesInserted}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log(`   Completed: ${new Date().toISOString()}`);
  console.log("\n📋 Next: Run validation pipeline to process staged data");

  // Sample output
  if (uniqueMatches.length > 0) {
    console.log("\n📋 Sample matches:");
    uniqueMatches.slice(0, 5).forEach((m, i) => {
      console.log(
        `   ${i + 1}. ${m.match_date} | ${m.home_team_name} ${m.home_score}-${m.away_score} ${m.away_team_name}`
      );
    });
  }
}

main().catch((error) => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
