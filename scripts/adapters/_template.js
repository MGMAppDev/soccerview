/**
 * Source Adapter Template v1.0
 * ============================
 *
 * Copy this file and customize for new data sources.
 *
 * File naming: {source_id}.js (e.g., gotsport.js, demosphere.js)
 */

export default {
  // =========================================
  // METADATA (Required)
  // =========================================

  /** Unique identifier - used in source_platform field */
  id: "template",

  /** Human-readable name */
  name: "Template Source",

  /** Base URL for all requests */
  baseUrl: "https://example.com",

  // =========================================
  // TECHNOLOGY (Required)
  // =========================================

  /**
   * Scraping technology to use:
   * - "cheerio": For static HTML pages (faster, lower resource)
   * - "puppeteer": For JavaScript-rendered SPAs (slower, requires browser)
   * - "api": For REST API endpoints (fastest, cleanest)
   */
  technology: "cheerio",

  // =========================================
  // RATE LIMITING (Required)
  // Pattern #1 from Phase 1 Audit
  // =========================================

  rateLimiting: {
    /** Minimum milliseconds between requests */
    requestDelayMin: 1500,

    /** Maximum milliseconds between requests (random between min/max) */
    requestDelayMax: 3000,

    /** Delay between iteration steps (e.g., groups within an event) */
    iterationDelay: 800,

    /** Delay between major items (e.g., between events) */
    itemDelay: 3000,

    /** Maximum retry attempts on failure */
    maxRetries: 3,

    /** Delays for each retry attempt (exponential backoff) */
    retryDelays: [5000, 15000, 30000],

    /** Cooldown period when rate limited (HTTP 429) */
    cooldownOn429: 120000,

    /** Cooldown period on server error (HTTP 5xx) */
    cooldownOn500: 60000,
  },

  // =========================================
  // USER AGENTS (Required)
  // Pattern #2 from Phase 1 Audit
  // =========================================

  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  ],

  // =========================================
  // ENDPOINTS (Required)
  // =========================================

  endpoints: {
    /**
     * URL templates with placeholders: {eventId}, {groupId}, {teamId}
     * The core engine will substitute these values.
     */
    eventPage: "/events/{eventId}",
    schedule: "/events/{eventId}/schedule?group={groupId}",
  },

  // =========================================
  // PARSING CONFIGURATION (Technology-specific)
  // =========================================

  parsing: {
    // ----- For Cheerio (HTML scraping) -----
    selectors: {
      /** CSS selector for group/division links */
      groupLinks: 'a[href*="group="]',

      /** CSS selector for match table rows */
      matchRows: "table tr",
    },

    /** Column indices in match table (0-indexed) */
    columns: {
      matchNumber: 0,
      dateTime: 1,
      homeTeam: 2,
      score: 3,
      awayTeam: 4,
      location: 5,
    },

    // ----- For Puppeteer (SPA scraping) -----
    puppeteer: {
      /** Selector to wait for before scraping */
      waitForSelector: "table.schedule",

      /** Selector for division/group dropdown */
      divisionDropdown: "select.division-select",

      /** Regex pattern to identify division options - U9/U-9/U11/U-11 etc + birth years */
      divisionPattern: /U-?\d{1,2}\b|20[01]\d/i,

      /** Wait time after page load (ms) */
      pageLoadWait: 3000,

      /** Wait time after changing division (ms) */
      divisionChangeWait: 2000,
    },

    /** Date format for parsing (moment.js style) */
    dateFormat: "MM/DD/YYYY",

    /** Regex for extracting scores from score cell */
    scoreRegex: /(\d+)\s*-\s*(\d+)/,
  },

  // =========================================
  // MATCH KEY FORMAT (Required)
  // Pattern #11 from Phase 1 Audit
  // =========================================

  /**
   * Template for generating unique match keys.
   * Available placeholders:
   * - {source}: adapter id
   * - {eventId}: event identifier
   * - {matchNumber}: match number within event
   * - {matchId}: unique match ID if available
   * - {homeId}: home team ID if available
   * - {awayId}: away team ID if available
   * - {date}: match date (YYYY-MM-DD)
   * - {gameNum}: game number if available
   */
  matchKeyFormat: "{source}-{eventId}-{matchNumber}",

  // =========================================
  // EVENT DISCOVERY (Optional)
  // =========================================

  discovery: {
    /**
     * Static list of known events.
     * Use for sources where events don't change frequently.
     */
    staticEvents: [
      // { id: "12345", name: "Example Tournament 2025", type: "tournament", year: 2025 },
    ],

    /**
     * Dynamic discovery function (optional).
     * Called by core engine to find events to scrape.
     *
     * @param {Object} engine - Reference to core scraper engine
     * @returns {Promise<Array>} - Array of { id, name, type, year }
     */
    discoverEvents: null, // async (engine) => { return [...]; },
  },

  // =========================================
  // DATA TRANSFORMATION (Optional)
  // =========================================

  transform: {
    /**
     * Normalize team name before storage.
     * @param {string} name - Raw team name from source
     * @returns {string} - Normalized team name
     */
    normalizeTeamName: (name) => name?.trim() || "",

    /**
     * Parse division text into gender and age group.
     * @param {string} divisionText - Raw division text
     * @returns {Object} - { gender: "Boys"|"Girls"|null, ageGroup: "U13"|null }
     */
    parseDivision: (divisionText) => {
      if (!divisionText) return { gender: null, ageGroup: null };

      let gender = null;
      const lower = divisionText.toLowerCase();
      if (lower.includes("boys") || /\bb\d/i.test(divisionText)) gender = "Boys";
      if (lower.includes("girls") || /\bg\d/i.test(divisionText)) gender = "Girls";

      let ageGroup = null;
      const ageMatch = divisionText.match(/u[-]?(\d+)/i);
      if (ageMatch) ageGroup = `U${ageMatch[1]}`;

      return { gender, ageGroup };
    },

    /**
     * Infer state from source (for regional sources).
     * @returns {string|null} - Two-letter state code or null
     */
    inferState: () => null,

    /**
     * Parse date string into ISO format (YYYY-MM-DD).
     * @param {string} dateStr - Raw date string from source
     * @returns {string|null} - ISO date or null if invalid
     */
    parseDate: (dateStr) => {
      if (!dateStr) return null;
      try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split("T")[0];
      } catch {
        return null;
      }
    },

    /**
     * Parse score string into [homeScore, awayScore].
     * @param {string} scoreStr - Raw score string (e.g., "3 - 1")
     * @returns {Array} - [homeScore, awayScore] or [null, null]
     */
    parseScore: (scoreStr) => {
      if (!scoreStr) return [null, null];
      const match = scoreStr.trim().match(/(\d+)\s*-\s*(\d+)/);
      if (!match) return [null, null];
      return [parseInt(match[1]), parseInt(match[2])];
    },
  },

  // =========================================
  // CHECKPOINT CONFIG (Required)
  // Pattern #3 from Phase 1 Audit
  // =========================================

  checkpoint: {
    /** Filename for checkpoint storage (in scripts/ directory) */
    filename: ".template_checkpoint.json",

    /** Save checkpoint after each major item (event/division) */
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    /** Minimum date for data collection (3-year rolling window) */
    minDate: "2023-08-01",

    /** Maximum future date (null = allow all future dates) */
    maxFutureDate: null,

    /** Filter function for excluding invalid matches */
    isValidMatch: (match) => {
      // Return false to exclude match
      if (!match.homeTeamName || !match.awayTeamName) return false;
      if (match.homeTeamName === match.awayTeamName) return false;
      return true;
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC (Optional)
  // =========================================

  /**
   * Custom scraping function for complex sources.
   * If provided, core engine will call this instead of default logic.
   *
   * @param {Object} engine - Reference to core scraper engine
   * @param {Object} event - Event to scrape { id, name, type, year }
   * @returns {Promise<Array>} - Array of match objects
   */
  scrapeEvent: null, // async (engine, event) => { return [...matches]; },
};
