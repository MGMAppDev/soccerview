/**
 * RI Super Liga Source Adapter v1.0
 * ==================================
 *
 * Scrapes match data from thesuperliga.com — Rhode Island's premier youth soccer league.
 *
 * TECHNOLOGY: Puppeteer (dropdowns populated by server-side JS — need full browser render)
 *   + direct POST requests (once parameters discovered) for data fetching
 *
 * PLATFORM: Custom PHP + jQuery (not a commercial platform)
 *
 * Architecture:
 * - Single-page app with tab navigation (#tab-0 through #tab-8)
 * - Tab 2 = "Spring" — main schedule/scores/standings interface
 * - Cascading dropdowns: Age Group → League → Division
 * - Data fetched via POST to actions/get{Scores|Standings|Schedule}.php
 * - POST responses are HTML fragments (not JSON)
 * - Dropdowns are ONLY populated during active seasons
 *
 * Season calendar:
 * - Fall: Late August → Late October (7-8 weeks)
 * - Spring: Late March → Late May/June
 * - Between seasons (Nov-March, Jun-Aug): site has NO DATA available
 *
 * Age groups: U7-U19 (Fall: U8-U17, Spring: U8-U19)
 * Divisions: Anchor (top), Classic Gold, Classic Blue, Rhody (4th)
 *   Younger: Gold, Silver, Blue, White
 * Genders: Boys, Girls, Coed (U17)
 *
 * IMPORTANT: This adapter requires Puppeteer to discover dropdown values,
 * then uses direct POST requests for efficiency. The site is ONLY accessible
 * during active seasons (dropdowns are empty between seasons).
 *
 * Usage:
 *   node scripts/universal/coreScraper.js --adapter risuperliga
 *   node scripts/universal/coreScraper.js --adapter risuperliga --event spring2026
 *
 * RETRY DATE: March 28, 2026 (Spring 2026 season start)
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "risuperliga",
  name: "RI Super Liga",
  baseUrl: "https://www.thesuperliga.com",

  // =========================================
  // TECHNOLOGY
  // =========================================

  technology: "puppeteer",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    requestDelayMin: 1500,
    requestDelayMax: 3000,
    iterationDelay: 2000,
    itemDelay: 5000,
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
  ],

  // =========================================
  // ENDPOINTS
  // =========================================

  endpoints: {
    scores: "/actions/getScores.php",
    standings: "/actions/getStandings.php",
    schedule: "/actions/getSchedule.php",
  },

  // =========================================
  // PARSING CONFIGURATION
  // =========================================

  parsing: {
    dateFormat: "MM/DD/YYYY",
    scoreRegex: /^(\d+)$/,
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "risuperliga-{eventId}-{matchId}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    staticEvents: [
      {
        id: "spring2026",
        name: "RI Super Liga Spring 2026",
        type: "league",
        year: 2026,
        state: "RI",
      },
      // Fall 2026 — add in August 2026
      // { id: "fall2026", name: "RI Super Liga Fall 2026", type: "league", year: 2027, state: "RI" },
    ],

    discoverEvents: null,
  },

  // =========================================
  // DATA TRANSFORMATION
  // =========================================

  transform: {
    normalizeTeamName: (name) => {
      if (!name) return "";
      return name.trim();
    },

    parseDivision: (divisionText) => {
      if (!divisionText)
        return { gender: null, ageGroup: null };

      let gender = null;
      if (/\bBoys?\b/i.test(divisionText)) gender = "Boys";
      if (/\bGirls?\b/i.test(divisionText)) gender = "Girls";
      if (/\bCoed\b/i.test(divisionText)) gender = "Boys"; // Coed counted as Boys for filter

      let ageGroup = null;
      const ageMatch = divisionText.match(/U-?(\d{1,2})\b/i);
      if (ageMatch) ageGroup = `U${ageMatch[1]}`;

      return { gender, ageGroup };
    },

    inferState: () => "RI",

    parseDate: (dateStr) => {
      if (!dateStr) return null;
      // Expected format: MM/DD/YYYY or similar
      const m = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) return null;
      return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
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
    filename: ".risuperliga_checkpoint.json",
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
    const baseUrl = "https://www.thesuperliga.com";

    // Step 1: Use Puppeteer to discover dropdown values
    console.log("   Discovering dropdown values via Puppeteer...");

    const page = engine.page;
    if (!page) {
      console.error("   ERROR: Puppeteer page not available");
      return [];
    }

    await page.goto(baseUrl, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 5000));

    // Activate Spring tab (tab index 2)
    await page.evaluate(() => {
      if (typeof showTab === "function") showTab(2);
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Extract age groups from scores dropdown
    const ageGroups = await page.evaluate(() => {
      const sel = document.querySelector("#scores_age_group");
      if (!sel) return [];
      return Array.from(sel.options)
        .filter((o) => o.value)
        .map((o) => ({ value: o.value, text: o.textContent.trim() }));
    });

    if (ageGroups.length === 0) {
      console.log("   WARNING: No age groups found — site may be between seasons");
      console.log("   RI Super Liga seasons:");
      console.log("     Fall: Late Aug → Late Oct");
      console.log("     Spring: Late Mar → Late May/Jun");
      console.log("   Current date: " + new Date().toISOString().split("T")[0]);
      return [];
    }

    console.log(`   Found ${ageGroups.length} age groups`);

    // Step 2: For each age group, discover leagues and divisions
    for (const ageGroup of ageGroups) {
      console.log(`\n   Age group: ${ageGroup.text}`);

      // Select age group
      await page.select("#scores_age_group", ageGroup.value);
      await new Promise((r) => setTimeout(r, 2000));

      // Get leagues
      const leagues = await page.evaluate(() => {
        const sel = document.querySelector("#scores_league");
        if (!sel) return [];
        return Array.from(sel.options)
          .filter((o) => o.value)
          .map((o) => ({ value: o.value, text: o.textContent.trim() }));
      });

      for (const league of leagues) {
        // Select league
        await page.select("#scores_league", league.value);
        await new Promise((r) => setTimeout(r, 2000));

        // Get divisions
        const divisions = await page.evaluate(() => {
          const sel = document.querySelector("#scores_select");
          if (!sel) return [];
          return Array.from(sel.options)
            .filter((o) => o.value)
            .map((o) => ({ value: o.value, text: o.textContent.trim() }));
        });

        for (const division of divisions) {
          console.log(
            `     ${ageGroup.text} / ${league.text} / ${division.text}`
          );

          // Select division and trigger data load
          await page.select("#scores_select", division.value);
          await new Promise((r) => setTimeout(r, 1000));

          // Trigger getSomething('scores')
          await page.evaluate(() => {
            if (typeof getSomething === "function") getSomething("scores");
          });
          await new Promise((r) => setTimeout(r, 3000));

          // Parse the response from #spring_display
          const matches = await page.evaluate(
            (params) => {
              const display = document.querySelector("#spring_display");
              if (!display) return [];

              const results = [];
              const tables = display.querySelectorAll("table");

              for (const table of tables) {
                const rows = table.querySelectorAll("tr");
                for (let i = 1; i < rows.length; i++) {
                  const cells = rows[i].querySelectorAll("td");
                  if (cells.length < 5) continue;

                  // Parse match data (format TBD — needs active season to verify)
                  const dateStr = cells[0]?.textContent?.trim();
                  const homeTeam = cells[1]?.textContent?.trim();
                  const scoreStr = cells[2]?.textContent?.trim();
                  const awayTeam = cells[3]?.textContent?.trim();
                  const venue = cells[4]?.textContent?.trim();

                  if (homeTeam && awayTeam) {
                    results.push({
                      dateStr,
                      homeTeam,
                      scoreStr,
                      awayTeam,
                      venue,
                      ageGroup: params.ageGroup,
                      league: params.league,
                      division: params.division,
                    });
                  }
                }
              }
              return results;
            },
            {
              ageGroup: ageGroup.text,
              league: league.text,
              division: division.text,
            }
          );

          // Transform to standard format
          for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            const matchId = `${ageGroup.value}-${division.value}-${i + 1}`;

            // Parse scores
            let homeScore = null;
            let awayScore = null;
            if (m.scoreStr) {
              const scoreParts = m.scoreStr.match(/(\d+)\s*[-–]\s*(\d+)/);
              if (scoreParts) {
                homeScore = parseInt(scoreParts[1], 10);
                awayScore = parseInt(scoreParts[2], 10);
              }
            }

            const status =
              homeScore !== null && awayScore !== null
                ? "completed"
                : "scheduled";

            // Infer gender and birth year from age group text
            let gender = null;
            let birthYear = null;
            const ageMatch = ageGroup.text.match(/U-?(\d+)/i);
            if (ageMatch) {
              const ageNum = parseInt(ageMatch[1], 10);
              birthYear = 2026 - ageNum;
            }
            // Gender would come from division or age group context
            if (/boys/i.test(division.text) || /boys/i.test(ageGroup.text))
              gender = "Boys";
            if (/girls/i.test(division.text) || /girls/i.test(ageGroup.text))
              gender = "Girls";

            allMatches.push({
              eventId: event.id,
              eventName: event.name,
              matchId,
              matchDate: m.dateStr
                ? engine.adapter.transform.parseDate(m.dateStr)
                : null,
              matchTime: null,
              homeTeamName: m.homeTeam,
              awayTeamName: m.awayTeam,
              homeScore,
              awayScore,
              homeId: null,
              awayId: null,
              status,
              location: m.venue || null,
              division: `${ageGroup.text} ${division.text}`,
              gender,
              ageGroup: ageMatch ? `U${ageMatch[1]}` : null,
              raw_data: {
                birth_year: birthYear,
                ri_league: league.text,
                ri_division: division.text,
                ri_age_group: ageGroup.text,
              },
            });
          }

          console.log(`       → ${matches.length} matches`);

          // Rate limiting
          await new Promise((r) =>
            setTimeout(r, engine.adapter.rateLimiting.iterationDelay)
          );
        }
      }
    }

    console.log(`\n   Total: ${allMatches.length} matches`);
    return allMatches.filter((m) =>
      engine.adapter.dataPolicy.isValidMatch(m)
    );
  },
};
