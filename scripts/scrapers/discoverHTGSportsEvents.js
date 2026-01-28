/**
 * HTGSports Event Discovery for Heartland Soccer
 * ===============================================
 *
 * Discovers Heartland Soccer events on HTGSports platform
 * by searching the events list page.
 *
 * Usage:
 *   node scripts/discoverHTGSportsEvents.js
 *
 * Prerequisites:
 *   npm install puppeteer
 */

import puppeteer from "puppeteer";
import fs from "fs";

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
  EVENTS_LIST_URL: "https://events.htgsports.net/",
  SEARCH_TERMS: [
    "heartland",
    "kansas city",
    "overland park",
    "olathe",
    "kc ",
    "sporting",
  ],
  OUTPUT_FILE: "scripts/discovered_htgsports_events.json",
  PAGE_LOAD_WAIT: 5000,
};

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log("🔍 HTGSports Event Discovery");
  console.log("============================\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    console.log("📋 Loading HTGSports events list...");
    await page.goto(CONFIG.EVENTS_LIST_URL, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for content to load
    await new Promise(r => setTimeout(r, CONFIG.PAGE_LOAD_WAIT));

    // Extract all event links and names
    const events = await page.evaluate(() => {
      const results = [];

      // Look for event links
      const links = document.querySelectorAll('a[href*="eventid"]');
      links.forEach(link => {
        const href = link.getAttribute("href");
        const match = href.match(/eventid=(\d+)/);
        if (match) {
          results.push({
            id: parseInt(match[1]),
            name: link.innerText.trim(),
            url: href,
          });
        }
      });

      // Also check for any divs/cards with event info
      const eventCards = document.querySelectorAll("[class*='event']");
      eventCards.forEach(card => {
        const text = card.innerText;
        const linkEl = card.querySelector("a");
        if (linkEl) {
          const href = linkEl.getAttribute("href");
          const match = href?.match(/eventid=(\d+)/);
          if (match && !results.find(r => r.id === parseInt(match[1]))) {
            results.push({
              id: parseInt(match[1]),
              name: text.split("\n")[0].trim(),
              url: href,
            });
          }
        }
      });

      return results;
    });

    console.log(`Found ${events.length} total events on HTGSports\n`);

    // Filter for Heartland/KC region events
    const heartlandEvents = events.filter(event => {
      const nameLower = event.name.toLowerCase();
      return CONFIG.SEARCH_TERMS.some(term => nameLower.includes(term));
    });

    console.log(`🎯 Found ${heartlandEvents.length} Heartland/KC region events:\n`);

    heartlandEvents.forEach(event => {
      console.log(`   [${event.id}] ${event.name}`);
    });

    // Save to file
    const output = {
      discovered_at: new Date().toISOString(),
      total_events: events.length,
      heartland_events: heartlandEvents,
      all_events: events,
    };

    fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n✅ Saved to ${CONFIG.OUTPUT_FILE}`);

    // Print code snippet for scraper
    console.log("\n📋 Copy this to scrapeHTGSports.js HEARTLAND_EVENTS array:\n");
    heartlandEvents.forEach(event => {
      const year = event.name.match(/20\d{2}/)?.[0] || "2025";
      console.log(`    { id: ${event.id}, name: "${event.name}", year: ${year} },`);
    });

  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
