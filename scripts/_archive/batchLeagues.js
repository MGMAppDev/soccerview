/**
 * Batch scrape GotSport LEAGUES
 * Phase B - SoccerView
 * Usage: node scripts/batchLeagues.js
 */

import { spawn } from "child_process";

const LEAGUE_IDS = [
  "35352", // SCCL Fall 2024 (SC Champions League) - 142 groups
  "34067", // EDP Fall 2024
  "34337", // North Atlantic Fall 2024-Spring 2025
  "44142", // NorCal Premier Fall 2025-26
  "29624", // NECSL Spring 2024
  "24097", // DPL League
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
  console.log(`🏆 Batch scraping ${LEAGUE_IDS.length} LEAGUES...\n`);
  const start = Date.now();

  for (const id of LEAGUE_IDS) {
    await runScraper(id);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const mins = ((Date.now() - start) / 60000).toFixed(1);
  console.log(`\n✅ All leagues done in ${mins} minutes!`);
}

main();
