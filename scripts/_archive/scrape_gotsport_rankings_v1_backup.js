/**
 * SoccerView - GotSport Rankings Scraper (Puppeteer)
 *
 * Scrapes national youth soccer team rankings from rankings.gotsport.com
 * Uses Puppeteer for JavaScript-rendered content
 *
 * Setup:
 *   npm install puppeteer
 *
 * Usage:
 *   node scripts/scrape_gotsport_rankings.js
 *   node scripts/scrape_gotsport_rankings.js --ages U12,U13,U14
 *   node scripts/scrape_gotsport_rankings.js --states CA,TX,FL --gender Boys
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import fs from "fs";
import puppeteer from "puppeteer";

// ============================================================
// CONFIGURATION
// ============================================================

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

const BASE_URL = "https://rankings.gotsport.com";

const AGE_GROUPS = [
  "U10",
  "U11",
  "U12",
  "U13",
  "U14",
  "U15",
  "U16",
  "U17",
  "U18",
  "U19",
];
const GENDERS = ["Boys", "Girls"];

const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
];

// Output directory
const OUTPUT_DIR = "gotsport_rankings_data";

// ============================================================
// SCRAPER CLASS
// ============================================================

class GotSportRankingsScraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.allTeams = [];
  }

  async init() {
    console.log("Launching browser...");
    this.browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
    });
    this.page = await this.browser.newPage();

    // Set viewport and user agent
    await this.page.setViewport({ width: 1920, height: 1080 });
    await this.page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    // Block unnecessary resources for faster loading
    await this.page.setRequestInterception(true);
    this.page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log("Browser ready\n");
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async navigateToRankings() {
    console.log(`Navigating to ${BASE_URL}...`);
    try {
      await this.page.goto(BASE_URL, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // Wait for the page to fully render
      await this.page.waitForTimeout(2000);

      // Check if we landed on the rankings page
      const title = await this.page.title();
      console.log(`Page title: ${title}`);

      // Take a screenshot for debugging
      await this.page.screenshot({ path: `${OUTPUT_DIR}/rankings_page.png` });
      console.log(`Screenshot saved to ${OUTPUT_DIR}/rankings_page.png`);

      return true;
    } catch (error) {
      console.error(`Navigation error: ${error.message}`);
      return false;
    }
  }

  async selectFilters(ageGroup, gender, state = null) {
    console.log(
      `  Setting filters: ${gender} ${ageGroup}${state ? ` - ${state}` : " - National"}...`,
    );

    try {
      // Wait for filter elements to be available
      await this.page.waitForTimeout(1000);

      // Try to find and interact with filter dropdowns
      // The exact selectors depend on the page structure

      // Look for age group selector
      const ageSelector = await this.page.$(
        'select[name*="age"], [data-filter="age"], #age-filter',
      );
      if (ageSelector) {
        await ageSelector.select(ageGroup.replace("U", ""));
      }

      // Look for gender selector
      const genderSelector = await this.page.$(
        'select[name*="gender"], [data-filter="gender"], #gender-filter',
      );
      if (genderSelector) {
        await genderSelector.select(gender.toLowerCase());
      }

      // Look for state selector if needed
      if (state) {
        const stateSelector = await this.page.$(
          'select[name*="state"], [data-filter="state"], #state-filter',
        );
        if (stateSelector) {
          await stateSelector.select(state);
        }
      }

      // Wait for results to load
      await this.page.waitForTimeout(2000);

      return true;
    } catch (error) {
      console.error(`    Filter error: ${error.message}`);
      return false;
    }
  }

  async extractTeamsFromPage(ageGroup, gender, state = null) {
    const teams = [];

    try {
      // Extract team data from the page
      // This will depend on the actual page structure
      const teamData = await this.page.evaluate(() => {
        const results = [];

        // Try multiple possible selectors for team rows
        const selectors = [
          "table tbody tr",
          ".ranking-row",
          ".team-row",
          "[data-team]",
          ".ranking-item",
          ".team-card",
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            elements.forEach((el, index) => {
              // Try to extract team data
              const cells = el.querySelectorAll("td");
              const text = el.textContent || "";

              // Try to parse rank, team name, state, points
              let rank = index + 1;
              let teamName = "";
              let teamState = "";
              let points = 0;

              if (cells.length >= 2) {
                rank = parseInt(cells[0]?.textContent?.trim()) || index + 1;
                teamName = cells[1]?.textContent?.trim() || "";
                teamState = cells[2]?.textContent?.trim() || "";
                points =
                  parseFloat(
                    cells[cells.length - 1]?.textContent?.replace(
                      /[^0-9.]/g,
                      "",
                    ),
                  ) || 0;
              } else {
                // Try to parse from text content
                const rankMatch = text.match(/^(\d+)/);
                if (rankMatch) rank = parseInt(rankMatch[1]);

                // Look for team name in various elements
                const nameEl = el.querySelector(
                  ".team-name, .name, a, h3, h4, span",
                );
                teamName =
                  nameEl?.textContent?.trim() || text.substring(0, 100);
              }

              if (teamName && teamName.length > 2) {
                results.push({ rank, teamName, teamState, points });
              }
            });

            if (results.length > 0) break;
          }
        }

        return results;
      });

      // Add metadata to each team
      teamData.forEach((team) => {
        teams.push({
          rank: team.rank,
          team_name: team.teamName,
          state: team.teamState || state,
          points: team.points,
          age_group: ageGroup,
          gender: gender,
          source: "gotsport_rankings",
          scraped_at: new Date().toISOString(),
        });
      });

      console.log(`    Extracted ${teams.length} teams`);
    } catch (error) {
      console.error(`    Extraction error: ${error.message}`);
    }

    return teams;
  }

  async scrapeRankingsByUrl(ageGroup, gender, state = null) {
    // Construct URL with parameters
    const age = ageGroup.replace("U", "");
    let url = `${BASE_URL}?age=${age}&gender=${gender.toLowerCase()}`;
    if (state) {
      url += `&state=${state}`;
    }

    console.log(`  Fetching: ${url}`);

    try {
      await this.page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // Wait for content to load
      await this.page.waitForTimeout(3000);

      // Extract teams
      const teams = await this.extractTeamsFromPage(ageGroup, gender, state);
      return teams;
    } catch (error) {
      console.error(`    URL fetch error: ${error.message}`);
      return [];
    }
  }

  async scrapeAllRankings(options = {}) {
    const {
      ageGroups = AGE_GROUPS,
      genders = GENDERS,
      states = null,
      topN = 100,
    } = options;

    console.log("=".repeat(60));
    console.log("GOTSPORT RANKINGS SCRAPER");
    console.log("=".repeat(60));
    console.log(`Age groups: ${ageGroups.join(", ")}`);
    console.log(`Genders: ${genders.join(", ")}`);
    console.log(`States: ${states ? states.join(", ") : "National"}`);
    console.log();

    // First navigate to main page
    const success = await this.navigateToRankings();
    if (!success) {
      console.error("Failed to navigate to rankings page");
      return [];
    }

    // Get the page HTML for analysis
    const html = await this.page.content();
    fs.writeFileSync(`${OUTPUT_DIR}/rankings_page.html`, html);
    console.log(`Page HTML saved to ${OUTPUT_DIR}/rankings_page.html\n`);

    let count = 0;
    const totalCombinations =
      genders.length * ageGroups.length * (states ? states.length : 1);

    for (const gender of genders) {
      for (const age of ageGroups) {
        if (states) {
          for (const state of states) {
            count++;
            console.log(
              `[${count}/${totalCombinations}] ${gender} ${age} - ${state}`,
            );
            const teams = await this.scrapeRankingsByUrl(age, gender, state);
            this.allTeams.push(...teams.slice(0, topN));
            await this.page.waitForTimeout(1500); // Rate limiting
          }
        } else {
          count++;
          console.log(
            `[${count}/${totalCombinations}] ${gender} ${age} - National`,
          );
          const teams = await this.scrapeRankingsByUrl(age, gender);
          this.allTeams.push(...teams.slice(0, topN));
          await this.page.waitForTimeout(1500); // Rate limiting
        }
      }
    }

    // Deduplicate
    this.deduplicateTeams();

    return this.allTeams;
  }

  deduplicateTeams() {
    const seen = new Set();
    const unique = [];

    for (const team of this.allTeams) {
      const key = `${team.team_name}|${team.age_group}|${team.gender}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(team);
      }
    }

    console.log(
      `\nDeduplicated: ${this.allTeams.length} -> ${unique.length} teams`,
    );
    this.allTeams = unique;
  }

  toSupabaseFormat() {
    return this.allTeams.map((team) => ({
      team_name: team.team_name,
      elo_rating: 1500 + (team.points || 0) / 10,
      matches_played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      state: team.state,
      gender: team.gender,
      age_group: team.age_group,
      gotsport_rank: team.rank,
      gotsport_points: team.points,
    }));
  }

  async saveResults() {
    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().split("T")[0].replace(/-/g, "_");

    // Save raw data
    const rawFile = `${OUTPUT_DIR}/gotsport_rankings_${timestamp}.json`;
    fs.writeFileSync(rawFile, JSON.stringify(this.allTeams, null, 2));
    console.log(`Saved: ${rawFile}`);

    // Save Supabase format
    const supabaseData = this.toSupabaseFormat();
    const supabaseFile = `${OUTPUT_DIR}/supabase_gotsport_teams_${timestamp}.json`;
    fs.writeFileSync(supabaseFile, JSON.stringify(supabaseData, null, 2));
    console.log(`Saved: ${supabaseFile}`);

    return { rawFile, supabaseFile };
  }

  async importToSupabase() {
    if (!supabase) {
      console.log("Supabase not configured - skipping import");
      return;
    }

    console.log("\nImporting to Supabase...");
    const teams = this.toSupabaseFormat();

    let inserted = 0;
    let errors = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < teams.length; i += BATCH_SIZE) {
      const batch = teams.slice(i, i + BATCH_SIZE);

      const { data, error } = await supabase
        .from("team_elo")
        .upsert(batch, { onConflict: "team_name", ignoreDuplicates: false })
        .select();

      if (error) {
        console.error(`  Batch error: ${error.message}`);
        errors += batch.length;
      } else {
        inserted += data?.length || batch.length;
        process.stdout.write(`\r  Imported: ${inserted} teams...`);
      }
    }

    console.log(`\n  Complete: ${inserted} imported, ${errors} errors`);
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ages" && args[i + 1]) {
      options.ageGroups = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--genders" && args[i + 1]) {
      options.genders = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--states" && args[i + 1]) {
      options.states = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--top" && args[i + 1]) {
      options.topN = parseInt(args[i + 1]);
      i++;
    }
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const scraper = new GotSportRankingsScraper();

  try {
    await scraper.init();
    const teams = await scraper.scrapeAllRankings(options);

    if (teams.length > 0) {
      const files = await scraper.saveResults();
      await scraper.importToSupabase();

      console.log("\n" + "=".repeat(60));
      console.log("SCRAPING COMPLETE");
      console.log("=".repeat(60));
      console.log(`  Total teams: ${teams.length}`);
      console.log(`  Files saved: ${Object.values(files).join(", ")}`);
    } else {
      console.log("\nNo teams extracted. Check the page structure.");
      console.log(
        `Review ${OUTPUT_DIR}/rankings_page.html and ${OUTPUT_DIR}/rankings_page.png`,
      );
    }
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await scraper.close();
  }
}

main();
