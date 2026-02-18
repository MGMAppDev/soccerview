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
      // Session 112: FL leagues
      { id: "43009", name: "Florida State Premier League 2025-26", year: 2026, type: "league" },
      { id: "45008", name: "West Florida Premier League 2025-26", year: 2026, type: "league" },
      { id: "45046", name: "Central Florida Premier League 2025-26", year: 2026, type: "league" },
      { id: "45052", name: "Southeast Florida Premier League 2025-26", year: 2026, type: "league" },
      // Session 112: Other state leagues (discovered + reclassified)
      { id: "49628", name: "Indiana Soccer League Spring 2026", year: 2026, type: "league" },
      { id: "44132", name: "SLYSA Fall 2025", year: 2026, type: "league" },
      { id: "44745", name: "Girls Classic League 2025-26", year: 2026, type: "league" },
      { id: "45379", name: "Eastern District Players League Fall 2025", year: 2026, type: "league" },
      // Session 112: Spring 2026 leagues - groups set up, games start March 2026 (nightly will capture)
      { id: "48452", name: "Kentucky Premier League Spring 2026", year: 2026, type: "league" },
      { id: "40682", name: "Montana State Spring League 2026", year: 2026, type: "league" },
      { id: "45220", name: "Oklahoma Premier League Spring 2026", year: 2026, type: "league" },
      { id: "957",   name: "Maine State Premier League Spring 2026", year: 2026, type: "league" },
      { id: "5082",  name: "Alaska United Anchorage Youth Soccer League Spring 2026", year: 2026, type: "league" },
      { id: "42137", name: "Girls Academy Tier 1 Spring 2026", year: 2026, type: "league" },
      // Session 112: NO LEAGUE states — multi-state conferences on GotSport
      { id: "40362", name: "USYS Mid South Conference 2024-25 (MS/AL/AR/LA/TN)", year: 2026, type: "league" },
      { id: "34558", name: "USYS Desert Conference 2024-25 (NM/AZ/CO/NV/UT)", year: 2026, type: "league" },
      { id: "32734", name: "Yellowstone Premier League 2024-25 (WY/CO/UT/NV/ID/MT)", year: 2026, type: "league" },
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
  // STANDINGS SCRAPING (Session 109)
  // Universal pattern: discoverSources() + scrapeSource()
  // Reuses existing group discovery + Cheerio parsing
  // =========================================

  standings: {
    enabled: true,

    /**
     * Discover standings sources from GotSport leagues in the database.
     * Each GotSport league = one standings source. Groups are discovered
     * per-source inside scrapeSource().
     */
    discoverSources: async (engine, options) => {
      const { rows } = await engine.pool.query(`
        SELECT l.id, l.name, l.source_event_id, l.state
        FROM leagues l
        WHERE l.source_event_id LIKE 'gotsport-%'
        ORDER BY l.name
      `);

      return rows.map(l => ({
        id: l.source_event_id,
        name: l.name,
        event_id: l.source_event_id.replace('gotsport-', ''),
        league_id: l.id,
        league_source_id: l.source_event_id,
        state: l.state,
        snapshot_date: new Date().toISOString().split('T')[0],
      }));
    },

    /**
     * Scrape standings for all groups in a GotSport league event.
     *
     * Flow:
     *   1. Fetch event page → discover group IDs (from group= links)
     *   2. For each group, fetch results page → extract division heading + standings table
     *   3. Return flat array of all standings entries
     *
     * GotSport results page structure:
     *   - Heading: "Male U12 - B12U - 2014 P1 9v9" (division name)
     *   - Table: table.table-bordered with columns:
     *     [position, team, MP, W, L, D, GF, GA, GD, PTS, PPG]
     *   - Team links: <a href="...?team={teamSourceId}">Team Name</a>
     */
    scrapeSource: async (engine, source) => {
      const baseUrl = engine.adapter.baseUrl;
      const eventUrl = `${baseUrl}/org_event/events/${source.event_id}`;

      // Step 1: Discover groups from event page
      const $ = await engine.fetchWithCheerio(eventUrl);
      if (!$) return [];

      const groupIds = new Set();
      $('a[href*="group="]').each((_, el) => {
        const href = $(el).attr('href');
        const match = href?.match(/group=(\d+)/);
        if (match) groupIds.add(match[1]);
      });

      const groups = Array.from(groupIds);
      if (groups.length === 0) return [];

      console.log(`  Found ${groups.length} groups for ${source.name}`);
      const allStandings = [];

      // Step 2: For each group, fetch results page and parse standings
      for (let i = 0; i < groups.length; i++) {
        const groupId = groups[i];
        const resultsUrl = `${baseUrl}/org_event/events/${source.event_id}/results?group=${groupId}`;

        const $r = await engine.fetchWithCheerio(resultsUrl);
        if (!$r) {
          await engine.applyRateLimit();
          continue;
        }

        // Extract division name from heading (e.g., "Male U12 - B12U - 2014 P1 9v9 - FRI (8 games)")
        let divisionName = null;
        $r('h1, h2, h3, h4, h5').each((_, el) => {
          const text = $r(el).text().trim();
          if (!divisionName && (text.includes('Male') || text.includes('Female') || /U\d+/i.test(text))) {
            divisionName = text.replace(/\s*\(\d+ games?\)\s*/i, '').trim();
          }
        });

        if (!divisionName) divisionName = `Group ${groupId}`;

        // Parse gender from division name (Male → Boys, Female → Girls)
        let gender = null;
        const lowerDiv = divisionName.toLowerCase();
        if (lowerDiv.includes('female') || lowerDiv.includes('girls') || /\bg\d/i.test(divisionName)) {
          gender = 'Girls';
        } else if (lowerDiv.includes('male') || lowerDiv.includes('boys') || /\bb\d/i.test(divisionName)) {
          gender = 'Boys';
        }

        // Parse age group
        let ageGroup = null;
        const ageMatch = divisionName.match(/U[-]?(\d+)/i);
        if (ageMatch) ageGroup = `U${ageMatch[1]}`;

        // Parse standings table rows
        let groupStandings = 0;
        $r('table.table-bordered tbody tr').each((_, row) => {
          const cells = $r(row).find('td');
          if (cells.length < 10) return;

          const position = parseInt($r(cells[0]).text().trim(), 10);
          const teamLink = $r(cells[1]).find('a');
          const teamName = teamLink.text().trim();
          const teamHref = teamLink.attr('href') || '';
          const teamSourceId = teamHref.match(/team=(\d+)/)?.[1] || null;

          if (!teamName) return;

          const played = parseInt($r(cells[2]).text().trim(), 10) || 0;
          const wins = parseInt($r(cells[3]).text().trim(), 10) || 0;
          const losses = parseInt($r(cells[4]).text().trim(), 10) || 0;
          const draws = parseInt($r(cells[5]).text().trim(), 10) || 0;

          // GotSport has two column layouts:
          //   11 cols: [pos, Team, MP, W, L, D, GF, GA, GD, PTS, PPG] → cells[9] = PTS
          //   10 cols: [pos, Team, MP, W, L, D, GF, GA, GD, PPG]     → no PTS column
          const hasPtsColumn = cells.length >= 11;
          const points = hasPtsColumn
            ? parseInt($r(cells[9]).text().trim(), 10) || 0
            : (3 * wins) + draws;

          allStandings.push({
            league_source_id: source.league_source_id,
            division: divisionName,
            team_name: teamName,
            team_source_id: teamSourceId || null,
            played,
            wins,
            losses,
            draws,
            goals_for: parseInt($r(cells[6]).text().trim(), 10) || 0,
            goals_against: parseInt($r(cells[7]).text().trim(), 10) || 0,
            points,
            position,
            age_group: ageGroup,
            gender,
            season: '2025-2026',
          });
          groupStandings++;
        });

        if (engine.isVerbose && groupStandings > 0) {
          console.log(`    Group ${i + 1}/${groups.length}: ${divisionName} — ${groupStandings} teams`);
        }

        await engine.applyRateLimit();
      }

      return allStandings;
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
