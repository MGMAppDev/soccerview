/**
 * GotSport Source Adapter v1.0
 * ============================
 *
 * Configuration for scraping GotSport (system.gotsport.com).
 * This is the primary source for national rankings and tournament data.
 *
 * Extracted from: scripts/daily/syncActiveEvents.js
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "gotsport",
  name: "GotSport",
  baseUrl: "https://system.gotsport.com",

  // =========================================
  // TECHNOLOGY
  // =========================================

  /** GotSport uses server-rendered HTML, Cheerio is sufficient */
  technology: "cheerio",

  // =========================================
  // RATE LIMITING
  // Preserved from syncActiveEvents.js CONFIG
  // =========================================

  rateLimiting: {
    requestDelayMin: 1500,
    requestDelayMax: 3000,
    iterationDelay: 800,      // GROUP_DELAY
    itemDelay: 3000,          // EVENT_DELAY
    maxRetries: 3,
    retryDelays: [5000, 15000, 30000],
    cooldownOn429: 60000,     // Rate limited - wait 60s
    cooldownOn500: 30000,
  },

  // =========================================
  // USER AGENTS
  // Preserved from syncActiveEvents.js
  // =========================================

  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  ],

  // =========================================
  // ENDPOINTS
  // =========================================

  endpoints: {
    eventPage: "/org_event/events/{eventId}",
    schedule: "/org_event/events/{eventId}/schedules?group={groupId}",
  },

  // =========================================
  // PARSING CONFIGURATION
  // Extracted from syncActiveEvents.js parsing logic
  // =========================================

  parsing: {
    selectors: {
      /** CSS selector for group/division links on event page */
      groupLinks: 'a[href*="schedules?group="]',

      /** Match rows in schedule table */
      matchRows: "table tr",
    },

    /**
     * Column indices for 7-column GotSport match table:
     * | Match# | DateTime | Home | Score | Away | Location | Division |
     */
    columns: {
      matchNumber: 0,
      dateTime: 1,
      homeTeam: 2,
      score: 3,
      awayTeam: 4,
      location: 5,
      division: 6,
    },

    /** Expected number of columns in valid match row */
    expectedColumns: 7,

    /** GotSport date format in schedule tables */
    dateFormat: "M/D/YYYY",

    /** Regex for extracting scores */
    scoreRegex: /(\d+)\s*-\s*(\d+)/,
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "gotsport-{eventId}-{matchNumber}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    /**
     * Session 108: Smart hybrid discovery via unified fallback path.
     * discoverEventsFromDatabase() uses 30d leagues / 14d tournaments.
     * Static events below are a SAFETY NET for critical national events.
     * All adapters use the same unified path (coreScraper lines 780-791).
     */
    staticEvents: [
      // National Academy League — year-round national league (reclassified Session 108)
      { id: "45671", name: "National Academy League 2025-2026", year: 2026, type: "league" },
      // USYS National League conferences
      { id: "50944", name: "2025 Fall NL Great Lakes Conference", year: 2026, type: "league" },
      { id: "50937", name: "2025 Fall NL Midwest Conference", year: 2026, type: "league" },
      { id: "50922", name: "2025 Fall NL South Atlantic Conference", year: 2026, type: "league" },
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
  // Extracted from syncActiveEvents.js parsing functions
  // =========================================

  transform: {
    normalizeTeamName: (name) => name?.trim() || "",

    parseDivision: (divisionText) => {
      if (!divisionText) return { gender: null, ageGroup: null };

      const lower = divisionText.toLowerCase();

      // Gender detection
      let gender = null;
      if (lower.includes("boys") || lower.includes(" b ") || /\bb\d/i.test(divisionText)) {
        gender = "Boys";
      } else if (lower.includes("girls") || lower.includes(" g ") || /\bg\d/i.test(divisionText)) {
        gender = "Girls";
      }

      // Age group detection
      let ageGroup = null;
      const ageMatch = lower.match(/u[-]?(\d+)/i);
      if (ageMatch) {
        ageGroup = `U${ageMatch[1]}`;
      } else {
        // Birth year pattern
        const yearMatch = divisionText.match(/\b(20[01]\d)\b/);
        if (yearMatch) {
          const birthYear = parseInt(yearMatch[1], 10);
          const currentYear = new Date().getFullYear();
          const age = currentYear - birthYear;
          ageGroup = `U${age}`;
        }
      }

      return { gender, ageGroup };
    },

    /** GotSport is national - can't infer state */
    inferState: () => "XX",

    /**
     * Parse GotSport date format.
     * Format: "Jan 15, 2025" or multi-line with time
     */
    parseDate: (dateStr) => {
      if (!dateStr) return null;
      const datePart = dateStr.split("\n")[0].trim();
      try {
        const date = new Date(datePart);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split("T")[0];
      } catch {
        return null;
      }
    },

    parseScore: (scoreStr) => {
      if (!scoreStr) return [null, null];
      const match = scoreStr.trim().match(/(\d+)\s*-\s*(\d+)/);
      if (!match) return [null, null];
      return [parseInt(match[1]), parseInt(match[2])];
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".gotsport_checkpoint.json",
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    /** 3-year rolling window aligned with GotSport */
    minDate: "2023-01-01",
    maxFutureDate: null,

    /** Max events per run — Session 108: increased from 100 to 300
     *  (295 GotSport leagues in DB, 100 cap was truncating discovery) */
    maxEventsPerRun: 300,

    isValidMatch: (match) => {
      if (!match.homeTeamName || !match.awayTeamName) return false;
      if (match.homeTeamName.toLowerCase() === match.awayTeamName.toLowerCase()) return false;
      return true;
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC
  // Replicates scrapeGroupMatches from syncActiveEvents.js
  // =========================================

  /**
   * Custom scrape function for GotSport events.
   * Uses the group discovery → group scrape pattern.
   */
  scrapeEvent: async (engine, event) => {
    const allMatches = [];

    // Step 1: Discover groups for this event
    const groups = await engine.discoverGroups(event.id);

    if (groups.length === 0) {
      console.log(`   No groups found for event ${event.id}`);
      return [];
    }

    console.log(`   Found ${groups.length} groups`);

    // Step 2: Scrape each group
    for (const groupId of groups) {
      const matches = await engine.scrapeGroup(event.id, groupId, event.name);
      allMatches.push(...matches);
      await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
    }

    // Step 3: Deduplicate by match key
    const uniqueMatches = Array.from(
      new Map(allMatches.map(m => [engine.generateMatchKey(m), m])).values()
    );

    return uniqueMatches;
  },
};
