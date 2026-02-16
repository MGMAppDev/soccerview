/**
 * Discover ECNL event names by intercepting XHR requests on TGS pages.
 * TGS is an Angular SPA — real data comes via XHR after page load.
 * This script captures those XHR responses to get actual event names.
 */
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const BASE_URL = "https://public.totalglobalsports.com/public/event";

// IDs to probe — confirmed range from research + broader scan
const IDS_TO_PROBE = [];
for (let i = 3880; i <= 3960; i++) IDS_TO_PROBE.push(i);
// Also check a few broader ranges
for (let i = 3800; i <= 3815; i++) IDS_TO_PROBE.push(i);
for (let i = 3970; i <= 3985; i++) IDS_TO_PROBE.push(i);
for (let i = 4010; i <= 4020; i++) IDS_TO_PROBE.push(i);
for (let i = 4050; i <= 4060; i++) IDS_TO_PROBE.push(i);

async function main() {
  console.log(`=== TGS Event Name Discovery via XHR Interception ===`);
  console.log(`Probing ${IDS_TO_PROBE.length} event IDs\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const discovered = [];

  for (const id of IDS_TO_PROBE) {
    const url = `${BASE_URL}/${id}/schedules-standings`;

    // Capture XHR responses
    const xhrData = [];
    const xhrHandler = (response) => {
      const reqUrl = response.url();
      if (reqUrl.includes("/api/") || reqUrl.includes("/Script/")) {
        response.text().then((text) => {
          try {
            const json = JSON.parse(text);
            xhrData.push({ url: reqUrl, data: json });
          } catch {}
        }).catch(() => {});
      }
    };
    page.on("response", xhrHandler);

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
      // Wait a bit for XHR requests to complete
      await new Promise((r) => setTimeout(r, 3000));

      // Extract event name from page
      const eventName = await page.evaluate(() => {
        // TGS typically shows event name in the page somewhere
        // Try reading the page title or breadcrumbs
        const all = document.body.innerText || "";

        // Look for ECNL/ECRL in page content
        const ecnlMatch = all.match(/(ECNL|ECRL|Pre-ECNL|Pre-ECRL)[^\n]*(Boys|Girls)[^\n]*/i);
        if (ecnlMatch) return ecnlMatch[0].trim().substring(0, 100);

        // Look for event title in header/toolbar
        const headers = document.querySelectorAll("h1, h2, h3, .toolbar-title, mat-toolbar span");
        for (const h of headers) {
          const text = h.textContent.trim();
          if (text.length > 5 && text.length < 100 && !text.match(/^[BG]\d{4}/)) {
            return text;
          }
        }

        // Look for breadcrumbs or navigation
        const navs = document.querySelectorAll("nav, .breadcrumb, [class*='nav']");
        for (const nav of navs) {
          const text = nav.textContent.trim();
          if (text.includes("ECNL") || text.includes("ECRL")) {
            return text.substring(0, 100);
          }
        }

        return null;
      });

      // Check XHR data for event info
      let xhrEventName = null;
      for (const xhr of xhrData) {
        if (xhr.data && typeof xhr.data === "object") {
          // Look for event name in XHR response
          const str = JSON.stringify(xhr.data);
          if (str.includes("ECNL") || str.includes("ECRL")) {
            const nameMatch = str.match(/"(?:EventName|eventName|Name|name)"\s*:\s*"([^"]+)"/);
            if (nameMatch) {
              xhrEventName = nameMatch[1];
            } else {
              // Try to find the name in the first few hundred chars
              const ecnlPos = str.indexOf("ECNL");
              const ecrlPos = str.indexOf("ECRL");
              const pos = Math.min(ecnlPos >= 0 ? ecnlPos : 999999, ecrlPos >= 0 ? ecrlPos : 999999);
              if (pos < 999999) {
                xhrEventName = str.substring(Math.max(0, pos - 30), Math.min(str.length, pos + 80));
              }
            }
          }
        }
      }

      const name = eventName || xhrEventName;
      const isECNL = name && (name.includes("ECNL") || name.includes("ECRL") || name.includes("Pre-ECNL"));

      if (isECNL) {
        console.log(`  ✅ ${id}: "${name}"`);
        discovered.push({ id, name });
      } else if (name) {
        // Not ECNL but has a name — might be another sport/event
        // Only log every 10th to reduce noise
        if (id % 10 === 0) console.log(`  ⏭️  ${id}: "${name}" (not ECNL)`);
      } else {
        if (id % 10 === 0) console.log(`  ❌ ${id}: No event name found`);
      }
    } catch (err) {
      if (id % 10 === 0) console.log(`  ❌ ${id}: ${err.message.substring(0, 60)}`);
    }

    page.removeListener("response", xhrHandler);
    await new Promise((r) => setTimeout(r, 1500));
  }

  await browser.close();

  // Summary
  console.log(`\n\n=== ECNL/ECRL EVENTS DISCOVERED ===`);
  console.log(`Total found: ${discovered.length}\n`);
  for (const e of discovered) {
    console.log(`  ${e.id}: "${e.name}"`);
  }

  // Generate adapter config
  if (discovered.length > 0) {
    console.log(`\n=== ADAPTER staticEvents CONFIG ===\n`);
    for (const e of discovered) {
      const isECRL = e.name.includes("RL") && !e.name.includes("ECNL");
      const isGirls = /girl/i.test(e.name);
      const gender = isGirls ? "Girls" : "Boys";
      const tier = isECRL ? "ECRL" : /Pre-ECNL/i.test(e.name) ? "Pre-ECNL" : "ECNL";
      const confMatch = e.name.match(/(Southwest|Southeast|Midwest|Mountain|Texas|Northwest|North Atlantic|New England|Ohio Valley|Northern Cal|NorCal|Far West|Mid-Atlantic|Heartland|Mid-America|Florida|Frontier|Chicago|Golden State|Virginia|SoCal)/i);
      const conference = confMatch ? confMatch[1] : "Unknown";
      console.log(`      {
        id: "${e.id}",
        name: "${e.name.replace(/"/g, '\\"')}",
        type: "league",
        year: 2026,
        tier: "${tier}",
        gender: "${gender}",
        conference: "${conference}",
      },`);
    }
  }
}

main().catch(console.error);
