/**
 * WAVE 6 - REGIONAL CUPS & TOURNAMENTS
 * Usage: node scripts/batchLeagues_wave6.js
 */

import { spawn } from "child_process";

const LEAGUE_IDS = [
  // CALIFORNIA
  "39816", // Copa Del Mar Winter Classic
  "31352", // Pats Cup 2024

  // ARIZONA
  "29894", // Phoenix Rising Fall Classic

  // VIRGINIA / DMV
  "40112", // Loudoun Premier Cup
  "25682", // Ultimate Cup (Richmond)

  // ODP / SELECT
  "27309", // ODP Events

  // SHOWCASES
  "30959", // Davis World Cup

  // REGIONAL
  "35562", // Internationals SC Event
  "44839", // JPL Mountain West NPL
  "3863", // NPL Boys West Playoffs

  // KENTUCKY
  "42118", // Kentucky State Open Cup

  // GIRLS SPECIFIC
  "35774", // Girls Classic League 2024-25

  // FUTURE SEASONS 2025-26
  "44473", // North Atlantic Fall 2025-Spring 2026
  "43731", // Central League Soccer 2025 Fall
  "43086", // SoCal Fall 2025
  "44846", // WPL Fall 2025

  // ADDITIONAL PREMIER
  "24896", // Vegas Cup 2024
  "30502", // NC Girls College Showcase
  "33570", // Copa Rayados East Coast
];

async function runScraper(eventId) {
  return new Promise((resolve) => {
    console.log(
      `\n${"=".repeat(50)}\nStarting event ${eventId}...\n${"=".repeat(50)}`,
    );
    const proc = spawn("node", ["scripts/scrapeMatches.js", eventId], {
      stdio: "inherit",
    });
    proc.on("close", (code) => {
      console.log(`Event ${eventId} finished with code ${code}`);
      resolve(code);
    });
  });
}

async function main() {
  console.log(
    `🏆 WAVE 6: Scraping ${LEAGUE_IDS.length} REGIONAL CUPS & TOURNAMENTS!\n`,
  );
  const start = Date.now();
  for (const id of LEAGUE_IDS) {
    await runScraper(id);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(
    `\n✅ Wave 6 done in ${((Date.now() - start) / 60000).toFixed(1)} minutes!`,
  );
}

main();
