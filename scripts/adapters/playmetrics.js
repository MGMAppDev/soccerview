/**
 * PlayMetrics Source Adapter v1.0
 * ================================
 *
 * Scrapes league data from PlayMetrics (playmetricssports.com).
 * PlayMetrics is a youth sports management platform used by Colorado Advanced League (CAL),
 * Sporting Development League (SDL), and other regional leagues.
 *
 * TECHNOLOGY: Puppeteer (Vite-based Vue SPA)
 * PLATFORM: PlayMetrics — Vue 3 + TypeScript frontend
 *
 * Data hierarchy:
 *   League → Divisions/Tiers → Matches + Standings (tables in HTML)
 *
 * Division structure: Age + Gender + Tier + Group
 * Example: "U19G Premier 1", "U17B Elite Group A", "U15G Platinum"
 *
 * URL structure:
 *   Landing: /g/leagues/{org-id}-{league-id}-{hash}/league_view.html
 *   Division: /g/leagues/{org-id}-{league-id}-{hash}/divisions/{div-id}/division_view.html
 *
 * Usage:
 *   node scripts/universal/coreScraper.js --adapter playmetrics
 *   node scripts/universal/coreScraper.js --adapter playmetrics --event cal-fall-2025
 *   node scripts/universal/coreScraper.js --adapter playmetrics --dry-run
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "playmetrics",
  name: "PlayMetrics",
  baseUrl: "https://playmetricssports.com",

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
    iterationDelay: 3000, // Between divisions
    itemDelay: 5000, // Between leagues
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
    leagueView: "/g/leagues/{leagueId}/league_view.html",
    divisionView: "/g/leagues/{leagueId}/divisions/{divisionId}/division_view.html",
  },

  // =========================================
  // PARSING CONFIGURATION
  // =========================================

  parsing: {
    puppeteer: {
      waitForSelector: "body",
      pageLoadWait: 8000, // Vue SPA render time
    },
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "playmetrics-{eventId}-{matchId}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    /**
     * StaticEvents for PlayMetrics leagues.
     * Each entry corresponds to one season of one league.
     *
     * leagueId format: {org-id}-{league-id}-{hash}
     *   - Colorado Advanced League (org 1017)
     *   - SDL (org 1133)
     */
    staticEvents: [
      // Colorado Advanced League
      {
        id: "cal-fall-2025",
        name: "Colorado Advanced League Fall 2025",
        type: "league",
        year: 2026,
        leagueId: "1017-1482-91a2b806",
        state: "CO",
      },
      // Sporting Development League (SDL)
      {
        id: "sdl-fall-2025-boys",
        name: "Sporting Development League Fall 2025 Boys U11/U12",
        type: "league",
        year: 2026,
        leagueId: "1133-1550-26d1bb55",
        state: null, // National league
      },
      {
        id: "sdl-fall-2025-girls",
        name: "Sporting Development League Fall 2025 Girls U11/U12",
        type: "league",
        year: 2026,
        leagueId: "1133-1563-d15ba886",
        state: null, // National league
      },
      // Wisconsin Youth Soccer Association (WYSA) — org 1014
      {
        id: "wysa-fall-2025",
        name: "WYSA Fall 2025",
        type: "league",
        year: 2026,
        leagueId: "1014-1514-8ccd4dbb",
        state: "WI",
      },
      {
        id: "wysa-spring-2025",
        name: "WYSA Spring 2025",
        type: "league",
        year: 2025,
        leagueId: "1014-1283-091395a1",
        state: "WI",
      },
    ],

    discoverEvents: null,
  },

  // =========================================
  // DATA TRANSFORMATION
  // =========================================

  transform: {
    normalizeTeamName: (name) => {
      if (!name) return "";
      // Fix concatenated team names (e.g., "Grand Junction Fire FCGrand Junction SC 2007G Premier")
      // This appears to be a data issue from the source - we'll preserve as-is for now
      return name.trim();
    },

    parseDivision: (divisionText) => {
      if (!divisionText) return { gender: null, ageGroup: null };

      // Division format: "U19G Premier 1", "U17B Elite", "U15G Platinum/Gold"
      // Gender letter immediately follows age number: U19G = Girls, U17B = Boys
      const ageGenderMatch = divisionText.match(/U(\d+)([BG])\b/i);
      let gender = null;
      let ageGroup = null;

      if (ageGenderMatch) {
        ageGroup = `U${ageGenderMatch[1]}`;
        gender = ageGenderMatch[2].toUpperCase() === "G" ? "Girls" : "Boys";
      } else {
        // Fallback: just extract age
        const ageMatch = divisionText.match(/U(\d+)/i);
        ageGroup = ageMatch ? `U${ageMatch[1]}` : null;
      }

      return { gender, ageGroup };
    },

    inferState: (event) => event?.state || null,

    /**
     * Parse PlayMetrics date format (from table header or implicit from page structure).
     * Division pages don't have dates in match rows - dates are in section headers.
     */
    parseDate: (dateStr, matchDate) => {
      // If explicit date provided from section header
      if (matchDate) return matchDate;

      if (!dateStr) return null;

      // Try ISO format
      const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) return isoMatch[1];

      // Try "Month DD, YYYY" format (e.g., "August 23, 2025")
      const usMatch = dateStr.match(/(\w+)\s+(\d+),\s+(\d{4})/);
      if (usMatch) {
        const months = {
          january: "01", february: "02", march: "03", april: "04",
          may: "05", june: "06", july: "07", august: "08",
          september: "09", october: "10", november: "11", december: "12",
        };
        const month = months[usMatch[1].toLowerCase()];
        if (month) {
          return `${usMatch[3]}-${month}-${usMatch[2].padStart(2, "0")}`;
        }
      }

      return null;
    },

    /**
     * Parse score: "6 - 0" → [6, 0], "-" → [null, null]
     */
    parseScore: (scoreStr) => {
      if (!scoreStr || scoreStr.trim() === "-") return [null, null];

      const match = String(scoreStr)
        .trim()
        .match(/^(\d+)\s*-\s*(\d+)$/);

      if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];

      return [null, null];
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".playmetrics_checkpoint.json",
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
      if (!match.matchDate) return false; // No date = "Not Scheduled" section
      if (match.homeTeamName === match.awayTeamName) return false;
      if (match.homeTeamName.toLowerCase() === "tbd") return false;
      if (match.awayTeamName.toLowerCase() === "tbd") return false;
      // Filter out withdrawn teams
      if (match.homeTeamName.includes("TEAM DROP") || match.awayTeamName.includes("TEAM DROP")) return false;
      return true;
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC
  // =========================================

  scrapeEvent: async (engine, event) => {
    const allMatches = [];
    const leagueId = event.leagueId;

    console.log(`   League ID: ${leagueId}`);
    console.log(`   State: ${event.state || "National"}`);

    const page = await engine.browser.newPage();
    await page.setUserAgent(engine.getRandomUserAgent());

    try {
      // Step 1: Load league landing page to get division links
      const landingUrl = `${engine.adapter.baseUrl}/g/leagues/${leagueId}/league_view.html`;
      console.log(`   Loading league landing page...`);

      await page.goto(landingUrl, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise(resolve => setTimeout(resolve, 8000)); // Wait for Vue SPA

      // Extract division links
      const divisions = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll(".league-divisions__grid__card"));
        return cards.map(card => {
          const nameEl = card.querySelector(".league-divisions__grid__card__name");
          const linkEl = card.querySelector("a.button");
          return {
            name: nameEl ? nameEl.textContent.trim() : null,
            href: linkEl ? linkEl.getAttribute("href") : null,
          };
        }).filter(d => d.name && d.href);
      });

      if (divisions.length === 0) {
        console.log(`   ⚠️  No divisions found for ${event.name}`);
        await page.close();
        return [];
      }

      console.log(`   Found ${divisions.length} divisions\n`);

      // Step 2: Scrape each division
      for (let i = 0; i < divisions.length; i++) {
        const division = divisions[i];
        console.log(`   [${i + 1}/${divisions.length}] ${division.name}`);

        try {
          const divisionUrl = `${engine.adapter.baseUrl}${division.href}`;
          await page.goto(divisionUrl, { waitUntil: "networkidle2", timeout: 60000 });
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Extract matches using DOM-aware date association
          // PlayMetrics structure: <div class="schedule__date"> contains both
          // the <h5> date header AND the <table> with matches for that date
          const divisionMatches = await page.evaluate((divName) => {
            const matches = [];
            const datePattern = /(\w+)\s+(\d+),\s+(\d{4})/;

            // Primary: Use schedule__date containers (each has date + table)
            const dateContainers = document.querySelectorAll(".schedule__date");

            if (dateContainers.length > 0) {
              for (const container of dateContainers) {
                // Extract date from the H5 inside this container
                const h5 = container.querySelector("h5");
                const dateText = h5 ? h5.textContent.trim() : null;

                // Find the schedule table inside this container
                const table = container.querySelector("table");
                if (!table) continue;

                const headers = Array.from(table.querySelectorAll("th")).map(th => th.textContent.trim());
                if (!headers.includes("Home Team") || !headers.includes("Away Team")) continue;

                // Find column indices
                const timeIdx = headers.indexOf("Time");
                const gameIdx = headers.indexOf("Game #");
                const fieldIdx = headers.indexOf("Field");
                const homeIdx = headers.findIndex(h => h.includes("Home Team"));
                const awayIdx = headers.findIndex(h => h.includes("Away Team"));
                const scoreIdx = headers.indexOf("Score");
                const statusIdx = headers.indexOf("Status");

                const rows = table.querySelectorAll("tr");
                for (let r = 1; r < rows.length; r++) {
                  const cells = Array.from(rows[r].querySelectorAll("td"));
                  if (cells.length < 5) continue;

                  const time = cells[timeIdx]?.textContent.trim() || null;
                  const gameId = cells[gameIdx]?.textContent.trim() || null;
                  const homeTeam = cells[homeIdx]?.textContent.trim() || null;
                  const awayTeam = cells[awayIdx]?.textContent.trim() || null;
                  const score = cells[scoreIdx]?.textContent.trim() || null;
                  const status = cells[statusIdx]?.textContent.trim() || null;
                  const field = cells[fieldIdx]?.textContent.trim() || null;

                  if (!gameId || !homeTeam || !awayTeam) continue;

                  matches.push({
                    time,
                    gameId,
                    field,
                    homeTeam,
                    awayTeam,
                    score,
                    status,
                    division: divName,
                    matchDate: dateText,
                  });
                }
              }
            } else {
              // Fallback: walk tables and find dates from previous siblings
              const tables = Array.from(document.querySelectorAll("table"));
              for (const table of tables) {
                const headers = Array.from(table.querySelectorAll("th")).map(th => th.textContent.trim());
                if (!headers.includes("Home Team") || !headers.includes("Away Team")) continue;

                // Find date by walking up/back through DOM
                let dateText = null;
                let el = table.parentElement;
                while (el && !dateText) {
                  const prev = el.previousElementSibling;
                  if (prev) {
                    const h5 = prev.querySelector ? prev.querySelector("h5") : null;
                    if (h5 && datePattern.test(h5.textContent)) {
                      dateText = h5.textContent.trim();
                      break;
                    }
                    if (datePattern.test(prev.textContent)) {
                      const match = prev.textContent.match(/\w+day,\s+\w+\s+\d+,\s+\d{4}/);
                      if (match) { dateText = match[0]; break; }
                    }
                  }
                  el = el.parentElement;
                }

                const timeIdx = headers.indexOf("Time");
                const gameIdx = headers.indexOf("Game #");
                const fieldIdx = headers.indexOf("Field");
                const homeIdx = headers.findIndex(h => h.includes("Home Team"));
                const awayIdx = headers.findIndex(h => h.includes("Away Team"));
                const scoreIdx = headers.indexOf("Score");
                const statusIdx = headers.indexOf("Status");

                const rows = table.querySelectorAll("tr");
                for (let r = 1; r < rows.length; r++) {
                  const cells = Array.from(rows[r].querySelectorAll("td"));
                  if (cells.length < 5) continue;

                  const time = cells[timeIdx]?.textContent.trim() || null;
                  const gameId = cells[gameIdx]?.textContent.trim() || null;
                  const homeTeam = cells[homeIdx]?.textContent.trim() || null;
                  const awayTeam = cells[awayIdx]?.textContent.trim() || null;
                  const score = cells[scoreIdx]?.textContent.trim() || null;
                  const status = cells[statusIdx]?.textContent.trim() || null;
                  const field = cells[fieldIdx]?.textContent.trim() || null;

                  if (!gameId || !homeTeam || !awayTeam) continue;

                  matches.push({
                    time,
                    gameId,
                    field,
                    homeTeam,
                    awayTeam,
                    score,
                    status,
                    division: divName,
                    matchDate: dateText,
                  });
                }
              }
            }

            return matches;
          }, division.name);

          if (divisionMatches.length > 0) {
            // Transform to SoccerView format
            for (const m of divisionMatches) {
              const [homeScore, awayScore] = engine.adapter.transform.parseScore(m.score);
              const { gender, ageGroup } = engine.adapter.transform.parseDivision(m.division);

              const matchStatus = m.status === "Played" ? "completed" : "scheduled";

              // Parse date from section header (format: "Saturday, August 23, 2025")
              const parsedDate = engine.adapter.transform.parseDate(m.matchDate);

              // Validate time: must look like HH:MM or H:MM AM/PM, else null
              let matchTime = m.time;
              if (matchTime && !/^\d{1,2}:\d{2}/.test(matchTime)) {
                matchTime = null; // Not a valid time (e.g., "-", "TBD")
              }

              allMatches.push({
                eventId: event.id,
                eventName: event.name,
                matchId: m.gameId,
                matchDate: parsedDate,
                matchTime,
                homeTeamName: m.homeTeam,
                awayTeamName: m.awayTeam,
                homeScore,
                awayScore,
                homeId: null,
                awayId: null,
                status: matchStatus,
                location: m.field,
                division: m.division,
                gender,
                ageGroup,
                raw_data: {
                  playmetrics_game_id: m.gameId,
                  status: m.status,
                },
              });
            }

            console.log(`      ${divisionMatches.length} matches`);
          } else {
            console.log(`      0 matches`);
          }
        } catch (error) {
          console.error(`      Error: ${error.message}`);
        }

        // Rate limiting between divisions
        if (i < divisions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, engine.adapter.rateLimiting.iterationDelay));
        }
      }

    } finally {
      await page.close();
    }

    // Deduplicate by game ID
    const uniqueMatches = Array.from(
      new Map(allMatches.map((m) => [m.matchId, m])).values()
    );

    console.log(`\n   Total: ${uniqueMatches.length} unique matches`);
    return uniqueMatches.filter(m => engine.adapter.dataPolicy.isValidMatch(m));
  },
};
