/**
 * AthleteOne Source Adapter v1.0
 * ================================
 *
 * Session 113: Built for STXCL (South Texas Champions League) ECNL-RL leagues.
 *
 * PLATFORM OVERVIEW:
 * - AthleteOne is a youth sports management platform (athleteone.com)
 * - Built on TGS (TotalGlobalSports) infrastructure — club logos from images.totalglobalsports.com
 * - React SPA frontend with clean unauthenticated REST API
 * - Used by: STXCL (South Texas Champions League — thestxcl.com)
 *
 * DATA ACCESS ARCHITECTURE:
 *
 * 1. Division/Flight Discovery (JSON):
 *    GET api.athleteone.com/api/Event/get-event-schedule-or-standings-athleteone/{eventId}
 *    Returns: { girlsDivAndFlightList: [...], boysDivAndFlightList: [...] }
 *    Each division has: { divisionID, divisionName, divisionGender, flightList: [...] }
 *    Each flight has: { flightID, flightName, teamsCount, hasActiveSchedule }
 *
 * 2. Schedule (Matches) per Flight (JSON):
 *    GET api.athleteone.com/api/Event/get-schedules-by-flight/{eventId}/{flightId}/0
 *    Returns: Array of matches with matchID, gameDate, homeTeam, awayTeam, scores
 *
 * 3. Event Details (JSON):
 *    GET api.athleteone.com/api/team/get-event-details-by-eventID/{eventId}
 *    Returns: { name, startDate, endDate, city, stateID, gender, ... }
 *
 * 4. Standings per Flight (JSON) — for standings scraper:
 *    GET api.athleteone.com/api/Event/get-standings-by-div-and-flight/{divId}/{flightId}/{eventId}
 *    Returns: Array of { flightGroupID, flightGroupName, teamStandings: [...] }
 *    Each teamStanding has: { teamID, teamName, win, loss, draw, point, ppg, gfTotal, gaTotal }
 *
 * TECHNOLOGY: api (pure REST, no browser needed)
 *
 * EVENTS SUPPORTED:
 * - 3979: ECNL RL Girls STXCL 2025-26 (South Texas, TX)
 * - 3973: ECNL RL Boys STXCL 2025-26 (South Texas, TX)
 * - 4184: Eastern Conference League 2025-26 (STXCL, TX)
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "athleteone",
  name: "AthleteOne",
  baseUrl: "https://api.athleteone.com/api",

  // =========================================
  // TECHNOLOGY
  // =========================================

  /** Pure REST API — no browser, no HTML parsing */
  technology: "api",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    requestDelayMin: 500,
    requestDelayMax: 1200,
    iterationDelay: 400,   // Between flights
    itemDelay: 1500,       // Between events
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
    /** Division and flight discovery */
    divisionFlights: "/Event/get-event-schedule-or-standings-athleteone/{eventId}",
    /** Match schedule per flight — last param 0 = all rounds */
    schedules: "/Event/get-schedules-by-flight/{eventId}/{flightId}/0",
    /** Event metadata */
    eventDetails: "/team/get-event-details-by-eventID/{eventId}",
    /** Standings per flight (for standings scraper) */
    standings: "/Event/get-standings-by-div-and-flight/{divisionId}/{flightId}/{eventId}",
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "athleteone-{eventId}-{matchId}",

  // =========================================
  // STATIC EVENTS
  // =========================================

  discovery: {
    /**
     * STXCL (South Texas Champions League) events on AthleteOne.
     * Event IDs discovered via probe (Session 113).
     */
    staticEvents: [
      // ECNL Regional League — Girls (U12G–U19G)
      {
        id: "athleteone-stxcl-girls-2025-26",
        name: "ECNL RL Girls STXCL 2025-26",
        type: "league",
        year: 2026,
        athleteOneEventId: 3979,
        state: "TX",
      },
      // ECNL Regional League — Boys (U12B–U19B)
      {
        id: "athleteone-stxcl-boys-2025-26",
        name: "ECNL RL Boys STXCL 2025-26",
        type: "league",
        year: 2026,
        athleteOneEventId: 3973,
        state: "TX",
      },
      // Eastern Conference League (ECL) — developmental league under STXCL
      {
        id: "athleteone-stxcl-ecl-2025-26",
        name: "Eastern Conference League 2025-26",
        type: "league",
        year: 2026,
        athleteOneEventId: 4184,
        state: "TX",
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
     * Parse gender from division name or API gender field.
     * AthleteOne uses 'f'/'m' in divisionGender field.
     * Division names: "G2008/2007" (girls by birth year), "B2010" (boys)
     */
    parseGender: (divisionGender, divisionName) => {
      if (divisionGender === 'f' || divisionGender === 'F') return 'Girls';
      if (divisionGender === 'm' || divisionGender === 'M') return 'Boys';
      if (!divisionName) return null;
      const lower = divisionName.toLowerCase();
      if (lower.startsWith('g') || lower.includes('girl') || lower.includes('female')) return 'Girls';
      if (lower.startsWith('b') || lower.includes('boy') || lower.includes('male')) return 'Boys';
      return null;
    },

    /**
     * Parse age group from AthleteOne division name.
     * Formats: "G2008/2007", "G2009", "B2012", "G2008"
     * Birth year → age group: 2026 - birthYear = age
     * E.g., G2012 → 2026-2012 = U14
     */
    parseAgeGroup: (divisionName) => {
      if (!divisionName) return null;
      // "G2009" or "B2010" or "G2008/2007" (use first year)
      const birthYearMatch = divisionName.match(/(\d{4})/);
      if (birthYearMatch) {
        const birthYear = parseInt(birthYearMatch[1]);
        if (birthYear >= 2000 && birthYear <= 2020) {
          const age = 2026 - birthYear;
          return `U${age}`;
        }
      }
      // Fallback: U-prefix format
      const uMatch = divisionName.match(/U[-]?(\d+)/i);
      if (uMatch) return `U${uMatch[1]}`;
      return null;
    },

    /**
     * Parse AthleteOne date format.
     * Format: "2026-04-10T19:00:00" (ISO datetime, local time)
     */
    parseDate: (dateStr) => {
      if (!dateStr) return null;
      try {
        // Take date part only (before T)
        return dateStr.split('T')[0];
      } catch {
        return null;
      }
    },

    /**
     * Parse match time.
     * Format: "19:00:00" → "19:00"
     */
    parseTime: (timeStr) => {
      if (!timeStr) return null;
      const match = timeStr.match(/^(\d{2}:\d{2})/);
      return match ? match[1] : null;
    },

    /**
     * Parse score from AthleteOne.
     * Null or undefined if match not played yet.
     */
    parseScore: (score) => {
      if (score === null || score === undefined) return null;
      const num = parseInt(score);
      return isNaN(num) ? null : num;
    },

    inferState: (event) => event?.state || "TX",
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".athleteone_checkpoint.json",
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
      return true;
    },
  },

  // =========================================
  // STANDINGS SCRAPING (Session 113)
  // Universal pattern: discoverSources() + scrapeSource()
  // Uses: GET /Event/get-standings-by-div-and-flight/{divId}/{flightId}/{eventId}
  // =========================================

  standings: {
    enabled: true,

    discoverSources: async (engine) => {
      const sources = [];
      for (const evt of engine.adapter.discovery.staticEvents) {
        if (evt.type !== 'league') continue;

        // Check if league exists in DB via source_entity_map or leagues table
        const { rows: leagueRows } = await engine.pool.query(
          `SELECT id FROM leagues WHERE source_event_id = $1 LIMIT 1`,
          [evt.id]
        );
        if (leagueRows.length === 0) continue;

        sources.push({
          id: evt.id,
          name: evt.name,
          league_source_id: evt.id,
          athleteOneEventId: evt.athleteOneEventId,
          snapshot_date: new Date().toISOString().split('T')[0],
        });
      }
      return sources;
    },

    scrapeSource: async (engine, source) => {
      const allStandings = [];
      const { athleteOneEventId, league_source_id } = source;
      const baseUrl = engine.adapter.baseUrl;

      // Step 1: Discover divisions and flights
      const divUrl = `${baseUrl}/Event/get-event-schedule-or-standings-athleteone/${athleteOneEventId}`;
      let divData;
      try {
        const res = await fetch(divUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Origin': 'https://app.athleteone.com' }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) return [];
        const json = await res.json();
        divData = json.data;
      } catch (err) {
        console.log(`  Error fetching divisions: ${err.message}`);
        return [];
      }

      const allDivisions = [
        ...(divData.girlsDivAndFlightList || []),
        ...(divData.boysDivAndFlightList || []),
      ];

      for (const div of allDivisions) {
        const gender = engine.adapter.transform.parseGender(div.divisionGender, div.divisionName);
        const ageGroup = engine.adapter.transform.parseAgeGroup(div.divisionName);

        for (const flight of (div.flightList || [])) {
          if (!flight.hasActiveSchedule) continue;

          const standingsUrl = `${baseUrl}/Event/get-standings-by-div-and-flight/${div.divisionID}/${flight.flightID}/${athleteOneEventId}`;
          try {
            const res = await fetch(standingsUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Origin': 'https://app.athleteone.com' }, signal: AbortSignal.timeout(10000) });
            if (!res.ok) continue;
            const json = await res.json();
            const groups = json.data || [];

            for (const group of groups) {
              const teamStandings = group.teamStandings || [];
              for (let pos = 0; pos < teamStandings.length; pos++) {
                const ts = teamStandings[pos];
                if (!ts.teamName) continue;
                allStandings.push({
                  league_source_id,
                  division: `${div.divisionName} - ${flight.flightName}`,
                  team_name: ts.teamName,
                  team_source_id: String(ts.teamID),
                  played: (ts.win || 0) + (ts.loss || 0) + (ts.draw || 0),
                  wins: ts.win || 0,
                  losses: ts.loss || 0,
                  draws: ts.draw || 0,
                  goals_for: ts.gfTotal || null,
                  goals_against: ts.gaTotal || null,
                  points: ts.point || 0,
                  position: pos + 1,
                  age_group: ageGroup,
                  gender,
                  season: '2025-2026',
                });
              }
            }
          } catch (err) {
            console.log(`  Standings error for flight ${flight.flightID}: ${err.message}`);
          }

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
   * Custom scraping function for AthleteOne REST API.
   * No browser needed — pure HTTP GET with JSON responses.
   *
   * Flow per event:
   *   1. Fetch division/flight list
   *   2. For each flight with hasActiveSchedule=true, fetch schedule
   *   3. Extract matches, convert to SoccerView format
   */
  scrapeEvent: async (engine, event) => {
    const allMatches = [];
    const { athleteOneEventId, name: eventName, state } = event;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping AthleteOne: ${eventName}`);
    console.log(`Event ID: ${athleteOneEventId}`);
    console.log(`${"=".repeat(60)}\n`);

    // Step 1: Discover divisions and flights
    const baseUrl = engine.adapter.baseUrl;
    const divUrl = `${baseUrl}/Event/get-event-schedule-or-standings-athleteone/${athleteOneEventId}`;
    console.log(`Fetching divisions: ${divUrl}`);

    let divData;
    try {
      const res = await fetch(divUrl, {
        headers: {
          'User-Agent': engine.getRandomUserAgent(),
          'Accept': 'application/json',
          'Origin': 'https://app.athleteone.com',
          'Referer': `https://app.athleteone.com/public/event/${athleteOneEventId}/schedules-standings`,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.log(`  HTTP ${res.status} for event ${athleteOneEventId}`);
        return [];
      }
      const json = await res.json();
      divData = json.data;
    } catch (err) {
      console.log(`  Error fetching divisions: ${err.message}`);
      return [];
    }

    const allDivisions = [
      ...(divData.girlsDivAndFlightList || []),
      ...(divData.boysDivAndFlightList || []),
    ];

    console.log(`Found ${allDivisions.length} divisions`);

    // Step 2: For each division, iterate flights
    for (const div of allDivisions) {
      const gender = engine.adapter.transform.parseGender(div.divisionGender, div.divisionName);
      const ageGroup = engine.adapter.transform.parseAgeGroup(div.divisionName);

      const activeFlights = (div.flightList || []).filter(f => f.hasActiveSchedule && f.teamsCount > 0);

      for (const flight of activeFlights) {
        const schedUrl = `${baseUrl}/Event/get-schedules-by-flight/${athleteOneEventId}/${flight.flightID}/0`;

        let matches;
        try {
          const res = await fetch(schedUrl, {
            headers: {
              'User-Agent': engine.getRandomUserAgent(),
              'Accept': 'application/json',
              'Origin': 'https://app.athleteone.com',
              'Referer': `https://app.athleteone.com/public/event/${athleteOneEventId}/schedules-standings/schedules/${flight.flightID}`,
            },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) {
            console.log(`  Flight ${flight.flightName} HTTP ${res.status}`);
            await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
            continue;
          }
          const json = await res.json();
          matches = json.data || [];
        } catch (err) {
          console.log(`  Flight ${flight.flightName} error: ${err.message}`);
          await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
          continue;
        }

        console.log(`  ${div.divisionName} - ${flight.flightName}: ${matches.length} matches`);

        for (const m of matches) {
          if (!m.homeTeam || !m.awayTeam) continue;
          if (m.homeTeam === m.awayTeam) continue;

          const matchDate = engine.adapter.transform.parseDate(m.gameDate);
          if (!matchDate) continue;

          const homeScore = engine.adapter.transform.parseScore(m.hometeamscore);
          const awayScore = engine.adapter.transform.parseScore(m.awayteamscore);

          allMatches.push({
            matchDate,
            matchTime: engine.adapter.transform.parseTime(m.gameTime),
            homeTeamName: engine.adapter.transform.normalizeTeamName(m.homeTeam),
            awayTeamName: engine.adapter.transform.normalizeTeamName(m.awayTeam),
            homeScore,
            awayScore,
            gender,
            ageGroup,
            // division: coreScraper uses ageGroup+gender fallback — set explicit division name for clarity
            division: `${div.divisionName} - ${flight.flightName}`,
            state: engine.adapter.transform.inferState(event),
            // eventId must be just the numeric string so generateMatchKey produces: athleteone-{3979}-{matchId}
            eventId: String(athleteOneEventId),
            eventName,
            // matchId (lowercase) is what generateMatchKey uses for {matchId} template
            matchId: m.matchID ? String(m.matchID) : null,
            // homeId/awayId is what coreScraper uses for source_home_team_id/source_away_team_id
            homeId: m.hometeamID ? String(m.hometeamID) : null,
            awayId: m.awayteamID ? String(m.awayteamID) : null,
            status: m.status,
          });
        }

        // Rate limit between flights
        await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
      }
    }

    console.log(`\nTotal matches scraped: ${allMatches.length}`);
    return allMatches;
  },
};
