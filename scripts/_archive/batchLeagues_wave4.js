/**
 * WAVE 4 - FULL NATIONAL COVERAGE
 * 22 additional leagues for maximum data
 * Usage: node scripts/batchLeagues_wave4.js
 */

import { spawn } from "child_process";

const LEAGUE_IDS = [
  // USYS NATIONAL CONFERENCES
  "4697", // USYS Sunshine Conference (FL/GA)
  "34040", // Northwest Conference 2024-25
  "5083", // Northwest Conference (older)
  "1751", // Spring Midwest Conference
  "1292", // National League North Carolina

  // TEXAS
  "35207", // North Texas Regional Premier
  "41135", // South Texas 2025
  "22481", // South Texas State Cup

  // FLORIDA
  "26429", // FYSA State Cup

  // CALIFORNIA
  "40753", // NorCal Premier Spring 2024-25
  "28571", // OC Great Park Tournament

  // KANSAS / MIDWEST
  "30637", // KC Area League

  // VIRGINIA
  "26274", // VYSA League

  // NORTHEAST
  "35056", // FCL Academy
  "9483", // Northeast Academy League
  "33570", // Copa Rayados East Coast

  // KENTUCKY
  "42118", // Kentucky State Open Cup

  // GIRLS LEAGUES
  "35774", // Girls Classic League 2024-25

  // SHOWCASES
  "24896", // Vegas Cup 2024
  "30502", // NC Girls College Showcase

  // FUTURE
  "44846", // WPL Fall 2025
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
    `🏆 WAVE 4: Scraping ${LEAGUE_IDS.length} LEAGUES for FULL COVERAGE!\n`,
  );
  const start = Date.now();
  for (const id of LEAGUE_IDS) {
    await runScraper(id);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(
    `\n✅ Wave 4 done in ${((Date.now() - start) / 60000).toFixed(1)} minutes!`,
  );
}

main();
