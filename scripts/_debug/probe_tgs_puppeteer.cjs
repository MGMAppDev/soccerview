/**
 * Discover ALL TotalGlobalSports event IDs using Puppeteer.
 * Probes IDs 3880-3960 to find ECNL/ECRL 2025-26 conferences.
 * Uses puppeteer-extra with stealth to bypass Cloudflare.
 */
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const BASE_URL = "https://public.totalglobalsports.com/public/event";
const START_ID = 3880;
const END_ID = 3960;

async function main() {
  console.log(`=== TGS Event Discovery (${START_ID}-${END_ID}) ===\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const discovered = [];
  const errors = [];

  for (let id = START_ID; id <= END_ID; id++) {
    const url = `${BASE_URL}/${id}/schedules-standings`;
    try {
      // Navigate with short timeout — just need the title
      await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });

      // Wait for Angular to render the event title (look for h1, h2, or specific class)
      await page.waitForSelector("h1, h2, .event-name, .event-title, .title", { timeout: 8000 }).catch(() => {});

      // Extract event information
      const eventInfo = await page.evaluate(() => {
        // Try multiple selectors for event name
        const selectors = [
          "h1", "h2", ".event-name", ".event-title",
          "[class*='event-name']", "[class*='title']",
          ".mat-toolbar", "mat-toolbar",
        ];

        let title = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim().length > 3) {
            title = el.textContent.trim();
            break;
          }
        }

        // Check if the page has meaningful content (not a 404/error)
        const bodyText = document.body.textContent || "";
        const has404 = bodyText.includes("Page Not Found") || bodyText.includes("404") || bodyText.includes("Event not found");
        const hasSchedule = bodyText.includes("Schedule") || bodyText.includes("Standings") || bodyText.includes("Conference");

        // Try to find age group links
        const ageGroupLinks = [];
        document.querySelectorAll("a").forEach((a) => {
          const text = a.textContent.trim();
          if (text.match(/[BG]\d{4}|U\d{1,2}/i)) {
            ageGroupLinks.push(text);
          }
        });

        return {
          title: title || document.title,
          has404,
          hasSchedule,
          ageGroups: ageGroupLinks.slice(0, 10),
          url: window.location.href,
        };
      });

      if (!eventInfo.has404 && eventInfo.hasSchedule) {
        console.log(`  ✅ ${id}: "${eventInfo.title}" [${eventInfo.ageGroups.slice(0, 5).join(", ")}]`);
        discovered.push({
          id,
          title: eventInfo.title,
          ageGroups: eventInfo.ageGroups,
        });
      } else if (!eventInfo.has404) {
        // Might be valid but no schedule yet
        console.log(`  ⚠️  ${id}: "${eventInfo.title}" (no schedule content)`);
        discovered.push({
          id,
          title: eventInfo.title,
          ageGroups: eventInfo.ageGroups,
          noSchedule: true,
        });
      } else {
        console.log(`  ❌ ${id}: Not found / 404`);
      }
    } catch (err) {
      console.log(`  ❌ ${id}: ${err.message.substring(0, 80)}`);
      errors.push({ id, error: err.message });
    }

    // Brief delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 2000));
  }

  await browser.close();

  // Summary
  console.log(`\n\n=== DISCOVERY SUMMARY ===`);
  console.log(`Total probed: ${END_ID - START_ID + 1}`);
  console.log(`Events found: ${discovered.length}`);
  console.log(`Errors: ${errors.length}\n`);

  console.log("=== FOUND EVENTS ===");
  for (const e of discovered) {
    const status = e.noSchedule ? "⚠️  (no schedule)" : "✅";
    console.log(`  ${status} ${e.id}: "${e.title}" [${e.ageGroups.join(", ")}]`);
  }

  // Output as JSON for adapter config
  console.log("\n=== ADAPTER CONFIG (copy to totalglobalsports.js) ===");
  for (const e of discovered.filter(e => !e.noSchedule)) {
    const isECRL = (e.title || "").includes("RL") || (e.title || "").includes("Regional");
    const isGirls = (e.title || "").includes("Girls") || (e.title || "").includes("Girl");
    const isBoys = (e.title || "").includes("Boys") || (e.title || "").includes("Boy");
    const type = isECRL ? "ECRL" : "ECNL";
    const gender = isGirls ? "Girls" : isBoys ? "Boys" : "Unknown";
    console.log(`  { id: "${e.id}", name: "${e.title}", type: "league", year: 2026, gender: "${gender}", tier: "${type}" },`);
  }
}

main().catch(console.error);
