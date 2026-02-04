/**
 * Heartland Soccer League Adapter v3.0 (Premier-Only)
 * ====================================================
 *
 * Session 84: SoccerView is PREMIER-ONLY. Recreational data excluded.
 *
 * UNIFIED adapter for scraping Heartland Soccer League data from TWO sources:
 *
 * 1. CGI Results (https://heartlandsoccer.net/reports/cgi-jrb/)
 *    - Technology: Cheerio (server-rendered HTML)
 *    - Data: Match RESULTS with scores
 *    - Events: heartland-premier-2026 (PREMIER ONLY)
 *
 * 2. Calendar (https://calendar.heartlandsoccer.net)
 *    - Technology: Puppeteer (JavaScript-rendered)
 *    - Data: SCHEDULED matches (no scores)
 *    - Events: heartland-calendar-2026 (filtered for premier teams only)
 *
 * The scrapeEvent function routes to the appropriate scraping method
 * based on the event's level property.
 *
 * IMPORTANT: Recreational scraping was REMOVED in Session 84.
 * See CLAUDE.md Principle 28 and docs/SESSION_84_PREMIER_ONLY_PLAN.md
 */

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
     * UNIVERSAL: Uses engine's database-based discovery + static fallback.
     * Heartland has 2 virtual events per year (Premier, Calendar).
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
// CGI RESULTS SCRAPING (Premier-Only)
// =========================================

/**
 * Scrape CGI results for Premier league only.
 * Iterates through all gender/age/subdivision combinations.
 * Session 84: Recreational scraping REMOVED - SoccerView is Premier-only.
 */
async function scrapeCGIResults(engine, event) {
  const allMatches = [];

  // Determine which level to scrape
  const levelConfig = engine.adapter.leagues[event.level];
  if (!levelConfig) {
    console.log(`   ⚠️ Unknown level: ${event.level}`);
    return [];
  }

  console.log(`   📊 CGI Results Scraping`);
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
}

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
