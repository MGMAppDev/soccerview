/**
 * Heartland Soccer League Adapter v5.0 (Premier-Only, Multi-Source)
 * ===================================================================
 *
 * Session 84: SoccerView is PREMIER-ONLY. Recreational data excluded.
 * Session 87.2: Deep investigation of all Heartland data mechanisms.
 *
 * FINDINGS (Feb 2026):
 *   - subdiv_results.cgi: DEAD (301 → www → 404). Cannot be fixed.
 *   - subdiv_standings.cgi: ALIVE but empty between seasons (returns 200, 0 bytes)
 *   - team_results.cgi: ALIVE (returns real responses, but team numbers change by season)
 *   - hs-reports WordPress plugin: Custom web component, intercepts form submit via AJAX
 *   - Season Archives: Static HTML at /reports/seasoninfo/archives/standings/{season}/
 *   - Calendar site: ALIVE at calendar.heartlandsoccer.net/team/
 *
 * DATA ACCESS MECHANISMS:
 *
 * 1. CGI Standings (AJAX from Score-Standings page)
 *    - URL: heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi
 *    - Data: Team W-L-T-GF-GA-Pts per division (when season is active)
 *    - Technology: Puppeteer page.evaluate → fetch() (same-origin AJAX)
 *    - Status: Works but EMPTY between seasons
 *
 * 2. Season Archives (Static HTML)
 *    - URL: www.heartlandsoccer.net/reports/seasoninfo/archives/standings/{season}/
 *    - Data: Historical standings with team IDs, W-L-T-GF-GA
 *    - Technology: Simple HTTP fetch + Cheerio parse
 *    - Seasons available: Fall 2018 through Fall 2025
 *
 * 3. Calendar (Puppeteer)
 *    - URL: calendar.heartlandsoccer.net/team/
 *    - Data: SCHEDULED matches (no scores) for upcoming games
 *    - Technology: Puppeteer (JavaScript-rendered SPA)
 *
 * NOTE: subdiv_results.cgi (individual match results) is DEAD.
 * We already have 9,237 Fall 2025 matches from previous scrapes.
 * When Spring 2026 starts, standings CGI should repopulate.
 *
 * IMPORTANT: Recreational scraping was REMOVED in Session 84.
 * See CLAUDE.md Principle 28 and docs/SESSION_84_PREMIER_ONLY_PLAN.md
 */

import * as cheerio from "cheerio";

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "heartland",
  name: "Heartland Soccer League",
  baseUrl: "https://heartlandsoccer.net",

  /** Calendar site base URL (for schedule scraping) */
  calendarBaseUrl: "https://calendar.heartlandsoccer.net",

  // =========================================
  // TECHNOLOGY
  // =========================================

  /**
   * This adapter uses BOTH technologies based on event type:
   * - CGI (Premier): Cheerio
   * - Calendar: Puppeteer
   * Set to "mixed" to indicate dynamic technology selection.
   */
  technology: "mixed",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    // CGI scraping (faster - server-rendered)
    requestDelayMin: 400,
    requestDelayMax: 600,
    iterationDelay: 500,      // Between subdivision requests
    itemDelay: 1000,          // Between age groups

    // Calendar scraping (slower - Puppeteer)
    calendarRequestDelay: 1500,
    calendarIterationDelay: 1500,  // Between teams
    calendarItemDelay: 2000,       // Between search terms
    calendarPageLoadWait: 3000,
    calendarSearchWait: 2000,

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
  // LEAGUE CONFIGURATION (CGI Results)
  // =========================================

  // Session 84: SoccerView is PREMIER-ONLY
  // Recreational config REMOVED - see CLAUDE.md Principle 28
  leagues: {
    Premier: {
      level: "Premier",
      genders: ["Boys", "Girls"],
      ages: ["U-9", "U-10", "U-11", "U-12", "U-13", "U-14", "U-15", "U-16", "U-17", "U-18"],
      subdivisions: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"],
      paramNames: { gender: "b_g", age: "age", subdiv: "subdivison" }, // Note: misspelling in original
    },
    // REMOVED in Session 84: Recreational config
    // SoccerView focuses on premier/competitive youth soccer only
  },

  // =========================================
  // CALENDAR CONFIGURATION (Schedule Scraping)
  // =========================================

  calendar: {
    /**
     * Club search terms to discover teams from calendar site.
     * These are major KC-area clubs that play in Heartland leagues.
     */
    clubSearchTerms: [
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
      "DASC",
      "Wolves",
      "Elite",
      "Premier",
    ],

    /** Max teams to scrape per run */
    maxTeamsPerRun: 200,

    endpoints: {
      teamSearch: "/team/",
      teamEvents: "/team/events/{teamId}",
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
     * The actual scraping iterates through subdivision combinations (CGI)
     * or team search (Calendar).
     *
     * TWO EVENT TYPES (Session 84: Premier-Only):
     * - Premier: CGI results scraping
     * - Calendar: Team schedule scraping (Puppeteer) - filtered for premier teams
     *
     * REMOVED: Recreational (Session 84)
     */
    staticEvents: [
      // CGI Results (with scores) - PREMIER ONLY
      { id: "heartland-premier-2026", name: "Heartland Premier League 2026", year: 2026, type: "league", level: "Premier" },
      // REMOVED: heartland-recreational-2026 (Session 84 - SoccerView is Premier-only)
      // Calendar Schedules (no scores - future matches) - filtered for premier teams
      { id: "heartland-calendar-2026", name: "Heartland Soccer League Schedule 2026", year: 2026, type: "league", level: "Calendar" },
    ],

    /**
     * Session 108: Removed custom discoverEvents. Uses unified fallback path
     * which calls discoverEventsFromDatabase() + merges with staticEvents.
     * See coreScraper.js lines 780-791 and Principle 45.
     */
    discoverEvents: null,
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
  // STANDINGS SCRAPING (Session 92)
  // Universal pattern: discoverSources() + scrapeSource()
  // Supports Season Archives (static HTML) + live CGI standings
  // =========================================

  standings: {
    enabled: true,

    /**
     * Available seasons in Heartland archives.
     * URL pattern: /reports/seasoninfo/archives/standings/{year}_{season}/
     * Files: boys_prem.html, girls_prem.html (Premier-only per Session 84)
     */
    staticSources: [
      { id: '2025_fall', name: 'Heartland Fall 2025', season: '2025_fall', snapshot_date: '2025-12-15', league_source_id: 'heartland-premier-2025' },
      { id: '2025_spring', name: 'Heartland Spring 2025', season: '2025_spring', snapshot_date: '2025-07-15', league_source_id: 'heartland-premier-2025' },
      { id: '2024_fall', name: 'Heartland Fall 2024', season: '2024_fall', snapshot_date: '2024-12-15', league_source_id: 'heartland-premier-2024' },
      { id: '2024_spring', name: 'Heartland Spring 2024', season: '2024_spring', snapshot_date: '2024-07-15', league_source_id: 'heartland-premier-2024' },
      { id: '2023_fall', name: 'Heartland Fall 2023', season: '2023_fall', snapshot_date: '2023-12-15', league_source_id: 'heartland-premier-2023' },
    ],

    /**
     * Scrape standings from a single source (season archive file or live CGI).
     * Returns array of universal standings objects for staging_standings.
     *
     * @param {object} engine - Scraper engine context (fetchWithCheerio, sleep, etc.)
     * @param {object} source - Source descriptor from staticSources or discoverSources
     * @returns {Array} Universal standings objects
     */
    scrapeSource: async (engine, source) => {
      // Route: live CGI for current season, archives for historical
      if (source.live_cgi) {
        return scrapeHeartlandCGIStandings(engine, source);
      }
      return scrapeHeartlandArchiveStandings(engine, source);
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC
  // Routes to CGI or Calendar scraping based on event level
  // =========================================

  /**
   * Custom scrape function for Heartland leagues.
   * Routes to appropriate scraping method based on event level:
   * - Premier/Recreational: CGI results (Cheerio)
   * - Calendar: Team schedules (Puppeteer)
   */
  scrapeEvent: async (engine, event) => {
    // Route to Calendar scraping if level is "Calendar"
    if (event.level === "Calendar") {
      return scrapeCalendarSchedules(engine, event);
    }

    // Otherwise, use CGI results scraping
    return scrapeCGIResults(engine, event);
  },
};

// =========================================
// CGI STANDINGS SCRAPING (Premier-Only)
// =========================================

/**
 * Scrape CGI standings for Premier league via AJAX within Score-Standings page.
 *
 * Session 87.2 FINDINGS:
 *   - subdiv_results.cgi: DEAD (301 → www → 404). Cannot be fixed.
 *   - subdiv_standings.cgi: ALIVE via same-origin AJAX (returns 200).
 *     Empty between seasons (Fall ends Dec, Spring starts Mar).
 *   - hs-reports WordPress plugin intercepts forms via jQuery AJAX.
 *   - We replicate the same AJAX from within page.evaluate().
 *
 * Between seasons: Logs a message and returns [].
 * During season: Fetches standings (W-L-T-GF-GA) for all divisions.
 */
async function scrapeCGIResults(engine, event) {
  const levelConfig = engine.adapter.leagues[event.level];
  if (!levelConfig) {
    console.log(`   ⚠️ Unknown level: ${event.level}`);
    return [];
  }

  const standingsUrl = "https://www.heartlandsoccer.net/league/score-standings/";
  console.log(`   📊 CGI Standings Scraping (via AJAX within Score-Standings page)`);
  console.log(`   URL: ${standingsUrl}`);
  console.log(`   Note: subdiv_results.cgi is DEAD. Using subdiv_standings.cgi.`);
  console.log(`   Level: ${levelConfig.level}`);
  console.log(`   Genders: ${levelConfig.genders.join(", ")}`);
  console.log(`   Ages: ${levelConfig.ages.length}, Subdivisions: ${levelConfig.subdivisions.length}`);

  // Open Score-Standings page for same-origin AJAX context
  let page;
  try {
    page = await engine.fetchWithPuppeteer(standingsUrl, {
      waitForSelector: "#results-premier-b_g",
    });
    await engine.sleep(5000);
  } catch (error) {
    console.log(`   ❌ Failed to open Score-Standings page: ${error.message}`);
    return [];
  }

  // Quick probe: check if standings CGI has data (between-season check)
  try {
    const probeResult = await page.evaluate(async () => {
      try {
        const resp = await fetch(
          "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=Premier&b_g=Boys&age=U-13&subdivison=1"
        );
        const text = await resp.text();
        return { status: resp.status, length: text.length, hasTable: text.includes("<table") };
      } catch (e) {
        return { error: e.message };
      }
    });

    if (probeResult.error || probeResult.length === 0) {
      console.log(`   ⚠️ Standings CGI returned empty - likely between seasons`);
      console.log(`   ⚠️ Fall 2025 data already in DB (9,237 matches with scores)`);
      console.log(`   ⚠️ Spring 2026 data will appear when season starts (~March)`);
      await page.close();
      return [];
    }

    if (!probeResult.hasTable) {
      console.log(`   ⚠️ Standings CGI responded but no table data (${probeResult.length} bytes)`);
      await page.close();
      return [];
    }
  } catch (error) {
    console.log(`   ❌ Probe failed: ${error.message}`);
    await page.close();
    return [];
  }

  console.log(`   ✅ Standings CGI has data! Scraping all divisions...`);

  const allMatches = [];
  let divisionsScraped = 0;
  let divisionsWithData = 0;

  try {
    for (const gender of levelConfig.genders) {
      for (const age of levelConfig.ages) {
        process.stdout.write(`\r   ${gender} ${age}...                    `);

        for (const subdiv of levelConfig.subdivisions) {
          divisionsScraped++;

          const html = await fetchStandingsAjax(
            engine, page, levelConfig.level, gender, age, subdiv, levelConfig.paramNames
          );

          if (html && html.includes("<table")) {
            divisionsWithData++;
            const $ = cheerio.load(html);
            const parsed = parseResultsHtml($, engine, levelConfig.level, gender, age, subdiv, event.name);
            allMatches.push(...parsed);
          }

          await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
        }
        await engine.sleep(engine.adapter.rateLimiting.itemDelay);
      }
    }
  } finally {
    await page.close();
  }

  console.log(`\n   📊 Scraped ${divisionsScraped} divisions, ${divisionsWithData} with data`);
  console.log(`   📊 ${allMatches.length} records`);
  return allMatches;
}

/**
 * Fetch standings data for a specific division via same-origin AJAX.
 * Session 87.2: Uses page.evaluate() + fetch() to bypass CORS.
 *
 * The hs-reports WordPress plugin normally does this via jQuery AJAX.
 * We replicate the same mechanism from within the page context.
 *
 * @returns {string|null} Raw HTML response or null if no data
 */
async function fetchStandingsAjax(engine, page, level, gender, age, subdiv, paramNames) {
  try {
    const params = paramNames || { gender: "b_g", age: "age", subdiv: "subdivison" };
    const result = await page.evaluate(async (p) => {
      try {
        const url = `https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=${p.level}&${p.gp}=${p.gender}&${p.ap}=${p.age}&${p.sp}=${p.subdiv}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const text = await resp.text();
        return text.length > 0 ? text : null;
      } catch {
        return null;
      }
    }, { level, gender, age, subdiv, gp: params.gender, ap: params.age, sp: params.subdiv });
    return result;
  } catch {
    return null;
  }
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

// =========================================
// CALENDAR SCHEDULE SCRAPING (Puppeteer)
// =========================================

/**
 * Session 84: Recreational team detection patterns
 * Used to filter out recreational teams from calendar scraping.
 * SoccerView is Premier-only - see CLAUDE.md Principle 28.
 */
const RECREATIONAL_PATTERNS = [
  /\brec\b/i,           // "Rec" as word boundary
  /recreational/i,      // "Recreational" anywhere
  /\bcomm\b/i,          // "Comm" (community)
  /community/i,         // "Community" anywhere
  /\bdev\b/i,           // "Dev" (development) as word
  /development/i,       // "Development" anywhere
];

/**
 * Check if a team name indicates recreational/community level.
 * Session 84: SoccerView is Premier-only.
 */
function isRecreationalTeam(teamName) {
  if (!teamName) return false;
  return RECREATIONAL_PATTERNS.some(pattern => pattern.test(teamName));
}

/**
 * Scrape schedules from calendar.heartlandsoccer.net using Puppeteer.
 * Searches for teams by club name, then scrapes each team's schedule.
 * Session 84: Filters out recreational teams (Premier-only).
 */
async function scrapeCalendarSchedules(engine, event) {
  const allMatches = [];
  const processedTeamIds = new Set();
  let teamsProcessed = 0;
  let matchesFound = 0;

  const calendarConfig = engine.adapter.calendar;
  const calendarBaseUrl = engine.adapter.calendarBaseUrl;

  console.log(`   📅 Calendar Schedule Scraping`);
  console.log(`   URL: ${calendarBaseUrl}`);
  console.log(`   Search terms: ${calendarConfig.clubSearchTerms.length}`);

  // Open browser page
  let page;
  try {
    page = await engine.fetchWithPuppeteer(`${calendarBaseUrl}/team/`, {
      waitForSelector: "form",
    });
  } catch (error) {
    console.log(`   ❌ Failed to open calendar page: ${error.message}`);
    return [];
  }

  try {
    for (const searchTerm of calendarConfig.clubSearchTerms) {
      console.log(`\n   🔍 Searching: "${searchTerm}"`);

      const teams = await searchCalendarTeams(page, searchTerm, calendarBaseUrl, engine);
      console.log(`      Found ${teams.length} teams`);

      for (const team of teams) {
        // Skip already processed teams
        if (processedTeamIds.has(team.id)) {
          continue;
        }

        // Session 84: Skip recreational teams (Premier-only policy)
        if (isRecreationalTeam(team.name) || isRecreationalTeam(team.fullName)) {
          console.log(`   ⏭️ Skipping recreational team: ${team.name}`);
          continue;
        }

        processedTeamIds.add(team.id);

        // Scrape team schedule
        const matches = await scrapeTeamSchedule(page, team, event, calendarBaseUrl, engine);
        allMatches.push(...matches);

        teamsProcessed++;
        matchesFound += matches.length;

        // Rate limiting
        await engine.sleep(engine.adapter.rateLimiting.calendarIterationDelay);

        // Check max teams limit
        if (teamsProcessed >= calendarConfig.maxTeamsPerRun) {
          console.log(`\n   ⚠️ Reached max teams limit (${calendarConfig.maxTeamsPerRun})`);
          break;
        }
      }

      if (teamsProcessed >= calendarConfig.maxTeamsPerRun) {
        break;
      }

      // Delay between search terms
      await engine.sleep(engine.adapter.rateLimiting.calendarItemDelay);
    }

    await page.close();

  } catch (error) {
    console.error(`\n   ❌ Calendar scraping error: ${error.message}`);
    if (page) await page.close();
    throw error;
  }

  // Deduplicate by match key
  const uniqueMatches = [];
  const seenKeys = new Set();
  for (const match of allMatches) {
    // Use calendar-specific key format
    const key = `heartland-cal-${match.homeId || "unk"}-${match.awayId || "unk"}-${match.matchDate}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      match.sourceMatchKey = key;
      uniqueMatches.push(match);
    }
  }

  console.log(`\n   📊 Teams processed: ${teamsProcessed}`);
  console.log(`   📊 Unique matches: ${uniqueMatches.length}`);

  return uniqueMatches;
}

/**
 * Search for teams by club name on calendar site.
 */
async function searchCalendarTeams(page, searchTerm, calendarBaseUrl, engine) {
  try {
    // Navigate to team search page
    await page.goto(`${calendarBaseUrl}/team/`, { waitUntil: "networkidle2" });
    await engine.sleep(engine.adapter.rateLimiting.calendarPageLoadWait);

    // Find and fill search input
    const searchInput = await page.$("#team_search_name");
    if (!searchInput) {
      const altInput = await page.$('input[name="team_search[name]"]');
      if (!altInput) {
        console.log(`      ⚠️ Search input not found`);
        return [];
      }
      await altInput.click({ clickCount: 3 });
      await altInput.type(searchTerm);
    } else {
      await searchInput.click({ clickCount: 3 });
      await searchInput.type(searchTerm);
    }

    // Submit form
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Wait for results
    await engine.sleep(engine.adapter.rateLimiting.calendarSearchWait);
    await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});

    // Extract team results
    const teams = await page.evaluate(() => {
      const results = [];

      // Find cards with team info
      // Structure: <div class="card">
      //   <h5 class="card-header">7927 - Sporting City 17B Blue-East</h5>
      //   <div class="card-body"><a href="/team/events/7927">Show Events</a></div>
      // </div>
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
                fullName: headerText,
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

    return teams;

  } catch (error) {
    console.log(`      ⚠️ Search error: ${error.message}`);
    return [];
  }
}

/**
 * Scrape schedule for a specific team from calendar site.
 */
async function scrapeTeamSchedule(page, team, event, calendarBaseUrl, engine) {
  try {
    // Navigate to team events page
    const eventsUrl = team.url.startsWith("http")
      ? team.url
      : `${calendarBaseUrl}${team.url}`;

    await page.goto(eventsUrl, { waitUntil: "networkidle2" });
    await engine.sleep(engine.adapter.rateLimiting.calendarPageLoadWait);

    // Extract match data from cards
    const rawMatches = await page.evaluate(() => {
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
    const matches = [];
    for (const raw of rawMatches) {
      const parsed = parseCalendarMatchText(raw.matchText);
      if (!parsed) continue;

      const matchDate = parseCalendarDate(raw.dateText);
      if (!matchDate) continue;

      // Infer gender and age from team names
      const homeDiv = parseCalendarDivision(parsed.homeName);
      const awayDiv = parseCalendarDivision(parsed.awayName);
      const gender = homeDiv.gender || awayDiv.gender;
      const ageGroup = homeDiv.ageGroup || awayDiv.ageGroup;

      matches.push({
        eventId: event.id,
        eventName: event.name,
        matchDate: matchDate,
        matchTime: null,
        homeTeamName: parsed.homeName,
        awayTeamName: parsed.awayName,
        homeId: parsed.homeId || "unk",
        awayId: parsed.awayId || "unk",
        // CRITICAL: NULL scores for scheduled matches per CLAUDE.md Principle 6b
        homeScore: null,
        awayScore: null,
        status: "scheduled",
        gender: gender,
        ageGroup: ageGroup,
        location: raw.fieldText || "Kansas City Area",
        division: `${ageGroup || ""} ${gender || ""}`.trim() || null,
        level: "calendar",
      });
    }

    // Session 84: Filter out matches involving recreational teams (Premier-only)
    const premierMatches = matches.filter(m =>
      !isRecreationalTeam(m.homeTeamName) &&
      !isRecreationalTeam(m.awayTeamName)
    );

    return premierMatches.filter(m => engine.adapter.dataPolicy.isValidMatch(m));

  } catch (error) {
    console.log(`      ⚠️ Schedule error for ${team.name}: ${error.message}`);
    return [];
  }
}

/**
 * Parse match text from calendar: "7927 - Sporting City vs 7929 - SS Academy"
 */
function parseCalendarMatchText(matchText) {
  if (!matchText) return null;

  // Split on " vs " (case insensitive)
  const vsMatch = matchText.match(/^(.+?)\s+vs\s+(.+)$/i);
  if (!vsMatch) return null;

  const homeStr = vsMatch[1].trim();
  const awayStr = vsMatch[2].trim();

  // Extract team ID and name: "7927 - Sporting City 17B Blue-East"
  function extractTeam(str) {
    const idNameMatch = str.match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
    if (idNameMatch) {
      return {
        id: idNameMatch[1],
        name: idNameMatch[2].trim(),
      };
    }
    return { id: null, name: str };
  }

  const home = extractTeam(homeStr);
  const away = extractTeam(awayStr);

  if (!home.name || !away.name) return null;

  return {
    homeId: home.id,
    homeName: home.name,
    awayId: away.id,
    awayName: away.name,
  };
}

/**
 * Parse calendar date format: "August 16, 2025"
 */
function parseCalendarDate(dateStr) {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

/**
 * Parse division from calendar team name for gender and age group.
 */
function parseCalendarDivision(teamName) {
  if (!teamName) return { gender: null, ageGroup: null };

  const lower = teamName.toLowerCase();

  // Gender detection - B/G followed by year or age
  let gender = null;
  if (/\d{2,4}[bg]\b|\b[bg]\d{2,4}\b/i.test(teamName) || lower.includes("boys")) {
    gender = lower.includes("girls") || /g\d{2}/i.test(teamName) ? "Girls" : "Boys";
  } else if (lower.includes("girls") || /g\d{2}/i.test(teamName)) {
    gender = "Girls";
  }

  // Age group detection
  let ageGroup = null;
  const ageMatch = lower.match(/u[-]?(\d+)/i);
  if (ageMatch) {
    ageGroup = `U${ageMatch[1]}`;
  } else {
    // Birth year pattern (2017, 2016, etc.)
    const yearMatch = teamName.match(/\b(20[01]\d)\b/);
    if (yearMatch) {
      const birthYear = parseInt(yearMatch[1], 10);
      const currentYear = new Date().getFullYear();
      const age = currentYear - birthYear;
      ageGroup = `U${age}`;
    }
  }

  return { gender, ageGroup };
}

// =========================================
// SEASON ARCHIVE STANDINGS SCRAPING (Session 92)
// Adapter-specific parsing for Heartland archives.
// Produces UNIVERSAL standings objects for staging_standings.
// =========================================

/**
 * Scrape standings from Heartland Season Archives (static HTML).
 * URL: /reports/seasoninfo/archives/standings/{season}/{gender}_prem.html
 *
 * HTML structure:
 *   <h4>U-9 Boys Premier Subdivision 1</h4>
 *   <table> 8 columns: Team | Win | Lose | Tie | GF | GA | RC | Pts </table>
 *   Team cell format: "{ID} {TEAM_NAME}" (e.g., "7916 SPORTING BV Academy 16")
 *
 * @param {object} engine - Scraper engine context
 * @param {object} source - Source descriptor (id, season, league_source_id, snapshot_date)
 * @returns {Array} Universal standings objects for staging_standings
 */
async function scrapeHeartlandArchiveStandings(engine, source) {
  const baseUrl = `https://www.heartlandsoccer.net/reports/seasoninfo/archives/standings/${source.season}`;
  const allStandings = [];

  // Premier only (Session 84) — scrape boys_prem.html and girls_prem.html
  const files = [
    { file: 'boys_prem.html', gender: 'Boys' },
    { file: 'girls_prem.html', gender: 'Girls' },
  ];

  for (const { file, gender } of files) {
    const url = `${baseUrl}/${file}`;
    console.log(`  Fetching ${url}...`);

    const $ = await engine.fetchWithCheerio(url);
    if (!$) {
      console.log(`  ⚠️ Could not fetch ${file} — skipping`);
      continue;
    }

    // Parse all division headings and their tables
    const standings = parseArchiveStandingsHtml($, gender, source);
    console.log(`  ${file}: ${standings.length} team standings from ${countDivisions(standings)} divisions`);
    allStandings.push(...standings);

    await engine.applyRateLimit();
  }

  return allStandings;
}

/**
 * Parse Heartland archive HTML into universal standings objects.
 *
 * Structure: <h4>U-9 Boys Premier Subdivision 1</h4> followed by <table>
 * Table columns: Team | Win | Lose | Tie | GF | GA | RC | Pts
 */
function parseArchiveStandingsHtml($, gender, source) {
  const standings = [];

  // Find all h4 headings (division headers)
  $('h4').each((_, heading) => {
    const headingText = $(heading).text().trim();

    // Parse: "U-9 Boys Premier Subdivision 1"
    const match = headingText.match(/U-?(\d+)\s+(?:Boys|Girls)\s+Premier\s+Subdivision\s+(\d+)/i);
    if (!match) return; // Skip non-standings headings

    const ageGroup = `U-${match[1]}`;
    const subdivision = match[2];
    const division = `Subdivision ${subdivision}`;

    // Find the next table after this heading
    const $table = $(heading).nextAll('table').first();
    if (!$table.length) return;

    // Parse data rows (skip header rows)
    let position = 0;
    $table.find('tr').each((rowIdx, row) => {
      const cells = $(row).find('td');
      if (cells.length < 8) return;

      const teamCell = $(cells[0]).text().trim();
      const winsText = $(cells[1]).text().trim();
      const lossesText = $(cells[2]).text().trim();
      const drawsText = $(cells[3]).text().trim();
      const gfText = $(cells[4]).text().trim();
      const gaText = $(cells[5]).text().trim();
      const rcText = $(cells[6]).text().trim();
      const ptsText = $(cells[7]).text().trim();

      // Skip header rows ("Team", "Win", etc.)
      if (teamCell.toLowerCase() === 'team' || winsText.toLowerCase() === 'win') return;
      // Skip title rows ("Subdivision Standings")
      if (teamCell.toLowerCase().includes('standings')) return;

      // Parse team: "{ID} {NAME}" → extract ID and name
      const teamMatch = teamCell.match(/^([A-Za-z0-9]+)\s+(.+)$/);
      if (!teamMatch) return;

      const teamSourceId = teamMatch[1];
      const teamName = teamMatch[2].trim();

      const wins = parseInt(winsText, 10) || 0;
      const losses = parseInt(lossesText, 10) || 0;
      const draws = parseInt(drawsText, 10) || 0;
      const goalsFor = parseInt(gfText, 10) || 0;
      const goalsAgainst = parseInt(gaText, 10) || 0;
      const redCards = parseInt(rcText, 10) || null;
      const points = parseInt(ptsText, 10) || 0;
      const played = wins + losses + draws;

      position++;

      standings.push({
        league_source_id: source.league_source_id,
        division,
        team_name: teamName,
        team_source_id: `heartland-${teamSourceId}`,
        played,
        wins,
        losses,
        draws,
        goals_for: goalsFor,
        goals_against: goalsAgainst,
        points,
        position,
        red_cards: redCards,
        season: source.season,
        age_group: ageGroup,
        gender,
        extra_data: {
          heartland_team_number: teamSourceId,
          heartland_subdivision: subdivision,
          raw_heading: headingText,
        },
      });
    });
  });

  return standings;
}

/**
 * Scrape live standings from subdiv_standings.cgi via Puppeteer.
 * Uses same-origin AJAX from within the Score-Standings page context.
 * ALIVE during active season, EMPTY between seasons.
 *
 * @param {object} engine - Scraper engine context
 * @param {object} source - Source descriptor with live_cgi: true
 * @returns {Array} Universal standings objects for staging_standings
 */
async function scrapeHeartlandCGIStandings(engine, source) {
  const standingsUrl = "https://www.heartlandsoccer.net/league/score-standings/";
  console.log(`  Opening Score-Standings page for CGI AJAX...`);

  let page;
  try {
    page = await engine.fetchWithPuppeteer(standingsUrl, {
      waitForSelector: "#results-premier-b_g",
    });
    await engine.sleep(5000);
  } catch (error) {
    console.log(`  ❌ Failed to open Score-Standings page: ${error.message}`);
    return [];
  }

  // Probe: check if CGI has data (between-season check)
  try {
    const probeResult = await page.evaluate(async () => {
      try {
        const resp = await fetch(
          "https://heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi?level=Premier&b_g=Boys&age=U-13&subdivison=1"
        );
        const text = await resp.text();
        return { status: resp.status, length: text.length, hasTable: text.includes("<table") };
      } catch (e) {
        return { error: e.message };
      }
    });

    if (probeResult.error || probeResult.length === 0 || !probeResult.hasTable) {
      console.log(`  ⚠️ Standings CGI empty — between seasons`);
      await page.close();
      return [];
    }
  } catch (error) {
    console.log(`  ❌ Probe failed: ${error.message}`);
    await page.close();
    return [];
  }

  console.log(`  ✅ CGI has data — scraping all divisions...`);

  const allStandings = [];
  const genders = ["Boys", "Girls"];
  const ages = ["U-9", "U-10", "U-11", "U-12", "U-13", "U-14", "U-15", "U-16", "U-17", "U-18"];
  const subdivisions = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"];
  let divisionsScraped = 0;
  let divisionsWithData = 0;

  try {
    for (const gender of genders) {
      for (const age of ages) {
        process.stdout.write(`\r  ${gender} ${age}...                    `);

        for (const subdiv of subdivisions) {
          divisionsScraped++;

          const html = await fetchStandingsAjax(
            engine, page, "Premier", gender, age, subdiv,
            { gender: "b_g", age: "age", subdiv: "subdivison" }
          );

          if (html && html.includes("<table")) {
            divisionsWithData++;
            const cgiCheerio = cheerio.load(html);
            const standings = parseCGIStandingsHtml(cgiCheerio, gender, age, subdiv, source);
            allStandings.push(...standings);
          }

          await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
        }
        await engine.sleep(engine.adapter.rateLimiting.itemDelay);
      }
    }
  } finally {
    await page.close();
  }

  console.log(`\n  Scraped ${divisionsScraped} divisions, ${divisionsWithData} with data`);
  console.log(`  ${allStandings.length} team standings`);
  return allStandings;
}

/**
 * Parse live CGI standings HTML into universal standings objects.
 * Same table structure as archives: Team | Win | Lose | Tie | GF | GA | RC | Pts
 */
function parseCGIStandingsHtml($, gender, age, subdiv, source) {
  const standings = [];
  const division = `Subdivision ${subdiv}`;
  let position = 0;

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 8) return;

    const teamCell = $(cells[0]).text().trim();
    const winsText = $(cells[1]).text().trim();

    // Skip header/title rows
    if (teamCell.toLowerCase() === 'team' || winsText.toLowerCase() === 'win') return;
    if (teamCell.toLowerCase().includes('standings')) return;

    const teamMatch = teamCell.match(/^([A-Za-z0-9]+)\s+(.+)$/);
    if (!teamMatch) return;

    const teamSourceId = teamMatch[1];
    const teamName = teamMatch[2].trim();

    const wins = parseInt($(cells[1]).text().trim(), 10) || 0;
    const losses = parseInt($(cells[2]).text().trim(), 10) || 0;
    const draws = parseInt($(cells[3]).text().trim(), 10) || 0;
    const goalsFor = parseInt($(cells[4]).text().trim(), 10) || 0;
    const goalsAgainst = parseInt($(cells[5]).text().trim(), 10) || 0;
    const redCards = parseInt($(cells[6]).text().trim(), 10) || null;
    const points = parseInt($(cells[7]).text().trim(), 10) || 0;
    const played = wins + losses + draws;

    position++;

    standings.push({
      league_source_id: source.league_source_id,
      division,
      team_name: teamName,
      team_source_id: `heartland-${teamSourceId}`,
      played,
      wins,
      losses,
      draws,
      goals_for: goalsFor,
      goals_against: goalsAgainst,
      points,
      position,
      red_cards: redCards,
      season: source.season,
      age_group: age,
      gender,
      extra_data: {
        heartland_team_number: teamSourceId,
        heartland_subdivision: subdiv,
      },
    });
  });

  return standings;
}

/**
 * Count unique divisions in standings array.
 */
function countDivisions(standings) {
  return new Set(standings.map(s => `${s.age_group}-${s.gender}-${s.division}`)).size;
}
