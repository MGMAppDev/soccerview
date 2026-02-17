/**
 * SINC Sports Adapter v1.0
 * ========================
 *
 * Session 95: First new adapter for national expansion.
 * Covers: NC (NCYSA Classic League) + TN (TN State League)
 *
 * Platform: ASP.NET WebForms (soccer.sincsports.com)
 * Technology: Puppeteer (required — pages use __doPostBack and JS rendering)
 *
 * Three data flows:
 *   Flow 1: Match results → staging_games → ELO pipeline
 *   Flow 2: League standings → staging_standings → league_standings (AS-IS)
 *   Flow 3: Scheduled games (NULL scores) → staging_games → upcoming section
 *
 * URL patterns:
 *   Schedule:  /schedule.aspx?tid={eventId}
 *   Division:  /schedule.aspx?tid={eventId}&year={year}&stid={eventId}&syear={year}&div={divCode}
 *   Team:      /team/team.aspx?tid={eventId}&year={year}&teamid={teamId}
 *   API:       /services/AutoComplete.asmx/GetLeagues
 *
 * Division codes: U{AGE}{M|F}{TIER} (e.g., U12M01 = U12 Boys 1st Division)
 * Team IDs: {STATE}{GENDER}{SEQ} (e.g., NCM143F1 = NC Male 43F1)
 * Game numbers: #NNNNN (unique within event, used for match keys)
 */

import * as cheerio from "cheerio";

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "sincsports",
  name: "SINC Sports",
  baseUrl: "https://soccer.sincsports.com",

  // =========================================
  // TECHNOLOGY
  // =========================================

  /** Puppeteer required — ASP.NET WebForms uses __doPostBack + JS rendering */
  technology: "puppeteer",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    requestDelayMin: 1500,
    requestDelayMax: 3000,
    iterationDelay: 2000,   // Between division pages
    itemDelay: 3000,        // Between events
    maxRetries: 3,
    retryDelays: [5000, 15000, 30000],
    cooldownOn429: 120000,
    cooldownOn500: 60000,
  },

  // =========================================
  // USER AGENTS
  // =========================================

  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  ],

  // =========================================
  // ENDPOINTS
  // =========================================

  endpoints: {
    schedule: "/schedule.aspx?tid={eventId}",
    divisionSchedule: "/schedule.aspx?tid={eventId}&year={year}&stid={eventId}&syear={year}&div={divCode}",
    standings: "/TTResults.aspx?tid={eventId}&tab=3&sub=3&SYear={year}",
    teamList: "/TTNewTeamList.aspx?tid={eventId}&tab=3&sub=2&SYear={year}&STID={eventId}",
    apiLeagues: "/services/AutoComplete.asmx/GetLeagues",
  },

  // =========================================
  // PARSING CONFIGURATION
  // =========================================

  parsing: {
    puppeteer: {
      waitForSelector: ".tabsection, #ctl00_ContentPlaceHolder1_divSchedule, .game-row",
      pageLoadWait: 4000,
      divisionChangeWait: 2000,
    },
    dateFormat: "M/D/YYYY",
    scoreRegex: /^(\d+)$/,
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  /** Game numbers (#38209) are unique within an event */
  matchKeyFormat: "sincsports-{eventId}-{matchNumber}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    staticEvents: [
      // North Carolina
      { id: "NCFL", name: "NCYSA Fall Classic League", type: "league", year: 2025, state: "NC" },
      { id: "NCCSL", name: "NC Classic Spring League", type: "league", year: 2026, state: "NC" },
      // Tennessee
      { id: "TZ1185", name: "TN State Soccer Assn League Fall", type: "league", year: 2025, state: "TN" },
      { id: "VESL", name: "Volunteer Elite Soccer League", type: "league", year: 2026, state: "TN" },
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
     * Normalize SINC Sports team names.
     * Format: "14 (12U) SFC GREEN" → "SFC GREEN"
     * Also handles: "SFC GREEN" (no prefix) → "SFC GREEN"
     */
    normalizeTeamName: (name) => {
      if (!name) return "";
      // Remove leading age prefix: "14 (12U) " or "15 (11U) "
      const match = name.match(/^\d{2}\s*\(\d+U\)\s*(.+)$/i);
      return match ? match[1].trim() : name.trim();
    },

    /**
     * Extract team ID from SINC Sports URL parameter.
     * href: "/team/team.aspx?tid=NCFL&year=2025&teamid=NCM143F1" → "NCM143F1"
     */
    extractTeamId: (href) => {
      if (!href) return null;
      const match = href.match(/teamid=([A-Za-z0-9]+)/i);
      return match ? match[1] : null;
    },

    /**
     * Parse division code and display name for gender/age/tier.
     * Code: "U12M01" → { gender: "Boys", ageGroup: "U12", tier: 1 }
     * Display: "12UB '14 1ST EAST1 H/A" → { gender: "Boys", ageGroup: "U12", birthYear: 2014, tier: "1ST" }
     */
    parseDivision: (divisionText) => {
      if (!divisionText) return { gender: null, ageGroup: null };

      // Try division code format: U{AGE}{M|F}{TIER}
      const codeMatch = divisionText.match(/^U(\d{1,2})(M|F)(\d{2})$/i);
      if (codeMatch) {
        return {
          gender: codeMatch[2].toUpperCase() === "M" ? "Boys" : "Girls",
          ageGroup: `U${codeMatch[1]}`,
          tier: parseInt(codeMatch[3], 10),
        };
      }

      // Try display name format: "12UB '14 1ST EAST1 H/A"
      const displayMatch = divisionText.match(/(\d{1,2})U(B|G)\s+'?(\d{2})\s+(\w+)/i);
      if (displayMatch) {
        const birthYearShort = parseInt(displayMatch[3], 10);
        const birthYear = birthYearShort > 50 ? 1900 + birthYearShort : 2000 + birthYearShort;
        return {
          gender: displayMatch[2].toUpperCase() === "B" ? "Boys" : "Girls",
          ageGroup: `U${displayMatch[1]}`,
          birthYear,
          tier: displayMatch[4],
        };
      }

      // Fallback: look for any age/gender clues
      let gender = null;
      let ageGroup = null;
      const lower = divisionText.toLowerCase();
      if (lower.includes("boys") || /\bm\b/i.test(divisionText)) gender = "Boys";
      if (lower.includes("girls") || /\bf\b/i.test(divisionText)) gender = "Girls";
      const ageMatch = divisionText.match(/u[-]?(\d+)/i);
      if (ageMatch) ageGroup = `U${ageMatch[1]}`;

      return { gender, ageGroup };
    },

    /**
     * Infer state from SINC Sports event ID.
     * NC events: NCFL, NCCSL
     * TN events: TZ1185, VESL, EMEPL, TNKYBC
     */
    inferState: (eventId) => {
      if (!eventId) return null;
      const upper = eventId.toUpperCase();
      if (upper.startsWith("NC") || upper === "CAROCL") return "NC";
      if (upper.startsWith("TZ") || upper === "VESL" || upper === "EMEPL" || upper.startsWith("TNKY")) return "TN";
      if (upper.startsWith("AL")) return "AL";
      return null;
    },

    /**
     * Parse SINC Sports date format: "Sunday8/24/2025" or "8/24/2025"
     */
    parseDate: (dateStr) => {
      if (!dateStr) return null;
      // Remove day-of-week prefix: "Sunday8/24/2025" → "8/24/2025"
      const cleaned = dateStr.replace(/^[A-Za-z]+/, "").trim();
      const match = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!match) return null;
      const month = parseInt(match[1], 10);
      const day = parseInt(match[2], 10);
      const year = parseInt(match[3], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    },

    /**
     * Parse time format: "2:00 PM" → "14:00"
     * Validates hour (0-23) and minute (0-59) to prevent invalid TIME values.
     */
    parseTime: (timeStr) => {
      if (!timeStr) return null;
      const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!match) return null;
      let hour = parseInt(match[1], 10);
      const minuteNum = parseInt(match[2], 10);
      const ampm = match[3].toUpperCase();
      // Reject invalid raw values (e.g., "53:00 AM" from corrupted page data)
      if (hour < 1 || hour > 12 || minuteNum < 0 || minuteNum > 59) return null;
      if (ampm === "PM" && hour < 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;
      return `${String(hour).padStart(2, "0")}:${String(minuteNum).padStart(2, "0")}`;
    },

    parseScore: (scoreStr) => {
      if (!scoreStr || scoreStr.trim() === "") return [null, null];
      const val = parseInt(scoreStr.trim(), 10);
      return isNaN(val) ? [null, null] : [val, null];
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".sincsports_checkpoint.json",
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    minDate: "2023-08-01",
    maxFutureDate: null,
    maxEventsPerRun: 10,

    isValidMatch: (match) => {
      if (!match.homeTeamName || !match.awayTeamName) return false;
      if (match.homeTeamName === match.awayTeamName) return false;
      return true;
    },
  },

  // =========================================
  // STANDINGS SCRAPING (Flow 2)
  // =========================================

  standings: {
    enabled: true,

    /**
     * Discover standings sources dynamically by scraping the event's division list.
     * Each division is a separate standings source.
     */
    discoverSources: async (engine, options) => {
      const events = engine.adapter.discovery.staticEvents;
      const sources = [];

      for (const event of events) {
        sources.push({
          id: `${event.id}-${event.year}`,
          name: `${event.name} ${event.year}`,
          event_id: event.id,
          year: event.year,
          state: event.state,
          league_source_id: `sincsports-${event.id.toLowerCase()}-${event.year}`,
          snapshot_date: new Date().toISOString().split("T")[0],
        });
      }

      if (options?.season) {
        return sources.filter(s => s.id.includes(options.season));
      }

      return sources;
    },

    /**
     * Scrape standings for all divisions in an event.
     * Navigates to each division page and extracts the standings table.
     */
    scrapeSource: async (engine, source) => {
      return scrapeEventStandings(engine, source);
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC (Flow 1 + Flow 3)
  // =========================================

  /**
   * Custom scrape function for SINC Sports events.
   * 1. Discover all divisions from the event schedule page
   * 2. For each division, navigate to division page
   * 3. Extract matches (completed + scheduled) from game rows
   */
  scrapeEvent: async (engine, event) => {
    return scrapeEventMatches(engine, event);
  },
};

// =============================================
// MATCH SCRAPING (Flow 1 + Flow 3)
// =============================================

/**
 * Scrape all matches for a SINC Sports event.
 * Steps:
 *   1. Navigate to event schedule page
 *   2. Extract division links (divCode values)
 *   3. For each division, navigate and parse game rows
 */
async function scrapeEventMatches(engine, event) {
  const baseUrl = engine.adapter.baseUrl;
  const scheduleUrl = `${baseUrl}/schedule.aspx?tid=${event.id}`;
  const year = event.year || new Date().getFullYear();

  console.log(`   📋 SINC Sports Match Scraping`);
  console.log(`   Event: ${event.name} (${event.id})`);
  console.log(`   URL: ${scheduleUrl}`);

  // Step 1: Discover divisions
  let page;
  try {
    page = await engine.fetchWithPuppeteer(scheduleUrl, {
      waitForSelector: ".tabsection, a[href*='div=']",
    });
    await engine.sleep(engine.adapter.rateLimiting.parsing?.puppeteer?.pageLoadWait || 4000);
  } catch (error) {
    console.log(`   ❌ Failed to open schedule page: ${error.message}`);
    return [];
  }

  // Extract division links
  let divisions;
  try {
    divisions = await page.evaluate(() => {
      const links = [];
      // Find all links with div= parameter
      document.querySelectorAll('a[href*="div="]').forEach(a => {
        const href = a.getAttribute("href");
        const divMatch = href.match(/div=([A-Za-z0-9]+)/);
        if (divMatch) {
          links.push({
            code: divMatch[1],
            text: a.textContent.trim(),
            href: href,
          });
        }
      });
      // Deduplicate by code
      const seen = new Set();
      return links.filter(l => {
        if (seen.has(l.code)) return false;
        seen.add(l.code);
        return true;
      });
    });
    await page.close();
  } catch (error) {
    console.log(`   ❌ Failed to extract divisions: ${error.message}`);
    if (page) await page.close();
    return [];
  }

  if (divisions.length === 0) {
    console.log(`   ⚠️ No divisions found — event may be offline`);
    return [];
  }

  console.log(`   Found ${divisions.length} divisions`);

  // Step 2: Scrape each division
  const allMatches = [];
  let divisionsScraped = 0;
  let divisionsWithData = 0;

  for (const div of divisions) {
    divisionsScraped++;
    process.stdout.write(`\r   Scraping division ${divisionsScraped}/${divisions.length}: ${div.code} (${div.text})...`);

    try {
      const divUrl = `${baseUrl}/schedule.aspx?tid=${event.id}&year=${year}&stid=${event.id}&syear=${year}&div=${div.code}`;
      const divPage = await engine.fetchWithPuppeteer(divUrl, {
        waitForSelector: ".game-row, .tabsection",
      });

      if (!divPage) {
        console.log(`\n   ⚠️ Could not load division page: ${div.code}`);
        continue;
      }

      await engine.sleep(2000);

      // Extract match data from DOM
      // SINC Sports uses div-based layout:
      //   .game-row > .col-md-3 (date/time/#gameNum)
      //             > .col-md-5 > .hometeam (logo link + name link)
      //                         > .awayteam (logo link + name link)
      //                         > .col-3 (score divs)
      //             > .col-md-4 (venue)
      const rawMatches = await divPage.evaluate(() => {
        const matches = [];
        const gameRows = document.querySelectorAll(".game-row");

        gameRows.forEach(row => {
          // Get home and away team containers
          const homeDiv = row.querySelector(".hometeam");
          const awayDiv = row.querySelector(".awayteam");
          if (!homeDiv || !awayDiv) return;

          // Extract team name from the <a> tag with text (second link; first is logo img)
          let homeTeamName = "", homeTeamId = null;
          for (const a of homeDiv.querySelectorAll("a")) {
            const text = a.textContent.trim();
            if (text.length > 0) homeTeamName = text;
            const href = a.getAttribute("href") || "";
            const idMatch = href.match(/teamid=([A-Za-z0-9]+)/i);
            if (idMatch) homeTeamId = idMatch[1];
          }

          let awayTeamName = "", awayTeamId = null;
          for (const a of awayDiv.querySelectorAll("a")) {
            const text = a.textContent.trim();
            if (text.length > 0) awayTeamName = text;
            const href = a.getAttribute("href") || "";
            const idMatch = href.match(/teamid=([A-Za-z0-9]+)/i);
            if (idMatch) awayTeamId = idMatch[1];
          }

          if (!homeTeamName || !awayTeamName) return;

          // Extract scores from .col-3 score divs
          // Structure: <div>4</div><div class="clear"></div><div>1</div>
          let homeScore = null, awayScore = null;
          const scoreContainer = row.querySelector(".col-3.text-right") || row.querySelector(".col-3");
          if (scoreContainer) {
            const scoreDivs = scoreContainer.querySelectorAll("div[style*='color']");
            if (scoreDivs.length >= 2) {
              const h = parseInt(scoreDivs[0].textContent.trim(), 10);
              const a = parseInt(scoreDivs[1].textContent.trim(), 10);
              if (!isNaN(h)) homeScore = h;
              if (!isNaN(a)) awayScore = a;
            }
          }

          // Extract date, time, game number from .col-md-3
          const metaDiv = row.querySelector(".col-md-3");
          const metaText = metaDiv ? metaDiv.textContent.trim() : "";

          let dateText = null;
          const dateMatch = metaText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
          if (dateMatch) dateText = dateMatch[1];

          let time = null;
          const timeMatch = metaText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
          if (timeMatch) time = timeMatch[1];

          let gameNum = null;
          const gameNumMatch = metaText.match(/#(\d{3,6})/);
          if (gameNumMatch) gameNum = gameNumMatch[1];

          // Extract venue from .col-md-4
          const venueDiv = row.querySelector(".col-md-4");
          const venue = venueDiv ? venueDiv.textContent.trim() : null;

          matches.push({
            dateText,
            time,
            gameNum,
            homeTeamName,
            awayTeamName,
            homeTeamId,
            awayTeamId,
            homeScore: homeScore !== null ? homeScore : null,
            awayScore: awayScore !== null ? awayScore : null,
            venue: venue && venue.length > 2 ? venue : null,
          });
        });

        return matches;
      });

      await divPage.close();

      if (rawMatches.length === 0) {
        continue;
      }

      divisionsWithData++;

      // Parse division info from code
      const divInfo = engine.adapter.transform.parseDivision(div.code);
      const state = engine.adapter.transform.inferState(event.id);

      // Transform raw matches into universal format
      for (const raw of rawMatches) {
        const matchDate = engine.adapter.transform.parseDate(raw.dateText);
        if (!matchDate) continue;

        // Min date filter
        if (matchDate < engine.adapter.dataPolicy.minDate) continue;

        const homeTeamName = engine.adapter.transform.normalizeTeamName(raw.homeTeamName);
        const awayTeamName = engine.adapter.transform.normalizeTeamName(raw.awayTeamName);

        if (!homeTeamName || !awayTeamName) continue;

        const hasValidScores = raw.homeScore !== null && raw.awayScore !== null;
        const matchTime = engine.adapter.transform.parseTime(raw.time);

        allMatches.push({
          eventId: event.id,
          eventName: event.name,
          matchDate,
          matchTime,
          matchNumber: raw.gameNum || `${div.code}-${divisionsScraped}-${allMatches.length}`,
          homeTeamName,
          awayTeamName,
          homeScore: hasValidScores ? raw.homeScore : null,
          awayScore: hasValidScores ? raw.awayScore : null,
          homeId: raw.homeTeamId,
          awayId: raw.awayTeamId,
          gender: divInfo.gender,
          ageGroup: divInfo.ageGroup,
          status: hasValidScores ? "completed" : "scheduled",
          location: raw.venue,
          division: div.text || div.code,
          level: "premier",
          state,
        });
      }

    } catch (error) {
      console.log(`\n   ⚠️ Error scraping division ${div.code}: ${error.message}`);
    }

    // Rate limiting between divisions
    await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
  }

  console.log(`\n   📊 Scraped ${divisionsScraped} divisions, ${divisionsWithData} with data`);
  console.log(`   📊 ${allMatches.length} matches found`);

  // Deduplicate by game number
  const uniqueMatches = [];
  const seenKeys = new Set();
  for (const match of allMatches) {
    const key = match.matchNumber || `${match.homeTeamName}-${match.awayTeamName}-${match.matchDate}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueMatches.push(match);
    }
  }

  if (uniqueMatches.length < allMatches.length) {
    console.log(`   📊 Deduplicated: ${allMatches.length} → ${uniqueMatches.length}`);
  }

  return uniqueMatches.filter(m => engine.adapter.dataPolicy.isValidMatch(m));
}

// =============================================
// STANDINGS SCRAPING (Flow 2)
// =============================================

/**
 * Scrape standings for all divisions in a SINC Sports event.
 * Navigates to each division page and extracts the standings table below the schedule.
 */
async function scrapeEventStandings(engine, source) {
  const baseUrl = engine.adapter.baseUrl;
  const eventId = source.event_id;
  const year = source.year;

  console.log(`  📊 SINC Sports Standings Scraping`);
  console.log(`  Event: ${source.name} (${eventId})`);

  // Step 1: Discover divisions (same as match scraping)
  const scheduleUrl = `${baseUrl}/schedule.aspx?tid=${eventId}`;
  let page;
  try {
    page = await engine.fetchWithPuppeteer(scheduleUrl, {
      waitForSelector: ".tabsection, a[href*='div=']",
    });
    await engine.sleep(4000);
  } catch (error) {
    console.log(`  ❌ Failed to open schedule page: ${error.message}`);
    return [];
  }

  let divisions;
  try {
    divisions = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href*="div="]').forEach(a => {
        const href = a.getAttribute("href");
        const divMatch = href.match(/div=([A-Za-z0-9]+)/);
        if (divMatch) {
          links.push({ code: divMatch[1], text: a.textContent.trim() });
        }
      });
      const seen = new Set();
      return links.filter(l => {
        if (seen.has(l.code)) return false;
        seen.add(l.code);
        return true;
      });
    });
    await page.close();
  } catch (error) {
    console.log(`  ❌ Failed to extract divisions: ${error.message}`);
    if (page) await page.close();
    return [];
  }

  if (divisions.length === 0) {
    console.log(`  ⚠️ No divisions found — event may be offline`);
    return [];
  }

  console.log(`  Found ${divisions.length} divisions`);

  // Step 2: Scrape standings from each division page
  const allStandings = [];
  let divisionsScraped = 0;

  for (const div of divisions) {
    divisionsScraped++;
    process.stdout.write(`\r  Standings ${divisionsScraped}/${divisions.length}: ${div.code}...`);

    try {
      const divUrl = `${baseUrl}/schedule.aspx?tid=${eventId}&year=${year}&stid=${eventId}&syear=${year}&div=${div.code}`;
      const divPage = await engine.fetchWithPuppeteer(divUrl, {
        waitForSelector: ".tabsection",
      });

      if (!divPage) continue;
      await engine.sleep(2000);

      // Extract standings from the page
      // SINC Sports uses div-based layout (Bootstrap grid), NOT tables:
      //   #divStds > .form-row.game-row (group header with <h3> + bigOnly std-heading)
      //           > .form-row (team row — ALSO contains smallOnly std-heading for responsive):
      //               .col-md-6 > .form-row > .col-1 (position) + .col-2 (logo) + .col-8.pt4 > a (team)
      //               .col-md-6 > .form-row.smallOnly.std-heading (responsive headers)
      //                         > .form-row > .col.bigpad (stat values: GP, W, L, T, GF, GA, GD5, Pts, TB)
      //           > <hr> (separator)
      // NOTE: Team rows contain .std-heading (responsive), so we can't skip by that class alone.
      // Instead: if it has <h3> → group header; if it has a[href*="team="] → team row.
      const rawStandings = await divPage.evaluate(() => {
        const standings = [];

        // Find the standings container
        const standsDiv = document.querySelector("#divStds")
          || document.querySelector("#ctl00_ContentPlaceHolder1_divStands")
          || document.querySelector("[id*='divStand']");

        if (!standsDiv) return standings;

        let currentGroup = null;
        let position = 0;

        // Walk through direct children of the standings container
        const children = standsDiv.children;
        for (let i = 0; i < children.length; i++) {
          const el = children[i];

          // Skip <hr> separators
          if (el.tagName === "HR") continue;

          // Check for group header (<h3> inside a .game-row)
          const h3 = el.querySelector("h3");
          if (h3) {
            currentGroup = h3.textContent.trim();
            position = 0;
            continue;
          }

          // Check for team row — identified by having a team schedule link
          const teamLink = el.querySelector('a[href*="team="]');
          if (!teamLink) continue;

          // Extract team name
          const teamName = teamLink.textContent.trim();
          if (!teamName) continue;

          // Extract team ID from href (standings links use team=, not teamid=)
          const teamHref = teamLink.getAttribute("href") || "";
          const teamIdMatch = teamHref.match(/[?&]team=([A-Za-z0-9]+)/i);
          const teamId = teamIdMatch ? teamIdMatch[1] : null;

          // Extract position from .col-1
          const posDiv = el.querySelector(".col-1");
          const posText = posDiv ? posDiv.textContent.trim().replace(".", "") : "";
          const parsedPos = parseInt(posText, 10);
          position = !isNaN(parsedPos) ? parsedPos : (position + 1);

          // Extract stats from .col.bigpad elements (NOT inside .std-heading rows)
          // Stats order: GP, W, L, T, GF, GA, GD5, Pts, TB
          // Each team row has two sets: responsive headers (.std-heading) + actual values
          // We want .col.bigpad that are NOT inside .std-heading
          const allBigpads = el.querySelectorAll(".col.bigpad");
          const stats = [];
          for (const bp of allBigpads) {
            // Skip bigpads inside .std-heading (responsive column headers)
            if (bp.closest(".std-heading")) continue;
            const val = parseInt(bp.textContent.trim(), 10);
            stats.push(isNaN(val) ? null : val);
          }

          standings.push({
            teamName,
            teamId,
            group: currentGroup,
            played: stats[0] != null ? stats[0] : null,
            wins: stats[1] != null ? stats[1] : null,
            losses: stats[2] != null ? stats[2] : null,
            draws: stats[3] != null ? stats[3] : null,
            goalsFor: stats[4] != null ? stats[4] : null,
            goalsAgainst: stats[5] != null ? stats[5] : null,
            goalDiff: stats[6] != null ? stats[6] : null,
            points: stats[7] != null ? stats[7] : null,
            position,
          });
        }

        return standings;
      });

      await divPage.close();

      if (rawStandings.length === 0) continue;

      // Parse division info
      const divInfo = engine.adapter.transform.parseDivision(div.code);
      const divDisplayInfo = engine.adapter.transform.parseDivision(div.text);

      // Map tier number to division name
      const tierName = mapTierToName(divInfo.tier || divDisplayInfo.tier);

      for (const raw of rawStandings) {
        const teamName = engine.adapter.transform.normalizeTeamName(raw.teamName);

        // Build division name: tier only (group suffix handled after dedup check below)
        let divisionName = tierName || div.text || `Division ${div.code}`;

        allStandings.push({
          league_source_id: source.league_source_id,
          division: divisionName,
          team_name: teamName,
          team_source_id: raw.teamId ? `sincsports-${raw.teamId}` : null,
          played: raw.played || 0,
          wins: raw.wins || 0,
          losses: raw.losses || 0,
          draws: raw.draws || 0,
          goals_for: raw.goalsFor || 0,
          goals_against: raw.goalsAgainst || 0,
          points: raw.points || 0,
          position: raw.position,
          red_cards: null,
          season: `${source.year}_${eventId.toLowerCase().includes("spring") || eventId === "NCCSL" || eventId === "VESL" ? "spring" : "fall"}`,
          age_group: divInfo.ageGroup || divDisplayInfo.ageGroup,
          gender: divInfo.gender || divDisplayInfo.gender,
          extra_data: {
            sincsports_team_id: raw.teamId,
            sincsports_div_code: div.code,
            sincsports_div_display: div.text,
            group: raw.group,
            goal_difference: raw.goalDiff,
          },
        });
      }

    } catch (error) {
      console.log(`\n  ⚠️ Error scraping standings for ${div.code}: ${error.message}`);
    }

    await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
  }

  // Post-process: only append group suffix when multiple groups exist per division
  const groupsPerDiv = {};
  for (const s of allStandings) {
    const group = s.extra_data?.group;
    if (group) {
      if (!groupsPerDiv[s.division]) groupsPerDiv[s.division] = new Set();
      groupsPerDiv[s.division].add(group);
    }
  }
  for (const s of allStandings) {
    const group = s.extra_data?.group;
    if (group && groupsPerDiv[s.division] && groupsPerDiv[s.division].size > 1) {
      s.division = `${s.division} - ${group}`;
    }
  }

  console.log(`\n  📊 ${allStandings.length} standings entries from ${divisionsScraped} divisions`);
  return allStandings;
}

// =============================================
// HELPERS
// =============================================

/**
 * Map SINC Sports tier number to human-readable division name.
 * Consistent ordinal naming: Premier > 1st Division > 2nd Division > ... > 14th Division
 *
 * SINC Sports tiers: 01 = Premier, 02+ = ordinal divisions
 */
function mapTierToName(tier) {
  if (tier === null || tier === undefined) return null;

  // If tier is already a string like "1ST", "PREMIER", etc.
  if (typeof tier === "string") {
    const upper = tier.toUpperCase();
    if (upper === "PREMIER" || upper === "PREM") return "Premier";
    // Parse ordinal strings to numbers: "1ST" → 1, "2ND" → 2, etc.
    const numMatch = upper.match(/^(\d+)/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      return `${toOrdinal(n)} Division`;
    }
    return tier;
  }

  // Numeric tier: 1 = Premier, 2+ = ordinal divisions
  const tierNum = parseInt(tier, 10);
  if (isNaN(tierNum)) return null;
  if (tierNum === 1) return "Premier";
  return `${toOrdinal(tierNum - 1)} Division`;
}

/**
 * Convert number to ordinal string: 1→"1st", 2→"2nd", 3→"3rd", 4→"4th", etc.
 */
function toOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
