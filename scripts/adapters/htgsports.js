/**
 * HTGSports Source Adapter v1.0
 * =============================
 *
 * Configuration for scraping HTGSports (events.htgsports.net).
 * This is the source for Heartland Soccer tournaments.
 *
 * TECHNOLOGY: Puppeteer (JavaScript SPA)
 * The site uses client-side rendering, so we need a real browser.
 *
 * Extracted from: scripts/scrapers/scrapeHTGSports.js
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "htgsports",
  name: "HTGSports",
  baseUrl: "https://events.htgsports.net",

  // =========================================
  // TECHNOLOGY
  // =========================================

  /** HTGSports is a JavaScript SPA - requires Puppeteer */
  technology: "puppeteer",

  // =========================================
  // RATE LIMITING
  // Preserved from scrapeHTGSports.js CONFIG
  // =========================================

  rateLimiting: {
    requestDelayMin: 2000,
    requestDelayMax: 3000,
    iterationDelay: 2000,     // DIVISION_WAIT
    itemDelay: 2000,          // BETWEEN_EVENTS
    maxRetries: 3,
    retryDelays: [5000, 15000, 30000],
    cooldownOn429: 60000,
    cooldownOn500: 30000,
  },

  // =========================================
  // USER AGENTS
  // =========================================

  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  ],

  // =========================================
  // ENDPOINTS
  // =========================================

  endpoints: {
    /** Schedule/Results page for an event */
    schedule: "/?eventid={eventId}#/scheduleresults",
  },

  // =========================================
  // PARSING CONFIGURATION (Puppeteer)
  // =========================================

  parsing: {
    puppeteer: {
      /** Wait for schedule table to load */
      waitForSelector: "table.table-striped",

      /** CSS selector for division dropdown */
      divisionDropdown: "select.form-control",

      /** Regex to identify division options - U09/U-09/U11/U-11 etc + birth years */
      divisionPattern: /U-?\d{1,2}\b|20[01]\d/i,

      /** Wait time after page load (ms) */
      pageLoadWait: 3000,

      /** Wait time after changing division (ms) */
      divisionChangeWait: 2000,
    },

    /**
     * HTGSports schedule table has 10 columns:
     * | Match ID | Date | Time | Field | Home Pool | Home Team | Home Score | Away Pool | Away Team | Away Score |
     */
    columns: {
      matchId: 0,
      date: 1,
      time: 2,
      field: 3,
      homePool: 4,
      homeTeam: 5,
      homeScore: 6,
      awayPool: 7,
      awayTeam: 8,
      awayScore: 9,
    },

    expectedColumns: 10,

    /** HTGSports date format: MM/DD/YYYY */
    dateFormat: "MM/DD/YYYY",
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "htg-{eventId}-{matchId}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    /**
     * Static list of HTGSports events (Heartland Soccer tournaments).
     * Updated: January 2026
     *
     * OUTDOOR SOCCER ONLY (excludes Futsal, Indoor, 3v3/5v5)
     * Last 3 Seasons: Aug 2023 - Present
     */
    staticEvents: [
      // Season 25-26 (Current)
      { id: 14130, name: "2026 Heartland Invitational - Boys", year: 2026, type: "tournament" },
      { id: 14129, name: "2026 Heartland Invitational - Girls", year: 2026, type: "tournament" },
      { id: 14126, name: "2026 Heartland Midwest Classic", year: 2026, type: "tournament" },
      { id: 13516, name: "2026 Heartland Spring Cup", year: 2026, type: "tournament" },
      { id: 13514, name: "2026 Border Battle Soccer Tournament", year: 2026, type: "tournament" },
      { id: 13444, name: "KC Fall Finale 2025", year: 2025, type: "tournament" },
      { id: 13437, name: "Challenger Sports Invitational 2025", year: 2025, type: "tournament" },
      { id: 13418, name: "Sporting Classic 2025", year: 2025, type: "tournament" },
      { id: 13371, name: "2025 Sporting Iowa Fall Cup", year: 2025, type: "tournament" },
      { id: 13014, name: "2025 Heartland Invitational - Boys", year: 2025, type: "tournament" },
      { id: 13008, name: "2025 Heartland Open Cup", year: 2025, type: "tournament" },
      { id: 12849, name: "2025 Kansas City Invitational", year: 2025, type: "tournament" },
      { id: 12847, name: "2025 KC Champions Cup", year: 2025, type: "tournament" },

      // Season 24-25
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

      // Season 23-24
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

      // KC Youth Development Leagues
      { id: 13593, name: "Fall 2025 KC Youth Development League", year: 2025, type: "league" },
      { id: 13272, name: "Spring 2025 KC Youth Development League", year: 2025, type: "league" },
      { id: 12295, name: "Spring 2024 KC Youth Development League", year: 2024, type: "league" },
      { id: 11708, name: "Fall 2023 KC Youth Development League", year: 2023, type: "league" },

      // Eastern Iowa Youth Soccer League (EIYSL)
      { id: 13486, name: "EIYSL Fall 2025", year: 2025, type: "league" },
      { id: 13113, name: "EIYSL Spring 2025", year: 2025, type: "league" },
    ],

    /**
     * UNIVERSAL: Uses engine's database-based discovery + static fallback.
     * Finds active events from matches_v2 filtered by source_match_key pattern.
     * Falls back to static list for events not yet in database.
     *
     * This approach works for ANY source:
     * 1. Database discovery finds events with recent match activity
     * 2. Static list provides historical events + newly added ones
     * 3. No Puppeteer/scraping overhead for discovery
     */
    discoverEvents: async (engine) => {
      // Use universal database-based discovery
      const dbEvents = await engine.discoverEventsFromDatabase(14, 14); // 2-week window

      // Merge with static list to catch events not yet scraped
      const staticEvents = engine.adapter.discovery.staticEvents || [];
      const eventIds = new Set(dbEvents.map(e => e.id.toString()));

      let newFromStatic = 0;
      for (const se of staticEvents) {
        if (!eventIds.has(se.id.toString())) {
          dbEvents.push(se);
          newFromStatic++;
        }
      }

      if (newFromStatic > 0) {
        console.log(`   Added ${newFromStatic} events from static list (not yet in DB)`);
      }

      return dbEvents;
    },

    // Static list (used as fallback + for new events not yet in DB)
  },

  // =========================================
  // DATA TRANSFORMATION
  // =========================================

  transform: {
    normalizeTeamName: (name) => name?.trim() || "",

    parseDivision: (divisionText) => {
      if (!divisionText) return { gender: null, ageGroup: null };

      const lower = divisionText.toLowerCase();

      // Gender detection
      let gender = null;
      if (lower.includes("boys") || lower.includes(" b ") || /\bb\s*\d/.test(lower)) {
        gender = "Boys";
      } else if (lower.includes("girls") || lower.includes(" g ") || /\bg\s*\d/.test(lower)) {
        gender = "Girls";
      }

      // Age group detection
      let ageGroup = null;
      const ageMatch = lower.match(/u[-]?(\d+)/i);
      if (ageMatch) {
        ageGroup = `U${ageMatch[1]}`;
      } else {
        // Birth year pattern (2010, 2011, etc.)
        const yearMatch = divisionText.match(/\b(20[01]\d)\b/);
        if (yearMatch) {
          const birthYear = parseInt(yearMatch[1], 10);
          const currentYear = new Date().getFullYear();
          const age = currentYear - birthYear;
          ageGroup = `U${age}`;
        }
      }

      return { gender, ageGroup };
    },

    /** HTGSports events are primarily Kansas City area */
    inferState: () => "KS",

    /**
     * Parse HTGSports date format: MM/DD/YYYY
     */
    parseDate: (dateStr) => {
      if (!dateStr) return null;
      try {
        const parts = dateStr.trim().split("/");
        if (parts.length === 3) {
          const [month, day, year] = parts;
          return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
        }
        return null;
      } catch {
        return null;
      }
    },

    parseScore: (scoreStr) => {
      if (!scoreStr) return [null, null];
      const score = parseInt(scoreStr.trim(), 10);
      return isNaN(score) ? [null, null] : [score, null]; // Single score per cell
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".htgsports_checkpoint.json",
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    /** 3-year rolling window */
    minDate: "2023-08-01",
    maxFutureDate: null,

    /** Max events per run */
    maxEventsPerRun: 50,

    isValidMatch: (match) => {
      if (!match.homeTeamName || !match.awayTeamName) return false;
      if (match.homeTeamName.toLowerCase() === "team") return false;
      if (match.awayTeamName.toLowerCase() === "team") return false;
      return true;
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC
  // HTGSports requires Puppeteer for SPA rendering
  // =========================================

  /**
   * Custom scrape function for HTGSports events.
   * Uses Puppeteer to navigate through division dropdown.
   */
  scrapeEvent: async (engine, event) => {
    const allMatches = [];

    // Open page
    const url = `${engine.adapter.baseUrl}/?eventid=${event.id}#/scheduleresults`;
    console.log(`   URL: ${url}`);

    const page = await engine.fetchWithPuppeteer(url, {
      waitForSelector: engine.adapter.parsing.puppeteer.waitForSelector,
    });

    try {
      await engine.sleep(engine.adapter.parsing.puppeteer.pageLoadWait);

      // Get all division options from the dropdown
      const divisions = await page.evaluate(() => {
        const selects = document.querySelectorAll("select.form-control");
        for (const select of selects) {
          const options = Array.from(select.querySelectorAll("option"));
          const divisionOptions = options.filter(opt =>
            opt.textContent.match(/U-?\d{1,2}\b|20[01]\d/i)
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
        // No division dropdown - scrape default view
        const matches = await scrapeDivision(page, event.id, event.name, "Default", engine);
        allMatches.push(...matches);
      } else {
        // Iterate through each division
        for (let i = 0; i < divisions.length; i++) {
          const division = divisions[i];
          process.stdout.write(`\r   [${i + 1}/${divisions.length}] ${division.text.substring(0, 30)}...`);

          // Select this division
          const changed = await page.evaluate((divValue) => {
            const selects = document.querySelectorAll("select.form-control");
            for (const select of selects) {
              const options = Array.from(select.querySelectorAll("option"));
              const hasDiv = options.some(opt =>
                opt.textContent.match(/U-?\d{1,2}\b|20[01]\d/i)
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
            await engine.sleep(engine.adapter.parsing.puppeteer.divisionChangeWait);
            const matches = await scrapeDivision(page, event.id, event.name, division.text, engine);
            allMatches.push(...matches);
          }
        }
        console.log(""); // New line after progress
      }

      await page.close();

    } catch (error) {
      await page.close();
      throw error;
    }

    // Deduplicate by match key
    const uniqueMatches = Array.from(
      new Map(allMatches.map(m => [engine.generateMatchKey(m), m])).values()
    );

    console.log(`   📊 ${uniqueMatches.length} unique matches`);
    return uniqueMatches;
  },
};

/**
 * Scrape current division's matches from the page.
 */
async function scrapeDivision(page, eventId, eventName, divisionName, engine) {
  const rawMatches = await page.evaluate((eventId, eventName, divisionName) => {
    const results = [];
    const tables = document.querySelectorAll("table.table-striped.table-hover.table-condensed");

    tables.forEach(table => {
      const rows = table.querySelectorAll("tr");
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll("td"));

        // Expected: 10 columns
        if (cells.length >= 10) {
          const matchId = cells[0].textContent.trim();
          const dateStr = cells[1].textContent.trim();
          const timeStr = cells[2].textContent.trim();
          const field = cells[3].textContent.trim();
          const homeTeam = cells[5].textContent.trim();
          const homeScore = cells[6].textContent.trim();
          const awayTeam = cells[8].textContent.trim();
          const awayScore = cells[9].textContent.trim();

          // Skip if missing team names or header rows
          if (!homeTeam || !awayTeam) return;
          if (homeTeam.toLowerCase() === "team" || matchId.toLowerCase() === "game") return;

          results.push({
            matchId,
            dateStr,
            timeStr,
            field,
            homeTeam,
            homeScore,
            awayTeam,
            awayScore,
            division: divisionName,
          });
        }
      });
    });

    return results;
  }, eventId, eventName, divisionName);

  // Transform to standard match format
  return rawMatches.map(m => {
    const matchDate = engine.adapter.transform.parseDate(m.dateStr);
    const homeScore = m.homeScore ? parseInt(m.homeScore, 10) : null;
    const awayScore = m.awayScore ? parseInt(m.awayScore, 10) : null;
    const { gender, ageGroup } = engine.adapter.transform.parseDivision(m.division);

    let status = "scheduled";
    if (homeScore !== null && !isNaN(homeScore) && awayScore !== null && !isNaN(awayScore)) {
      status = "completed";
    }

    return {
      eventId: eventId.toString(),
      eventName: eventName,
      matchId: m.matchId,
      matchDate: matchDate,
      matchTime: m.timeStr,
      homeTeamName: engine.adapter.transform.normalizeTeamName(m.homeTeam),
      awayTeamName: engine.adapter.transform.normalizeTeamName(m.awayTeam),
      homeScore: isNaN(homeScore) ? null : homeScore,
      awayScore: isNaN(awayScore) ? null : awayScore,
      status: status,
      location: m.field || "Kansas City, KS",
      division: m.division,
      gender: gender,
      ageGroup: ageGroup,
    };
  }).filter(m => engine.adapter.dataPolicy.isValidMatch(m));
}
