/**
 * SportsAffinity Source Adapter v1.0
 * ===================================
 *
 * Scrapes match data from SportsAffinity/Sports Connect (Stack Sports) platform.
 * Primary target: Georgia Soccer (biggest coverage gap — 10.9% coverage, 4,107 orphans).
 *
 * TECHNOLOGY: Cheerio (server-rendered ASP.NET WebForms — no JavaScript needed)
 * PLATFORM: SportsAffinity old ASP.NET system at gs*.sportsaffinity.com
 *
 * Architecture (confirmed from diagnostic 2026-02-15):
 * - Season-specific subdomains: gs-fall25gplacadathclrias.sportsaffinity.com
 * - Tournament/season identified by GUID
 * - Flights (age groups/divisions) discovered from accepted_list.asp
 * - Schedule data at schedule_results2.asp per flight
 * - HTML tables with 10 columns: Game, Venue, Time, Field, Group, Home, Score, vs, Away, Score
 * - Date headers in <b> tags: "Bracket - Saturday, September 06, 2025"
 * - Age codes in flight URLs: agecode=B12, B13, B14, B15, B16, B17, B19
 * - Flight names in <td> cells on accepted_list.asp: "12UB Pre GPL", "13UB GPL", etc.
 *
 * States using SportsAffinity: GA, MN (partial), UT, OR, NE, PA-W, HI
 * This adapter is built for GA but designed to support other states with config changes.
 *
 * Usage:
 *   node scripts/universal/coreScraper.js --adapter sportsaffinity
 *   node scripts/universal/coreScraper.js --adapter sportsaffinity --event fall2025
 *   node scripts/universal/coreScraper.js --adapter sportsaffinity --dry-run
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "sportsaffinity",
  name: "SportsAffinity (Georgia Soccer)",
  baseUrl: "https://gs.sportsaffinity.com",

  // =========================================
  // TECHNOLOGY
  // =========================================

  technology: "cheerio",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    requestDelayMin: 1500,
    requestDelayMax: 3000,
    iterationDelay: 2000, // Between flights
    itemDelay: 5000, // Between seasons/events
    maxRetries: 3,
    retryDelays: [5000, 15000, 30000],
    cooldownOn429: 120000,
    cooldownOn500: 60000,
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
    acceptedList:
      "/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid={tournamentGuid}",
    schedule:
      "/tour/public/info/schedule_results2.asp?sessionguid=&flightguid={flightGuid}&tournamentguid={tournamentGuid}",
  },

  // =========================================
  // PARSING CONFIGURATION
  // =========================================

  parsing: {
    dateFormat: "MMMM DD, YYYY", // "September 06, 2025"
    scoreRegex: /^(\d+)$/,
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "sportsaffinity-{matchId}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    /**
     * Georgia Soccer seasons on SportsAffinity.
     * Each season has a subdomain and tournament GUID.
     * Current season (2025-26) = Fall 2025 + Spring 2026.
     */
    staticEvents: [
      {
        id: "fall2025",
        name: "Georgia Soccer Fall 2025 GPL",
        type: "league",
        year: 2026,
        state: "GA",
        subdomain: "gs-fall25gplacadathclrias",
        tournamentGuid: "E7A6731D-D5FF-41B4-9C3C-300ECEE69150",
      },
      {
        id: "spring2026",
        name: "Georgia Soccer Spring 2026 GPL",
        type: "league",
        year: 2026,
        state: "GA",
        subdomain: "gs",
        tournamentGuid: "CE35DE7A-39D2-40C0-BA3B-2A46C862535C",
      },
      {
        id: "spring2025",
        name: "Georgia Soccer Spring 2025 GPL",
        type: "league",
        year: 2025,
        state: "GA",
        subdomain: "gs-spr25acadathclrias",
        tournamentGuid: "6F94BCCC-EAAD-4369-8598-ECDF00068393",
      },
      {
        id: "fall2024",
        name: "Georgia Soccer Fall 2024 GPL",
        type: "league",
        year: 2025,
        state: "GA",
        subdomain: "gs-fall24gplacadathclrias",
        tournamentGuid: "7336D9D7-3A6F-46FD-9A85-D263981782DF",
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
      // Remove leading group codes: "A1 : Team Name" → "Team Name"
      return name.replace(/^[A-Z]\d+\s*:\s*/, "").trim();
    },

    parseDivision: (divisionText) => {
      if (!divisionText)
        return { gender: null, ageGroup: null };

      let gender = null;
      // SportsAffinity uses B12, B13, G12, G13 format (agecode)
      if (/\bB\d/i.test(divisionText) || /\bBoys?\b/i.test(divisionText))
        gender = "Boys";
      if (/\bG\d/i.test(divisionText) || /\bGirls?\b/i.test(divisionText))
        gender = "Girls";

      let ageGroup = null;
      // Extract age: B12 → U12, G14 → U14, or "12UB" → U12
      const ageMatch = divisionText.match(
        /[BG](\d{1,2})\b|\b(\d{1,2})U[BG]\b/i
      );
      if (ageMatch) {
        const age = ageMatch[1] || ageMatch[2];
        ageGroup = `U${age}`;
      }

      return { gender, ageGroup };
    },

    /** Georgia Soccer — always GA */
    inferState: () => "GA",

    /**
     * Parse date from "Month Day, Year" format.
     * Example: "September 06, 2025" → "2025-09-06"
     */
    parseDate: (dateStr) => {
      if (!dateStr) return null;
      const MONTHS = {
        January: "01",
        February: "02",
        March: "03",
        April: "04",
        May: "05",
        June: "06",
        July: "07",
        August: "08",
        September: "09",
        October: "10",
        November: "11",
        December: "12",
      };
      const m = dateStr.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/);
      if (!m) return null;
      const month = MONTHS[m[1]];
      if (!month) return null;
      return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
    },

    parseScore: (scoreStr) => {
      if (!scoreStr || scoreStr.trim() === "") return [null, null];
      const val = parseInt(scoreStr.trim(), 10);
      if (isNaN(val)) return [null, null];
      return val;
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".sportsaffinity_checkpoint.json",
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    minDate: "2024-08-01",
    maxFutureDate: null,

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

  scrapeEvent: async (engine, event) => {
    const allMatches = [];
    const subdomain = event.subdomain;
    const tournamentGuid = event.tournamentGuid;
    const baseUrl = `https://${subdomain}.sportsaffinity.com/tour/public/info`;

    console.log(`   Subdomain: ${subdomain}`);
    console.log(`   Tournament GUID: ${tournamentGuid}`);

    // Step 1: Discover all flights from accepted_list.asp
    const acceptedUrl = `${baseUrl}/accepted_list.asp?sessionguid=&tournamentguid=${tournamentGuid}`;
    console.log(`   Discovering flights...`);

    const { $: $acc, error: accError } =
      await engine.fetchWithCheerio(acceptedUrl);

    if (accError || !$acc) {
      console.error(
        `   Failed to fetch accepted list: ${accError || "empty response"}`
      );
      return [];
    }

    // Extract flights: agecode + flightguid from links
    const flights = [];
    const seenGuids = new Set();

    $acc('a[href*="flightguid"]').each((_, a) => {
      const href = $acc(a).attr("href") || "";
      const flightMatch = href.match(/flightguid=([A-F0-9-]+)/i);
      const ageMatch = href.match(/agecode=([A-Z]\d+)/i);
      if (!flightMatch) return;

      const guid = flightMatch[1].toUpperCase();
      if (seenGuids.has(guid)) return;
      seenGuids.add(guid);

      flights.push({
        guid,
        agecode: ageMatch ? ageMatch[1] : null,
      });
    });

    // Also extract flight names from <td> cells that contain age group info
    // Pattern: "12UB Pre GPL", "13UB GPL", "14UB Champ/Conf. North"
    const flightNames = new Map();
    $acc("td").each((_, td) => {
      const text = $acc(td).text().trim();
      const nameMatch = text.match(
        /^(\d{1,2}U[BG])\s+(.+)/i
      );
      if (nameMatch) {
        // Find the closest flight link in the same row
        const row = $acc(td).closest("tr");
        const link = row.find('a[href*="flightguid"]').first();
        if (link.length) {
          const href = link.attr("href") || "";
          const fm = href.match(/flightguid=([A-F0-9-]+)/i);
          if (fm) {
            flightNames.set(fm[1].toUpperCase(), text);
          }
        }
      }
    });

    // Enrich flights with names
    for (const flight of flights) {
      flight.name =
        flightNames.get(flight.guid) || flight.agecode || "Unknown";
    }

    console.log(`   Found ${flights.length} flights`);
    for (const f of flights) {
      console.log(`     ${f.agecode || "?"}: ${f.name} (${f.guid.substring(0, 8)}...)`);
    }

    // Step 2: For each flight, fetch schedule_results2.asp and parse matches
    for (let i = 0; i < flights.length; i++) {
      const flight = flights[i];
      console.log(
        `\n   [${i + 1}/${flights.length}] ${flight.name} (${flight.agecode})`
      );

      try {
        const matches = await scrapeFlight(
          engine,
          baseUrl,
          tournamentGuid,
          flight,
          event
        );

        if (matches.length > 0) {
          allMatches.push(...matches);
          console.log(`   ${flight.name}: ${matches.length} matches`);
        } else {
          console.log(`   ${flight.name}: 0 matches`);
        }
      } catch (error) {
        console.error(
          `   Error scraping ${flight.name}: ${error.message}`
        );
      }

      if (i < flights.length - 1) {
        await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
      }
    }

    // Deduplicate by game number
    const uniqueMatches = Array.from(
      new Map(allMatches.map((m) => [m.matchId, m])).values()
    );

    console.log(
      `\n   Total: ${uniqueMatches.length} unique matches (${allMatches.length} raw)`
    );
    return uniqueMatches;
  },
};

// =========================================
// INTERNAL FUNCTIONS
// =========================================

const MONTHS = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
};

/**
 * Parse a date from "Month Day, Year" format to YYYY-MM-DD.
 */
function parseFullDate(month, day, year) {
  const mm = MONTHS[month];
  if (!mm) return null;
  return `${year}-${mm}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse gender and birth year from an agecode like "B12", "G14".
 */
function parseAgecode(agecode) {
  if (!agecode) return { gender: null, ageGroup: null, birthYear: null };

  const m = agecode.match(/^([BG])(\d{1,2})$/i);
  if (!m) return { gender: null, ageGroup: null, birthYear: null };

  const gender = m[1].toUpperCase() === "B" ? "Boys" : "Girls";
  const ageNum = parseInt(m[2], 10);
  const ageGroup = `U${ageNum}`;

  // Birth year: U12 in 2025-26 season = 2014 birth year (2026 - 12)
  const birthYear = 2026 - ageNum;

  return { gender, ageGroup, birthYear };
}

/**
 * Scrape all matches for one flight.
 * Fetches schedule_results2.asp and parses the HTML tables.
 *
 * Date association: Uses recursive DOM walk to find <b> date headers
 * and associate them with subsequent match tables.
 */
async function scrapeFlight(engine, baseUrl, tournamentGuid, flight, event) {
  const scheduleUrl = `${baseUrl}/schedule_results2.asp?sessionguid=&flightguid=${flight.guid}&tournamentguid=${tournamentGuid}`;

  const { $, html, error } = await engine.fetchWithCheerio(scheduleUrl);

  if (error || !$) {
    console.log(`     Failed to fetch schedule: ${error || "empty"}`);
    return [];
  }

  const { gender, ageGroup, birthYear } = parseAgecode(flight.agecode);

  // Strategy for date detection:
  // Walk the entire DOM tree depth-first. When we encounter a <b> with a date pattern,
  // save it as currentDate. When we encounter a match table, parse matches using currentDate.
  // This works because depth-first traversal follows document order.

  const matchesWithDates = [];
  let currentDate = null;

  function walkNode(node) {
    if (!node) return;

    // Check if this is a tag element
    if (node.type === "tag") {
      // Check for date header in <b> tags
      if (node.tagName === "b") {
        const text = $(node).text().trim();
        const dateMatch = text.match(
          /Bracket\s*-\s*\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/
        );
        if (dateMatch) {
          currentDate = parseFullDate(
            dateMatch[1],
            dateMatch[2],
            dateMatch[3]
          );
        }
      }

      // Check for match table
      if (node.tagName === "table") {
        const headerRow = $(node).find("tr").first();
        const headerText = headerRow.text();

        if (
          headerText.includes("Home Team") &&
          headerText.includes("Away Team")
        ) {
          // This is a match table — parse it
          $(node)
            .find("tr")
            .slice(1)
            .each((_, row) => {
              const cells = $(row).find("td");
              if (cells.length < 10) return;

              const gameNum = $(cells[0]).text().trim();
              const venue = $(cells[1]).text().trim();
              const time = $(cells[2]).text().trim();
              const field = $(cells[3]).text().trim();
              const group = $(cells[4]).text().trim();
              const homeTeam = $(cells[5]).text().trim();
              const homeScoreStr = $(cells[6]).text().trim();
              // cells[7] = "vs."
              const awayTeam = $(cells[8]).text().trim();
              const awayScoreStr = $(cells[9]).text().trim();

              if (!gameNum || !homeTeam || !awayTeam) return;

              matchesWithDates.push({
                gameNum,
                date: currentDate,
                time,
                venue,
                field,
                group,
                homeTeam,
                homeScoreStr,
                awayTeam,
                awayScoreStr,
              });
            });
        }
      }

      // Recurse into children
      const children = node.children || [];
      for (const child of children) {
        walkNode(child);
      }
    }
  }

  // Start walk from <body> (or root)
  const root = $("body")[0] || $.root()[0];
  if (root && root.children) {
    for (const child of root.children) {
      walkNode(child);
    }
  }

  // Transform to standard match format
  const matches = [];
  for (const m of matchesWithDates) {
    // Parse time: "09:00 AM" → "09:00"
    let matchTime = null;
    if (m.time) {
      const tm = m.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (tm) {
        let hours = parseInt(tm[1], 10);
        if (tm[3].toUpperCase() === "PM" && hours !== 12) hours += 12;
        if (tm[3].toUpperCase() === "AM" && hours === 12) hours = 0;
        matchTime = `${String(hours).padStart(2, "0")}:${tm[2]}`;
      }
    }

    // Parse scores
    const homeScore = m.homeScoreStr !== "" ? parseInt(m.homeScoreStr, 10) : null;
    const awayScore = m.awayScoreStr !== "" ? parseInt(m.awayScoreStr, 10) : null;
    const hasScore =
      homeScore !== null &&
      !isNaN(homeScore) &&
      awayScore !== null &&
      !isNaN(awayScore);

    const status = hasScore ? "completed" : "scheduled";

    // Build division string
    const division = [ageGroup, flight.name, m.group]
      .filter(Boolean)
      .join(" — ");

    matches.push({
      eventId: event.id,
      eventName: event.name,
      matchId: m.gameNum,
      matchDate: m.date || null,
      matchTime,
      homeTeamName: m.homeTeam,
      awayTeamName: m.awayTeam,
      homeScore: hasScore ? homeScore : null,
      awayScore: hasScore ? awayScore : null,
      homeId: null,
      awayId: null,
      status,
      location: [m.venue, m.field].filter(Boolean).join(" — "),
      division,
      gender,
      ageGroup,
      raw_data: {
        sportsaffinity_game_num: m.gameNum,
        flight_guid: flight.guid,
        agecode: flight.agecode,
        flight_name: flight.name,
        group_matchup: m.group,
        birth_year: birthYear,
      },
    });
  }

  return matches.filter((m) =>
    engine.adapter.dataPolicy.isValidMatch(m)
  );
}
