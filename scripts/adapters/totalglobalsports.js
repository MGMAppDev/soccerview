/**
 * TotalGlobalSports (ECNL) Source Adapter v1.0
 * =============================================
 *
 * Scrapes ECNL match data from TotalGlobalSports (public.totalglobalsports.com).
 * ECNL (Elite Clubs National League) is the premier girls + boys club league.
 * ECRL (ECNL Regional League) is the second tier.
 *
 * TECHNOLOGY: Puppeteer (React SPA behind Cloudflare protection)
 * PLATFORM: TotalGlobalSports — React frontend + .NET-like backend
 *
 * Key TGS concepts:
 * - Each conference + season = unique event ID (e.g., 3933 = ECNL Southwest Girls 25-26)
 * - Public pages at public.totalglobalsports.com/public/event/{ID}/...
 * - API endpoint discovered: /api/Script/get-conference-standings/{eventId}/{params}
 * - Cloudflare protection — Puppeteer with stealth required
 * - Schedules, standings, and match details are PUBLIC (no auth)
 *
 * Data hierarchy:
 *   Event (conference+season) → Age Groups → Divisions/Brackets → Games
 *
 * Usage:
 *   node scripts/universal/coreScraper.js --adapter totalglobalsports
 *   node scripts/universal/coreScraper.js --adapter totalglobalsports --event 3933
 *   node scripts/universal/coreScraper.js --adapter totalglobalsports --dry-run
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "totalglobalsports",
  name: "TotalGlobalSports (ECNL)",
  baseUrl: "https://public.totalglobalsports.com",

  // =========================================
  // TECHNOLOGY
  // =========================================

  technology: "puppeteer",

  /** Cloudflare-protected site — requires stealth plugin */
  puppeteerStealth: true,

  // =========================================
  // RATE LIMITING
  // Cloudflare-protected — be very gentle
  // =========================================

  rateLimiting: {
    requestDelayMin: 4000,
    requestDelayMax: 7000,
    iterationDelay: 5000, // Between age groups
    itemDelay: 8000, // Between events/conferences
    maxRetries: 3,
    retryDelays: [10000, 30000, 60000],
    cooldownOn429: 180000, // 3 minutes for Cloudflare
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
    schedulesStandings:
      "/public/event/{eventId}/schedules-standings",
    conferenceStandings:
      "/public/event/{eventId}/conference-standings/{ageGroupId}",
    individualTeam:
      "/public/event/{eventId}/individual-team/{orgId}/{teamId}/{divisionId}",
    clubSchedules:
      "/public/event/{eventId}/club-schedules/{clubId}",
    gamePreview:
      "/public/event/{eventId}/game-preview/{gameId}/{param2}/{divisionId}",
    apiStandings:
      "/api/Script/get-conference-standings/{eventId}/{p2}/{p3}/{p4}/{p5}",
  },

  // =========================================
  // PARSING CONFIGURATION
  // =========================================

  parsing: {
    puppeteer: {
      waitForSelector: "body",
      pageLoadWait: 6000,
      ajaxWait: 12000, // React SPA + Cloudflare = slow
    },
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "ecnl-{eventId}-{matchId}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    /**
     * ECNL event IDs for 2025-26 season.
     * Each conference + tier has its own event ID.
     *
     * DISCOVERY METHOD: Event IDs change each season.
     * Found via: Google indexing, theecnl.com links, SoCal Soccer forums.
     * Must be updated each August when new season events are created.
     */
    staticEvents: [
      // ========================
      // ECNL BOYS — 2025-26
      // ========================
      { id: 3933, name: "ECNL Boys Southwest 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Southwest" },

      // ========================
      // ECNL GIRLS — 2025-26
      // ========================
      { id: 3928, name: "ECNL Girls North Atlantic 2025-26", type: "league", year: 2026, gender: "Girls", conference: "North Atlantic" },

      // ========================
      // ECRL (Regional League) — 2025-26
      // ========================
      { id: 3954, name: "ECRL Southwest 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Southwest" },

      // ========================
      // NATIONAL EVENTS — 2025-26
      // ========================
      { id: 3388, name: "ECNL Phoenix Spring 2026", type: "tournament", year: 2026, gender: "Boys" },
      { id: 3393, name: "ECNL North Carolina Spring 2026", type: "tournament", year: 2026, gender: "Girls" },
      { id: 3391, name: "ECNL North Carolina 2025-26", type: "tournament", year: 2026, gender: "Girls" },

      // ========================
      // OLDER SEASON (for backfill / reference)
      // ========================
      { id: 3262, name: "ECRL Boys Texas 2024-25", type: "league", year: 2025, gender: "Boys", conference: "Texas" },
      { id: 3255, name: "ECRL Boys North Texas 2024-25", type: "league", year: 2025, gender: "Boys", conference: "North Texas" },
      { id: 3226, name: "ECRL Girls North Texas 2024-25", type: "league", year: 2025, gender: "Girls", conference: "North Texas" },
      { id: 3215, name: "ECRL Girls Florida 2024-25", type: "league", year: 2025, gender: "Girls", conference: "Florida" },
      { id: 2869, name: "ECNL Boys Texas 2023-24", type: "league", year: 2024, gender: "Boys", conference: "Texas" },
      { id: 2261, name: "ECNL Boys National Playoffs 2024-25", type: "tournament", year: 2025, gender: "Boys" },
      { id: 2118, name: "ECNL Girls National Playoffs 2024-25", type: "tournament", year: 2025, gender: "Girls" },
    ],

    discoverEvents: null, // Static events — expand as we discover more IDs
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
      if (lower.includes("boys") || lower.includes("boy") || /\bb\d/i.test(divisionText)) {
        gender = "Boys";
      } else if (lower.includes("girls") || lower.includes("girl") || /\bg\d/i.test(divisionText)) {
        gender = "Girls";
      }

      // Age group: U13-U19 or birth year 2006-2013
      let ageGroup = null;
      const ageMatch = divisionText.match(/U-?(\d+)/i);
      if (ageMatch) {
        ageGroup = `U${ageMatch[1]}`;
      } else {
        const yearMatch = divisionText.match(/\b(20[01]\d)\b/);
        if (yearMatch) {
          const birthYear = parseInt(yearMatch[1], 10);
          const currentYear = new Date().getFullYear();
          ageGroup = `U${currentYear - birthYear}`;
        }
      }

      return { gender, ageGroup };
    },

    /** National league — teams from all states */
    inferState: () => null,

    /** TGS dates can be "MM/DD/YYYY" or "YYYY-MM-DD" */
    parseDate: (dateStr) => {
      if (!dateStr) return null;
      // ISO format
      const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) return isoMatch[1];
      // US format
      const usMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (usMatch) {
        return `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
      }
      return null;
    },

    parseScore: (scoreStr) => {
      if (scoreStr === null || scoreStr === undefined || scoreStr === "") return [null, null];
      const match = String(scoreStr).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
      if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];
      const single = parseInt(String(scoreStr).trim(), 10);
      return isNaN(single) ? [null, null] : [single, null];
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".totalglobalsports_checkpoint.json",
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    /** Current + previous season */
    minDate: "2024-08-01",
    maxFutureDate: null,
    maxEventsPerRun: 20,

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

  /**
   * Custom scrape function for TotalGlobalSports/ECNL events.
   *
   * Strategy:
   * 1. Navigate to the event's schedules-standings page
   * 2. Wait for Cloudflare challenge to resolve
   * 3. Wait for React SPA to render
   * 4. Extract available age groups/divisions from the page
   * 5. For each age group, navigate and extract match data
   * 6. Parse rendered DOM for schedules and results
   *
   * Cloudflare bypass: Puppeteer with stealth plugin handles the challenge.
   * The engine's fetchWithPuppeteer handles basic Puppeteer setup.
   */
  scrapeEvent: async (engine, event) => {
    const allMatches = [];
    const eventGender = event.gender || null;

    console.log(`   Event: ${event.name} (TGS ID: ${event.id})`);
    console.log(`   Gender: ${eventGender || "Mixed"}`);

    // Step 1: Navigate to the event's main page to discover age groups
    const mainUrl = `${engine.adapter.baseUrl}/public/event/${event.id}/schedules-standings`;
    console.log(`   URL: ${mainUrl}`);

    const page = await engine.browser.newPage();
    await page.setUserAgent(engine.getRandomUserAgent());

    // Set up network interception for API calls
    const capturedApiData = [];
    page.on("response", async (response) => {
      const respUrl = response.url();
      if (
        respUrl.includes("/api/Script/") ||
        respUrl.includes("/api/") ||
        respUrl.includes("schedule") ||
        respUrl.includes("standings")
      ) {
        try {
          const contentType = response.headers()["content-type"] || "";
          if (contentType.includes("json")) {
            const json = await response.json();
            capturedApiData.push({ url: respUrl, data: json });
          }
        } catch {}
      }
    });

    try {
      await page.goto(mainUrl, { waitUntil: "networkidle2", timeout: 90000 });

      // Wait for Cloudflare challenge + React render
      await engine.sleep(engine.adapter.parsing.puppeteer.ajaxWait);

      // Check if we hit Cloudflare challenge
      const isCloudflare = await page.evaluate(() => {
        return (
          document.title.includes("Just a moment") ||
          document.body.innerText.includes("Checking your browser") ||
          document.querySelector("#challenge-form") !== null
        );
      });

      if (isCloudflare) {
        console.log("   Cloudflare challenge detected — waiting...");
        await engine.sleep(15000);

        // Check again
        const stillBlocked = await page.evaluate(() => {
          return document.title.includes("Just a moment");
        });

        if (stillBlocked) {
          console.log("   Still blocked by Cloudflare. Try puppeteer-extra-plugin-stealth.");
          await page.close();
          return [];
        }
      }

      // Step 2: Check for captured API data first
      if (capturedApiData.length > 0) {
        console.log(`   Captured ${capturedApiData.length} API responses`);
        for (const captured of capturedApiData) {
          const matches = parseTgsApiResponse(captured.data, event, eventGender, engine);
          allMatches.push(...matches);
        }
      }

      // Step 3: Discover age groups from the rendered page
      const ageGroups = await page.evaluate(() => {
        const groups = [];

        // Look for age group links, tabs, or dropdown options
        const selectors = [
          'a[href*="conference-standings"]',
          'a[href*="schedules"]',
          ".age-group-tab",
          ".age-group-link",
          "[data-age-group]",
          'button[data-age]',
          'select option[value*="age"]',
          ".tab-content a",
          ".nav-tabs a",
          ".schedule-tab",
        ];

        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => {
            const text = el.textContent.trim();
            const href = el.getAttribute("href") || "";

            // Match age group patterns: U13, U14, U15, U16, U17, U19
            // or birth year patterns: B2009, G2010, 2011
            if (/U-?\d{1,2}\b/i.test(text) || /[BG]?20[01]\d/i.test(text)) {
              groups.push({
                text: text,
                href: href,
                value: el.value || null,
              });
            }
          });
        }

        // Also look for any links/buttons with age-related text in the body
        document.querySelectorAll("a, button").forEach((el) => {
          const text = el.textContent.trim();
          if (
            /^(U1[3-9]|U[2-9]\d|[BG]20[01]\d)\b/i.test(text) &&
            text.length < 30
          ) {
            const href = el.getAttribute("href") || "";
            groups.push({ text, href, value: null });
          }
        });

        // Deduplicate
        const seen = new Set();
        return groups.filter((g) => {
          const key = g.text + g.href;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });

      console.log(`   Found ${ageGroups.length} age group links`);

      if (ageGroups.length > 0) {
        // Navigate to each age group page and scrape
        for (let i = 0; i < ageGroups.length; i++) {
          const ag = ageGroups[i];
          console.log(
            `   [${i + 1}/${ageGroups.length}] ${ag.text}`
          );

          try {
            let targetUrl;

            if (ag.href && ag.href.startsWith("/")) {
              targetUrl = `${engine.adapter.baseUrl}${ag.href}`;
            } else if (ag.href && ag.href.startsWith("http")) {
              targetUrl = ag.href;
            } else {
              // Click the element instead of navigating
              continue;
            }

            const matches = await scrapeAgeGroupPage(
              engine,
              page,
              targetUrl,
              ag.text,
              event,
              eventGender
            );
            allMatches.push(...matches);
          } catch (error) {
            console.error(`   Error on ${ag.text}: ${error.message}`);
          }

          await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
        }
      } else {
        // No age group navigation found — try to scrape the main page directly
        console.log("   No age group navigation — scraping main page");
        const matches = await scrapeTgsPage(page, event, eventGender, engine);
        allMatches.push(...matches);
      }

      // Step 4: Log page structure if no matches found (discovery mode)
      if (allMatches.length === 0) {
        await logTgsPageStructure(page, event);
      }

      await page.close();
    } catch (error) {
      console.error(`   Error: ${error.message}`);
      try {
        await page.close();
      } catch {}
    }

    // Deduplicate by match key
    const uniqueMatches = Array.from(
      new Map(allMatches.map((m) => [engine.generateMatchKey(m), m])).values()
    );

    console.log(`   Total: ${uniqueMatches.length} matches`);
    return uniqueMatches;
  },
};

// =========================================
// INTERNAL SCRAPING FUNCTIONS
// =========================================

/**
 * Navigate to an age group page and scrape match data.
 */
async function scrapeAgeGroupPage(engine, page, url, ageText, event, eventGender) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await engine.sleep(engine.adapter.parsing.puppeteer.pageLoadWait);
  return scrapeTgsPage(page, event, eventGender, engine, ageText);
}

/**
 * Scrape match data from a rendered TGS page.
 * Tries multiple DOM patterns to find match/game elements.
 */
async function scrapeTgsPage(page, event, eventGender, engine, ageHint) {
  const rawMatches = await page.evaluate(
    (eventName, gender, ageText) => {
      const results = [];

      // =============================================
      // Pattern 1: Table rows (common in standings/schedules)
      // =============================================
      document.querySelectorAll("table").forEach((table) => {
        const headers = Array.from(table.querySelectorAll("th")).map((th) =>
          th.textContent.trim().toLowerCase()
        );

        // Check if this looks like a schedule table
        const isSchedule =
          headers.some((h) => h.includes("home") || h.includes("away")) ||
          headers.some((h) => h.includes("date") || h.includes("time")) ||
          headers.some((h) => h.includes("score") || h.includes("result"));

        if (!isSchedule && headers.length > 0) return;

        const rows = table.querySelectorAll("tbody tr, tr");
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll("td"));
          if (cells.length >= 3) {
            results.push({
              source: "table",
              cells: cells.map((c) => c.textContent.trim()),
              links: Array.from(row.querySelectorAll("a")).map((a) => ({
                href: a.getAttribute("href") || "",
                text: a.textContent.trim(),
              })),
            });
          }
        });
      });

      // =============================================
      // Pattern 2: Game/match cards (React components)
      // =============================================
      const cardSelectors = [
        ".game-card",
        ".match-card",
        ".schedule-item",
        ".game-row",
        ".match-row",
        "[class*='game']",
        "[class*='match']",
        "[class*='schedule-item']",
        "[data-game-id]",
        "[data-match-id]",
      ];

      for (const sel of cardSelectors) {
        try {
          document.querySelectorAll(sel).forEach((card) => {
            const text = card.innerText;
            // Only include if it looks like match data (has team names or scores)
            if (
              text.length > 10 &&
              text.length < 500 &&
              (/\d/.test(text) || text.includes("vs"))
            ) {
              results.push({
                source: "card",
                selector: sel,
                text: text.substring(0, 300),
                html: card.innerHTML.substring(0, 500),
                matchId:
                  card.dataset.gameId ||
                  card.dataset.matchId ||
                  null,
                links: Array.from(card.querySelectorAll("a")).map((a) => ({
                  href: a.getAttribute("href") || "",
                  text: a.textContent.trim(),
                })),
              });
            }
          });
        } catch {}
      }

      // =============================================
      // Pattern 3: Game preview links
      // =============================================
      document
        .querySelectorAll(
          'a[href*="game-preview"], a[href*="game-detail"], a[href*="match"]'
        )
        .forEach((link) => {
          const href = link.getAttribute("href") || "";
          const gameIdMatch = href.match(
            /game-preview\/(\d+)|game-detail\/(\d+)|match\/(\d+)/
          );
          if (gameIdMatch) {
            const gameId = gameIdMatch[1] || gameIdMatch[2] || gameIdMatch[3];
            // Get surrounding context (parent row/card)
            const parent = link.closest("tr, .game-card, .match-card, [class*='game']");
            results.push({
              source: "game-link",
              matchId: gameId,
              href: href,
              text: link.textContent.trim(),
              context: parent ? parent.innerText.substring(0, 300) : "",
            });
          }
        });

      return results;
    },
    event.name,
    eventGender,
    ageHint
  );

  // Parse raw DOM results into match objects
  const matches = [];

  for (const raw of rawMatches) {
    const match = parseTgsRawMatch(raw, event, eventGender, ageHint);
    if (match && engine.adapter.dataPolicy.isValidMatch(match)) {
      matches.push(match);
    }
  }

  return matches;
}

/**
 * Parse a raw DOM extraction result into a match object.
 */
function parseTgsRawMatch(raw, event, eventGender, ageHint) {
  if (raw.source === "table" && raw.cells) {
    return parseTgsTableRow(raw.cells, raw.links, event, eventGender, ageHint);
  }

  if (raw.source === "game-link" && raw.matchId) {
    // Minimal match with game ID — context may have team names
    const context = raw.context || raw.text || "";
    const teams = extractTeamsFromText(context);

    return {
      eventId: event.id.toString(),
      eventName: event.name,
      matchId: raw.matchId,
      matchDate: extractDateFromText(context),
      homeTeamName: teams[0] || null,
      awayTeamName: teams[1] || null,
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      division: ageHint || null,
      gender: eventGender || null,
      ageGroup: extractAgeGroup(ageHint || context),
    };
  }

  if (raw.source === "card" && raw.text) {
    const text = raw.text;
    const teams = extractTeamsFromText(text);
    const scores = extractScoresFromText(text);
    const date = extractDateFromText(text);

    if (teams[0] && teams[1]) {
      return {
        eventId: event.id.toString(),
        eventName: event.name,
        matchId: raw.matchId || `${teams[0]}-${teams[1]}-${date}`.replace(/\s+/g, "-"),
        matchDate: date,
        homeTeamName: teams[0],
        awayTeamName: teams[1],
        homeScore: scores[0],
        awayScore: scores[1],
        status: scores[0] !== null ? "completed" : "scheduled",
        division: ageHint || null,
        gender: eventGender || null,
        ageGroup: extractAgeGroup(ageHint || text),
      };
    }
  }

  return null;
}

/**
 * Parse a TGS table row into a match object.
 */
function parseTgsTableRow(cells, links, event, eventGender, ageHint) {
  if (!cells || cells.length < 3) return null;

  // Try to identify columns by content
  let dateStr = null;
  let timeStr = null;
  let homeTeam = null;
  let awayTeam = null;
  let homeScore = null;
  let awayScore = null;
  let matchId = null;

  // Check links for game IDs
  for (const link of links || []) {
    const gameMatch = link.href.match(
      /game-preview\/(\d+)|game-detail\/(\d+)/
    );
    if (gameMatch) {
      matchId = gameMatch[1] || gameMatch[2];
    }
  }

  for (const cell of cells) {
    // Date patterns
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(cell) && !dateStr) {
      dateStr = cell;
      continue;
    }
    if (/\d{4}-\d{2}-\d{2}/.test(cell) && !dateStr) {
      dateStr = cell;
      continue;
    }

    // Time pattern
    if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(cell) && !timeStr) {
      timeStr = cell;
      continue;
    }

    // Score pattern
    const scoreMatch = cell.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (scoreMatch) {
      homeScore = parseInt(scoreMatch[1], 10);
      awayScore = parseInt(scoreMatch[2], 10);
      continue;
    }

    // Team names
    if (cell.length > 2 && !/^\d+$/.test(cell) && !/^\d{1,2}:\d{2}/.test(cell)) {
      if (!homeTeam) {
        homeTeam = cell;
      } else if (!awayTeam) {
        awayTeam = cell;
      }
    }
  }

  if (!homeTeam || !awayTeam) return null;

  // Parse date
  let matchDate = null;
  if (dateStr) {
    const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
      matchDate = isoMatch[1];
    } else {
      const usMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (usMatch) {
        matchDate = `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
      }
    }
  }

  return {
    eventId: event.id.toString(),
    eventName: event.name,
    matchId: matchId || `${homeTeam}-${awayTeam}-${matchDate}`.replace(/\s+/g, "-"),
    matchDate: matchDate,
    matchTime: timeStr,
    homeTeamName: homeTeam.trim(),
    awayTeamName: awayTeam.trim(),
    homeScore: homeScore,
    awayScore: awayScore,
    status: homeScore !== null && awayScore !== null ? "completed" : "scheduled",
    division: ageHint || null,
    gender: eventGender || null,
    ageGroup: extractAgeGroup(ageHint),
  };
}

/**
 * Parse a TGS API response into match objects.
 */
function parseTgsApiResponse(data, event, eventGender, engine) {
  const matches = [];

  if (!data) return matches;

  // API may return standings (array of team records) or games (array of game records)
  const items = Array.isArray(data)
    ? data
    : data.games || data.schedule || data.matches || data.data || [];

  if (!Array.isArray(items)) return matches;

  for (const item of items) {
    // Check if this looks like a game record (has team names + scores)
    const homeTeam =
      item.homeTeam || item.home_team || item.teamHome || item.home || null;
    const awayTeam =
      item.awayTeam || item.away_team || item.teamAway || item.away || null;

    if (!homeTeam || !awayTeam) continue;

    const homeTeamName =
      typeof homeTeam === "string" ? homeTeam : homeTeam.name || homeTeam.teamName || "";
    const awayTeamName =
      typeof awayTeam === "string" ? awayTeam : awayTeam.name || awayTeam.teamName || "";

    const homeScore =
      item.homeScore ?? item.home_score ?? item.scoreHome ?? null;
    const awayScore =
      item.awayScore ?? item.away_score ?? item.scoreAway ?? null;

    const matchDate =
      item.date || item.gameDate || item.matchDate || item.startDate || null;
    const matchId =
      item.id || item.gameId || item.matchId || item.UID || null;

    const match = {
      eventId: event.id.toString(),
      eventName: event.name,
      matchId: matchId ? String(matchId) : null,
      matchDate: matchDate ? engine.adapter.transform.parseDate(String(matchDate)) : null,
      homeTeamName: engine.adapter.transform.normalizeTeamName(homeTeamName),
      awayTeamName: engine.adapter.transform.normalizeTeamName(awayTeamName),
      homeScore: homeScore !== null ? parseInt(String(homeScore), 10) : null,
      awayScore: awayScore !== null ? parseInt(String(awayScore), 10) : null,
      homeId: homeTeam.id || homeTeam.teamId || null,
      awayId: awayTeam.id || awayTeam.teamId || null,
      status:
        homeScore !== null && awayScore !== null ? "completed" : "scheduled",
      division: item.ageGroup || item.division || null,
      gender: eventGender || item.gender || null,
      ageGroup: extractAgeGroup(
        item.ageGroup || item.age || item.division || ""
      ),
    };

    if (match.matchId && engine.adapter.dataPolicy.isValidMatch(match)) {
      matches.push(match);
    }
  }

  return matches;
}

// =========================================
// HELPER FUNCTIONS
// =========================================

function extractTeamsFromText(text) {
  if (!text) return [null, null];

  // Pattern: "Team A vs Team B" or "Team A - Team B" or "Team A at Team B"
  const vsMatch = text.match(/^(.+?)\s+(?:vs\.?|at|@)\s+(.+?)$/im);
  if (vsMatch) {
    return [vsMatch[1].trim(), vsMatch[2].trim()];
  }

  // Pattern: Lines that look like team names (no numbers at start)
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !/^\d/.test(l) && !/^\d{1,2}:\d{2}/.test(l));

  if (lines.length >= 2) {
    return [lines[0], lines[1]];
  }

  return [null, null];
}

function extractScoresFromText(text) {
  if (!text) return [null, null];
  const match = text.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];
  return [null, null];
}

function extractDateFromText(text) {
  if (!text) return null;
  // ISO format
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  // US format
  const usMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }
  return null;
}

function extractAgeGroup(text) {
  if (!text) return null;
  const match = text.match(/U-?(\d+)/i);
  if (match) return `U${match[1]}`;

  const yearMatch = text.match(/[BG]?(20[01]\d)/i);
  if (yearMatch) {
    const birthYear = parseInt(yearMatch[1], 10);
    const currentYear = new Date().getFullYear();
    return `U${currentYear - birthYear}`;
  }

  return null;
}

/**
 * Log TGS page structure for debugging when no matches found.
 */
async function logTgsPageStructure(page, event) {
  const structure = await page.evaluate(() => {
    return {
      title: document.title,
      url: window.location.href,
      bodyText: document.body.innerText.substring(0, 1500),
      links: Array.from(document.querySelectorAll("a"))
        .filter((a) => a.href && a.textContent.trim().length > 0)
        .slice(0, 30)
        .map((a) => ({
          href: a.getAttribute("href"),
          text: a.textContent.trim().substring(0, 50),
        })),
      tables: document.querySelectorAll("table").length,
      scripts: Array.from(document.querySelectorAll("script"))
        .filter((s) => s.textContent.includes("api") || s.textContent.includes("schedule"))
        .map((s) => s.textContent.substring(0, 300)),
    };
  });

  console.log(`\n   === TGS PAGE STRUCTURE (Event ${event.id}) ===`);
  console.log(`   Title: ${structure.title}`);
  console.log(`   URL: ${structure.url}`);
  console.log(`   Tables: ${structure.tables}`);
  console.log(`   Links: ${structure.links.length}`);
  if (structure.links.length > 0) {
    structure.links.slice(0, 10).forEach((l) => {
      console.log(`     ${l.href} — ${l.text}`);
    });
  }
  console.log(`   Content: ${structure.bodyText.substring(0, 300)}`);
  if (structure.scripts.length > 0) {
    console.log(`   Relevant scripts: ${structure.scripts.length}`);
  }
  console.log(`   === END TGS DEBUG ===\n`);
}
