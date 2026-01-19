/**
 * Batch scrape GotSport LEAGUES - WAVE 2
 * 15 NEW leagues for national coverage
 * Usage: node scripts/batchLeagues_wave2.js
 */

import { spawn } from "child_process";

const LEAGUE_IDS = [
  "33123", // SoCal Soccer League 2024-25
  "36297", // Mid-Atlantic Premier League
  "40866", // Central League Soccer (PA)
  "39130", // LA Winter League 2024-25
  "32708", // Florida State Premier League
  "8120", // Great Lakes Conference (OH/MI/IN)
  "27516", // Ohio State Cup 2024
  "21903", // NorCal NPL
  "44970", // NPL Schedule 25/26
  "41823", // NorCal Spring NPL 2025
  "36210", // Arlington Premier Invitational (VA)
  "34294", // Open League 2024-25
  "33371", // EPYSA League (PA)
  "23878", // National Academy League
  "6420", // Texas Clubs Soccer League
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
  console.log(`🏆 WAVE 2: Scraping ${LEAGUE_IDS.length} NEW LEAGUES...\n`);
  const start = Date.now();
  for (const id of LEAGUE_IDS) {
    await runScraper(id);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(
    `\n✅ Wave 2 done in ${((Date.now() - start) / 60000).toFixed(1)} minutes!`,
  );
}

main();
