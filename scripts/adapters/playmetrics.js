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
      {
        id: "cal-spring-2026",
        name: "Colorado Advanced League Spring 2026",
        type: "league",
        year: 2026,
        leagueId: "1017-1829-bf8e0969",
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
      // WYSA State Championships + Presidents Cup — org 1014
      {
        id: "wysa-state-champs-fall-2025",
        name: "WYSA State Championships Fall 2025",
        type: "tournament",
        year: 2026,
        leagueId: "1014-1549-d93b8fa6",
        state: "WI",
      },
      {
        id: "wysa-state-champs-spring-2025",
        name: "WYSA State Championships Spring 2025",
        type: "tournament",
        year: 2025,
        leagueId: "1014-1287-253aeff2",
        state: "WI",
      },
      {
        id: "wysa-presidents-cup-fall-2025",
        name: "WYSA Presidents Cup Fall 2025",
        type: "tournament",
        year: 2026,
        leagueId: "1014-1548-5e86d088",
        state: "WI",
      },
      {
        id: "wysa-presidents-cup-spring-2025",
        name: "WYSA Presidents Cup Spring 2025",
        type: "tournament",
        year: 2025,
        leagueId: "1014-1286-98381605",
        state: "WI",
      },
      // MAYSA (Madison Area Youth Soccer Association) — org 1027
      {
        id: "maysa-fall-2025",
        name: "MAYSA League Fall 2025",
        type: "league",
        year: 2026,
        leagueId: "1027-1519-e326860f",
        state: "WI",
      },
      {
        id: "maysa-spring-2025",
        name: "MAYSA League Spring 2025",
        type: "league",
        year: 2025,
        leagueId: "1027-1262-9af9ea75",
        state: "WI",
      },
      // East Central Classic League — org 1028
      {
        id: "east-central-fall-2025",
        name: "East Central Classic League Fall 2025",
        type: "league",
        year: 2026,
        leagueId: "1028-1508-d9de4618",
        state: "WI",
      },
      {
        id: "east-central-spring-2025",
        name: "East Central Classic League Spring 2025",
        type: "league",
        year: 2025,
        leagueId: "1028-1245-87cf8b2e",
        state: "WI",
      },
      // Central Wisconsin Soccer League — org 1033
      {
        id: "cwsl-current",
        name: "Central Wisconsin Soccer League",
        type: "league",
        year: 2026,
        leagueId: "1033-1414-5115f522",
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
  // STANDINGS SCRAPING (Session 110)
  // Universal pattern: discoverSources() + scrapeSource()
  // Requires Puppeteer — Vue SPA renders standings tables client-side.
  //
  // PlayMetrics division_view.html page has TWO tables:
  //   1. Schedule table (has "Home Team"/"Away Team" headers)
  //   2. Standings table (has "Team"/"MP"/"W"/"D"/"L"/"GF"/"GA"/"GD"/"Pts" headers)
  // =========================================

  standings: {
    enabled: true,

    /**
     * Discover sources from PlayMetrics static events.
     * Only league events (not tournaments) have standings.
     */
    discoverSources: async (engine) => {
      const sources = [];

      for (const evt of engine.adapter.discovery.staticEvents) {
        if (evt.type !== 'league') continue;
        if (!evt.leagueId) continue;

        // Verify this event exists in the DB
        const { rows } = await engine.pool.query(
          `SELECT id FROM leagues WHERE source_event_id = $1 AND source_platform = 'playmetrics' LIMIT 1`,
          [evt.id]
        );
        if (rows.length === 0) continue;

        sources.push({
          id: evt.id,
          name: evt.name,
          league_source_id: evt.id, // source_entity_id in source_entity_map
          leagueId: evt.leagueId,
          season: evt.year >= 2026 ? '2025-2026' : '2024-2025',
          snapshot_date: new Date().toISOString().split('T')[0],
        });
      }

      return sources;
    },

    /**
     * Scrape standings for a PlayMetrics league.
     * Uses Puppeteer to load the Vue SPA and extract standings tables.
     *
     * Flow:
     *   1. Load league landing page → discover division links
     *   2. For each division, load division_view.html (wait 5s for Vue)
     *   3. Parse the standings table (any table with a "Pts" or "Points" column
     *      that does NOT have "Home Team" columns — this distinguishes it from
     *      the schedule/matches table on the same page)
     */
    scrapeSource: async (engine, source) => {
      const allStandings = [];
      const { leagueId, league_source_id, season } = source;
      const baseUrl = engine.adapter.baseUrl;

      const b = await engine.initPuppeteer();
      const page = await b.newPage();

      try {
        // Step 1: Load league landing page to discover division links
        const landingUrl = `${baseUrl}/g/leagues/${leagueId}/league_view.html`;
        await page.goto(landingUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await engine.sleep(8000); // Vue SPA render

        const divisions = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('.league-divisions__grid__card'));
          return cards.map(card => {
            const nameEl = card.querySelector('.league-divisions__grid__card__name');
            const linkEl = card.querySelector('a.button');
            return {
              name: nameEl ? nameEl.textContent.trim() : null,
              href: linkEl ? linkEl.getAttribute('href') : null,
            };
          }).filter(d => d.name && d.href);
        });

        if (divisions.length === 0) {
          console.log(`  No divisions found for ${source.name}`);
          await page.close();
          return [];
        }

        console.log(`  Found ${divisions.length} divisions for ${source.name}`);

        // Step 2: Scrape each division for standings
        for (let i = 0; i < divisions.length; i++) {
          const division = divisions[i];
          const { gender, ageGroup } = engine.adapter.transform.parseDivision(division.name);

          try {
            const divisionUrl = `${baseUrl}${division.href}`;
            await page.goto(divisionUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await engine.sleep(5000); // Vue SPA render

            // Step 3: Extract standings table
            const standings = await page.evaluate((divName) => {
              const results = [];
              const tables = Array.from(document.querySelectorAll('table'));

              for (const table of tables) {
                const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());

                // Skip schedule/match tables (they have "Home Team" column)
                if (headers.some(h => h.includes('Home Team') || h.includes('Away Team'))) continue;

                // Look for standings table (has "Pts" or "Points" column)
                const hasPts = headers.some(h => h === 'Pts' || h === 'Points' || h === 'PTS');
                const hasTeam = headers.some(h => h === 'Team' || h === 'Club');
                if (!hasPts || !hasTeam) continue;

                // Find column indices
                const teamIdx = headers.findIndex(h => h === 'Team' || h === 'Club');
                const mpIdx = headers.findIndex(h => h === 'MP' || h === 'P' || h === 'GP' || h === 'Played');
                const wIdx = headers.findIndex(h => h === 'W' || h === 'Wins');
                const dIdx = headers.findIndex(h => h === 'D' || h === 'T' || h === 'Ties' || h === 'Draws');
                const lIdx = headers.findIndex(h => h === 'L' || h === 'Losses');
                const gfIdx = headers.findIndex(h => h === 'GF' || h === 'F' || h === 'Goals For');
                const gaIdx = headers.findIndex(h => h === 'GA' || h === 'A' || h === 'Goals Against');
                const ptsIdx = headers.findIndex(h => h === 'Pts' || h === 'Points' || h === 'PTS');

                const rows = table.querySelectorAll('tbody tr');
                for (let r = 0; r < rows.length; r++) {
                  const cells = Array.from(rows[r].querySelectorAll('td'));
                  if (cells.length < 4) continue;

                  const teamName = cells[teamIdx]?.textContent.trim();
                  if (!teamName) continue;

                  results.push({
                    division: divName,
                    team_name: teamName,
                    position: r + 1,
                    played: mpIdx >= 0 ? parseInt(cells[mpIdx]?.textContent.trim(), 10) || 0 : null,
                    wins: wIdx >= 0 ? parseInt(cells[wIdx]?.textContent.trim(), 10) || 0 : null,
                    draws: dIdx >= 0 ? parseInt(cells[dIdx]?.textContent.trim(), 10) || 0 : null,
                    losses: lIdx >= 0 ? parseInt(cells[lIdx]?.textContent.trim(), 10) || 0 : null,
                    goals_for: gfIdx >= 0 ? parseInt(cells[gfIdx]?.textContent.trim(), 10) || 0 : null,
                    goals_against: gaIdx >= 0 ? parseInt(cells[gaIdx]?.textContent.trim(), 10) || 0 : null,
                    points: ptsIdx >= 0 ? parseInt(cells[ptsIdx]?.textContent.trim(), 10) || 0 : null,
                  });
                }

                if (results.length > 0) break; // Found standings table, stop searching
              }

              return results;
            }, division.name);

            for (const s of standings) {
              allStandings.push({
                league_source_id,
                division: s.division,
                team_name: s.team_name,
                team_source_id: null,
                played: s.played,
                wins: s.wins,
                losses: s.losses,
                draws: s.draws,
                goals_for: s.goals_for,
                goals_against: s.goals_against,
                points: s.points,
                position: s.position,
                age_group: ageGroup,
                gender,
                season,
              });
            }

            if (engine.isVerbose) {
              console.log(`    [${i + 1}/${divisions.length}] ${division.name}: ${standings.length} entries`);
            }

          } catch (err) {
            console.log(`    Division ${division.name} error: ${err.message}`);
          }

          await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
        }

      } finally {
        await page.close();
      }

      return allStandings;
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
