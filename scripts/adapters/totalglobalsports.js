/**
 * TotalGlobalSports (ECNL) Source Adapter v1.0
 * =============================================
 *
 * Scrapes ECNL match data from TotalGlobalSports (public.totalglobalsports.com).
 * ECNL (Elite Clubs National League) is the premier girls + boys club league.
 * ECRL (ECNL Regional League) is the second tier.
 *
 * TECHNOLOGY: Puppeteer (Angular SPA behind Cloudflare protection)
 * PLATFORM: TotalGlobalSports — Angular 8 frontend + .NET-like backend
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
      ajaxWait: 12000, // Angular SPA + Cloudflare = slow
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
      // ECNL BOYS — 2025-26 (11 conferences)
      // ========================
      { id: 3880, name: "ECNL Boys Mid-Atlantic 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Mid-Atlantic" },
      { id: 3881, name: "ECNL Boys Midwest 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Midwest" },
      { id: 3882, name: "ECNL Boys Mountain 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Mountain" },
      { id: 3883, name: "ECNL Boys New England 2025-26", type: "league", year: 2026, gender: "Boys", conference: "New England" },
      { id: 3884, name: "ECNL Boys North Atlantic 2025-26", type: "league", year: 2026, gender: "Boys", conference: "North Atlantic" },
      { id: 3885, name: "ECNL Boys Northern Cal 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Northern Cal" },
      { id: 3886, name: "ECNL Boys Northwest 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Northwest" },
      { id: 3887, name: "ECNL Boys Ohio Valley 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Ohio Valley" },
      { id: 3888, name: "ECNL Boys Southeast 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Southeast" },
      { id: 3889, name: "ECNL Boys Southwest 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Southwest" },
      { id: 3890, name: "ECNL Boys Texas 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Texas" },

      // ========================
      // ECNL GIRLS — 2025-26 (10 conferences)
      // ========================
      { id: 3925, name: "ECNL Girls Mid-Atlantic 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Mid-Atlantic" },
      { id: 3926, name: "ECNL Girls Midwest 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Midwest" },
      { id: 3927, name: "ECNL Girls New England 2025-26", type: "league", year: 2026, gender: "Girls", conference: "New England" },
      { id: 3928, name: "ECNL Girls North Atlantic 2025-26", type: "league", year: 2026, gender: "Girls", conference: "North Atlantic" },
      { id: 3929, name: "ECNL Girls Northern Cal 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Northern Cal" },
      { id: 3930, name: "ECNL Girls Northwest 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Northwest" },
      { id: 3931, name: "ECNL Girls Ohio Valley 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Ohio Valley" },
      { id: 3932, name: "ECNL Girls Southeast 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Southeast" },
      { id: 3933, name: "ECNL Girls Southwest 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Southwest" },
      { id: 3934, name: "ECNL Girls Texas 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Texas" },

      // ========================
      // ECNL RL (Regional League) BOYS — 2025-26 (23 conferences with schedules)
      // ========================
      { id: 3891, name: "ECNL RL Boys Carolinas 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Carolinas" },
      { id: 3892, name: "ECNL RL Boys Chicago Metro 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Chicago Metro" },
      { id: 3893, name: "ECNL RL Boys Far West 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Far West" },
      { id: 3894, name: "ECNL RL Boys Florida 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Florida" },
      { id: 3895, name: "ECNL RL Boys Frontier 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Frontier" },
      { id: 3896, name: "ECNL RL Boys Golden State 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Golden State" },
      { id: 3897, name: "ECNL RL Boys Greater Michigan 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Greater Michigan" },
      { id: 3898, name: "ECNL RL Boys Greater Michigan Alliance 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Greater Michigan Alliance" },
      { id: 3899, name: "ECNL RL Boys Great Lakes Alliance 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Great Lakes Alliance" },
      { id: 3900, name: "ECNL RL Boys Gulf Coast 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Gulf Coast" },
      { id: 3901, name: "ECNL RL Boys Heartland 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Heartland" },
      { id: 3902, name: "ECNL RL Boys Mid-America 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Mid-America" },
      { id: 3903, name: "ECNL RL Boys Midwest 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Midwest" },
      { id: 3904, name: "ECNL RL Boys Mountain 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Mountain" },
      { id: 3905, name: "ECNL RL Boys New England 2025-26", type: "league", year: 2026, gender: "Boys", conference: "New England" },
      { id: 3906, name: "ECNL RL Boys NorCal 2025-26", type: "league", year: 2026, gender: "Boys", conference: "NorCal" },
      { id: 3907, name: "ECNL RL Boys North Atlantic 2025-26", type: "league", year: 2026, gender: "Boys", conference: "North Atlantic" },
      { id: 3908, name: "ECNL RL Boys Northeast 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Northeast" },
      { id: 3909, name: "ECNL RL Boys NTX 2025-26", type: "league", year: 2026, gender: "Boys", conference: "NTX" },
      { id: 3910, name: "ECNL RL Boys Northwest 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Northwest" },
      { id: 3911, name: "ECNL RL Boys SoCal 2025-26", type: "league", year: 2026, gender: "Boys", conference: "SoCal" },
      { id: 3912, name: "ECNL RL Boys Southeast 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Southeast" },
      { id: 3913, name: "ECNL RL Boys Texas 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Texas" },
      // 3914: ECNL RL Boys STXCL — No Schedules Published, skipped
      { id: 3915, name: "ECNL RL Boys Virginia 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Virginia" },

      // ========================
      // ECNL RL (Regional League) GIRLS — 2025-26 (22 conferences with schedules)
      // ========================
      { id: 3935, name: "ECNL RL Girls Carolinas 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Carolinas" },
      { id: 3936, name: "ECNL RL Girls Florida 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Florida" },
      { id: 3937, name: "ECNL RL Girls Frontier 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Frontier" },
      { id: 3938, name: "ECNL RL Girls Golden State 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Golden State" },
      { id: 3939, name: "ECNL RL Girls Great Lakes Alliance 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Great Lakes Alliance" },
      { id: 3940, name: "ECNL RL Girls Greater Michigan Alliance 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Greater Michigan Alliance" },
      { id: 3941, name: "ECNL RL Girls Gulf Coast 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Gulf Coast" },
      { id: 3942, name: "ECNL RL Girls Heartland 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Heartland" },
      { id: 3943, name: "ECNL RL Girls Mid-America 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Mid-America" },
      { id: 3944, name: "ECNL RL Girls Mountain 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Mountain" },
      { id: 3945, name: "ECNL RL Girls New England 2025-26", type: "league", year: 2026, gender: "Girls", conference: "New England" },
      { id: 3946, name: "ECNL RL Girls NorCal 2025-26", type: "league", year: 2026, gender: "Girls", conference: "NorCal" },
      { id: 3947, name: "ECNL RL Girls North Atlantic 2025-26", type: "league", year: 2026, gender: "Girls", conference: "North Atlantic" },
      { id: 3948, name: "ECNL RL Girls Northeast 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Northeast" },
      { id: 3949, name: "ECNL RL Girls Northwest 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Northwest" },
      { id: 3950, name: "ECNL RL Girls NTX 2025-26", type: "league", year: 2026, gender: "Girls", conference: "NTX" },
      { id: 3951, name: "ECNL RL Girls Ohio Valley 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Ohio Valley" },
      { id: 3952, name: "ECNL RL Girls Southeast 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Southeast" },
      { id: 3953, name: "ECNL RL Girls Southern Cal 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Southern Cal" },
      { id: 3954, name: "ECNL RL Girls Southwest 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Southwest" },
      { id: 3955, name: "ECNL RL Girls Texas 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Texas" },
      // 3956: ECNL RL Girls STXCL — No Schedules Published, skipped
      { id: 3957, name: "ECNL RL Girls Virginia 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Virginia" },

      // ========================
      // PRE-ECNL BOYS — 2025-26 (7 with schedules)
      // ========================
      { id: 3916, name: "Pre-ECNL Boys Lake Michigan 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Lake Michigan" },
      // 3917: DO NOT USE — marked by TGS, skipped
      { id: 3918, name: "Pre-ECNL Boys Northeast 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Northeast" },
      { id: 3919, name: "Pre-ECNL Boys New England 2025-26", type: "league", year: 2026, gender: "Boys", conference: "New England" },
      { id: 3920, name: "Pre-ECNL Boys North Atlantic 2025-26", type: "league", year: 2026, gender: "Boys", conference: "North Atlantic" },
      { id: 3921, name: "Pre-ECNL Boys NTX 2025 Fall", type: "league", year: 2026, gender: "Boys", conference: "NTX" },
      { id: 3922, name: "Pre-ECNL Boys Ohio Valley 2025-26", type: "league", year: 2026, gender: "Boys", conference: "Ohio Valley" },
      { id: 3923, name: "Pre-ECNL Boys SoCal 2025-26", type: "league", year: 2026, gender: "Boys", conference: "SoCal" },

      // ========================
      // PRE-ECNL GIRLS — 2025-26 (3 with schedules)
      // ========================
      { id: 3958, name: "Pre-ECNL Girls Lake Michigan 2025-26", type: "league", year: 2026, gender: "Girls", conference: "Lake Michigan" },
      { id: 3959, name: "Pre-ECNL Girls North Atlantic 2025-26", type: "league", year: 2026, gender: "Girls", conference: "North Atlantic" },
      { id: 3960, name: "Pre-ECNL Girls New England 2025-26", type: "league", year: 2026, gender: "Girls", conference: "New England" },
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
    maxEventsPerRun: 80,

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

        // ===========================================================
        // Strategy A: TGS table layout — age groups in table headers,
        // Schedules/Standings links in table body cells.
        // Table structure (Angular 8 SPA):
        //   TH: G2008/2007, Flights, Teams
        //   TD: [Schedules text/link] | [Standings link] | ECNL | 17
        //
        // NOTE: TGS is Angular (not React). Links use routerLink directives.
        // The "Schedules" text may not have a standard href. The "Standings"
        // link DOES have href like /public/event/3933/standings/32928.
        // We extract the division ID from the standings link and construct
        // the schedule URL ourselves.
        // ===========================================================
        document.querySelectorAll("table").forEach((table) => {
          const headers = Array.from(table.querySelectorAll("th")).map((th) => th.textContent.trim());
          // Check if any header contains an age group pattern (G2009, U14, etc.)
          const ageHeader = headers.find((h) => /U-?\d{1,2}\b/i.test(h) || /[BG]?20[01]\d/i.test(h));
          if (!ageHeader) return;

          // Found an age-group table — look for ANY link with a division ID
          const links = Array.from(table.querySelectorAll("a"));
          for (const link of links) {
            const href = link.getAttribute("href") || "";

            // Extract division ID from standings, schedules, or event-division-teams links
            const divMatch = href.match(/\/(?:standings|schedules|event-division-teams)\/(\d+)/);
            if (divMatch) {
              const divisionId = divMatch[1];
              // Always construct the schedules URL (not standings)
              groups.push({
                text: ageHeader,
                href: `/public/event/${href.match(/\/event\/(\d+)\//)?.[1] || ""}/schedules/${divisionId}`,
                value: null,
              });
              break; // One link per table
            }
          }
        });

        // ===========================================================
        // Strategy B: Direct link selectors (original approach)
        // Works for sites that put age groups directly in link text
        // ===========================================================
        const selectors = [
          'a[href*="/standings/"]',
          'a[href*="/schedules/"]',
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

        // ===========================================================
        // Strategy C: Any links/buttons with age-related text
        // ===========================================================
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

        // Deduplicate by age group text + href
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
              // Bug 1 fix: If the href points to /standings/, convert to /schedules/
              // TGS standings pages show league tables, not match data.
              // Schedule URL pattern: /public/event/{eventId}/schedules/{divisionId}
              let fixedHref = ag.href;
              if (fixedHref.includes("/standings/")) {
                fixedHref = fixedHref.replace("/standings/", "/schedules/");
                console.log(`     Converting standings→schedules: ${ag.href} → ${fixedHref}`);
              }
              targetUrl = `${engine.adapter.baseUrl}${fixedHref}`;
            } else if (ag.href && ag.href.startsWith("http")) {
              // Also fix full URLs that point to standings
              targetUrl = ag.href;
              if (targetUrl.includes("/standings/")) {
                targetUrl = targetUrl.replace("/standings/", "/schedules/");
                console.log(`     Converting standings→schedules: ${ag.href} → ${targetUrl}`);
              }
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
  console.log(`     Navigating to: ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await engine.sleep(engine.adapter.parsing.puppeteer.pageLoadWait);

  const matches = await scrapeTgsPage(page, event, eventGender, engine, ageText);

  // Debug: if no matches found on this page, log the page structure for diagnosis
  if (matches.length === 0) {
    console.log(`     No matches found on ${ageText} page — logging structure for diagnosis`);
    await logTgsPageStructure(page, event);
  }

  return matches;
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
      // Pattern 0: TGS-specific schedule table
      // Headers: [GM#, GAME INFO, TEAM & VENUE, DETAILS, ]
      // Team names are in <a href="/public/event/.../individual-team/..."> tags
      // Scores are in the DETAILS cell (e.g., "2  2   Box Score")
      // Date+division is in the GAME INFO cell (e.g., "Sep 6, 2025 08:00 AMG2008/2007 - ECNL")
      // =============================================
      document.querySelectorAll("table").forEach((table) => {
        const headers = Array.from(table.querySelectorAll("th")).map((th) =>
          th.textContent.trim().toLowerCase()
        );

        // Detect TGS schedule table: has "gm#" or "game info" or "team & venue" headers
        const isTgsSchedule =
          headers.some((h) => h.includes("gm") || h.includes("game info")) &&
          headers.some((h) => h.includes("team") || h.includes("venue") || h.includes("details"));

        if (isTgsSchedule) {
          const rows = table.querySelectorAll("tbody tr, tr:not(:first-child)");
          rows.forEach((row) => {
            const cells = Array.from(row.querySelectorAll("td"));
            if (cells.length < 3) return;

            // Extract game ID from first cell (GM#)
            const gameId = cells[0] ? cells[0].textContent.trim() : null;

            // Extract date from GAME INFO cell (column 1)
            const gameInfoText = cells[1] ? cells[1].textContent.trim() : "";

            // Extract team names from links in TEAM & VENUE cell (column 2)
            // Teams are in <a href="...individual-team..."> tags
            const teamCell = cells[2];
            const teamLinks = teamCell
              ? Array.from(teamCell.querySelectorAll('a[href*="individual-team"]'))
              : [];
            const homeTeamName = teamLinks[0] ? teamLinks[0].textContent.trim() : null;
            const awayTeamName = teamLinks[1] ? teamLinks[1].textContent.trim() : null;

            // Extract source team IDs from individual-team URLs
            // URL pattern: /individual-team/{orgId}/{teamId}/{divisionId}
            let homeTeamSourceId = null;
            let awayTeamSourceId = null;
            if (teamLinks[0]) {
              const hrefMatch = (teamLinks[0].getAttribute("href") || "").match(/\/individual-team\/(\d+)\/(\d+)\//);
              if (hrefMatch) homeTeamSourceId = `${hrefMatch[1]}-${hrefMatch[2]}`;
            }
            if (teamLinks[1]) {
              const hrefMatch = (teamLinks[1].getAttribute("href") || "").match(/\/individual-team\/(\d+)\/(\d+)\//);
              if (hrefMatch) awayTeamSourceId = `${hrefMatch[1]}-${hrefMatch[2]}`;
            }

            // Extract venue from venue/complex links
            const venueLink = teamCell
              ? teamCell.querySelector('a[href*="game-complex"]')
              : null;
            const venue = venueLink ? venueLink.textContent.trim() : null;

            // Extract scores from DETAILS cell (column 3)
            // Format: "2  2   Box Score" or just "Box Score" for scheduled
            const detailsText = cells[3] ? cells[3].textContent.trim() : "";
            let homeScore = null;
            let awayScore = null;
            // Look for two numbers before "Box Score"
            const scoreMatch = detailsText.match(/^(\d+)\s+(\d+)/);
            if (scoreMatch) {
              homeScore = parseInt(scoreMatch[1], 10);
              awayScore = parseInt(scoreMatch[2], 10);
            }

            if (homeTeamName && awayTeamName) {
              results.push({
                source: "tgs-schedule",
                matchId: gameId,
                gameInfoText: gameInfoText,
                homeTeamName: homeTeamName,
                awayTeamName: awayTeamName,
                homeTeamSourceId: homeTeamSourceId,
                awayTeamSourceId: awayTeamSourceId,
                homeScore: homeScore,
                awayScore: awayScore,
                venue: venue,
              });
            }
          });

          return; // Handled this table, skip generic parser
        }

        // =============================================
        // Pattern 1: Generic table rows (fallback)
        // =============================================
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
  // =============================================
  // TGS-specific schedule table row
  // =============================================
  if (raw.source === "tgs-schedule") {
    // Parse date from GAME INFO text
    // Format: "Sep 6, 2025 08:00 AMG2008/2007 - ECNL" or "Sep 6, 2025 08:00 AM\nG2008/2007 - ECNL"
    const gameInfoText = raw.gameInfoText || "";

    let matchDate = null;
    let matchTime = null;

    // Try to extract date: "Sep 6, 2025" or "Oct 18, 2025"
    const dateMatch = gameInfoText.match(/([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/);
    if (dateMatch) {
      const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
                       Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
      const month = months[dateMatch[1]] || "01";
      const day = dateMatch[2].padStart(2, "0");
      const year = dateMatch[3];
      matchDate = `${year}-${month}-${day}`;
    }

    // Extract time: "08:00 AM" or "10:00 PM"
    const timeMatch = gameInfoText.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (timeMatch) {
      matchTime = timeMatch[1].trim();
    }

    // Extract division/age group from GAME INFO
    // Pattern: "G2008/2007 - ECNL" or "G2009 - ECNL"
    const divisionMatch = gameInfoText.match(/([BG]?\d{4}(?:\/\d{4})?)\s*-?\s*(?:ECNL|ECRL)?/i);
    const division = divisionMatch ? divisionMatch[0].trim() : ageHint;

    return {
      eventId: event.id.toString(),
      eventName: event.name,
      matchId: raw.matchId,
      matchDate: matchDate,
      matchTime: matchTime,
      homeTeamName: raw.homeTeamName,
      awayTeamName: raw.awayTeamName,
      homeScore: raw.homeScore,
      awayScore: raw.awayScore,
      homeId: raw.homeTeamSourceId,
      awayId: raw.awayTeamSourceId,
      venue: raw.venue,
      status: raw.homeScore !== null && raw.awayScore !== null ? "completed" : "scheduled",
      division: division || ageHint || null,
      gender: eventGender || null,
      ageGroup: extractAgeGroup(ageHint || division || gameInfoText),
    };
  }

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
    // Capture table details for diagnosis
    const tableDetails = Array.from(document.querySelectorAll("table")).map((table, idx) => {
      const headers = Array.from(table.querySelectorAll("th")).map((th) => th.textContent.trim());
      const rowCount = table.querySelectorAll("tbody tr, tr").length;
      const firstRowCells = Array.from(
        (table.querySelector("tbody tr") || table.querySelector("tr:nth-child(2)") || { querySelectorAll: () => [] })
          .querySelectorAll("td")
      ).map((td) => td.textContent.trim().substring(0, 40));
      return { index: idx, headers, rowCount, firstRowCells: firstRowCells.slice(0, 8) };
    });

    return {
      title: document.title,
      url: window.location.href,
      bodyText: document.body.innerText.substring(0, 2000),
      bodyHtml: document.body.innerHTML.substring(0, 3000),
      links: Array.from(document.querySelectorAll("a"))
        .filter((a) => a.href && a.textContent.trim().length > 0)
        .slice(0, 40)
        .map((a) => ({
          href: a.getAttribute("href"),
          text: a.textContent.trim().substring(0, 60),
        })),
      tables: document.querySelectorAll("table").length,
      tableDetails: tableDetails,
      divs: Array.from(document.querySelectorAll("[class]"))
        .filter((el) => {
          const cls = el.className.toLowerCase();
          return cls.includes("schedule") || cls.includes("game") || cls.includes("match") || cls.includes("fixture");
        })
        .slice(0, 10)
        .map((el) => ({
          tag: el.tagName,
          className: el.className,
          text: el.innerText.substring(0, 100),
        })),
      scripts: Array.from(document.querySelectorAll("script"))
        .filter((s) => s.textContent.includes("api") || s.textContent.includes("schedule"))
        .map((s) => s.textContent.substring(0, 300)),
    };
  });

  console.log(`\n   === TGS PAGE STRUCTURE (Event ${event.id}) ===`);
  console.log(`   Title: ${structure.title}`);
  console.log(`   URL: ${structure.url}`);
  console.log(`   Tables: ${structure.tables}`);
  if (structure.tableDetails.length > 0) {
    structure.tableDetails.forEach((t) => {
      console.log(`     Table ${t.index}: ${t.rowCount} rows, headers=[${t.headers.join(", ")}]`);
      if (t.firstRowCells.length > 0) {
        console.log(`       First row: [${t.firstRowCells.join(" | ")}]`);
      }
    });
  }
  console.log(`   Links: ${structure.links.length}`);
  if (structure.links.length > 0) {
    structure.links.slice(0, 15).forEach((l) => {
      console.log(`     ${l.href} — ${l.text}`);
    });
  }
  if (structure.divs.length > 0) {
    console.log(`   Schedule/game-related elements: ${structure.divs.length}`);
    structure.divs.forEach((d) => {
      console.log(`     <${d.tag} class="${d.className}"> ${d.text.substring(0, 60)}`);
    });
  }
  console.log(`   Content (first 500 chars): ${structure.bodyText.substring(0, 500)}`);
  console.log(`   HTML snippet (first 1000 chars): ${structure.bodyHtml.substring(0, 1000)}`);
  if (structure.scripts.length > 0) {
    console.log(`   Relevant scripts: ${structure.scripts.length}`);
  }
  console.log(`   === END TGS DEBUG ===\n`);
}
