/**
 * WAVE 3 - Maximum National Coverage
 * 35 NEW leagues discovered
 * Usage: node scripts/batchLeagues_wave3.js
 */

import { spawn } from "child_process";

const LEAGUE_IDS = [
  // NATIONAL LEAGUES
  "4632", // USYS National League P.R.O.
  "24996", // USYS Conference Playoffs
  "27199", // Girls Academy League
  "36330", // Girls Academy 2024-25
  "1271", // MLS NEXT League
  "45036", // Mid-Atlantic Premier 25/26

  // CALIFORNIA
  "41863", // SoCal Spring 2025
  "43086", // SoCal Fall 2025
  "28860", // SoCal State Cup 2024
  "33460", // NorCal State Cup 2024-25
  "44146", // NorCal State Cup 2025-26
  "33826", // Sierra-Valley Metro League

  // FLORIDA
  "45008", // West Florida Premier League
  "34599", // Alabama State League Fall 24

  // NORTHEAST
  "39930", // LIJSL Spring 2025
  "35035", // North Atlantic Academy
  "41025", // MOSA Spring 2025
  "20781", // EDP League
  "24618", // North Atlantic 2023-24
  "1206", // PA Regional Club League
  "34397", // WPL Fall 2024

  // MIDWEST
  "27574", // USYS Midwest Conference
  "4696", // Midwest Conference
  "859", // Midwest Conference Legacy

  // SOUTHEAST
  "36055", // Southeast NPL
  "42138", // ASPIRE League

  // SOUTHWEST
  "34558", // USYS Desert Conference
  "35204", // Nevada State League 2024
  "35062", // Dallas Tournament

  // NEW ENGLAND
  "35806", // New England Fall 2024
  "1752", // Great Lakes Conference
];

async function runScraper(eventId) {
  return new Promise((resolve) => {
    console.log(
      `\n${"=".repeat(50)}\nStarting league ${eventId}...\n${"=".repeat(50)}`,
    );
    const proc = spawn("node", ["scripts/scrapeMatches.js", eventId], {
      stdio: "inherit",
    });
    proc.on("close", (code) => {
      console.log(`League ${eventId} finished with code ${code}`);
      resolve(code);
    });
  });
}

async function main() {
  console.log(
    `🏆 WAVE 3: Scraping ${LEAGUE_IDS.length} LEAGUES for MAXIMUM COVERAGE!\n`,
  );
  const start = Date.now();
  for (const id of LEAGUE_IDS) {
    await runScraper(id);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(
    `\n✅ Wave 3 done in ${((Date.now() - start) / 60000).toFixed(1)} minutes!`,
  );
}

main();
