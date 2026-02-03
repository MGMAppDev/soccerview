# Phase 2: Universal Data Pipeline Framework Design

## Architecture Design Document v1.0

**Date:** January 29, 2026
**Status:** DRAFT - Pending User Approval
**Purpose:** Design the Universal Ingestion Framework per the specification

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Source Adapter Specification](#source-adapter-specification)
3. [Core Scraper Engine Design](#core-scraper-engine-design)
4. [Promotion Engine Design](#promotion-engine-design)
5. [GitHub Actions Integration](#github-actions-integration)
6. [Migration Strategy](#migration-strategy)
7. [Validation Criteria](#validation-criteria)

---

## Architecture Overview

### Current State (Per-Source Scripts)
```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  syncActiveEvents   │  │  scrapeHTGSports    │  │ scrapeHeartland*    │
│     (GotSport)      │  │    (HTGSports)      │  │   (Heartland)       │
│  - Custom config    │  │  - Custom config    │  │  - Custom config    │
│  - Custom parsing   │  │  - Custom parsing   │  │  - Custom parsing   │
│  - Custom delays    │  │  - Custom delays    │  │  - Custom delays    │
└─────────┬───────────┘  └─────────┬───────────┘  └─────────┬───────────┘
          │                        │                        │
          └────────────────────────┼────────────────────────┘
                                   ▼
                          ┌───────────────────┐
                          │   staging_games   │
                          └─────────┬─────────┘
                                    ▼
                          ┌───────────────────┐
                          │validationPipeline │
                          └─────────┬─────────┘
                                    ▼
                          ┌───────────────────┐
                          │    matches_v2     │
                          └───────────────────┘
```

### Target State (Universal Framework)
```
┌─────────────────────────────────────────────────────────────────────┐
│                        SOURCE ADAPTERS                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ gotsport.js │  │ htgsports.js│  │ heartland.js│  │  sinc.js    │ │
│  │  (config)   │  │  (config)   │  │  (config)   │  │  (future)   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
└─────────┼────────────────┼────────────────┼────────────────┼────────┘
          │                │                │                │
          └────────────────┼────────────────┼────────────────┘
                           ▼
               ┌───────────────────────┐
               │  CORE SCRAPER ENGINE  │
               │  ─────────────────    │
               │  • Reads adapter      │
               │  • Applies rate limit │
               │  • Handles technology │
               │  • Writes staging     │
               │  • Saves checkpoints  │
               └───────────┬───────────┘
                           ▼
               ┌───────────────────────┐
               │     staging_games     │
               └───────────┬───────────┘
                           ▼
               ┌───────────────────────┐
               │   PROMOTION ENGINE    │
               │   ─────────────────   │
               │  • Team linking       │
               │  • Event creation     │
               │  • Birth year parsing │
               │  • Fuzzy matching     │
               │  • Inference linkage  │
               └───────────┬───────────┘
                           ▼
               ┌───────────────────────┐
               │      matches_v2       │
               └───────────────────────┘
```

---

## Source Adapter Specification

### File Location
```
scripts/adapters/
├── gotsport.js      # GotSport (system.gotsport.com)
├── htgsports.js     # HTGSports (events.htgsports.net)
├── heartland.js     # Heartland CGI (heartlandsoccer.net)
├── demosphere.js    # Demosphere (future)
├── sinc.js          # SINC (future)
└── _template.js     # Template for new adapters
```

### Adapter Schema Definition

```javascript
/**
 * Source Adapter Schema v1.0
 *
 * Each adapter exports a configuration object that tells the
 * Core Scraper Engine how to fetch and parse data from a source.
 */

export default {
  // =========================================
  // METADATA (Required)
  // =========================================
  id: "gotsport",                          // Unique identifier (used in source_platform)
  name: "GotSport",                        // Human-readable name
  baseUrl: "https://system.gotsport.com", // Base URL for requests

  // =========================================
  // TECHNOLOGY (Required)
  // =========================================
  technology: "cheerio",                   // "cheerio" | "puppeteer" | "api"

  // =========================================
  // RATE LIMITING (Required - Pattern #1)
  // =========================================
  rateLimiting: {
    requestDelayMin: 1500,                 // Minimum ms between requests
    requestDelayMax: 3000,                 // Maximum ms between requests
    groupDelay: 800,                       // Delay between group iterations
    eventDelay: 3000,                      // Delay between events
    maxRetries: 3,                         // Max retry attempts
    retryDelays: [5000, 15000, 30000],    // Exponential backoff delays
    cooldownOn429: 120000,                 // Cooldown on rate limit (2 min)
    cooldownOn500: 60000,                  // Cooldown on server error (1 min)
  },

  // =========================================
  // USER AGENTS (Required - Pattern #2)
  // =========================================
  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  ],

  // =========================================
  // ENDPOINTS (Required)
  // =========================================
  endpoints: {
    eventList: "/org_event/events/{eventId}",
    schedule: "/org_event/events/{eventId}/schedules?group={groupId}",
    // For API sources:
    // teamAwards: "/api/v1/ranking_team_awards?team_id={teamId}",
  },

  // =========================================
  // PARSING CONFIGURATION (Source-specific)
  // =========================================
  parsing: {
    // For Cheerio/HTML sources:
    selectors: {
      groupLinks: 'a[href*="schedules?group="]',
      matchTable: "table tr",
      // Column indices for 7-column match table
      columns: {
        matchNumber: 0,
        dateTime: 1,
        homeTeam: 2,
        score: 3,
        awayTeam: 4,
        location: 5,
        division: 6,
      },
    },

    // For Puppeteer/SPA sources:
    puppeteer: {
      waitForSelector: "table.table-striped",
      divisionDropdownSelector: "select.form-control",
      divisionOptionPattern: /U-\d+|20[01]\d/i,
      pageLoadWait: 3000,
      divisionChangeWait: 2000,
    },

    // Date parsing format
    dateFormat: "MM/DD/YYYY",              // or "MMMM D, YYYY" for Heartland

    // Score parsing regex
    scoreRegex: /(\d+)\s*-\s*(\d+)/,
  },

  // =========================================
  // MATCH KEY FORMAT (Required - Pattern #11)
  // =========================================
  matchKeyFormat: "{source}-{eventId}-{matchNumber}",
  // Examples:
  // GotSport: "gotsport-30789-123"
  // HTGSports: "htg-14130-456"
  // Heartland: "heartland-premier-7311-7312-2025-01-15-789"

  // =========================================
  // EVENT DISCOVERY (Optional)
  // =========================================
  discovery: {
    // Static list of known events (like current HTGSports)
    staticEvents: [
      { id: "30789", name: "2025 Tournament", type: "tournament", year: 2025 },
    ],

    // Or dynamic discovery function
    discoverEvents: async (engine) => {
      // Custom discovery logic
      return [{ id, name, type, year }];
    },
  },

  // =========================================
  // DATA TRANSFORMATION (Optional)
  // =========================================
  transform: {
    // Custom team name normalization
    normalizeTeamName: (name) => name.trim(),

    // Custom division parsing
    parseDivision: (divisionText) => {
      // Extract gender and age_group
      return { gender: "Boys", ageGroup: "U13" };
    },

    // Infer state from source
    inferState: () => "KS",  // Heartland is always Kansas
  },

  // =========================================
  // CHECKPOINT CONFIG (Required - Pattern #3)
  // =========================================
  checkpoint: {
    filename: ".gotsport_checkpoint.json",
    saveAfterEachEvent: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================
  dataPolicy: {
    minDate: "2023-08-01",                // 3-year rolling window
    maxFutureDate: null,                   // Allow future scheduled matches
  },
};
```

### Example: HTGSports Adapter

```javascript
// scripts/adapters/htgsports.js

export default {
  id: "htgsports",
  name: "HTGSports",
  baseUrl: "https://events.htgsports.net",
  technology: "puppeteer",  // SPA requires browser

  rateLimiting: {
    requestDelayMin: 2000,
    requestDelayMax: 4000,
    groupDelay: 800,
    eventDelay: 2000,
    maxRetries: 3,
    retryDelays: [5000, 15000, 30000],
    cooldownOn429: 180000,
    cooldownOn500: 60000,
  },

  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
  ],

  endpoints: {
    event: "/?eventid={eventId}#/scheduleresults",
  },

  parsing: {
    puppeteer: {
      waitForSelector: "table.table-striped",
      divisionDropdownSelector: "select.form-control",
      divisionOptionPattern: /U-\d+|2017|2016|2015|2014|2013|2012|2011|2010|2009|2008|2007|2006/i,
      pageLoadWait: 3000,
      divisionChangeWait: 2000,
    },
    columns: {
      matchId: 0,
      date: 1,
      time: 2,
      field: 3,
      homePool: 4,
      homeTeam: 5,
      homeScore: 6,
      awayPool: 7,
      awayTeam: 8,
      awayScore: 9,
    },
    dateFormat: "MM/DD/YYYY",
  },

  matchKeyFormat: "htg-{eventId}-{matchId}",

  discovery: {
    staticEvents: [
      // Current season
      { id: "14130", name: "2026 Heartland Invitational - Boys", type: "tournament", year: 2026 },
      { id: "14129", name: "2026 Heartland Invitational - Girls", type: "tournament", year: 2026 },
      // ... (full list from current scraper)
    ],
  },

  transform: {
    inferState: () => "KS",
    parseDivision: (divisionText) => {
      let gender = null;
      if (/boys|b\s*\d/i.test(divisionText)) gender = "Boys";
      if (/girls|g\s*\d/i.test(divisionText)) gender = "Girls";

      let ageGroup = null;
      const match = divisionText.match(/u[-]?(\d+)/i);
      if (match) ageGroup = `U${match[1]}`;

      return { gender, ageGroup };
    },
  },

  checkpoint: {
    filename: ".htgsports_checkpoint.json",
    saveAfterEachEvent: true,
  },

  dataPolicy: {
    minDate: "2023-08-01",
  },
};
```

### Example: Heartland CGI Adapter

```javascript
// scripts/adapters/heartland.js

export default {
  id: "heartland",
  name: "Heartland Soccer",
  baseUrl: "https://heartlandsoccer.net",
  technology: "cheerio",  // Static HTML, no JS needed

  rateLimiting: {
    requestDelayMin: 500,
    requestDelayMax: 1000,
    maxRetries: 3,
    retryDelays: [2000, 5000, 10000],
    cooldownOn429: 60000,
    cooldownOn500: 30000,
  },

  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
  ],

  endpoints: {
    results: "/reports/cgi-jrb/subdiv_results.cgi",
    standings: "/reports/cgi-jrb/subdiv_standings.cgi",
  },

  parsing: {
    selectors: {
      matchTable: "table tr",
      columns: {
        date: 0,
        gameNum: 1,
        time: 2,
        homeTeam: 3,
        homeScore: 4,
        awayTeam: 5,
        awayScore: 6,
      },
    },
    dateFormat: "MMM D",  // "Aug 16"
  },

  matchKeyFormat: "heartland-{level}-{homeId}-{awayId}-{date}-{gameNum}",

  discovery: {
    // Dynamic - iterate through divisions
    divisions: {
      Premier: {
        genders: ["Boys", "Girls"],
        ages: ["U-9", "U-10", "U-11", "U-12", "U-13", "U-14", "U-15", "U-16", "U-17", "U-18"],
        subdivisions: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        paramNames: { gender: "b_g", age: "age", subdiv: "subdivison" },
      },
      Recreational: {
        // ... similar structure
      },
    },
  },

  transform: {
    inferState: () => "KS",

    // Extract team ID from "7311 DASC 2013 Black" -> { id: "7311", name: "DASC 2013 Black" }
    parseTeamWithId: (teamStr) => {
      const match = teamStr.match(/^(\d+)\s+(.+)$/);
      if (match) return { id: match[1], name: match[2].trim() };
      return { id: null, name: teamStr };
    },

    // Season-aware date parsing (Aug-Dec = last year, Jan-Jul = current year)
    parseSeasonDate: (dateStr, currentYear) => {
      const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
      const match = dateStr.match(/([A-Za-z]+)\s+(\d+)/);
      if (!match) return null;
      const month = months[match[1]];
      const day = parseInt(match[2]);
      const year = month >= 7 ? currentYear - 1 : currentYear;
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    },
  },

  checkpoint: {
    filename: ".heartland_checkpoint.json",
    saveAfterEachDivision: true,
  },

  dataPolicy: {
    minDate: "2023-08-01",
  },
};
```

---

## Core Scraper Engine Design

### File: `scripts/universal/coreScraper.js`

```javascript
/**
 * Core Scraper Engine v1.0
 *
 * Universal scraper that reads adapter configs and fetches data.
 * Preserves all 12 critical patterns from Phase 1.
 *
 * Usage:
 *   node scripts/universal/coreScraper.js --adapter gotsport
 *   node scripts/universal/coreScraper.js --adapter htgsports --active-only
 *   node scripts/universal/coreScraper.js --adapter heartland --level Premier
 *   node scripts/universal/coreScraper.js --adapter gotsport --resume
 */

// Module structure:
class CoreScraper {
  constructor(adapterConfig) {
    this.adapter = adapterConfig;
    this.stats = { /* tracking */ };
    this.checkpoint = null;
  }

  // =========================================
  // INITIALIZATION
  // =========================================

  async initialize() {
    // 1. Load checkpoint if exists (Pattern #3)
    this.checkpoint = await this.loadCheckpoint();

    // 2. Test database write capability (Pattern #4)
    const canWrite = await this.testDatabaseWrite();
    if (!canWrite) throw new Error("Database write test failed");

    // 3. Initialize technology (Cheerio vs Puppeteer)
    await this.initializeTechnology();
  }

  // =========================================
  // TECHNOLOGY HANDLERS
  // =========================================

  async initializeTechnology() {
    if (this.adapter.technology === "puppeteer") {
      const puppeteer = await import("puppeteer");
      this.browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    }
    // Cheerio is loaded per-request, no init needed
  }

  async fetchWithCheerio(url) {
    // Pattern #1: Rate limiting
    await this.applyRateLimit();

    // Pattern #2: User agent rotation
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.getRandomUserAgent(),
        "Accept": "text/html",
      },
    });

    // Handle errors with retry
    if (response.status === 429) {
      await this.cooldown(this.adapter.rateLimiting.cooldownOn429);
      return this.fetchWithCheerio(url); // Retry
    }

    const html = await response.text();
    const cheerio = await import("cheerio");
    return cheerio.load(html);
  }

  async fetchWithPuppeteer(url, options = {}) {
    const page = await this.browser.newPage();

    // Pattern #2: User agent
    await page.setUserAgent(this.getRandomUserAgent());

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait for content
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 10000 }).catch(() => {});
    }
    await this.sleep(this.adapter.parsing.puppeteer?.pageLoadWait || 3000);

    return page;
  }

  // =========================================
  // RATE LIMITING (Pattern #1)
  // =========================================

  async applyRateLimit() {
    const { requestDelayMin, requestDelayMax } = this.adapter.rateLimiting;
    const delay = requestDelayMin + Math.random() * (requestDelayMax - requestDelayMin);
    await this.sleep(delay);
  }

  async cooldown(ms) {
    console.log(`⏳ Cooling down for ${ms / 1000}s...`);
    await this.sleep(ms);
  }

  // =========================================
  // USER AGENT ROTATION (Pattern #2)
  // =========================================

  getRandomUserAgent() {
    const agents = this.adapter.userAgents;
    return agents[Math.floor(Math.random() * agents.length)];
  }

  // =========================================
  // CHECKPOINT MANAGEMENT (Pattern #3)
  // =========================================

  async loadCheckpoint() {
    const filename = this.adapter.checkpoint.filename;
    try {
      const fs = await import("fs");
      if (fs.existsSync(filename)) {
        return JSON.parse(fs.readFileSync(filename, "utf8"));
      }
    } catch (e) {
      console.warn("Could not load checkpoint:", e.message);
    }
    return null;
  }

  async saveCheckpoint(state) {
    const filename = this.adapter.checkpoint.filename;
    const fs = await import("fs");
    fs.writeFileSync(filename, JSON.stringify({
      ...state,
      lastRun: new Date().toISOString(),
      stats: this.stats,
    }, null, 2));
  }

  // =========================================
  // DATABASE WRITE VERIFICATION (Pattern #4)
  // =========================================

  async testDatabaseWrite() {
    // Test insert and delete a dummy record
    const testRecord = {
      source_platform: "test",
      source_match_key: "TEST_DELETE_ME",
      home_team_name: "Test",
      away_team_name: "Test",
      processed: false,
    };

    const { error: writeError } = await supabase
      .from("staging_games")
      .insert([testRecord]);

    if (writeError) {
      console.error("Database write test failed:", writeError.message);
      return false;
    }

    // Clean up
    await supabase.from("staging_games").delete().eq("source_match_key", "TEST_DELETE_ME");

    console.log("✅ Database write test passed");
    return true;
  }

  // =========================================
  // MAIN SCRAPING LOOP
  // =========================================

  async run(options = {}) {
    await this.initialize();

    // Get events to scrape
    const events = await this.getEventsToScrape(options);
    console.log(`Found ${events.length} events to scrape`);

    for (const event of events) {
      // Skip if already processed (checkpoint)
      if (this.checkpoint?.processedEventIds?.includes(event.id)) {
        console.log(`Skipping ${event.id} (already processed)`);
        continue;
      }

      try {
        const matches = await this.scrapeEvent(event);
        await this.writeToStaging(matches);

        // Save checkpoint after each event (Pattern #3)
        await this.saveCheckpoint({
          lastEventId: event.id,
          processedEventIds: [...(this.checkpoint?.processedEventIds || []), event.id],
        });

        // Event delay
        await this.sleep(this.adapter.rateLimiting.eventDelay);

      } catch (error) {
        console.error(`Error scraping ${event.id}:`, error.message);
        this.stats.errors++;
        // Continue to next event
      }
    }

    await this.cleanup();
    return this.stats;
  }

  // =========================================
  // STAGING OUTPUT (Pattern #12)
  // =========================================

  async writeToStaging(matches) {
    if (matches.length === 0) return;

    // Transform to staging_games schema
    const stagingGames = matches.map(m => ({
      match_date: m.matchDate,
      match_time: m.matchTime,
      home_team_name: m.homeTeamName,
      away_team_name: m.awayTeamName,
      home_score: m.homeScore,
      away_score: m.awayScore,
      event_name: m.eventName,
      event_id: m.eventId,
      venue_name: m.location,
      division: m.division,
      source_platform: this.adapter.id,  // Pattern #11
      source_match_key: this.generateMatchKey(m),  // Pattern #11
      raw_data: { original: m },
      processed: false,
    }));

    // Batch insert
    const BATCH_SIZE = 500;
    for (let i = 0; i < stagingGames.length; i += BATCH_SIZE) {
      const batch = stagingGames.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("staging_games").insert(batch);
      if (error) {
        console.error("Staging insert error:", error.message);
        this.stats.errors++;
      } else {
        this.stats.matchesStaged += batch.length;
      }
    }
  }

  // =========================================
  // MATCH KEY GENERATION (Pattern #11)
  // =========================================

  generateMatchKey(match) {
    // Use adapter's format string
    return this.adapter.matchKeyFormat
      .replace("{source}", this.adapter.id)
      .replace("{eventId}", match.eventId)
      .replace("{matchNumber}", match.matchNumber || match.matchId)
      .replace("{matchId}", match.matchId)
      .replace("{homeId}", match.homeId || "")
      .replace("{awayId}", match.awayId || "")
      .replace("{date}", match.matchDate)
      .replace("{gameNum}", match.gameNum || "")
      .replace("{level}", match.level || "")
      .toLowerCase();
  }

  // =========================================
  // UTILITIES
  // =========================================

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

export default CoreScraper;
```

---

## Promotion Engine Design

The Promotion Engine is essentially an enhanced version of the current `validationPipeline.js`. It will preserve all linking patterns.

### File: `scripts/universal/promotionEngine.js`

```javascript
/**
 * Promotion Engine v1.0
 *
 * Moves data from staging to production with:
 * - Team creation/linking (Patterns #5, #6, #7)
 * - Event creation
 * - Birth year extraction (Pattern #5)
 * - Fuzzy matching (Pattern #7)
 * - Inference linkage integration (Pattern #8)
 */

class PromotionEngine {
  constructor() {
    this.teamCache = new Map();
    this.eventCache = new Map();
    this.seasonYear = null;
  }

  // =========================================
  // BIRTH YEAR EXTRACTION (Pattern #5)
  // =========================================

  extractBirthYear(teamName, seasonYear) {
    // Priority 1: Full 4-digit birth year
    const fullYearMatch = teamName.match(/\b(20[01]\d)\b/);
    if (fullYearMatch) {
      const year = parseInt(fullYearMatch[1], 10);
      if (this.isValidBirthYear(year, seasonYear)) {
        return { birthYear: year, source: "parsed_4digit" };
      }
    }

    // Priority 2: 2-digit after gender (B14, G15, 14B, 15G)
    const twoDigitPatterns = [/[BG](\d{2})(?![0-9])/i, /(\d{2})[BG](?![0-9])/i];
    for (const pattern of twoDigitPatterns) {
      const match = teamName.match(pattern);
      if (match) {
        const twoDigit = parseInt(match[1], 10);
        const year = twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
        if (this.isValidBirthYear(year, seasonYear)) {
          return { birthYear: year, source: "parsed_2digit" };
        }
      }
    }

    // Priority 3: Back-calculate from age group (U12, U-11)
    const ageGroupMatch = teamName.match(/\bU[-\s]?(\d+)\b/i);
    if (ageGroupMatch) {
      const age = parseInt(ageGroupMatch[1], 10);
      if (age >= 7 && age <= 19) {
        return { birthYear: seasonYear - age, source: "parsed_age_group" };
      }
    }

    return { birthYear: null, source: "unknown" };
  }

  isValidBirthYear(year, seasonYear) {
    const minYear = seasonYear - 19;  // U19
    const maxYear = seasonYear - 7;   // U7
    return year >= minYear && year <= maxYear;
  }

  // =========================================
  // SUFFIX STRIPPING (Pattern #6)
  // =========================================

  stripSuffix(teamName) {
    // Remove " (U13 Boys)" style suffixes
    return teamName.replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  // =========================================
  // FUZZY MATCHING (Pattern #7)
  // =========================================

  async findTeamFuzzy(teamName, birthYear) {
    const nameLower = teamName.toLowerCase().trim();

    // Use pg_trgm similarity with 0.75 threshold
    const { data: candidates } = await supabase.rpc("find_similar_teams", {
      search_name: nameLower,
      similarity_threshold: 0.75,
      birth_year_filter: birthYear,
    });

    if (candidates && candidates.length > 0) {
      // Return best match
      return candidates[0];
    }

    return null;
  }

  // =========================================
  // TEAM LINKING CASCADE
  // =========================================

  async findOrCreateTeam(teamName, sourcePlatform) {
    const cacheKey = `${teamName}::${sourcePlatform}`;
    if (this.teamCache.has(cacheKey)) {
      return this.teamCache.get(cacheKey);
    }

    const { birthYear, source: birthYearSource } = this.extractBirthYear(teamName, this.seasonYear);
    const canonicalName = teamName.toLowerCase().trim();
    const strippedName = this.stripSuffix(teamName).toLowerCase().trim();

    // Strategy 1: Exact canonical match
    let team = await this.findTeamExact(canonicalName, birthYear);

    // Strategy 2: Suffix-stripped match
    if (!team) {
      team = await this.findTeamExact(strippedName, birthYear);
    }

    // Strategy 3: Fuzzy match (Pattern #7)
    if (!team) {
      team = await this.findTeamFuzzy(strippedName, birthYear);
    }

    // Strategy 4: Create new team
    if (!team) {
      team = await this.createTeam(teamName, birthYear, birthYearSource, sourcePlatform);
    }

    this.teamCache.set(cacheKey, team.id);
    return team.id;
  }

  // =========================================
  // INFERENCE LINKAGE INTEGRATION (Pattern #8)
  // =========================================

  async runInferenceLinkage() {
    // This calls the existing inferEventLinkage.js logic
    // or integrates it directly

    // Load unlinked matches
    const { data: unlinked } = await supabase
      .from("matches_v2")
      .select("id, match_date, home_team_id, away_team_id")
      .is("league_id", null)
      .is("tournament_id", null)
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null);

    // Build team-event relationships from linked matches
    // ... (logic from inferEventLinkage.js)

    // Infer and update
    // ...
  }

  // =========================================
  // MAIN PROMOTION FLOW
  // =========================================

  async run(options = {}) {
    // Load season year from database
    this.seasonYear = await this.getSeasonYear();

    // Process staged games
    const { data: stagedGames } = await supabase
      .from("staging_games")
      .select("*")
      .eq("processed", false)
      .order("scraped_at", { ascending: true })
      .limit(options.limit || 10000);

    for (const game of stagedGames) {
      try {
        // Validate
        if (!this.isValidGame(game)) {
          await this.markInvalid(game.id, "Validation failed");
          continue;
        }

        // Find/create teams
        const homeTeamId = await this.findOrCreateTeam(game.home_team_name, game.source_platform);
        const awayTeamId = await this.findOrCreateTeam(game.away_team_name, game.source_platform);

        // Find/create event
        const { leagueId, tournamentId } = await this.findOrCreateEvent(
          game.event_id,
          game.event_name,
          game.source_platform
        );

        // Insert to matches_v2
        await this.insertMatch({
          ...game,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          league_id: leagueId,
          tournament_id: tournamentId,
        });

        // Mark staged as processed
        await this.markProcessed(game.id);

      } catch (error) {
        await this.markInvalid(game.id, error.message);
      }
    }

    // Run inference linkage after promotion
    if (options.runInference !== false) {
      await this.runInferenceLinkage();
    }

    // Refresh views
    if (options.refreshViews !== false) {
      await supabase.rpc("refresh_app_views");
    }
  }
}

export default PromotionEngine;
```

---

## GitHub Actions Integration

### Updated Workflow Structure

```yaml
# .github/workflows/daily-data-sync.yml

name: Daily Data Sync

on:
  schedule:
    - cron: '0 6 * * *'  # 6 AM UTC daily
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 55  # Stay under 60 min limit

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      # =========================================
      # PHASE 1: Data Collection (Universal)
      # =========================================

      - name: "Phase 1a: GotSport Active Events"
        run: node scripts/universal/coreScraper.js --adapter gotsport --active-only
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: "Phase 1b: HTGSports Active Events"
        run: node scripts/universal/coreScraper.js --adapter htgsports --active-only
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: "Phase 1c: Heartland Results"
        run: node scripts/universal/coreScraper.js --adapter heartland --level Premier
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      # =========================================
      # PHASE 2: Promotion (Staging → Production)
      # =========================================

      - name: "Phase 2: Promotion Engine"
        run: node scripts/universal/promotionEngine.js --refresh-views
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      # =========================================
      # PHASE 2.5: Inference Linkage (CRITICAL)
      # =========================================

      - name: "Phase 2.5: Inference Linkage"
        run: node scripts/maintenance/inferEventLinkage.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      # =========================================
      # PHASE 3: ELO Calculation
      # =========================================

      - name: "Phase 3: Recalculate ELO"
        run: node scripts/daily/recalculate_elo_v2.js
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      # =========================================
      # PHASE 4: Score Predictions
      # =========================================

      - name: "Phase 4: Score Predictions"
        run: node scripts/daily/scorePredictions.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      # =========================================
      # PHASE 5: Rank Snapshot
      # =========================================

      - name: "Phase 5: Capture Rank Snapshot"
        run: node scripts/daily/captureRankSnapshot.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

---

## Migration Strategy

### Phase 3 Execution Plan

1. **Build Universal Framework** (runs ALONGSIDE existing scripts)
   - Create `scripts/universal/` directory
   - Implement `coreScraper.js`
   - Implement `promotionEngine.js`
   - Create GotSport adapter first

2. **Parallel Testing**
   - Run both old and new scrapers
   - Compare output (should be identical)
   - Validate link rates, match counts

3. **Gradual Migration**
   - Replace one scraper at a time
   - GotSport → HTGSports → Heartland
   - Keep old scripts as fallback

4. **Deprecation**
   - Move old scripts to `scripts/_archive/`
   - Only after validation passes

### Rollback Plan

If issues arise:
```bash
# Restore old scrapers from archive
git checkout HEAD~1 -- scripts/daily/syncActiveEvents.js
git checkout HEAD~1 -- scripts/scrapers/scrapeHTGSports.js
# etc.
```

---

## Validation Criteria

### Before Phase 3 is Complete

- [ ] **Match counts identical** before/after migration
- [ ] **Team counts identical** before/after migration
- [ ] **Link rate maintained** at 84.7%+ (currently ~84.7%)
- [ ] **ELO calculations identical** (compare top 100 teams)
- [ ] **Inference linkage working** (orphan count decreasing)
- [ ] **GitHub Actions completing** within timeout
- [ ] **No data loss** (staging_games preserved)

### Automated Validation Script

```javascript
// scripts/universal/validateMigration.js

async function validate() {
  const before = await getMetrics();

  // Run universal framework
  await runUniversalPipeline();

  const after = await getMetrics();

  // Compare
  assert(after.matchCount >= before.matchCount, "Match count decreased!");
  assert(after.teamCount >= before.teamCount, "Team count decreased!");
  assert(after.linkRate >= 0.847, `Link rate dropped: ${after.linkRate}`);

  console.log("✅ Validation passed");
}
```

---

## Approval Checklist

Before proceeding to Phase 3, please confirm:

- [ ] Adapter schema meets your needs
- [ ] Core engine design is acceptable
- [ ] Promotion engine preserves all linking logic
- [ ] GitHub Actions integration is correct
- [ ] Migration strategy is safe
- [ ] Rollback plan is adequate

**STOP AND WAIT FOR USER APPROVAL BEFORE IMPLEMENTING**

---

## Phase 3 Validation Results

**Date:** January 30, 2026
**Status:** ✅ VALIDATED

### Test Summary

| Component | Test | Result |
|-----------|------|--------|
| CLI Interface | `--help` output | ✅ Working, lists all adapters |
| Adapter Loading | Load gotsport.js | ✅ Correct Windows path handling |
| Database Connection | staging_games query | ✅ 8,581 rows accessible |
| Write Test | Insert/verify/delete | ✅ SERVICE_ROLE_KEY working |
| Group Discovery | Event 39064 | ✅ Found 26 groups |
| Match Scraping | Mt Olive Cup 2025 | ✅ Scraped 209 matches |
| Rate Limiting | 26 groups in 97s | ✅ ~3.7s avg per group |
| Dry-Run Mode | `--dry-run` flag | ✅ Shows "Would stage" |
| Checkpoint | Save/load/clear | ✅ Working correctly |

### Test Commands Used

```bash
# CLI help
node scripts/universal/coreScraper.js --help

# Dry-run with real event
node scripts/universal/coreScraper.js --adapter gotsport --event 39064 --dry-run
```

### Output Sample

```
🚀 Universal Scraper Engine v1.0
   Adapter: GotSport (gotsport)
   Technology: cheerio
   Base URL: https://system.gotsport.com

🔍 Testing database write capability...
   Current staging_games count: 8581
   ✅ Database write test PASSED

📋 Events to process: 1

📋 [1/1] Event 39064
   Found 26 groups
   [DRY RUN] Would stage 209 matches
   ✅ Staged 209 matches

✅ SCRAPE COMPLETE
   Events found: 1
   Events processed: 1
   Events successful: 1
   Groups scraped: 26
   Matches found: 209
   Runtime: 97s
```

### Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `scripts/adapters/_template.js` | Template for new adapters | 296 |
| `scripts/adapters/gotsport.js` | GotSport source config | 328 |
| `scripts/universal/coreScraper.js` | Core scraper engine | 841 |

### Parallel Comparison Test Results

**Date:** January 30, 2026
**Status:** ✅ PASSED

Two events tested with identical results:

| Event | Groups | Old Matches | New Matches | Verdict |
|-------|--------|-------------|-------------|---------|
| Mt Olive Cup 2025 (39064) | 26 | 209 | 209 | ✅ Identical |
| TFA Fall Ball Classic (45118) | 24 | 198 | 198 | ✅ Identical |

**Field-by-field comparison:**
- ✅ home_team_name: 0 differences
- ✅ away_team_name: 0 differences
- ✅ home_score: 0 differences
- ✅ away_score: 0 differences
- ✅ match_date: 0 differences
- ✅ status: 0 differences

**Extra data captured by new scraper:**
- division: Raw text preserved (100%)
- gender: Parsed when detectable (varies by event)
- ageGroup: Parsed when detectable (varies by event)

**Conclusion:** The new Universal Scraper produces **100% identical core data** to the old syncActiveEvents.js, plus captures additional metadata (division, gender, ageGroup).

### Next Steps

1. ~~Run parallel test~~ ✅ COMPLETE - Identical results confirmed
2. **Add HTGSports adapter**: Create `scripts/adapters/htgsports.js`
3. **Add Heartland adapter**: Create `scripts/adapters/heartland.js`
4. **Integration test**: Run full pipeline with validation
5. **GitHub Actions**: Update workflow to use new framework

---

## Appendix: File Structure After Phase 3

```
scripts/
├── universal/                    # NEW: Universal Framework
│   ├── coreScraper.js           # Core engine
│   ├── promotionEngine.js       # Staging → Production
│   └── validateMigration.js     # Validation script
├── adapters/                     # NEW: Source Adapters
│   ├── gotsport.js
│   ├── htgsports.js
│   ├── heartland.js
│   └── _template.js
├── daily/                        # UNCHANGED
│   ├── recalculate_elo_v2.js
│   ├── scorePredictions.js
│   └── captureRankSnapshot.js
├── maintenance/                  # UNCHANGED
│   └── inferEventLinkage.js     # PROTECTED
└── _archive/                     # MOVED: Old scrapers
    ├── syncActiveEvents.js      # After validation
    └── scrapeHTGSports.js       # After validation
```

---

*End of Phase 2 Framework Design Document*
