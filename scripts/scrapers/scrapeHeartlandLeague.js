/**
 * Heartland Soccer League Calendar Scraper v2.0
 * ==============================================
 *
 * Scrapes regular season league match data from calendar.heartlandsoccer.net
 * Uses Puppeteer to handle the team lookup and schedule pages.
 *
 * V2 ARCHITECTURE:
 * - Writes to staging_games (not production tables)
 * - Validation pipeline moves data to matches_v2 after processing
 *
 * FIXED: Updated DOM selectors based on actual page structure
 * - Search form: POST to /team/search with team_search[name]
 * - Results: Team cards with "Show Events" links to /team/events/{id}
 * - Events: Cards with "Team1 vs Team2" format, date, time, field
 *
 * Usage:
 *   node scripts/scrapeHeartlandLeague.js                    # Full scrape
 *   node scripts/scrapeHeartlandLeague.js --team "Sporting"  # Search specific team
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
  BASE_URL: "https://calendar.heartlandsoccer.net",
  TEAM_LOOKUP_URL: "https://calendar.heartlandsoccer.net/team/",

  // Major KC-area clubs to search for
  CLUB_SEARCH_TERMS: [
    "Sporting",
    "KC Fusion",
    "Kansas Rush",
    "Nationals",
    "United",
    "Academy",
    "Athletics",
    "Fire",
    "Blue Valley",
    "FC",
  ],

  // Delays
  PAGE_LOAD_WAIT: 3000,
  SEARCH_DELAY: 2000,
  BETWEEN_TEAMS: 1500,

  // Limits
  MAX_TEAMS_PER_SEARCH: 100,
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
  searchesPerformed: 0,
  teamsFound: 0,
  teamsProcessed: 0,
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

function parseHeartlandDate(dateStr) {
  if (!dateStr) return null;
  try {
    // Format: "August 16, 2025" or "September 13, 2025"
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

function parseTeamFromMatch(matchText, position) {
  // Format: "7927 - Sporting City 17B Blue-East vs 7929 - SS Academy 2017B Pre Select"
  // position: 'home' for first team, 'away' for second team
  const vsMatch = matchText.match(/^(.+?)\s+vs\s+(.+)$/i);
  if (!vsMatch) return { id: null, name: null };

  const teamStr = position === "home" ? vsMatch[1].trim() : vsMatch[2].trim();

  // Extract team ID and name: "7927 - Sporting City 17B Blue-East"
  const idNameMatch = teamStr.match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
  if (idNameMatch) {
    return {
      id: idNameMatch[1],
      name: idNameMatch[2].trim(),
    };
  }

  return { id: null, name: teamStr };
}

function inferGenderAndAge(teamName) {
  if (!teamName) return { gender: null, age_group: null };
  const lower = teamName.toLowerCase();

  // Gender detection - look for B or G followed by year or age
  let gender = null;
  if (/\d{2,4}[bg]\b|\b[bg]\d{2,4}\b/i.test(teamName) || lower.includes("boys")) {
    gender = lower.includes("girls") || /g\d{2}/i.test(teamName) ? "Girls" : "Boys";
  } else if (lower.includes("girls") || /g\d{2}/i.test(teamName)) {
    gender = "Girls";
  }

  // Age group detection - look for U-XX or birth year (2017, 2016, etc.)
  let age_group = null;
  const ageMatch = lower.match(/u[-]?(\d+)/i);
  if (ageMatch) {
    age_group = `U${ageMatch[1]}`;
  } else {
    // Birth year pattern (2017, 2016, etc.)
    const yearMatch = teamName.match(/\b(20[01]\d)\b/);
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

async function searchTeams(page, searchTerm) {
  console.log(`\n🔍 Searching for teams: "${searchTerm}"`);

  try {
    await page.goto(CONFIG.TEAM_LOOKUP_URL, { waitUntil: "networkidle2" });
    await sleep(CONFIG.PAGE_LOAD_WAIT);

    // Find and fill the search input (id="team_search_name")
    const searchInput = await page.$("#team_search_name");
    if (!searchInput) {
      // Try alternative selector
      const altInput = await page.$('input[name="team_search[name]"]');
      if (!altInput) {
        console.log("   ⚠️ Search input not found");
        return [];
      }
      await altInput.click({ clickCount: 3 });
      await altInput.type(searchTerm);
    } else {
      await searchInput.click({ clickCount: 3 });
      await searchInput.type(searchTerm);
    }

    // Submit the form - click the submit button
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Wait for navigation/form submission
    await sleep(CONFIG.SEARCH_DELAY);
    await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});

    // Debug: Check what's on the page after search
    const pageUrl = page.url();
    console.log(`   Page URL after search: ${pageUrl}`);

    // Extract team results - look for "Show Events" links
    const teams = await page.evaluate(() => {
      const results = [];

      // Debug: count links
      const allLinks = document.querySelectorAll("a");
      const eventLinks = document.querySelectorAll('a[href*="/team/events/"]');
      results.push({ debug: true, allLinks: allLinks.length, eventLinks: eventLinks.length });

      // Find all cards with team info
      // Structure: <div class="card">
      //              <h5 class="card-header">7927 - Sporting City 17B Blue-East</h5>
      //              <div class="card-body"><a href="/team/events/7927">Show Events</a></div>
      //            </div>
      const cards = document.querySelectorAll("div.card");
      cards.forEach(card => {
        const header = card.querySelector(".card-header, h5");
        const link = card.querySelector('a[href*="/team/events/"]');

        if (header && link) {
          const href = link.getAttribute("href");
          const idMatch = href.match(/\/team\/events\/([A-Za-z0-9]+)/);
          const headerText = header.textContent.trim();

          if (idMatch && headerText.includes(" - ")) {
            const teamMatch = headerText.match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
            if (teamMatch) {
              results.push({
                id: teamMatch[1],
                name: teamMatch[2].trim(),
                url: href,
              });
            }
          }
        }
      });

      // Remove duplicates
      const uniqueTeams = [];
      const seenIds = new Set();
      for (const team of results) {
        if (!seenIds.has(team.id)) {
          seenIds.add(team.id);
          uniqueTeams.push(team);
        }
      }

      return uniqueTeams.slice(0, 100);
    });

    // Handle debug info
    const debugInfo = teams.find(t => t.debug);
    if (debugInfo) {
      console.log(`   Debug: ${debugInfo.allLinks} total links, ${debugInfo.eventLinks} event links`);
    }

    // Filter out debug entry
    const realTeams = teams.filter(t => !t.debug);
    console.log(`   Found ${realTeams.length} teams`);
    stats.searchesPerformed++;
    stats.teamsFound += realTeams.length;

    return realTeams;

  } catch (error) {
    console.error(`   ❌ Search error: ${error.message}`);
    stats.errors++;
    return [];
  }
}

async function scrapeTeamSchedule(page, team) {
  console.log(`   📅 Scraping: ${team.name} (ID: ${team.id})`);

  try {
    // Navigate to team events page
    const eventsUrl = team.url.startsWith("http")
      ? team.url
      : `${CONFIG.BASE_URL}${team.url}`;

    await page.goto(eventsUrl, { waitUntil: "networkidle2" });
    await sleep(CONFIG.PAGE_LOAD_WAIT);

    // Extract match data from cards
    const matches = await page.evaluate(() => {
      const results = [];

      // Find all event cards
      const cards = document.querySelectorAll("div.card");

      cards.forEach(card => {
        const text = card.innerText;
        const lines = text.split("\n").map(l => l.trim()).filter(l => l);

        if (lines.length >= 2) {
          // Line 0: "Team1 vs Team2"
          // Line 1: Date (e.g., "August 16, 2025")
          // Line 2: Time (e.g., "3:15 PM - 4:05 PM")
          // Line 3: Field (e.g., "Field: CMSF #4 South")

          const matchLine = lines.find(l => l.includes(" vs "));
          const dateLine = lines.find(l => l.match(/\w+\s+\d{1,2},\s+\d{4}/));
          const fieldLine = lines.find(l => l.startsWith("Field:"));

          if (matchLine && dateLine) {
            results.push({
              matchText: matchLine,
              dateText: dateLine,
              fieldText: fieldLine ? fieldLine.replace("Field:", "").trim() : null,
            });
          }
        }
      });

      return results;
    });

    // Parse matches
    const parsedMatches = [];
    for (const match of matches) {
      const homeTeam = parseTeamFromMatch(match.matchText, "home");
      const awayTeam = parseTeamFromMatch(match.matchText, "away");
      const matchDate = parseHeartlandDate(match.dateText);

      if (!homeTeam.name || !awayTeam.name || !matchDate) {
        continue;
      }

      // Infer gender and age from team names
      const { gender, age_group } = inferGenderAndAge(homeTeam.name) ||
        inferGenderAndAge(awayTeam.name);

      // Generate unique match key
      const matchKey = `heartland-${homeTeam.id || "unk"}-${awayTeam.id || "unk"}-${matchDate}`.toLowerCase();

      parsedMatches.push({
        event_id: `heartland-league-${matchDate.split("-")[0]}`,
        event_name: `Heartland Soccer League ${matchDate.split("-")[0]}`,
        match_date: matchDate,
        home_team_name: homeTeam.name,
        away_team_name: awayTeam.name,
        home_score: null,  // League schedule - scores not available yet
        away_score: null,
        gender: gender,
        age_group: age_group,
        location: match.fieldText || "Kansas City Area",
        source_platform: "heartland",
        source_match_key: matchKey,
        status: "scheduled",
      });
    }

    console.log(`      Found ${parsedMatches.length} matches`);
    stats.teamsProcessed++;
    stats.matchesFound += parsedMatches.length;

    return parsedMatches;

  } catch (error) {
    console.error(`      ❌ Error: ${error.message}`);
    stats.errors++;
    return [];
  }
}

// ===========================================
// DATABASE FUNCTIONS (V2 - Staging Tables)
// ===========================================

async function insertMatchesToStaging(matches) {
  if (matches.length === 0) return 0;

  const validMatches = matches.filter(m =>
    m.home_team_name && m.away_team_name && m.match_date && m.source_match_key
  );

  if (validMatches.length === 0) return 0;

  // Transform to staging_games schema
  const stagingGames = validMatches.map(m => ({
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
    division: `${m.age_group || ""} ${m.gender || ""}`.trim() || null,
    source_platform: "heartland",
    source_match_key: m.source_match_key,
    raw_data: {
      status: m.status,
      original: m,
    },
    processed: false,
  }));

  // Batch insert
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

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log("⚽ Heartland Soccer League Scraper (FIXED VERSION)");
  console.log("===================================================");

  // Parse command line arguments
  const args = process.argv.slice(2);
  const specificTeam = args.includes("--team") ?
    args[args.indexOf("--team") + 1] : null;
  const activeOnly = args.includes("--active-only");

  // For active-only mode, use a reduced set of search terms (major clubs only)
  const ACTIVE_SEARCH_TERMS = ["Sporting", "KC Fusion", "Kansas Rush", "Academy", "FC"];

  let searchTerms;
  if (specificTeam) {
    searchTerms = [specificTeam];
  } else if (activeOnly) {
    searchTerms = ACTIVE_SEARCH_TERMS;
    console.log("🔄 Active-only mode: using reduced search set");
  } else {
    searchTerms = CONFIG.CLUB_SEARCH_TERMS;
  }

  console.log(`Search terms: ${searchTerms.length}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Launch browser
  console.log("🌐 Launching browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const allMatches = [];

  try {
    const page = await browser.newPage();
    const processedTeamIds = new Set();

    for (const searchTerm of searchTerms) {
      const teams = await searchTeams(page, searchTerm);

      for (const team of teams) {
        // Skip already processed teams
        if (processedTeamIds.has(team.id)) {
          continue;
        }
        processedTeamIds.add(team.id);

        const matches = await scrapeTeamSchedule(page, team);
        allMatches.push(...matches);

        await sleep(CONFIG.BETWEEN_TEAMS);
      }
    }

    // Deduplicate matches by source_match_key
    const uniqueMatches = [];
    const seenKeys = new Set();
    for (const match of allMatches) {
      if (!seenKeys.has(match.source_match_key)) {
        seenKeys.add(match.source_match_key);
        uniqueMatches.push(match);
      }
    }

    console.log(`\n📊 Total unique matches found: ${uniqueMatches.length}`);

    // Insert matches to staging
    if (uniqueMatches.length > 0) {
      const inserted = await insertMatchesToStaging(uniqueMatches);
      stats.matchesInserted = inserted;
      console.log(`   ✅ Staged ${inserted} matches`);
    }

  } finally {
    await browser.close();
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("📊 SCRAPE COMPLETE (V2 - Staging)");
  console.log("=".repeat(50));
  console.log(`   Searches performed: ${stats.searchesPerformed}`);
  console.log(`   Teams found: ${stats.teamsFound}`);
  console.log(`   Teams processed: ${stats.teamsProcessed}`);
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
