/**
 * Heartland Soccer League Adapter v1.0
 * =====================================
 *
 * Configuration for scraping Heartland Soccer League results.
 * Uses CGI reporting endpoints for Premier and Recreational leagues.
 *
 * TECHNOLOGY: Cheerio (Server-rendered HTML from CGI)
 *
 * NOTE: This adapter has a UNIQUE pattern. Instead of scraping events,
 * it iterates through all level/gender/age/subdivision combinations.
 * The scrapeEvent function is overridden to handle this pattern.
 *
 * Extracted from: scripts/scrapers/scrapeHeartlandResults.js
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "heartland",
  name: "Heartland Soccer League",
  baseUrl: "https://heartlandsoccer.net",

  // =========================================
  // TECHNOLOGY
  // =========================================

  /** Heartland CGI pages are server-rendered HTML */
  technology: "cheerio",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    requestDelayMin: 400,
    requestDelayMax: 600,
    iterationDelay: 500,      // Between subdivision requests
    itemDelay: 1000,          // Between age groups
    maxRetries: 3,
    retryDelays: [2000, 5000, 10000],
    cooldownOn429: 30000,
    cooldownOn500: 15000,
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
    /** CGI endpoint for match results */
    results: "/reports/cgi-jrb/subdiv_results.cgi",

    /** CGI endpoint for standings (not currently used) */
    standings: "/reports/cgi-jrb/subdiv_standings.cgi",
  },

  // =========================================
  // LEAGUE CONFIGURATION
  // =========================================

  leagues: {
    Premier: {
      level: "Premier",
      genders: ["Boys", "Girls"],
      ages: ["U-9", "U-10", "U-11", "U-12", "U-13", "U-14", "U-15", "U-16", "U-17", "U-18"],
      subdivisions: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"],
      paramNames: { gender: "b_g", age: "age", subdiv: "subdivison" }, // Note: misspelling in original
    },
    Recreational: {
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
  },

  // =========================================
  // PARSING CONFIGURATION
  // =========================================

  parsing: {
    /**
     * Heartland results table has 7 columns:
     * | Date | Game# | Time | Home Team | Home Score | Away Team | Away Score |
     */
    columns: {
      date: 0,
      gameNumber: 1,
      time: 2,
      homeTeam: 3,
      homeScore: 4,
      awayTeam: 5,
      awayScore: 6,
    },

    expectedColumns: 7,

    /** Date format: "Aug 16 (Sat)" or "Sep 5 (Fri)" */
    dateFormat: "MMM D",
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "heartland-{level}-{homeId}-{awayId}-{date}-{gameNum}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    /**
     * Heartland uses virtual events - one per level per year.
     * The actual scraping iterates through subdivision combinations.
     *
     * Static list defines the leagues, discovery finds active ones.
     */
    staticEvents: [
      { id: "heartland-premier-2026", name: "Heartland Premier League 2026", year: 2026, type: "league", level: "Premier" },
      { id: "heartland-recreational-2026", name: "Heartland Recreational League 2026", year: 2026, type: "league", level: "Recreational" },
    ],

    /**
     * UNIVERSAL: Uses engine's database-based discovery + static fallback.
     * Heartland only has 2 virtual events per year, so static list is primary.
     */
    discoverEvents: async (engine) => {
      // Try database discovery first
      const dbEvents = await engine.discoverEventsFromDatabase(30, 30); // 30-day window for leagues

      // Merge with static list (Heartland needs level property)
      const staticEvents = engine.adapter.discovery.staticEvents || [];
      const eventIds = new Set(dbEvents.map(e => e.id.toString()));

      for (const se of staticEvents) {
        if (!eventIds.has(se.id.toString())) {
          dbEvents.push(se);
        }
      }

      return dbEvents;
    },
  },

  // =========================================
  // DATA TRANSFORMATION
  // =========================================

  transform: {
    /**
     * Normalize team name - remove leading team ID.
     * Format: "7311 DASC 2013 Black" -> "DASC 2013 Black"
     * CRITICAL: Must handle alphanumeric IDs (e.g., "711A") not just numeric!
     */
    normalizeTeamName: (name) => {
      if (!name) return "";
      // Match alphanumeric IDs at start of name (e.g., "7115", "711A", "12AB")
      const match = name.match(/^[A-Za-z0-9]+\s+(.+)$/);
      return match ? match[1].trim() : name.trim();
    },

    /**
     * Extract team ID from name format "7311 DASC 2013 Black" or "711A Team Name"
     * CRITICAL: Must handle alphanumeric IDs (e.g., "711A") not just numeric!
     * Previous bug: /^(\d+)\s+/ only matched pure numeric IDs, causing
     * teams like "711A Union KC Jr Elite B15" to be completely SKIPPED.
     */
    extractTeamId: (name) => {
      if (!name) return null;
      // Match alphanumeric IDs at start of name (e.g., "7115", "711A", "12AB")
      const match = name.match(/^([A-Za-z0-9]+)\s+/);
      return match ? match[1] : null;
    },

    parseDivision: (divisionText) => {
      if (!divisionText) return { gender: null, ageGroup: null };

      const lower = divisionText.toLowerCase();

      let gender = null;
      if (lower.includes("boys")) gender = "Boys";
      else if (lower.includes("girls")) gender = "Girls";

      let ageGroup = null;
      const ageMatch = lower.match(/u[-]?(\d+)/i);
      if (ageMatch) {
        ageGroup = `U${ageMatch[1]}`;
      }

      return { gender, ageGroup };
    },

    /** Heartland is Kansas area */
    inferState: () => "KS",

    /**
     * Parse Heartland date format: "Aug 16 (Sat)" or "Sep 5"
     */
    parseDate: (dateStr) => {
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
      // Aug-Dec = previous calendar year, Jan-Jul = current calendar year
      const currentYear = new Date().getFullYear();
      const year = month >= 7 ? currentYear - 1 : currentYear;

      const date = new Date(year, month, day);
      return date.toISOString().split("T")[0];
    },

    parseScore: (scoreStr) => {
      if (!scoreStr) return [null, null];
      const score = parseInt(scoreStr.trim(), 10);
      return isNaN(score) ? [null, null] : [score, null];
    },

    /**
     * Normalize age group: "U-13/7th Grade" -> "U13"
     */
    normalizeAgeGroup: (ageStr) => {
      const match = ageStr.match(/U-?(\d+)/i);
      return match ? `U${match[1]}` : ageStr;
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".heartland_checkpoint.json",
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    /** 3-year rolling window */
    minDate: "2023-08-01",
    maxFutureDate: null,

    /** No event limit - iterate through all subdivisions */
    maxEventsPerRun: 10,

    isValidMatch: (match) => {
      if (!match.homeTeamName || !match.awayTeamName) return false;
      if (match.homeTeamName.toLowerCase() === "home") return false;
      return true;
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC
  // Heartland iterates through subdivisions, not events
  // =========================================

  /**
   * Custom scrape function for Heartland leagues.
   * Iterates through all level/gender/age/subdivision combinations.
   */
  scrapeEvent: async (engine, event) => {
    const allMatches = [];

    // Determine which level to scrape
    const levelConfig = engine.adapter.leagues[event.level];
    if (!levelConfig) {
      console.log(`   ⚠️ Unknown level: ${event.level}`);
      return [];
    }

    console.log(`   Level: ${levelConfig.level}`);
    console.log(`   Genders: ${levelConfig.genders.join(", ")}`);
    console.log(`   Ages: ${levelConfig.ages.length}`);
    console.log(`   Subdivisions: ${levelConfig.subdivisions.length}`);

    let divisionsScraped = 0;
    let divisionsWithData = 0;

    for (const gender of levelConfig.genders) {
      for (const age of levelConfig.ages) {
        process.stdout.write(`\r   ${gender} ${age}...                    `);

        for (const subdiv of levelConfig.subdivisions) {
          divisionsScraped++;

          const matches = await fetchDivisionResults(
            engine,
            levelConfig.level,
            gender,
            age,
            subdiv,
            levelConfig.paramNames,
            event.name
          );

          if (matches.length > 0) {
            divisionsWithData++;
            allMatches.push(...matches);
          }

          await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
        }
      }
    }

    console.log(`\n   📊 Scraped ${divisionsScraped} divisions, ${divisionsWithData} with data`);

    // Deduplicate by match key
    const uniqueMatches = [];
    const seenKeys = new Set();
    for (const match of allMatches) {
      const key = engine.generateMatchKey(match);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueMatches.push(match);
      }
    }

    console.log(`   📊 ${uniqueMatches.length} unique matches`);
    return uniqueMatches;
  },
};

/**
 * Fetch results for a specific division.
 */
async function fetchDivisionResults(engine, level, gender, age, subdiv, paramNames, eventName) {
  const url = new URL(`${engine.adapter.baseUrl}${engine.adapter.endpoints.results}`);
  url.searchParams.set("level", level);
  url.searchParams.set(paramNames.gender, gender);
  url.searchParams.set(paramNames.age, age);
  url.searchParams.set(paramNames.subdiv, subdiv);

  const { $, error } = await engine.fetchWithCheerio(url.toString());

  if (error || !$) {
    return [];
  }

  // Check for error page
  const html = $.html();
  if (html.includes("Select Subdivision Error") || html.includes("could not match")) {
    return [];
  }

  return parseResultsHtml($, engine, level, gender, age, subdiv, eventName);
}

/**
 * Parse results HTML into match objects.
 */
function parseResultsHtml($, engine, level, gender, age, subdiv, eventName) {
  const matches = [];
  let lastDate = null;

  $("table tr").each((i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 7) return;

    const dateCell = $(cells[0]).text().trim();
    const gameNum = $(cells[1]).text().trim();
    const time = $(cells[2]).text().trim();
    const homeTeamRaw = $(cells[3]).text().trim();
    const homeScoreText = $(cells[4]).text().trim();
    const awayTeamRaw = $(cells[5]).text().trim();
    const awayScoreText = $(cells[6]).text().trim();

    // Skip header rows
    if (homeTeamRaw === "Home" || homeScoreText === "") return;

    // Parse date - some rows may have empty date (same day as previous)
    const matchDate = dateCell ? engine.adapter.transform.parseDate(dateCell) : lastDate;
    if (dateCell) lastDate = matchDate;

    // Extract team IDs and names
    const homeId = engine.adapter.transform.extractTeamId(homeTeamRaw);
    const awayId = engine.adapter.transform.extractTeamId(awayTeamRaw);
    const homeTeamName = engine.adapter.transform.normalizeTeamName(homeTeamRaw);
    const awayTeamName = engine.adapter.transform.normalizeTeamName(awayTeamRaw);

    if (!homeId || !awayId || !homeTeamName || !awayTeamName) return;

    // Parse scores - allow NaN for scheduled matches
    const homeScore = parseInt(homeScoreText, 10);
    const awayScore = parseInt(awayScoreText, 10);
    const hasValidScores = !isNaN(homeScore) && !isNaN(awayScore);

    // CRITICAL: Don't skip scheduled matches! Per CLAUDE.md Principle 6:
    // "Scheduled/future matches (0-0 scores) are NOT garbage. They populate the Upcoming section."
    // If scores are NaN, this is a scheduled match - we WANT to capture it.

    // Normalize age group
    const normalizedAge = engine.adapter.transform.normalizeAgeGroup(age);

    matches.push({
      eventId: `heartland-${level.toLowerCase()}-2026`,
      eventName: eventName,
      matchDate: matchDate,
      matchTime: time,
      gameNum: gameNum,
      homeTeamName: homeTeamName,
      awayTeamName: awayTeamName,
      // Use null for scheduled matches (NaN scores), actual values for played matches
      homeScore: hasValidScores ? homeScore : null,
      awayScore: hasValidScores ? awayScore : null,
      homeId: homeId,
      awayId: awayId,
      gender: gender,
      ageGroup: normalizedAge,
      level: level.toLowerCase(),
      location: "Kansas City Area",
      // Status based on whether scores exist
      status: hasValidScores ? "completed" : "scheduled",
      division: `${normalizedAge} ${gender}`,
      heartlandSubdivision: subdiv,
    });
  });

  return matches.filter(m => engine.adapter.dataPolicy.isValidMatch(m));
}
