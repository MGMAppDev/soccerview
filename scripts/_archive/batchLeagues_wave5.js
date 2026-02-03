/**
 * WAVE 5 - MAJOR CUPS & CHAMPIONSHIPS
 * Usage: node scripts/batchLeagues_wave5.js
 */

import { spawn } from "child_process";

const LEAGUE_IDS = [
  // USYS NATIONAL EVENTS
  "27695", // USYS National Presidents Cup (Wichita)
  "35044", // National League December Quarterfinals
  "37932", // National Cup Finals
  "24591", // USYS Desert Conference

  // STATE CUPS
  "30791", // Washington State Cup
  "25458", // Illinois State Cup & Presidents Cup
  "35355", // Maryland MSYSA State Cup

  // REGIONAL LEAGUES
  "35013", // Red River NPL (TX/LA/OK/AR)
  "40582", // Frontier Premier League
  "7173", // Frontier (FDL)
  "34235", // E64 Regional League (Midwest)
  "29226", // NY West Champions Conference

  // MAJOR SHOWCASES
  "37242", // GA Winter Showcase & Champions Cup
  "36386", // IMG Academy Cup
  "33158", // ESPN Wide World of Sports Cup

  // FLORIDA EVENTS
  "35869", // Weston Cup 2025
  "26279", // Florida State Invitational
  "33584", // Nona Soccer Cup 2024

  // TEXAS EVENTS
  "45567", // Solar Premier Cup 2025
  "39308", // Houston Premier Cup 2025
  "13357", // South Texas Directors Cup

  // MLS/ACADEMY
  "27220", // National Academy Championships (MLS NEXT)
  "32837", // DPL Finals
  "4961", // DPL Playoffs
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
    `🏆 WAVE 5: Scraping ${LEAGUE_IDS.length} MAJOR CUPS & CHAMPIONSHIPS!\n`,
  );
  const start = Date.now();
  for (const id of LEAGUE_IDS) {
    await runScraper(id);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(
    `\n✅ Wave 5 done in ${((Date.now() - start) / 60000).toFixed(1)} minutes!`,
  );
}

main();
