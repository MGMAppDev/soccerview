/**
 * MLS Next Source Adapter v2.0
 * ============================
 *
 * Scrapes MLS Next match data from Modular11 (www.modular11.com).
 * MLS Next is the national premier youth development league operated by MLS.
 *
 * TECHNOLOGY: Puppeteer (JavaScript SPA — AJAX returns HTML fragments)
 * PLATFORM: Modular11 — CakePHP backend + jQuery/Bootstrap frontend
 *
 * Confirmed architecture (from diagnostic 2026-02-15):
 * - Tournament ID 12 = MLS NEXT overall (includes Flex, League, Pro Player Pathway)
 * - AJAX endpoint: /public_schedule/league/get_matches
 * - Required params: match_type, start_date, end_date (plus tournament, age, etc.)
 * - Status values: "all", "scheduled", "pending" (no "played"/"completed")
 * - Response: HTML div structure (NOT tables, NOT JSON)
 * - Match data in Bootstrap grid divs with data-title attributes for team names
 * - Scores in .score-match-table elements
 * - Match IDs in col-sm-1 column
 * - Division/Conference in js-match-group attributes
 * - Competition type in js-match-bracket attributes
 * - Pagination: 25 matches per page, js-page attributes on pagination links
 * - Date format: MM/DD/YY HH:MMam/pm
 *
 * Age group mapping (CONFIRMED from dropdown DOM inspection):
 *   UID 21 = U13, UID 22 = U14, UID 33 = U15,
 *   UID 14 = U16, UID 15 = U17, UID 26 = U19
 *
 * Strategy:
 * 1. Navigate to schedule page (establishes PHP session + loads jQuery)
 * 2. For each age group, call AJAX with explicit date range + match_type + status=all
 * 3. Parse div-based HTML response for match data
 * 4. Handle pagination (25 per page)
 *
 * Usage:
 *   node scripts/universal/coreScraper.js --adapter mlsnext
 *   node scripts/universal/coreScraper.js --adapter mlsnext --event 12
 *   node scripts/universal/coreScraper.js --adapter mlsnext --dry-run
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "mlsnext",
  name: "MLS Next",
  baseUrl: "https://www.modular11.com",

  // =========================================
  // TECHNOLOGY
  // =========================================

  technology: "puppeteer",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    requestDelayMin: 2000,
    requestDelayMax: 4000,
    iterationDelay: 3000, // Between age groups
    itemDelay: 5000, // Between events
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
  ],

  // =========================================
  // ENDPOINTS
  // =========================================

  endpoints: {
    schedule: "/schedule?year={ageId}",
    getMatches: "/public_schedule/league/get_matches",
  },

  // =========================================
  // PARSING CONFIGURATION
  // =========================================

  parsing: {
    puppeteer: {
      waitForSelector: ".container-schedule-list",
      pageLoadWait: 5000,
      ajaxWait: 8000,
    },
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "mlsnext-{matchId}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    /**
     * MLS NEXT (tournament 12) age group mapping.
     * CONFIRMED via dropdown DOM inspection on 2026-02-15.
     */
    staticEvents: [
      {
        id: 12,
        name: "MLS NEXT 2025-26",
        type: "league",
        year: 2026,
        modular11Tournament: 12,
        ageGroups: [
          { uid: 21, label: "U13" },
          { uid: 22, label: "U14" },
          { uid: 33, label: "U15" },
          { uid: 14, label: "U16" },
          { uid: 15, label: "U17" },
          { uid: 26, label: "U19" },
        ],
      },
    ],

    discoverEvents: null,
  },

  // =========================================
  // DATA TRANSFORMATION
  // =========================================

  transform: {
    normalizeTeamName: (name) => name?.trim() || "",

    parseDivision: (divisionText) => {
      if (!divisionText) return { gender: null, ageGroup: null };
      const ageMatch = divisionText.match(/U-?(\d+)/i);
      const ageGroup = ageMatch ? `U${ageMatch[1]}` : null;
      return { gender: "Boys", ageGroup };
    },

    /** National league — no single state */
    inferState: () => null,

    /**
     * Parse Modular11 date format: "MM/DD/YY HH:MMam/pm"
     * Example: "02/14/26 09:00am"
     */
    parseDate: (dateStr) => {
      if (!dateStr) return null;
      // MM/DD/YY format (2-digit year)
      const shortMatch = dateStr.match(
        /(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2})(am|pm)?/i
      );
      if (shortMatch) {
        const year = parseInt(shortMatch[3], 10) + 2000;
        return `${year}-${shortMatch[1].padStart(2, "0")}-${shortMatch[2].padStart(2, "0")}`;
      }
      // MM/DD/YYYY format (4-digit year)
      const usMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (usMatch) {
        return `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
      }
      // ISO format
      const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) return isoMatch[1];
      return null;
    },

    parseScore: (scoreStr) => {
      if (
        scoreStr === null ||
        scoreStr === undefined ||
        scoreStr === "" ||
        scoreStr === "TBD"
      )
        return [null, null];
      const match = String(scoreStr)
        .trim()
        .match(/^(\d+)\s*:\s*(\d+)$/);
      if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];
      return [null, null];
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".mlsnext_checkpoint.json",
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    minDate: "2024-08-01",
    maxFutureDate: null,
    maxEventsPerRun: 10,

    isValidMatch: (match) => {
      if (!match.homeTeamName || !match.awayTeamName) return false;
      if (match.homeTeamName === match.awayTeamName) return false;
      if (match.homeTeamName.toLowerCase() === "tbd") return false;
      if (match.awayTeamName.toLowerCase() === "tbd") return false;
      return true;
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC
  // =========================================

  scrapeEvent: async (engine, event) => {
    const allMatches = [];
    const ageGroups =
      event.ageGroups || engine.adapter.discovery.staticEvents[0].ageGroups;
    const tournamentId = event.modular11Tournament || 12;

    console.log(`   Tournament ID: ${tournamentId} (Modular11)`);
    console.log(`   Age groups: ${ageGroups.map((a) => a.label).join(", ")}`);

    // Step 1: Open initial page to establish PHP session + load jQuery
    const initUrl = `${engine.adapter.baseUrl}/schedule?year=${ageGroups[0].uid}`;
    console.log(`   Establishing session at ${initUrl}...`);

    const page = await engine.browser.newPage();
    await page.setUserAgent(engine.getRandomUserAgent());
    await page.goto(initUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await engine.sleep(5000);

    // Step 2: For each age group, fetch all pages via AJAX
    for (let i = 0; i < ageGroups.length; i++) {
      const age = ageGroups[i];
      console.log(
        `\n   [${i + 1}/${ageGroups.length}] ${age.label} (UID: ${age.uid})`
      );

      try {
        const matches = await scrapeAgeGroup(
          page,
          engine,
          tournamentId,
          age,
          event
        );
        if (matches.length > 0) {
          allMatches.push(...matches);
          console.log(`   ${age.label}: ${matches.length} matches`);
        } else {
          console.log(`   ${age.label}: 0 matches`);
        }
      } catch (error) {
        console.error(`   Error scraping ${age.label}: ${error.message}`);
      }

      if (i < ageGroups.length - 1) {
        await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
      }
    }

    await page.close();

    // Deduplicate by match ID
    const uniqueMatches = Array.from(
      new Map(allMatches.map((m) => [m.matchId, m])).values()
    );

    console.log(`\n   Total: ${uniqueMatches.length} unique matches`);
    return uniqueMatches;
  },
};

// =========================================
// INTERNAL FUNCTIONS
// =========================================

/**
 * Scrape all matches for one age group using the AJAX endpoint.
 * Handles pagination (25 matches per page).
 *
 * Uses explicit start_date/end_date and match_type=2 as required
 * by the server-side validation. status=all gets both scheduled
 * and completed matches.
 */
async function scrapeAgeGroup(page, engine, tournamentId, age, event) {
  const allMatches = [];
  let pageNum = 0;
  let hasMore = true;
  const maxPages = 100; // Safety limit (100 pages x 25 = 2500 matches max per age group)

  while (hasMore && pageNum < maxPages) {
    // Call the AJAX endpoint within the page context (uses existing jQuery + PHP session)
    const result = await page.evaluate(
      async (tournId, ageUid, pageOffset) => {
        return new Promise((resolve) => {
          const timeout = setTimeout(
            () => resolve({ error: "timeout", html: "" }),
            25000
          );

          $.ajax({
            url: "/public_schedule/league/get_matches",
            type: "GET",
            data: {
              open_page: pageOffset,
              academy: 0,
              tournament: tournId,
              gender: 0,
              age: ageUid,
              brackets: "",
              groups: "",
              group: "",
              match_number: 0,
              status: "all",
              match_type: 2,
              schedule: 0,
              team: 0,
              teamPlayer: 0,
              location: 0,
              as_referee: 0,
              report_status: 0,
              start_date: "2025-08-01 00:00:00",
              end_date: "2026-07-31 23:59:59",
            },
            success: function (html) {
              clearTimeout(timeout);
              resolve({ html: html, length: html.length });
            },
            error: function (xhr) {
              clearTimeout(timeout);
              resolve({
                error: `${xhr.status} ${xhr.statusText}`,
                html: "",
              });
            },
          });
        });
      },
      tournamentId,
      age.uid,
      pageNum
    );

    if (result.error) {
      console.log(`     Page ${pageNum}: AJAX error — ${result.error}`);
      break;
    }

    if (!result.html || result.html.length < 100) {
      hasMore = false;
      break;
    }

    // Check for server-side error messages
    if (
      result.html.includes("field is required") ||
      result.html.includes("is invalid")
    ) {
      console.log(
        `     Page ${pageNum}: Server error — ${result.html.substring(0, 200)}`
      );
      break;
    }

    // Parse matches from the HTML response
    const parsed = await page.evaluate(
      (htmlStr, ageLabel, eventId, eventName) => {
        const container = document.createElement("div");
        container.innerHTML = htmlStr;

        const matches = [];

        // Each match is a .container-row div
        const rows = container.querySelectorAll(".container-row");

        rows.forEach((row) => {
          // Desktop version: .table-content-row.hidden-xs
          const desktopRow = row.querySelector(
            ".table-content-row.hidden-xs"
          );
          if (!desktopRow) return;

          // Extract data from columns
          const cols = desktopRow.querySelectorAll(
            ".col-sm-1, .col-sm-2, .col-sm-3, .col-sm-5, .col-sm-6"
          );
          const colTexts = Array.from(cols).map((c) =>
            c.textContent.replace(/\s+/g, " ").trim()
          );

          // Match ID: first col-sm-1 contains "105048 MALE"
          const firstCol = cols[0]?.textContent?.trim() || "";
          const matchIdMatch = firstCol.match(/^(\d+)/);
          const matchId = matchIdMatch ? matchIdMatch[1] : null;

          // Date/time: second column (col-sm-2) contains "02/14/26 09:00am Location..."
          const dateCol = cols[1]?.textContent?.trim() || "";
          const dateMatch = dateCol.match(
            /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}(?:am|pm)?)/i
          );
          const dateStr = dateMatch ? dateMatch[1] : null;
          const timeStr = dateMatch ? dateMatch[2] : null;

          // Location from data-title attribute
          const locationEl = row.querySelector(
            ".container-location p[data-title]"
          );
          const location = locationEl
            ? locationEl.getAttribute("data-title")
            : null;

          // Age: third column
          const ageCol = cols[2]?.textContent?.trim() || "";

          // Competition type from js-match-bracket attribute
          const bracket =
            desktopRow.getAttribute("js-match-bracket") || "";

          // Division/Conference from js-match-group attribute
          const group =
            desktopRow.getAttribute("js-match-group") || "";

          // Team names from data-title attributes on team containers
          const teamContainers = row.querySelectorAll(
            ".container-first-team, .container-second-team"
          );
          let homeTeam = null;
          let awayTeam = null;

          if (teamContainers.length >= 2) {
            // Look for data-title on child elements
            const homeEl = teamContainers[0].querySelector(
              "[data-title]"
            );
            const awayEl = teamContainers[1].querySelector(
              "[data-title]"
            );
            homeTeam = homeEl
              ? homeEl.getAttribute("data-title")
              : teamContainers[0].textContent.trim();
            awayTeam = awayEl
              ? awayEl.getAttribute("data-title")
              : teamContainers[1].textContent.trim();
          }

          // Fallback: Look for data-title in col-sm-3 containers (team image wrappers)
          if (!homeTeam || !awayTeam) {
            const allDataTitles = Array.from(
              row.querySelectorAll("[data-title]")
            )
              .map((el) => el.getAttribute("data-title"))
              .filter(
                (t) =>
                  t &&
                  !t.includes("Stadium") &&
                  !t.includes("Field") &&
                  !t.includes("Center") &&
                  !t.includes("Park") &&
                  !t.includes("Complex")
              );
            if (allDataTitles.length >= 2) {
              homeTeam = homeTeam || allDataTitles[0];
              awayTeam = awayTeam || allDataTitles[1];
            }
          }

          // Score from .score-match-table element
          const scoreEl = row.querySelector(".score-match-table");
          const scoreText = scoreEl?.textContent?.trim() || "";

          if (!matchId) return;

          matches.push({
            matchId,
            dateStr,
            timeStr,
            homeTeam: homeTeam || null,
            awayTeam: awayTeam || null,
            scoreText,
            location,
            ageGroup: ageCol || ageLabel,
            bracket,
            group,
          });
        });

        // Check for pagination: look for last page number
        let lastPage = 0;
        container
          .querySelectorAll("[js-page]")
          .forEach((el) => {
            const p = parseInt(el.getAttribute("js-page"), 10);
            if (!isNaN(p) && p > lastPage) lastPage = p;
          });

        return {
          matches,
          totalRows: rows.length,
          lastPage,
        };
      },
      result.html,
      age.label,
      event.id.toString(),
      event.name
    );

    if (pageNum === 0) {
      console.log(
        `     Page 0: ${parsed.totalRows} rows, ${parsed.matches.length} parsed, ${parsed.lastPage} total pages`
      );
    }

    // Transform parsed matches to our standard format
    for (const m of parsed.matches) {
      // Parse date: MM/DD/YY → YYYY-MM-DD
      let matchDate = null;
      if (m.dateStr) {
        const dm = m.dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (dm) {
          const year =
            dm[3].length === 2 ? 2000 + parseInt(dm[3], 10) : parseInt(dm[3], 10);
          matchDate = `${year}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
        }
      }

      // Parse score: "1 : 3" or "TBD"
      let homeScore = null;
      let awayScore = null;
      if (m.scoreText && m.scoreText !== "TBD") {
        const sm = m.scoreText.match(/(\d+)\s*:\s*(\d+)/);
        if (sm) {
          homeScore = parseInt(sm[1], 10);
          awayScore = parseInt(sm[2], 10);
        }
      }

      // Build division string
      const division = [m.ageGroup, m.bracket, m.group]
        .filter(Boolean)
        .join(" — ");

      const status =
        homeScore !== null && awayScore !== null ? "completed" : "scheduled";

      allMatches.push({
        eventId: event.id.toString(),
        eventName: event.name,
        matchId: m.matchId,
        matchDate,
        matchTime: m.timeStr || null,
        homeTeamName: m.homeTeam,
        awayTeamName: m.awayTeam,
        homeScore,
        awayScore,
        homeId: null, // Modular11 doesn't expose team IDs in list view
        awayId: null,
        status,
        location: m.location,
        division: division || age.label,
        gender: "Boys",
        ageGroup: m.ageGroup || age.label,
        raw_data: {
          modular11_match_id: m.matchId,
          bracket: m.bracket,
          conference: m.group,
        },
      });
    }

    // Pagination: check if there are more pages
    if (parsed.totalRows === 0 || parsed.matches.length === 0) {
      hasMore = false;
    } else if (pageNum === 0 && parsed.lastPage > 0) {
      // First page tells us total pages
      console.log(`     Pagination: ${parsed.lastPage} total pages`);
      pageNum++;
    } else if (pageNum < parsed.lastPage) {
      pageNum++;
    } else {
      hasMore = false;
    }

    if (hasMore) {
      await engine.sleep(engine.adapter.rateLimiting.requestDelayMin);
    }
  }

  return allMatches.filter((m) =>
    engine.adapter.dataPolicy.isValidMatch(m)
  );
}
