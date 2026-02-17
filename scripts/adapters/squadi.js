/**
 * Squadi Source Adapter v1.0
 * ==========================
 *
 * Session 104: Built for Arkansas Competitive Soccer League (ACSL) and related AR competitions.
 *
 * PLATFORM OVERVIEW:
 * - Squadi (formerly World Sport Action / WSA) is an Australian sports management platform
 * - US operations at api.us.squadi.com since 2023
 * - React SPA frontend, but ALL data accessible via clean REST API (NO auth required)
 * - Used by: Arkansas Soccer Association, Tennessee State League, NPSL
 *
 * DATA ACCESS ARCHITECTURE:
 *
 * 1. Competitions List (JSON):
 *    GET api.us.squadi.com/livescores/competitions/list?organisationUniqueKey={orgKey}
 *    Returns: Array of competitions with numeric IDs and unique keys
 *
 * 2. Divisions (JSON):
 *    GET api.us.squadi.com/livescores/division?competitionId={numericId}
 *    Returns: Array of divisions with numeric IDs and names
 *
 * 3. Matches by Division (JSON):
 *    GET api.us.squadi.com/livescores/round/matches?competitionId={compId}&divisionId={divId}
 *    Returns: { rounds: [{ matches: [{ team1, team2, scores, startTime, ... }] }] }
 *
 * 4. Standings/Ladder (JSON):
 *    GET api.us.squadi.com/livescores/teams/ladder/v2?divisionIds={divId}&competitionKey={uniqueKey}&showForm=1&sportRefId=1
 *    Returns: { ladders: [{ P, W, L, D, F, A, PTS, rk, ... }] }
 *
 * TECHNOLOGY: api (pure REST, no browser or HTML parsing needed)
 *
 * ORGANIZATIONS SUPPORTED:
 * - Arkansas Soccer Association: orgKey 3ec85864-ce92-4838-b407-1009438aafb0
 *   - ACSL (Arkansas Competitive Soccer League) — main state league
 *   - NWAL (Northwest Arkansas League)
 *   - CARL (Central Arkansas Recreational League) — recreational, EXCLUDED per Principle 28
 *   - CAL (Central Arkansas League)
 *   - State Championships, ODP, Friendlies
 *
 * Future: Tennessee State League (orgKey: d1445ee0-8058-44ff-9aaa-e9ce0b69ef2a)
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "squadi",
  name: "Squadi",
  baseUrl: "https://api.us.squadi.com/livescores",

  // =========================================
  // TECHNOLOGY
  // =========================================

  technology: "api",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    requestDelayMin: 800,
    requestDelayMax: 1500,
    iterationDelay: 500,   // Between divisions
    itemDelay: 1500,       // Between competitions
    maxRetries: 3,
    retryDelays: [3000, 8000, 15000],
    cooldownOn429: 60000,
    cooldownOn500: 30000,
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
    competitions: "/competitions/list?organisationUniqueKey={orgKey}",
    divisions: "/division?competitionId={competitionId}",
    matches: "/round/matches?competitionId={competitionId}&divisionId={divisionId}",
    ladder: "/teams/ladder/v2?divisionIds={divisionId}&competitionKey={competitionKey}&showForm=1&sportRefId=1",
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "squadi-{eventId}-{matchId}",

  // =========================================
  // STATIC EVENTS
  // =========================================

  discovery: {
    /**
     * StaticEvents for Squadi-powered leagues.
     * AR Soccer Association orgKey: 3ec85864-ce92-4838-b407-1009438aafb0
     *
     * Competition IDs discovered via API (Session 104).
     * CARL excluded per Principle 28 (recreational/community league).
     */
    staticEvents: [
      // Arkansas Competitive Soccer League (ACSL) — MAIN state league
      {
        id: "acsl-fall-2025",
        name: "ACSL Fall 2025",
        type: "league",
        year: 2026,
        orgKey: "3ec85864-ce92-4838-b407-1009438aafb0",
        competitionId: 143,
        competitionKey: "28c644ec-255a-4494-964a-58547d43effb",
        state: "AR",
      },
      {
        id: "acsl-spring-2026",
        name: "ACSL Spring 2026",
        type: "league",
        year: 2026,
        orgKey: "3ec85864-ce92-4838-b407-1009438aafb0",
        competitionId: 228,
        competitionKey: "debb1676-7ba6-4368-80d9-4d7ee70e6589",
        state: "AR",
      },
      // Northwest Arkansas League (NWAL) — regional competitive
      {
        id: "nwal-fall-2025",
        name: "NWAL Fall 2025",
        type: "league",
        year: 2026,
        orgKey: "3ec85864-ce92-4838-b407-1009438aafb0",
        competitionId: 163,
        competitionKey: "107cec99-bf7b-44b0-a947-c345917c042f",
        state: "AR",
      },
      {
        id: "nwal-spring-2026",
        name: "NWAL Spring 2026",
        type: "league",
        year: 2026,
        orgKey: "3ec85864-ce92-4838-b407-1009438aafb0",
        competitionId: 229,
        competitionKey: "85d04756-05e9-4b96-9121-5eefb46037b8",
        state: "AR",
      },
      // Central Arkansas League (CAL) — competitive (NOT to be confused with CARL recreational)
      {
        id: "cal-ar-spring-2026",
        name: "Central Arkansas League Spring 2026",
        type: "league",
        year: 2026,
        orgKey: "3ec85864-ce92-4838-b407-1009438aafb0",
        competitionId: 240,
        competitionKey: "711be9c8-3729-466b-acc5-d820444b729f",
        state: "AR",
      },
      // AR State Championships
      {
        id: "ar-state-champs-fall-2025",
        name: "AR State Championships Fall 2025",
        type: "tournament",
        year: 2026,
        orgKey: "3ec85864-ce92-4838-b407-1009438aafb0",
        competitionId: 203,
        competitionKey: "8e99678c-c55a-40f3-9940-e7360e3af137",
        state: "AR",
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
      return name.trim().replace(/\s+/g, " ");
    },

    /**
     * Parse Squadi division names.
     * Format: "{ageGroup} {gender} {region} {tierName}"
     * Examples:
     *   "11U Boys Central Div 1"
     *   "14U Girls 13/14U Div 1"
     *   "15U Boys NWA Division 2"
     *   "17U Boys Div 1"
     */
    parseDivision: (divisionText) => {
      if (!divisionText) return { gender: null, ageGroup: null };

      let gender = null;
      const lower = divisionText.toLowerCase();
      if (lower.includes("boys")) gender = "Boys";
      else if (lower.includes("girls")) gender = "Girls";

      let ageGroup = null;
      // Match "11U", "14U", "15U", "17U", "19U" — first occurrence
      const ageMatch = divisionText.match(/(\d+)U\b/i);
      if (ageMatch) {
        ageGroup = `U${ageMatch[1]}`;
      } else {
        // Fallback: "U11", "U14" format
        const altMatch = divisionText.match(/U(\d+)/i);
        if (altMatch) ageGroup = `U${altMatch[1]}`;
      }

      return { gender, ageGroup };
    },

    inferState: (event) => event?.state || "AR",

    /**
     * Parse Squadi ISO 8601 date.
     * Format: "2025-08-24T18:30:00.000Z"
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
     * Extract time from ISO date string.
     * "2025-08-24T18:30:00.000Z" → "18:30"
     */
    parseTime: (dateStr) => {
      if (!dateStr) return null;
      try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;
        const hours = date.getUTCHours().toString().padStart(2, "0");
        const minutes = date.getUTCMinutes().toString().padStart(2, "0");
        return `${hours}:${minutes}`;
      } catch {
        return null;
      }
    },

    parseScore: (scoreStr) => {
      if (scoreStr === null || scoreStr === undefined) return null;
      const score = parseInt(scoreStr);
      return isNaN(score) ? null : score;
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".squadi_checkpoint.json",
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
      if (!match.matchDate) return false;
      if (match.homeTeamName === match.awayTeamName) return false;
      // Skip BYE matches
      if (match.homeTeamName.toLowerCase().includes("bye")) return false;
      if (match.awayTeamName.toLowerCase().includes("bye")) return false;
      return true;
    },
  },

  // =========================================
  // STANDINGS SCRAPING (Session 110)
  // Universal pattern: discoverSources() + scrapeSource()
  // Uses the REST API ladder endpoint:
  //   GET /teams/ladder/v2?divisionIds={divId}&competitionKey={key}&showForm=1&sportRefId=1
  //   Returns: { ladders: [{ name, P, W, L, D, F, A, PTS, rk, divisionName, grade, ... }] }
  // =========================================

  standings: {
    enabled: true,

    /**
     * Discover standings sources from Squadi static events (leagues only).
     * Tournaments (e.g., state champs) are excluded — no league standings.
     */
    discoverSources: async (engine) => {
      const sources = [];

      for (const evt of engine.adapter.discovery.staticEvents) {
        // Only leagues have standings
        if (evt.type !== 'league') continue;

        // Look up league UUID via source_entity_map
        const { rows: semRows } = await engine.pool.query(
          `SELECT sv_id FROM source_entity_map
           WHERE entity_type = 'league' AND source_platform = 'squadi' AND source_entity_id = $1
           LIMIT 1`,
          [evt.id]
        );

        // Also try leagues table directly
        if (semRows.length === 0) {
          const { rows: leagueRows } = await engine.pool.query(
            `SELECT id FROM leagues WHERE source_event_id = $1 AND source_platform = 'squadi' LIMIT 1`,
            [evt.id]
          );
          if (leagueRows.length === 0) continue; // League not in DB yet, skip
        }

        sources.push({
          id: evt.id,
          name: evt.name,
          league_source_id: evt.id, // source_entity_id in source_entity_map
          competitionId: evt.competitionId,
          competitionKey: evt.competitionKey,
          season: evt.year >= 2026 ? '2025-2026' : '2024-2025',
          snapshot_date: new Date().toISOString().split('T')[0],
        });
      }

      return sources;
    },

    /**
     * Scrape standings for a Squadi competition.
     * Step 1: Fetch all divisions for the competition
     * Step 2: For each division, fetch the ladder (standings) via REST API
     */
    scrapeSource: async (engine, source) => {
      const allStandings = [];
      const { competitionId, competitionKey, league_source_id, season } = source;
      const baseUrl = engine.adapter.baseUrl;

      // Step 1: Fetch divisions
      const divisionsUrl = `${baseUrl}/division?competitionId=${competitionId}`;
      let divisions;

      try {
        const response = await fetch(divisionsUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          console.log(`  Squadi divisions HTTP ${response.status} for competition ${competitionId}`);
          return [];
        }
        divisions = await response.json();
      } catch (err) {
        console.log(`  Squadi divisions error: ${err.message}`);
        return [];
      }

      if (!divisions || divisions.length === 0) return [];

      console.log(`  Found ${divisions.length} divisions for ${source.name}`);

      // Step 2: For each division, fetch the ladder
      for (let i = 0; i < divisions.length; i++) {
        const div = divisions[i];
        const divName = div.name || div.divisionName || `Division ${div.id}`;
        const { gender, ageGroup } = engine.adapter.transform.parseDivision(divName);

        const ladderUrl = `${baseUrl}/teams/ladder/v2?divisionIds=${div.id}&competitionKey=${competitionKey}&showForm=1&sportRefId=1`;

        try {
          const response = await fetch(ladderUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000),
          });

          if (!response.ok) {
            console.log(`  Division ${divName}: HTTP ${response.status}`);
            continue;
          }

          const data = await response.json();
          const ladders = data.ladders || [];

          for (const entry of ladders) {
            if (!entry.name) continue;

            allStandings.push({
              league_source_id,
              division: divName,
              team_name: entry.name,
              team_source_id: entry.teamUniqueKey || String(entry.id) || null,
              played: parseInt(entry.P, 10) || 0,
              wins: parseInt(entry.W, 10) || 0,
              losses: parseInt(entry.L, 10) || 0,
              draws: parseInt(entry.D, 10) || 0,
              goals_for: parseInt(entry.F, 10) || 0,
              goals_against: parseInt(entry.A, 10) || 0,
              points: parseInt(entry.PTS, 10) || 0,
              position: parseInt(entry.rk, 10) || null,
              age_group: ageGroup,
              gender,
              season,
            });
          }

        } catch (err) {
          console.log(`  Division ${divName} ladder error: ${err.message}`);
        }

        // Rate limit between divisions
        if (i < divisions.length - 1) {
          await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
        }
      }

      return allStandings;
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC
  // =========================================

  /**
   * Custom scraping function for Squadi REST API.
   * No browser needed — pure HTTP GET with JSON responses.
   */
  scrapeEvent: async (engine, event) => {
    const allMatches = [];
    const { competitionId, competitionKey, name: eventName, state } = event;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping Squadi: ${eventName}`);
    console.log(`Competition ID: ${competitionId}, Key: ${competitionKey}`);
    console.log(`${"=".repeat(60)}\n`);

    // Step 1: Fetch divisions for this competition
    const divisionsUrl = `${engine.adapter.baseUrl}/division?competitionId=${competitionId}`;
    console.log(`Fetching divisions: ${divisionsUrl}`);

    let divisions;
    try {
      const response = await fetch(divisionsUrl, {
        headers: {
          "User-Agent": engine.getRandomUserAgent(),
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        console.error(`ERROR: HTTP ${response.status} fetching divisions`);
        return [];
      }

      divisions = await response.json();
      console.log(`Found ${divisions.length} divisions\n`);
    } catch (error) {
      console.error(`ERROR fetching divisions: ${error.message}`);
      return [];
    }

    if (!divisions || divisions.length === 0) {
      console.log(`No divisions found for ${eventName}`);
      return [];
    }

    // Step 2: Fetch matches for each division
    for (let i = 0; i < divisions.length; i++) {
      const div = divisions[i];
      const divName = div.name || div.divisionName || `Division ${div.id}`;
      console.log(`   [${i + 1}/${divisions.length}] ${divName} (ID: ${div.id})`);

      const matchesUrl = `${engine.adapter.baseUrl}/round/matches?competitionId=${competitionId}&divisionId=${div.id}`;

      try {
        const response = await fetch(matchesUrl, {
          headers: {
            "User-Agent": engine.getRandomUserAgent(),
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          console.error(`      ERROR: HTTP ${response.status}`);
          continue;
        }

        const data = await response.json();
        const rounds = data.rounds || [];
        let divMatchCount = 0;

        for (const round of rounds) {
          const matches = round.matches || [];

          for (const m of matches) {
            // Extract team names
            const homeTeamName = m.team1?.name || null;
            const awayTeamName = m.team2?.name || null;

            if (!homeTeamName || !awayTeamName) continue;

            // Parse scores — null for unplayed
            const homeScore = (m.matchStatus === "ENDED" || m.matchStatus === "FORFEIT")
              ? engine.adapter.transform.parseScore(m.team1Score)
              : null;
            const awayScore = (m.matchStatus === "ENDED" || m.matchStatus === "FORFEIT")
              ? engine.adapter.transform.parseScore(m.team2Score)
              : null;

            // Parse date and time from ISO startTime
            const matchDate = engine.adapter.transform.parseDate(m.startTime);
            const matchTime = engine.adapter.transform.parseTime(m.startTime);

            // Parse division metadata
            const { gender, ageGroup } = engine.adapter.transform.parseDivision(divName);

            // Determine match status
            let status = "scheduled";
            if (m.matchStatus === "ENDED" || m.matchStatus === "FORFEIT") {
              status = "completed";
            } else if (m.matchStatus === "STARTED") {
              status = "in_progress";
            }

            allMatches.push({
              eventId: event.id,
              eventName,
              matchId: String(m.id),
              matchDate,
              matchTime,
              homeTeamName,
              awayTeamName,
              homeScore,
              awayScore,
              homeId: m.team1Id ? String(m.team1Id) : null,
              awayId: m.team2Id ? String(m.team2Id) : null,
              status,
              location: m.venueCourt?.venue?.name || m.venueCourt?.name || null,
              division: divName,
              gender,
              ageGroup,
              raw_data: {
                squadi_match_id: m.id,
                squadi_team1_id: m.team1Id,
                squadi_team2_id: m.team2Id,
                squadi_team1_key: m.team1?.teamUniqueKey,
                squadi_team2_key: m.team2?.teamUniqueKey,
                round_name: round.name,
                round_sequence: round.sequence,
                match_status: m.matchStatus,
                result_status: m.resultStatus,
                competition_id: competitionId,
              },
            });

            divMatchCount++;
          }
        }

        console.log(`      ${divMatchCount} matches`);
      } catch (error) {
        console.error(`      ERROR: ${error.message}`);
      }

      // Rate limiting between divisions
      if (i < divisions.length - 1) {
        await new Promise(resolve =>
          setTimeout(resolve, engine.adapter.rateLimiting.iterationDelay)
        );
      }
    }

    // Deduplicate by match ID
    const uniqueMatches = Array.from(
      new Map(allMatches.map((m) => [m.matchId, m])).values()
    );

    console.log(`\n   Total: ${uniqueMatches.length} unique matches`);
    return uniqueMatches.filter((m) => engine.adapter.dataPolicy.isValidMatch(m));
  },
};
