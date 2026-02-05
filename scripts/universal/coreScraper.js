/**
 * Universal Core Scraper Engine v1.0
 * ===================================
 *
 * Source-agnostic scraper that reads adapter configs and fetches data.
 * Preserves all 12 critical patterns from Phase 1 Audit.
 *
 * DESIGN PRINCIPLE: Adding a new source requires ONLY a new adapter config file.
 * The engine code should NOT need modification for new sources.
 *
 * Usage:
 *   node scripts/universal/coreScraper.js --adapter gotsport
 *   node scripts/universal/coreScraper.js --adapter gotsport --active-only
 *   node scripts/universal/coreScraper.js --adapter htgsports --event 14130
 *   node scripts/universal/coreScraper.js --adapter heartland --level Premier
 *   node scripts/universal/coreScraper.js --adapter gotsport --resume
 *   node scripts/universal/coreScraper.js --adapter gotsport --dry-run
 *
 * @version 1.0.0
 * @date January 2026
 */

import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===========================================
// DATABASE CLIENTS
// ===========================================

// pg Pool for staging writes (bypasses SERVICE_ROLE_KEY issues)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 600000, // 10 minutes
});

// Supabase client for reads (works with any key)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL (required for staging writes)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===========================================
// CORE SCRAPER ENGINE CLASS
// ===========================================

class CoreScraperEngine {
  constructor(adapter) {
    this.adapter = adapter;
    this.supabase = supabase;
    this.browser = null;
    this.checkpoint = null;
    this.processedEventIds = new Set();

    // Statistics
    this.stats = {
      eventsFound: 0,
      eventsProcessed: 0,
      eventsSuccessful: 0,
      eventsFailed: 0,
      eventsSkipped: 0,
      matchesFound: 0,
      matchesStaged: 0,
      groupsScraped: 0,
      errors: [],
      startTime: null,
    };
  }

  // =========================================
  // INITIALIZATION
  // =========================================

  async initialize() {
    console.log(`🚀 Universal Scraper Engine v1.0`);
    console.log(`   Adapter: ${this.adapter.name} (${this.adapter.id})`);
    console.log(`   Technology: ${this.adapter.technology}`);
    console.log(`   Base URL: ${this.adapter.baseUrl}`);
    console.log("");

    // Pattern #4: Test database write capability
    const canWrite = await this.testDatabaseWrite();
    if (!canWrite) {
      throw new Error("Database write test failed - check SERVICE_ROLE_KEY");
    }

    // Initialize technology
    await this.initializeTechnology();

    // Pattern #3: Load checkpoint if exists
    this.checkpoint = this.loadCheckpoint();
    if (this.checkpoint) {
      this.processedEventIds = new Set(this.checkpoint.processedEventIds || []);
      console.log(`📂 Loaded checkpoint: ${this.processedEventIds.size} events already processed`);
    }
  }

  // =========================================
  // TECHNOLOGY INITIALIZATION
  // =========================================

  async initializeTechnology() {
    if (this.adapter.technology === "puppeteer" || this.adapter.technology === "mixed") {
      console.log("🌐 Launching Puppeteer browser...");
      const puppeteer = await import("puppeteer");
      this.browser = await puppeteer.default.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      console.log("   Browser launched\n");
    }
    // Cheerio and API don't need initialization
  }

  // =========================================
  // PATTERN #4: DATABASE WRITE VERIFICATION
  // =========================================

  async testDatabaseWrite() {
    console.log("🔍 Testing database write capability (using pg Pool)...");

    try {
      // Test read via pg Pool
      const { rows: countResult } = await pool.query(
        `SELECT COUNT(*) as count FROM staging_games`
      );
      console.log(`   Current staging_games count: ${countResult[0].count}`);

      // Test write with dummy record
      const testKey = `test_${Date.now()}`;
      await pool.query(
        `INSERT INTO staging_games (source_platform, source_match_key, home_team_name, away_team_name, processed)
         VALUES ($1, $2, $3, $4, $5)`,
        ["test_delete_me", testKey, "Test Home", "Test Away", false]
      );

      // Verify write
      const { rows: verify } = await pool.query(
        `SELECT id FROM staging_games WHERE source_match_key = $1`,
        [testKey]
      );

      if (verify.length === 0) {
        console.error("   ❌ Write succeeded but data not found!");
        return false;
      }

      // Clean up
      await pool.query(
        `DELETE FROM staging_games WHERE source_match_key = $1`,
        [testKey]
      );

      console.log("   ✅ Database write test PASSED (pg Pool)\n");
      return true;

    } catch (error) {
      console.error(`   ❌ Database write test failed: ${error.message}`);
      return false;
    }
  }

  // =========================================
  // PATTERN #3: CHECKPOINT MANAGEMENT
  // =========================================

  loadCheckpoint() {
    const filename = path.join(__dirname, "..", this.adapter.checkpoint.filename);
    try {
      if (fs.existsSync(filename)) {
        return JSON.parse(fs.readFileSync(filename, "utf8"));
      }
    } catch (e) {
      console.warn(`⚠️ Could not load checkpoint: ${e.message}`);
    }
    return null;
  }

  saveCheckpoint(lastEventId) {
    const filename = path.join(__dirname, "..", this.adapter.checkpoint.filename);
    const checkpoint = {
      lastEventId,
      processedEventIds: Array.from(this.processedEventIds),
      lastRun: new Date().toISOString(),
      adapter: this.adapter.id,
      stats: { ...this.stats },
    };

    try {
      fs.writeFileSync(filename, JSON.stringify(checkpoint, null, 2));
    } catch (e) {
      console.error(`⚠️ Failed to save checkpoint: ${e.message}`);
    }
  }

  clearCheckpoint() {
    const filename = path.join(__dirname, "..", this.adapter.checkpoint.filename);
    try {
      if (fs.existsSync(filename)) {
        fs.unlinkSync(filename);
        console.log("🗑️ Checkpoint cleared");
      }
    } catch (e) {
      console.warn(`⚠️ Could not clear checkpoint: ${e.message}`);
    }
  }

  // =========================================
  // PATTERN #2: USER AGENT ROTATION
  // =========================================

  getRandomUserAgent() {
    const agents = this.adapter.userAgents;
    return agents[Math.floor(Math.random() * agents.length)];
  }

  // =========================================
  // PATTERN #1: RATE LIMITING
  // =========================================

  async applyRateLimit() {
    const { requestDelayMin, requestDelayMax } = this.adapter.rateLimiting;
    const delay = requestDelayMin + Math.random() * (requestDelayMax - requestDelayMin);
    await this.sleep(delay);
  }

  async cooldown(ms, reason = "Rate limiting") {
    console.log(`   ⏳ ${reason} - cooling down ${ms / 1000}s...`);
    await this.sleep(ms);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =========================================
  // HTML FETCHING (Cheerio)
  // =========================================

  async fetchWithCheerio(url, retries = null) {
    retries = retries ?? this.adapter.rateLimiting.maxRetries;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.applyRateLimit();

        const response = await fetch(url, {
          headers: {
            "User-Agent": this.getRandomUserAgent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
        });

        // Handle rate limiting
        if (response.status === 429) {
          await this.cooldown(this.adapter.rateLimiting.cooldownOn429, "Rate limited (429)");
          continue;
        }

        // Handle server errors
        if (response.status >= 500) {
          if (attempt < retries) {
            await this.cooldown(this.adapter.rateLimiting.cooldownOn500, `Server error (${response.status})`);
            continue;
          }
          return { html: null, status: response.status, error: `HTTP ${response.status}` };
        }

        // Handle not found
        if (response.status === 404) {
          return { html: null, status: 404, error: "Not found" };
        }

        if (!response.ok) {
          return { html: null, status: response.status, error: `HTTP ${response.status}` };
        }

        const html = await response.text();
        const cheerio = await import("cheerio");
        return { $: cheerio.load(html), html, status: response.status, error: null };

      } catch (error) {
        if (attempt < retries) {
          const delay = this.adapter.rateLimiting.retryDelays[attempt] || 30000;
          console.log(`   ⚠️ Attempt ${attempt + 1} failed: ${error.message}`);
          await this.sleep(delay);
          continue;
        }
        return { html: null, status: null, error: error.message };
      }
    }

    return { html: null, status: null, error: "Max retries exceeded" };
  }

  // =========================================
  // SPA FETCHING (Puppeteer)
  // =========================================

  async fetchWithPuppeteer(url, options = {}) {
    if (!this.browser) {
      throw new Error("Puppeteer not initialized - set technology: 'puppeteer' in adapter");
    }

    const page = await this.browser.newPage();

    try {
      await page.setUserAgent(this.getRandomUserAgent());
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

      // Wait for selector if specified
      const waitSelector = options.waitForSelector || this.adapter.parsing.puppeteer?.waitForSelector;
      if (waitSelector) {
        await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => {});
      }

      // Page load wait
      const loadWait = this.adapter.parsing.puppeteer?.pageLoadWait || 3000;
      await this.sleep(loadWait);

      return page;

    } catch (error) {
      await page.close();
      throw error;
    }
  }

  // =========================================
  // GROUP DISCOVERY (GotSport pattern)
  // =========================================

  async discoverGroups(eventId) {
    const url = this.adapter.endpoints.eventPage
      .replace("{eventId}", eventId);
    const fullUrl = `${this.adapter.baseUrl}${url}`;

    const { $, error } = await this.fetchWithCheerio(fullUrl);

    if (error || !$) {
      return [];
    }

    const selector = this.adapter.parsing.selectors?.groupLinks || 'a[href*="group="]';
    const groups = new Set();

    $(selector).each((_, el) => {
      const href = $(el).attr("href");
      const match = href?.match(/group=(\d+)/);
      if (match) groups.add(match[1]);
    });

    return Array.from(groups);
  }

  // =========================================
  // GROUP SCRAPING (GotSport pattern)
  // =========================================

  async scrapeGroup(eventId, groupId, eventName) {
    const url = this.adapter.endpoints.schedule
      .replace("{eventId}", eventId)
      .replace("{groupId}", groupId);
    const fullUrl = `${this.adapter.baseUrl}${url}`;

    const { $, error } = await this.fetchWithCheerio(fullUrl);

    if (error || !$) {
      return [];
    }

    const matches = [];
    const columns = this.adapter.parsing.columns;
    const expectedColumns = this.adapter.parsing.expectedColumns || 7;

    $("table tr").each((_, row) => {
      const cells = $(row).find("td");

      if (cells.length === expectedColumns) {
        const matchNumber = $(cells[columns.matchNumber]).text().trim();
        const dateTime = $(cells[columns.dateTime]).text().trim();
        const homeTeamName = $(cells[columns.homeTeam]).text().trim();
        const scoreText = $(cells[columns.score]).text().trim();
        const awayTeamName = $(cells[columns.awayTeam]).text().trim();
        const location = $(cells[columns.location]).text().trim();
        const division = columns.division !== undefined ? $(cells[columns.division]).text().trim() : null;

        // Skip rows without score indicator
        if (!scoreText.includes("-")) return;

        const [homeScore, awayScore] = this.adapter.transform.parseScore(scoreText);
        const matchDate = this.adapter.transform.parseDate(dateTime);

        // Apply data policy: min date filter
        if (matchDate && this.adapter.dataPolicy.minDate && matchDate < this.adapter.dataPolicy.minDate) {
          return;
        }

        // Determine status
        let status = "scheduled";
        if (homeScore !== null && awayScore !== null && matchDate) {
          if (new Date(matchDate) < new Date()) status = "completed";
        }

        // Parse division for gender/age
        const { gender, ageGroup } = this.adapter.transform.parseDivision(division || "");

        const match = {
          eventId: eventId.toString(),
          eventName,
          matchNumber,
          matchDate,
          homeTeamName: this.adapter.transform.normalizeTeamName(homeTeamName),
          awayTeamName: this.adapter.transform.normalizeTeamName(awayTeamName),
          homeScore,
          awayScore,
          status,
          location,
          division,
          gender,
          ageGroup,
        };

        // Apply validity filter
        if (this.adapter.dataPolicy.isValidMatch && !this.adapter.dataPolicy.isValidMatch(match)) {
          return;
        }

        matches.push(match);
      }
    });

    this.stats.groupsScraped++;
    return matches;
  }

  // =========================================
  // PATTERN #11: MATCH KEY GENERATION
  // =========================================

  generateMatchKey(match) {
    return this.adapter.matchKeyFormat
      .replace("{source}", this.adapter.id)
      .replace("{eventId}", match.eventId || "")
      .replace("{matchNumber}", match.matchNumber || "")
      .replace("{matchId}", match.matchId || "")
      .replace("{homeId}", match.homeId || "")
      .replace("{awayId}", match.awayId || "")
      .replace("{date}", match.matchDate || "")
      .replace("{gameNum}", match.gameNum || "")
      .replace("{level}", match.level || "")
      .toLowerCase();
  }

  // =========================================
  // PATTERN #12: STAGING OUTPUT
  // =========================================

  async writeToStaging(matches, options = {}) {
    if (matches.length === 0) return 0;

    // Transform to staging_games schema
    const stagingGames = matches.map(m => ({
      match_date: m.matchDate,
      match_time: m.matchTime || null,
      home_team_name: m.homeTeamName,
      away_team_name: m.awayTeamName,
      home_score: m.homeScore,
      away_score: m.awayScore,
      event_name: m.eventName,
      event_id: m.eventId,
      venue_name: m.location,
      field_name: null,
      division: m.division || (m.ageGroup && m.gender ? `${m.ageGroup} ${m.gender}` : null),
      source_platform: this.adapter.id,
      source_match_key: this.generateMatchKey(m),
      raw_data: {
        status: m.status,
        gender: m.gender,
        ageGroup: m.ageGroup,
        original: m,
      },
      processed: false,
    }));

    if (options.dryRun) {
      console.log(`   [DRY RUN] Would stage ${stagingGames.length} matches`);
      return stagingGames.length;
    }

    // SESSION 87: Use pg Pool instead of Supabase for staging writes
    // This bypasses the SERVICE_ROLE_KEY validation issue
    const BATCH_SIZE = 500;
    let totalInserted = 0;

    for (let i = 0; i < stagingGames.length; i += BATCH_SIZE) {
      const batch = stagingGames.slice(i, i + BATCH_SIZE);

      try {
        // Build parameterized INSERT with ON CONFLICT DO NOTHING
        const columns = [
          "match_date", "match_time", "home_team_name", "away_team_name",
          "home_score", "away_score", "event_name", "event_id",
          "venue_name", "field_name", "division", "source_platform",
          "source_match_key", "raw_data", "processed"
        ];

        const values = [];
        const placeholders = batch.map((game, idx) => {
          const base = idx * columns.length;
          values.push(
            game.match_date,
            game.match_time,
            game.home_team_name,
            game.away_team_name,
            game.home_score,
            game.away_score,
            game.event_name,
            game.event_id,
            game.venue_name,
            game.field_name,
            game.division,
            game.source_platform,
            game.source_match_key,
            JSON.stringify(game.raw_data),
            game.processed
          );
          return `(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`;
        });

        const sql = `
          INSERT INTO staging_games (${columns.join(", ")})
          VALUES ${placeholders.join(", ")}
          ON CONFLICT (source_match_key) DO NOTHING
        `;

        const result = await pool.query(sql, values);
        totalInserted += result.rowCount || batch.length;

      } catch (error) {
        console.error(`   ❌ Staging insert error: ${error.message}`);
        this.stats.errors.push(`Staging: ${error.message}`);
      }
    }

    this.stats.matchesStaged += totalInserted;
    return totalInserted;
  }

  // =========================================
  // EVENT REGISTRATION TO STAGING
  // =========================================

  async registerEventToStaging(event, matchCount) {
    try {
      // SESSION 87: Use pg Pool instead of Supabase
      const rawData = JSON.stringify({
        year: event.year,
        match_count: matchCount,
        scraped_at: new Date().toISOString(),
      });

      await pool.query(`
        INSERT INTO staging_events (event_name, event_type, source_platform, source_event_id, state, raw_data, processed)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [
        event.name,
        event.type || "tournament",
        this.adapter.id,
        event.id.toString(),
        this.adapter.transform.inferState ? this.adapter.transform.inferState() : null,
        rawData,
        false
      ]);
    } catch (e) {
      // Ignore duplicate errors in staging
    }
  }

  // =========================================
  // MAIN SCRAPING ORCHESTRATION
  // =========================================

  async scrapeEvent(event) {
    // Use custom scrape function if adapter provides one
    if (this.adapter.scrapeEvent) {
      return await this.adapter.scrapeEvent(this, event);
    }

    // Default: Group discovery → Group scraping pattern
    const allMatches = [];
    const groups = await this.discoverGroups(event.id);

    if (groups.length === 0) {
      console.log(`   ⚠️ No groups found`);
      return [];
    }

    console.log(`   Found ${groups.length} groups`);

    for (let i = 0; i < groups.length; i++) {
      process.stdout.write(`\r   Scraping group ${i + 1}/${groups.length}...`);
      const matches = await this.scrapeGroup(event.id, groups[i], event.name);
      allMatches.push(...matches);
      await this.sleep(this.adapter.rateLimiting.iterationDelay);
    }

    console.log(`\n   📊 Found ${allMatches.length} matches`);

    // Deduplicate
    const uniqueMatches = Array.from(
      new Map(allMatches.map(m => [this.generateMatchKey(m), m])).values()
    );

    if (uniqueMatches.length < allMatches.length) {
      console.log(`   📊 ${uniqueMatches.length} unique (${allMatches.length - uniqueMatches.length} duplicates removed)`);
    }

    return uniqueMatches;
  }

  // =========================================
  // UNIVERSAL EVENT DISCOVERY (Database-based)
  // Works for ANY source without custom code
  // =========================================

  async discoverEventsFromDatabase(lookbackDays = 7, forwardDays = 7) {
    console.log(`🔍 Universal discovery: Finding ${this.adapter.id} events from database...`);

    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

    const forwardDate = new Date();
    forwardDate.setDate(forwardDate.getDate() + forwardDays);

    // Query matches_v2 for recent/upcoming activity
    // Extract source_match_key prefix from matchKeyFormat (e.g., "htg-{eventId}-{matchId}" -> "htg")
    const matchKeyPrefix = this.adapter.matchKeyFormat?.split('-')[0] || this.adapter.id;
    const sourcePattern = `${matchKeyPrefix}-%`;

    const { data: recentMatches, error } = await this.supabase
      .from("matches_v2")
      .select("league_id, tournament_id")
      .like("source_match_key", sourcePattern)
      .gte("match_date", lookbackDate.toISOString().split("T")[0])
      .lte("match_date", forwardDate.toISOString().split("T")[0])
      .limit(5000);

    if (error) {
      console.error("   Error querying matches:", error.message);
      return [];
    }

    // Collect unique league and tournament IDs
    const leagueIds = new Set();
    const tournamentIds = new Set();
    for (const match of recentMatches || []) {
      if (match.league_id) leagueIds.add(match.league_id);
      if (match.tournament_id) tournamentIds.add(match.tournament_id);
    }

    console.log(`   Found ${leagueIds.size} leagues, ${tournamentIds.size} tournaments with recent activity`);

    const events = [];

    // Fetch league details
    if (leagueIds.size > 0) {
      const { data: leagues } = await this.supabase
        .from("leagues")
        .select("id, name, source_event_id")
        .in("id", Array.from(leagueIds));

      for (const lg of leagues || []) {
        if (lg.source_event_id) {
          events.push({
            id: lg.source_event_id,
            name: lg.name,
            type: "league",
            internalId: lg.id,
          });
        }
      }
    }

    // Fetch tournament details
    if (tournamentIds.size > 0) {
      const { data: tournaments } = await this.supabase
        .from("tournaments")
        .select("id, name, source_event_id")
        .in("id", Array.from(tournamentIds));

      for (const t of tournaments || []) {
        if (t.source_event_id) {
          events.push({
            id: t.source_event_id,
            name: t.name,
            type: "tournament",
            internalId: t.id,
          });
        }
      }
    }

    console.log(`   Discovered ${events.length} active events`);
    return events;
  }

  // =========================================
  // MAIN RUN FUNCTION
  // =========================================

  async run(options = {}) {
    this.stats.startTime = Date.now();

    await this.initialize();

    // Get events to scrape
    let events = [];

    if (options.eventId) {
      // Single event mode - look up from staticEvents first to get full metadata
      const staticEvents = this.adapter.discovery.staticEvents || [];
      const found = staticEvents.find(e => e.id.toString() === options.eventId.toString());

      if (found) {
        events = [found];
      } else {
        // Fallback: create basic event object
        events = [{
          id: options.eventId,
          name: `Event ${options.eventId}`,
          type: "tournament",
        }];
      }
    } else if (this.adapter.discovery.discoverEvents) {
      // Adapter-specific discovery (can call universal method internally)
      console.log("🔍 Discovering events (adapter-specific)...");
      events = await this.adapter.discovery.discoverEvents(this);
    } else if (options.activeOnly || options.useUniversalDiscovery) {
      // UNIVERSAL: Database-based discovery (works for ANY source)
      events = await this.discoverEventsFromDatabase();

      // Merge with static list to catch any we might have missed
      const staticEvents = this.adapter.discovery.staticEvents || [];
      const eventIds = new Set(events.map(e => e.id.toString()));
      for (const se of staticEvents) {
        if (!eventIds.has(se.id.toString())) {
          events.push(se);
        }
      }
    } else {
      // Static events list (fallback)
      events = this.adapter.discovery.staticEvents || [];
    }

    // Apply active-only filter if needed
    if (options.activeOnly && events.length > 0) {
      const currentYear = new Date().getFullYear();
      events = events.filter(e => e.year >= currentYear - 1);
    }

    // Apply max events limit
    const maxEvents = this.adapter.dataPolicy?.maxEventsPerRun || 100;
    if (events.length > maxEvents) {
      console.log(`⚠️ Limiting to ${maxEvents} events (found ${events.length})`);
      events = events.slice(0, maxEvents);
    }

    this.stats.eventsFound = events.length;
    console.log(`📋 Events to process: ${events.length}\n`);

    if (events.length === 0) {
      console.log("✅ No events to scrape");
      return this.stats;
    }

    // Process each event
    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Skip if already processed (checkpoint)
      if (this.processedEventIds.has(event.id.toString())) {
        console.log(`⏭️ Skipping ${event.name || event.id} (already processed)`);
        this.stats.eventsSkipped++;
        continue;
      }

      console.log(`\n📋 [${i + 1}/${events.length}] ${event.name || event.id}`);

      try {
        const matches = await this.scrapeEvent(event);
        this.stats.matchesFound += matches.length;

        if (matches.length > 0) {
          const inserted = await this.writeToStaging(matches, options);
          console.log(`   ✅ Staged ${inserted} matches`);
          await this.registerEventToStaging(event, matches.length);
          this.stats.eventsSuccessful++;
          this.stats.matchesStaged += inserted;

          // UNIVERSAL FIX: Only mark as processed if we got data
          // Events with 0 matches (future events, empty brackets) should be retried
          this.processedEventIds.add(event.id.toString());
        } else {
          // Event had no data - DON'T mark as processed so it can be retried
          console.log(`   ⏸️ No matches found (will retry next run)`);
          this.stats.eventsSkipped++;
        }

        this.stats.eventsProcessed++;

        if (this.adapter.checkpoint.saveAfterEachItem) {
          this.saveCheckpoint(event.id);
        }

      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        this.stats.eventsFailed++;
        this.stats.errors.push(`Event ${event.id}: ${error.message}`);

        // For errors, mark as processed to avoid infinite retry loops
        // But log the error so it can be investigated
        this.processedEventIds.add(event.id.toString());
        this.saveCheckpoint(event.id);
      }

      // Event delay
      if (i < events.length - 1) {
        await this.sleep(this.adapter.rateLimiting.itemDelay);
      }
    }

    await this.cleanup();
    return this.stats;
  }

  // =========================================
  // CLEANUP
  // =========================================

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log("\n🌐 Browser closed");
    }

    // Clear checkpoint if all successful
    if (this.stats.eventsFailed === 0 && this.stats.eventsProcessed > 0) {
      this.clearCheckpoint();
    }

    // Close pg Pool (SESSION 87)
    try {
      await pool.end();
    } catch (e) {
      // Pool may already be closed
    }
  }

  // =========================================
  // SUMMARY
  // =========================================

  printSummary() {
    const elapsed = Date.now() - this.stats.startTime;

    console.log("\n" + "=".repeat(60));
    console.log("✅ SCRAPE COMPLETE");
    console.log("=".repeat(60));
    console.log(`   Adapter: ${this.adapter.name}`);
    console.log(`   Events found: ${this.stats.eventsFound}`);
    console.log(`   Events processed: ${this.stats.eventsProcessed}`);
    console.log(`   Events successful: ${this.stats.eventsSuccessful}`);
    console.log(`   Events skipped: ${this.stats.eventsSkipped}`);
    console.log(`   Events failed: ${this.stats.eventsFailed}`);
    console.log(`   Groups scraped: ${this.stats.groupsScraped}`);
    console.log(`   Matches found: ${this.stats.matchesFound}`);
    console.log(`   Matches staged: ${this.stats.matchesStaged}`);
    console.log(`   Runtime: ${Math.round(elapsed / 1000)}s`);
    console.log(`   Completed: ${new Date().toISOString()}`);

    if (this.stats.eventsFailed > 0) {
      console.log("\n❌ ERRORS:");
      for (const err of this.stats.errors.slice(0, 5)) {
        console.log(`   - ${err}`);
      }
      if (this.stats.errors.length > 5) {
        console.log(`   ... and ${this.stats.errors.length - 5} more`);
      }
    }

    console.log("\n📋 Next: Run Data Quality Engine to process staged data");
    console.log("   node scripts/universal/intakeValidator.js --clean-staging");
    console.log("   node scripts/universal/dataQualityEngine.js --process-staging");
  }
}

// ===========================================
// CLI INTERFACE
// ===========================================

async function main() {
  console.log("🔄 Universal Core Scraper Engine v1.0");
  console.log("=".repeat(50));

  // Parse arguments
  const args = process.argv.slice(2);

  const getArg = (name) => {
    const idx = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
    if (idx === -1) return null;
    if (args[idx].includes("=")) return args[idx].split("=")[1];
    return args[idx + 1] || true;
  };

  const adapterId = getArg("adapter");
  const eventId = getArg("event");
  const activeOnly = args.includes("--active-only");
  const resume = args.includes("--resume");
  const dryRun = args.includes("--dry-run");

  if (!adapterId) {
    console.error("\n❌ Missing required --adapter argument");
    console.error("\nUsage:");
    console.error("  node scripts/universal/coreScraper.js --adapter gotsport");
    console.error("  node scripts/universal/coreScraper.js --adapter gotsport --active-only");
    console.error("  node scripts/universal/coreScraper.js --adapter htgsports --event 14130");
    console.error("  node scripts/universal/coreScraper.js --adapter gotsport --resume");
    console.error("  node scripts/universal/coreScraper.js --adapter gotsport --dry-run");
    console.error("\nAvailable adapters:");
    console.error("  gotsport, htgsports, heartland");
    process.exit(1);
  }

  // Load adapter
  let adapter;
  try {
    const adapterPath = path.join(__dirname, "..", "adapters", `${adapterId}.js`);
    const adapterUrl = pathToFileURL(adapterPath).href;
    const adapterModule = await import(adapterUrl);
    adapter = adapterModule.default;
  } catch (error) {
    console.error(`\n❌ Could not load adapter '${adapterId}': ${error.message}`);
    console.error(`   Make sure scripts/adapters/${adapterId}.js exists`);
    process.exit(1);
  }

  console.log(`Adapter: ${adapter.name}`);
  console.log(`Active only: ${activeOnly}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Resume: ${resume}`);
  if (eventId) console.log(`Event ID: ${eventId}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Run scraper
  const engine = new CoreScraperEngine(adapter);

  try {
    await engine.run({
      eventId,
      activeOnly,
      dryRun,
    });
    engine.printSummary();

  } catch (error) {
    console.error(`\n❌ FATAL: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
main().catch(error => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
});

export default CoreScraperEngine;
