/**
 * Heartland Soccer API Discovery Tool
 * ====================================
 *
 * Intercepts network traffic to discover hidden API endpoints
 * that power the Heartland Soccer calendar and schedule systems.
 *
 * This script:
 * 1. Opens the calendar pages in a headless browser
 * 2. Captures ALL network requests (XHR, Fetch, WebSocket)
 * 3. Identifies JSON API endpoints
 * 4. Logs request/response patterns for reverse engineering
 *
 * Usage:
 *   node scripts/inspectHeartlandAPIs.js
 *
 * Prerequisites:
 *   npm install puppeteer
 */

import puppeteer from "puppeteer";
import fs from "fs";

// ===========================================
// URLS TO INSPECT
// ===========================================

const URLS_TO_INSPECT = [
  // Heartland Soccer Calendar
  { name: "Calendar Home", url: "https://calendar.heartlandsoccer.net/" },
  { name: "Team Lookup", url: "https://calendar.heartlandsoccer.net/team/" },

  // HTGSports Events (with hash navigation)
  { name: "HTGSports Event", url: "https://events.htgsports.net/?eventid=11647" },
  { name: "HTGSports Schedule", url: "https://events.htgsports.net/?eventid=11647#/scheduleresults" },
  { name: "HTGSports Brackets", url: "https://events.htgsports.net/?eventid=11647#/brackets" },

  // Main Heartland site
  { name: "League Schedules", url: "https://www.heartlandsoccer.net/league/league-schedules/" },
  { name: "Score Standings", url: "https://www.heartlandsoccer.net/league/score-standings/" },

  // Registration portal
  { name: "Registration", url: "https://registration.heartlandsoccer.net/" },
];

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log("🔍 Heartland Soccer API Discovery Tool");
  console.log("======================================\n");
  console.log("Intercepting network traffic to find hidden APIs...\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const discoveredAPIs = [];
  const allRequests = [];

  try {
    const page = await browser.newPage();

    // Enable request interception
    await page.setRequestInterception(true);

    // Capture all requests
    page.on("request", request => {
      const url = request.url();
      const method = request.method();
      const resourceType = request.resourceType();
      const headers = request.headers();

      // Log interesting requests
      if (resourceType === "xhr" || resourceType === "fetch" ||
          url.includes("api") || url.includes("json") ||
          url.includes("data") || url.includes("schedule") ||
          url.includes("team") || url.includes("game") ||
          url.includes("match") || url.includes("event")) {

        const entry = {
          url: url,
          method: method,
          type: resourceType,
          headers: headers,
          timestamp: new Date().toISOString(),
        };
        allRequests.push(entry);

        // Check if this looks like an API endpoint
        if (url.includes("/api/") || url.endsWith(".json") ||
            url.includes("?") && (resourceType === "xhr" || resourceType === "fetch")) {
          console.log(`\n🎯 POTENTIAL API FOUND:`);
          console.log(`   Type: ${resourceType.toUpperCase()}`);
          console.log(`   Method: ${method}`);
          console.log(`   URL: ${url}`);

          discoveredAPIs.push(entry);
        }
      }

      request.continue();
    });

    // Capture responses to see data format
    page.on("response", async response => {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()["content-type"] || "";

      // Check for JSON responses
      if (contentType.includes("json") ||
          url.includes("api") ||
          url.endsWith(".json")) {
        try {
          const text = await response.text();
          console.log(`\n📦 JSON RESPONSE:`);
          console.log(`   URL: ${url}`);
          console.log(`   Status: ${status}`);
          console.log(`   Content-Type: ${contentType}`);
          console.log(`   Preview: ${text.substring(0, 500)}...`);

          // Find matching request and add response
          const matchingReq = discoveredAPIs.find(r => r.url === url);
          if (matchingReq) {
            matchingReq.response = {
              status: status,
              contentType: contentType,
              preview: text.substring(0, 1000),
            };
          }
        } catch (e) {
          // Response body not available
        }
      }
    });

    // Visit each URL and wait for network activity
    for (const target of URLS_TO_INSPECT) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`📍 Inspecting: ${target.name}`);
      console.log(`   URL: ${target.url}`);
      console.log("=".repeat(60));

      try {
        await page.goto(target.url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // Wait extra time for any lazy-loaded content
        await new Promise(r => setTimeout(r, 5000));

        // Trigger any interactive elements that might load data
        await page.evaluate(() => {
          // Click any "load more" or "show schedule" buttons
          const buttons = document.querySelectorAll("button, [onclick], .btn");
          buttons.forEach(btn => {
            const text = btn.innerText.toLowerCase();
            if (text.includes("schedule") || text.includes("load") ||
                text.includes("show") || text.includes("search")) {
              try {
                btn.click();
              } catch (e) {}
            }
          });

          // Trigger form submissions if any
          const forms = document.querySelectorAll("form");
          forms.forEach(form => {
            const inputs = form.querySelectorAll("input[type='text']");
            if (inputs.length > 0) {
              // Fill with test data and submit
              inputs[0].value = "test";
            }
          });
        });

        await new Promise(r => setTimeout(r, 3000));

        // Also check for embedded iframes
        const iframes = await page.$$("iframe");
        for (const iframe of iframes) {
          const src = await iframe.evaluate(el => el.src);
          if (src) {
            console.log(`\n🖼️ Found iframe: ${src}`);
          }
        }

        // Check for script sources that might reveal API patterns
        const scripts = await page.evaluate(() => {
          const scripts = [];
          document.querySelectorAll("script[src]").forEach(s => {
            scripts.push(s.src);
          });
          return scripts;
        });

        console.log(`\n📜 JavaScript files loaded:`);
        scripts.forEach(s => console.log(`   ${s}`));

        // Look for inline scripts with API URLs
        const inlineAPIs = await page.evaluate(() => {
          const patterns = [];
          document.querySelectorAll("script:not([src])").forEach(script => {
            const content = script.innerHTML;
            // Look for API patterns
            const apiMatches = content.match(/(https?:\/\/[^\s"']+api[^\s"']*)/gi);
            const fetchMatches = content.match(/fetch\s*\(\s*['"]([^'"]+)['"]/gi);
            const ajaxMatches = content.match(/\$\.(?:ajax|get|post)\s*\(\s*['"]([^'"]+)['"]/gi);

            if (apiMatches) patterns.push(...apiMatches);
            if (fetchMatches) patterns.push(...fetchMatches);
            if (ajaxMatches) patterns.push(...ajaxMatches);
          });
          return [...new Set(patterns)];
        });

        if (inlineAPIs.length > 0) {
          console.log(`\n🔑 API patterns found in inline scripts:`);
          inlineAPIs.forEach(api => console.log(`   ${api}`));
          discoveredAPIs.push(...inlineAPIs.map(url => ({
            url: url,
            source: "inline_script",
            page: target.name,
          })));
        }

        // Check for data attributes
        const dataAttrs = await page.evaluate(() => {
          const attrs = [];
          document.querySelectorAll("[data-url], [data-api], [data-endpoint], [data-source]").forEach(el => {
            attrs.push({
              tag: el.tagName,
              dataUrl: el.getAttribute("data-url"),
              dataApi: el.getAttribute("data-api"),
              dataEndpoint: el.getAttribute("data-endpoint"),
              dataSource: el.getAttribute("data-source"),
            });
          });
          return attrs;
        });

        if (dataAttrs.length > 0) {
          console.log(`\n📌 Data attributes found:`);
          dataAttrs.forEach(attr => console.log(`   ${JSON.stringify(attr)}`));
        }

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }

  } finally {
    await browser.close();
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 DISCOVERY SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total requests captured: ${allRequests.length}`);
  console.log(`Potential APIs found: ${discoveredAPIs.length}`);

  if (discoveredAPIs.length > 0) {
    console.log("\n🎯 DISCOVERED API ENDPOINTS:");
    discoveredAPIs.forEach((api, i) => {
      console.log(`\n${i + 1}. ${api.url || api}`);
      if (api.method) console.log(`   Method: ${api.method}`);
      if (api.type) console.log(`   Type: ${api.type}`);
      if (api.source) console.log(`   Source: ${api.source}`);
      if (api.response) {
        console.log(`   Response Status: ${api.response.status}`);
        console.log(`   Content Type: ${api.response.contentType}`);
      }
    });
  }

  // Save full results
  const output = {
    discovered_at: new Date().toISOString(),
    apis: discoveredAPIs,
    all_requests: allRequests,
  };

  fs.writeFileSync("scripts/heartland_api_discovery.json", JSON.stringify(output, null, 2));
  console.log("\n✅ Full results saved to scripts/heartland_api_discovery.json");

  // Generate recommendations
  console.log("\n" + "=".repeat(60));
  console.log("💡 NEXT STEPS");
  console.log("=".repeat(60));
  console.log("1. Review heartland_api_discovery.json for API patterns");
  console.log("2. Test discovered endpoints with curl or Postman");
  console.log("3. Check if APIs require authentication");
  console.log("4. Look for parameter patterns (team IDs, date ranges)");
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
