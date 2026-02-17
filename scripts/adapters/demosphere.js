/**
 * Demosphere/OttoSport Adapter v2.0
 * ==================================
 *
 * Session 103: Built for National Capital Soccer League (NCSL) VA/DC
 *
 * PLATFORM OVERVIEW:
 * - Demosphere is rebranding to "OTTO SPORT AI" (ottosport.ai)
 * - Legacy widget system (elements.demosphere.com) remains active
 * - Provides STRUCTURED DATA via .js (JSON) and .xml endpoints
 *
 * DATA ACCESS ARCHITECTURE:
 *
 * 1. Schedule Data (JSON endpoint):
 *    URL: elements.demosphere-secure.com/{orgId}/schedules/{seasonName}/{divisionId}.js
 *    Returns: Pure JSON with match data
 *    ACTUAL API FORMAT (verified):
 *    {
 *      "115422580": {
 *        "dt": "14-SEP-2025",                      // Date (DD-MMM-YYYY)
 *        "tim": "30-DEC-1899 12:00:00.0000",      // Time (weird date prefix + HH:MM:SS)
 *        "tm1": "111206599",                      // Home/Team 1 ID
 *        "tm2": "92725281",                       // Away/Team 2 ID
 *        "sc1": "2",                              // Home/Team 1 score (or "" for unplayed)
 *        "sc2": "3",                              // Away/Team 2 score (or "" for unplayed)
 *        "facn": "South Run Park #6"              // Facility name (location)
 *      }
 *    }
 *    NOTE: Team names NOT included in JSON - must resolve via standings or source_entity_map
 *
 * 2. Standings Data (XML endpoint):
 *    URL: elements.demosphere-secure.com/{orgId}/standings/{seasonKey}/{divisionId}.xml
 *    Returns: Structured XML with standings
 *    <teams>
 *      <teamgroup key="115189283" name="GU16 Division 3">
 *        <team key="111234700" name="Team Name" rank="1">
 *          <td>22</td>  <!-- Points -->
 *          <td>9</td>   <!-- Games Played -->
 *          <td>7</td>   <!-- Wins -->
 *        </team>
 *      </teamgroup>
 *    </teams>
 *
 * 3. Division Discovery (HTML):
 *    URL: elements.demosphere-secure.com/{orgId}/schedules/index_E.html
 *    Returns: HTML with links to division schedule pages
 *
 * TECHNOLOGY: Cheerio (no browser needed - server-rendered data)
 *
 * ORGANIZATIONS SUPPORTED:
 * - NCSL (National Capital Soccer League) - VA/DC/MD: org ID 80738
 * - Future: Can add other Demosphere leagues by adding org IDs
 */

import * as cheerio from "cheerio";

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "demosphere",
  name: "Demosphere/OttoSport Platform",
  baseUrl: "https://elements.demosphere-secure.com",

  // =========================================
  // TECHNOLOGY
  // =========================================

  technology: "cheerio",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    requestDelayMin: 800,
    requestDelayMax: 1500,
    iterationDelay: 600,
    itemDelay: 2000,
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  ],

  // =========================================
  // ENDPOINTS
  // =========================================

  endpoints: {
    // Division listing page
    scheduleIndex: "/{orgId}/schedules/index_E.html",

    // Schedule JSON endpoint (the key data source)
    scheduleData: "/{orgId}/schedules/{seasonName}/{divisionId}.js",

    // Standings XML endpoint
    standingsData: "/{orgId}/standings/{seasonKey}/{divisionId}.xml",

    // Team roster/schedule widget
    teamPage: "/{orgId}/teams/{seasonKey}/{teamKey}-{groupKey}/TEAM.html",
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "demosphere-{eventId}-{matchId}",

  // =========================================
  // STATIC EVENTS (NCSL)
  // =========================================

  discovery: {
    /**
     * StaticEvents for Demosphere-powered leagues.
     * Division IDs discovered via range probing (Session 103).
     * Fall 2025: 286 divisions, ~14,750 matches
     * Spring 2025: 322 divisions, ~17,539 matches
     */
    staticEvents: [
      {
        id: "80738-fall2025",
        orgId: "80738",
        name: "NCSL Travel Fall 2025",
        seasonName: "Fall2025",
        seasonKey: "115189101",
        type: "league",
        year: 2026,
        state: "VA", // Primary state (also covers DC, MD)
        divisions: [115189100,115189110,115189119,115189120,115189121,115189122,115189123,115189124,115189125,115189126,115189127,115189128,115189130,115189139,115189140,115189149,115189159,115189160,115189169,115189170,115189179,115189188,115189189,115189191,115189192,115189193,115189194,115189195,115189196,115189197,115189198,115189199,115189200,115189201,115189202,115189203,115189204,115189205,115189206,115189207,115189208,115189209,115189210,115189211,115189212,115189213,115189214,115189215,115189216,115189217,115189218,115189219,115189220,115189221,115189222,115189223,115189224,115189225,115189226,115189227,115189228,115189229,115189230,115189231,115189232,115189233,115189234,115189235,115189236,115189237,115189238,115189239,115189240,115189241,115189242,115189243,115189245,115189246,115189247,115189248,115189249,115189250,115189251,115189252,115189253,115189254,115189255,115189256,115189257,115189258,115189259,115189260,115189261,115189262,115189263,115189264,115189265,115189266,115189267,115189268,115189269,115189270,115189271,115189272,115189273,115189274,115189275,115189276,115189277,115189278,115189280,115189281,115189282,115189283,115189284,115189285,115189286,115189287,115189288,115189290,115189291,115189292,115189293,115189294,115189295,115189296,115189300,115189301,115189302,115189303,115189304,115189305,115189306,115189307,115189308,115189309,115189310,115189311,115189312,115189313,115189314,115189315,115189316,115189317,115189318,115189319,115189320,115189321,115189322,115189323,115189324,115189325,115189326,115189327,115189328,115189329,115189330,115189331,115189332,115189333,115189334,115189335,115189336,115189337,115189338,115189339,115189340,115189341,115189343,115189344,115189356,115189360,115189362,115189364,115189365,115189366,115189367,115189368,115189369,115189370,115189371,115189372,115189373,115189374,115189375,115189376,115189377,115189378,115189381,115189382,115189383,115189384,115189385,115189386,115189387,115189389,115189391,115189392,115189393,115189394,115189395,115189396,115189397,115189398,115189399,115189400,115189401,115189402,115189403,115189404,115189405,115189406,115189407,115189408,115189409,115189410,115189411,115189412,115189413,115189414,115189415,115189416,115189417,115189418,115189419,115189420,115189421,115189422,115189423,115189424,115189425,115189426,115189427,115189428,115189429,115189430,115189431,115189432,115189433,115189434,115189435,115189436,115189437,115189438,115189439,115189440,115189441,115189443,115189444,115189456,115189460,115189462,115189464,115189465,115189466,115189467,115189468,115189469,115189470,115189471,115189472,115189473,115189474,115189475,115189476,115189477,115189478,115189481,115189482,115189483,115189484,115189485,115189486,115189487,115189488,115189489,115189491,115189492,115189493,115189494,115189495,115189496,115189497,115189498,115189499,115189500],
      },
      {
        id: "80738-spring2025",
        orgId: "80738",
        name: "NCSL Travel Spring 2025",
        seasonName: "Spring2025",
        seasonKey: "114346054",
        type: "league",
        year: 2025,
        state: "VA",
        divisions: [114346008,114346009,114346010,114346011,114346012,114346013,114346014,114346015,114346016,114346017,114346018,114346028,114346029,114346038,114346039,114346048,114346049,114346059,114346068,114346069,114346078,114346079,114346080,114346082,114346083,114346084,114346086,114346087,114346089,114346090,114346091,114346092,114346093,114346094,114346095,114346096,114346097,114346098,114346099,114346100,114346101,114346102,114346103,114346104,114346105,114346106,114346107,114346108,114346109,114346110,114346111,114346112,114346113,114346114,114346115,114346116,114346117,114346118,114346119,114346120,114346121,114346122,114346123,114346124,114346125,114346126,114346127,114346128,114346129,114346130,114346131,114346132,114346133,114346134,114346135,114346136,114346137,114346138,114346139,114346140,114346141,114346142,114346143,114346144,114346145,114346146,114346147,114346148,114346149,114346150,114346151,114346152,114346153,114346154,114346155,114346156,114346157,114346158,114346159,114346160,114346161,114346162,114346163,114346164,114346165,114346166,114346167,114346168,114346169,114346170,114346171,114346172,114346173,114346174,114346175,114346176,114346177,114346179,114346180,114346181,114346182,114346183,114346184,114346185,114346186,114346190,114346191,114346192,114346193,114346194,114346195,114346196,114346197,114346200,114346201,114346202,114346203,114346204,114346205,114346206,114346207,114346208,114346209,114346210,114346211,114346212,114346213,114346214,114346215,114346216,114346217,114346218,114346219,114346220,114346221,114346222,114346223,114346224,114346225,114346226,114346227,114346228,114346229,114346230,114346231,114346232,114346233,114346234,114346235,114346236,114346237,114346238,114346239,114346240,114346241,114346242,114346243,114346244,114346245,114346246,114346247,114346248,114346249,114346250,114346251,114346252,114346253,114346254,114346255,114346256,114346257,114346258,114346259,114346260,114346261,114346262,114346263,114346264,114346265,114346266,114346267,114346268,114346269,114346270,114346271,114346272,114346273,114346274,114346275,114346276,114346277,114346282,114346283,114346284,114346286,114346287,114346289,114346290,114346291,114346292,114346293,114346294,114346295,114346296,114346297,114346298,114346299,114346300,114346301,114346302,114346303,114346304,114346305,114346306,114346307,114346308,114346309,114346310,114346311,114346312,114346313,114346314,114346315,114346316,114346317,114346318,114346319,114346320,114346321,114346322,114346323,114346324,114346325,114346326,114346327,114346328,114346329,114346330,114346331,114346332,114346333,114346334,114346335,114346336,114346337,114346338,114346339,114346340,114346341,114346342,114346343,114346344,114346345,114346346,114346347,114346348,114346349,114346350,114346351,114346352,114346353,114346354,114346355,114346356,114346357,114346358,114346359,114346360,114346361,114346362,114346363,114346364,114346365,114346366,114346367,114346368,114346369,114346370,114346371,114346372,114346373,114346374,114346375,114346376,114346377,114346382,114346383,114346384,114346386,114346387,114346389,114346390,114346391,114346392,114346393,114346394,114346395,114346396,114346397,114346398,114346399,114346400],
      },
    ],
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
     * Parse Demosphere division names.
     * Examples: "GU16 Division 3", "BU14 Premier", "Girls U13 Div 1"
     */
    parseDivision: (divisionText) => {
      if (!divisionText) return { gender: null, ageGroup: null };

      let gender = null;
      const lower = divisionText.toLowerCase();

      // Check for gender indicators
      if (lower.includes("girls") || /\bgu\d+/i.test(divisionText)) {
        gender = "Girls";
      } else if (lower.includes("boys") || /\bbu\d+/i.test(divisionText)) {
        gender = "Boys";
      }

      // Extract age group (U13, U14, etc.)
      let ageGroup = null;
      const ageMatch = divisionText.match(/u[-]?(\d+)/i);
      if (ageMatch) {
        ageGroup = `U${ageMatch[1]}`;
      }

      return { gender, ageGroup };
    },

    /**
     * NCSL is VA/DC/MD. Primary state is VA, but teams can be from DC or MD.
     * State will be inferred from team name if possible.
     */
    inferState: () => "VA",

    /**
     * Parse Demosphere date format: "14-SEP-2025"
     * Format is consistent: DD-MMM-YYYY
     */
    parseDate: (dateStr) => {
      if (!dateStr) return null;

      try {
        // Demosphere format: "14-SEP-2025"
        const monthMap = {
          JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
          JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
        };

        const match = dateStr.match(/(\d+)-([A-Z]{3})-(\d{4})/i);
        if (!match) return null;

        const day = parseInt(match[1]);
        const monthAbbr = match[2].toUpperCase();
        const year = parseInt(match[3]);

        const month = monthMap[monthAbbr];
        if (month === undefined) return null;

        const date = new Date(year, month, day);
        if (isNaN(date.getTime())) return null;

        return date.toISOString().split("T")[0];
      } catch {
        return null;
      }
    },

    /**
     * Parse time: "16:00" or "4:00 pm"
     */
    parseTime: (timeStr) => {
      if (!timeStr) return null;

      // Already in 24-hour format (16:00)
      if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
        return timeStr.padStart(5, "0");
      }

      // 12-hour format with am/pm
      const match = timeStr.match(/(\d+):(\d+)\s*(am|pm)/i);
      if (match) {
        let hours = parseInt(match[1]);
        const minutes = match[2];
        const meridian = match[3].toLowerCase();

        if (meridian === "pm" && hours !== 12) hours += 12;
        if (meridian === "am" && hours === 12) hours = 0;

        return `${hours.toString().padStart(2, "0")}:${minutes}`;
      }

      return null;
    },

    /**
     * Parse score: Can be "2" / "3" (separate fields) or null for unplayed
     */
    parseScore: (scoreStr) => {
      if (!scoreStr || scoreStr === "" || scoreStr === "vs") return null;
      const score = parseInt(scoreStr);
      return isNaN(score) ? null : score;
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".demosphere_checkpoint.json",
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    minDate: "2023-08-01",
    maxFutureDate: null, // Allow future scheduled matches

    isValidMatch: (match) => {
      // Demosphere uses placeholder team names (DEMOSPHERE_TEAM_{id})
      // Note: CoreScraper uses camelCase property names (homeTeamName, awayTeamName)
      if (!match.homeTeamName || !match.awayTeamName) return false;
      if (match.homeTeamName === match.awayTeamName) return false;

      return true;
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC
  // =========================================

  /**
   * Custom scraping function for Demosphere.
   * Uses JSON endpoints for schedule data.
   *
   * ACTUAL JSON FORMAT (verified):
   * {
   *   "matchId": {
   *     "dt": "14-SEP-2025",                         // Date
   *     "tim": "30-DEC-1899 12:00:00.0000",         // Time (weird date prefix)
   *     "tm1": "teamId1",                           // Home team ID
   *     "tm2": "teamId2",                           // Away team ID
   *     "sc1": "2",                                 // Home score (or "" for unplayed)
   *     "sc2": "3",                                 // Away score (or "" for unplayed)
   *     "facn": "Field Name"                        // Location
   *   }
   * }
   */
  scrapeEvent: async (engine, event) => {
    const { orgId, seasonName, name: eventName, divisions: configuredDivisions } = event;
    const allMatches = [];

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping Demosphere Event: ${eventName}`);
    console.log(`Org ID: ${orgId}, Season: ${seasonName}`);
    console.log(`${"=".repeat(60)}\n`);

    // Use divisions from event config (no discovery needed - index_E.html 404s)
    const divisions = (configuredDivisions || []).map(id => ({ id: String(id) }));

    if (divisions.length === 0) {
      console.log(`ERROR: No divisions configured for event ${event.id}`);
      console.log(`Add divisions array to event config in staticEvents`);
      return allMatches;
    }

    console.log(`Processing ${divisions.length} configured division(s)`);

    // Scrape each division's schedule data (JSON endpoint)
    for (let i = 0; i < divisions.length; i++) {
      const division = divisions[i];
      console.log(`\n--- Division ${i + 1}/${divisions.length}: ${division.id} ---`);

      const scheduleUrl = `${engine.adapter.baseUrl}/${orgId}/schedules/${seasonName}/${division.id}.js`;
      console.log(`Fetching schedule JSON: ${scheduleUrl}`);

      try {
        // Use native fetch for JSON endpoint
        const response = await fetch(scheduleUrl);

        if (!response.ok) {
          console.log(`ERROR: HTTP ${response.status} ${response.statusText}`);
          continue;
        }

        const jsonText = await response.text();
        let jsonData;

        // Parse JSON response
        try {
          jsonData = JSON.parse(jsonText);
        } catch (parseError) {
          console.log(`ERROR parsing JSON: ${parseError.message}`);
          continue;
        }

        // jsonData is an object with match IDs as keys
        const matchIds = Object.keys(jsonData);
        console.log(`Found ${matchIds.length} matches in JSON`);

        for (const matchId of matchIds) {
          const matchData = jsonData[matchId];

          // CORRECTED FIELD NAMES (actual API format):
          // tm1/tm2 (not htm/vtm), sc1/sc2 (not hsc/vsc), dt (not dtsd), tim with date prefix, facn (location)

          // Parse match data with ACTUAL field names
          const matchDate = engine.adapter.transform.parseDate(matchData.dt);

          // Parse time - strip the "30-DEC-1899 " prefix and extract HH:MM
          let matchTime = null;
          if (matchData.tim) {
            // Format: "30-DEC-1899 12:00:00.0000" -> extract "12:00"
            const timeMatch = matchData.tim.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch) {
              const hours = timeMatch[1].padStart(2, '0');
              const minutes = timeMatch[2];
              matchTime = `${hours}:${minutes}`;
            }
          }

          const homeScore = engine.adapter.transform.parseScore(matchData.sc1);
          const awayScore = engine.adapter.transform.parseScore(matchData.sc2);

          // Team IDs from tm1/tm2 fields
          const homeTeamId = matchData.tm1;
          const awayTeamId = matchData.tm2;

          // Skip if missing team IDs
          if (!homeTeamId || !awayTeamId) {
            console.log(`SKIP: Match ${matchId} missing team IDs`);
            continue;
          }

          // CoreScraper engine expects camelCase property names
          const match = {
            matchId,
            eventId: event.id,
            eventName,
            matchDate,
            matchTime,
            homeTeamName: `DEMOSPHERE_TEAM_${homeTeamId}`,
            awayTeamName: `DEMOSPHERE_TEAM_${awayTeamId}`,
            homeScore,
            awayScore,
            location: matchData.facn || null,
            division: division.id, // Store division ID since we don't have name yet
            gender: null, // Will be inferred from team names or standings
            ageGroup: null, // Will be inferred from team names or standings
            homeId: homeTeamId, // For source_entity_map resolution
            awayId: awayTeamId, // For source_entity_map resolution
            state: event.state,
          };

          // Validation - skip if same team or missing data
          if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) {
            if (homeTeamId === awayTeamId) {
              console.log(`SKIP: Match ${matchId} has same team ID for both teams`);
            }
          } else {
            allMatches.push(match);
          }
        }

        console.log(`Processed ${matchIds.length} matches from division ${division.id}`);

      } catch (error) {
        console.log(`ERROR scraping division ${division.id}: ${error.message}`);
      }

      // Rate limiting between divisions
      if (i < divisions.length - 1) {
        await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Total matches scraped: ${allMatches.length}`);
    console.log(`${"=".repeat(60)}\n`);

    return allMatches;
  },

  /**
   * Scrape standings data from XML endpoint.
   * This is a separate function called by the universal scrapeStandings.js engine.
   */
  scrapeStandings: async (engine, event) => {
    const { orgId, seasonKey, seasonName, name: eventName } = event;
    const allStandings = [];

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scraping Demosphere Standings: ${eventName}`);
    console.log(`Org ID: ${orgId}, Season Key: ${seasonKey}`);
    console.log(`${"=".repeat(60)}\n`);

    // First, discover divisions (same as schedule scraping)
    const indexUrl = `${engine.adapter.baseUrl}/${orgId}/schedules/index_E.html`;
    let divisions = [];

    try {
      // Use engine.fetchWithCheerio which returns { $, html, status, error }
      const { $, error } = await engine.fetchWithCheerio(indexUrl);
      if (error) {
        console.log(`ERROR fetching index: ${error}`);
        return allStandings;
      }

      $('a[href*="/schedules/"]').each((_, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();

        const match = href.match(/\/schedules\/([^/]+)\/(\d+)(?:\.(\d+))?\.html/);
        if (match && (!seasonName || match[1] === seasonName)) {
          const divisionId = match[2];
          const subDivisionId = match[3] || null;
          const fullDivisionId = subDivisionId ? `${divisionId}.${subDivisionId}` : divisionId;

          divisions.push({
            id: fullDivisionId,
            name: text,
          });
        }
      });

      console.log(`Found ${divisions.length} divisions for standings`);
    } catch (error) {
      console.log(`ERROR discovering divisions: ${error.message}`);
      return allStandings;
    }

    // Scrape standings XML for each division
    for (let i = 0; i < divisions.length; i++) {
      const division = divisions[i];
      const standingsUrl = `${engine.adapter.baseUrl}/${orgId}/standings/${seasonKey}/${division.id}.xml`;
      console.log(`\n--- Division ${i + 1}/${divisions.length}: ${division.name} (${division.id}) ---`);
      console.log(`Fetching standings XML: ${standingsUrl}`);

      try {
        // Use native fetch for XML endpoint
        const response = await fetch(standingsUrl);

        if (!response.ok) {
          console.log(`ERROR: HTTP ${response.status} ${response.statusText}`);
          continue;
        }

        const xmlText = await response.text();

        // Parse XML with cheerio in XML mode
        const $ = cheerio.load(xmlText, { xmlMode: true });

        // Parse XML structure
        $("teamgroup").each((_, tgEl) => {
          const teamGroupName = $(tgEl).attr("name");

          $(tgEl).find("team").each((_, teamEl) => {
            const teamName = $(teamEl).attr("name");
            const teamKey = $(teamEl).attr("key");
            const rank = parseInt($(teamEl).attr("rank")) || null;

            // Parse stats from <td> elements
            const statCells = $(teamEl).find("td");
            const stats = {
              points: parseInt($(statCells[0]).text()) || 0,
              games_played: parseInt($(statCells[1]).text()) || 0,
              wins: parseInt($(statCells[2]).text()) || 0,
              losses: parseInt($(statCells[3]).text()) || 0,
              ties: parseInt($(statCells[4]).text()) || 0,
              goals_for: parseInt($(statCells[5]).text()) || 0,
              goals_against: parseInt($(statCells[6]).text()) || 0,
            };

            allStandings.push({
              source_platform: engine.adapter.id,
              source_event_id: event.id,
              team_name: teamName,
              division: division.name,
              rank,
              ...stats,
              raw_data: {
                team_key: teamKey,
                division_id: division.id,
                team_group_name: teamGroupName,
                source_team_id: teamKey,
              },
            });
          });
        });

        console.log(`Processed standings for ${division.name}`);

      } catch (error) {
        console.log(`ERROR scraping standings for ${division.name}: ${error.message}`);
      }

      // Rate limiting between divisions
      if (i < divisions.length - 1) {
        await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Total standings entries: ${allStandings.length}`);
    console.log(`${"=".repeat(60)}\n`);

    return allStandings;
  },
};
