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

  matchKeyFormat: "playmetrics-{gameId}",

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
      {
        id: "cal-spring-2025",
        name: "Colorado Advanced League Spring 2025",
        type: "league",
        year: 2025,
        leagueId: "1017-1253-d76f4cb2",
        state: "CO",
      },
      {
        id: "cal-fall-2024",
        name: "Colorado Advanced League Fall 2024",
        type: "league",
        year: 2025,
        leagueId: "1017-1088-827359b7",
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
      let gender = null;
      if (divisionText.includes("G")) gender = "Girls";
      else if (divisionText.includes("B")) gender = "Boys";

      const ageMatch = divisionText.match(/U(\d+)/i);
      const ageGroup = ageMatch ? `U${ageMatch[1]}` : null;

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

          // Extract matches from tables
          const divisionMatches = await page.evaluate((divName) => {
            const matches = [];
            const tables = Array.from(document.querySelectorAll("table"));

            // Extract all dates from page text using regex
            const bodyText = document.body.textContent;
            const datePattern = /(\w+day),\s+(\w+)\s+(\d+),\s+(\d{4})/g;
            const allDates = [];
            let dateMatch;
            while ((dateMatch = datePattern.exec(bodyText)) !== null) {
              allDates.push(dateMatch[0]); // Full date string
            }

            let dateIndex = 0;

            // Skip first table (standings table)
            for (let t = 1; t < tables.length; t++) {
              const table = tables[t];
              const rows = table.querySelectorAll("tr");

              // Check if this is a schedule table (has specific headers)
              const headers = Array.from(table.querySelectorAll("th")).map(th => th.textContent.trim());
              const isScheduleTable = headers.includes("Home Team") && headers.includes("Away Team");

              if (!isScheduleTable) continue;

              // Each schedule table corresponds to one date
              // Use the next date from our sequential list
              const currentDate = allDates[dateIndex] || null;
              if (allDates.length > dateIndex + 1) {
                dateIndex++; // Move to next date for next table
              }

              // Find column indices
              const timeIdx = headers.indexOf("Time");
              const gameIdx = headers.indexOf("Game #");
              const fieldIdx = headers.indexOf("Field");
              const homeIdx = headers.findIndex(h => h.includes("Home Team"));
              const awayIdx = headers.findIndex(h => h.includes("Away Team"));
              const scoreIdx = headers.indexOf("Score");
              const statusIdx = headers.indexOf("Status");

              // Parse each row (skip header)
              for (let r = 1; r < rows.length; r++) {
                const row = rows[r];
                const cells = Array.from(row.querySelectorAll("td"));

                if (cells.length < 5) continue; // Skip incomplete rows

                const time = cells[timeIdx]?.textContent.trim() || null;
                const gameId = cells[gameIdx]?.textContent.trim() || null;
                const field = cells[fieldIdx]?.textContent.trim() || null;
                const homeTeam = cells[homeIdx]?.textContent.trim() || null;
                const awayTeam = cells[awayIdx]?.textContent.trim() || null;
                const score = cells[scoreIdx]?.textContent.trim() || null;
                const status = cells[statusIdx]?.textContent.trim() || null;

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
                  matchDate: currentDate, // Pass date header to match
                });
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

              allMatches.push({
                eventId: event.id,
                eventName: event.name,
                matchId: m.gameId,
                matchDate: parsedDate,
                matchTime: m.time === "-" ? null : m.time, // Convert "-" to null
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
