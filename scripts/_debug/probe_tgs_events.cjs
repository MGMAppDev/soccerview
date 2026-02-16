/**
 * Probe TotalGlobalSports event IDs 3880-3960 to discover ALL ECNL/ECRL events.
 * Strategy: Try API endpoints first (faster), fall back to page scraping.
 */
require("dotenv").config();

async function fetchJSON(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch { return null; }
}

async function fetchHTML(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,*/*",
      },
    });
    if (!res.ok) return null;
    return res.text();
  } catch { return null; }
}

async function main() {
  console.log("=== TGS Event ID Probe ===\n");

  // Strategy 1: Try known API endpoints
  console.log("1. Testing API endpoints...\n");

  const apiPatterns = [
    "https://public.totalglobalsports.com/api/Script/get-event-list",
    "https://public.totalglobalsports.com/api/Script/get-events",
    "https://public.totalglobalsports.com/api/events",
    "https://public.totalglobalsports.com/api/Script/get-conference-standings/3933/0/0/0/0",
    "https://public.totalglobalsports.com/api/Script/get-event-info/3933",
    "https://public.totalglobalsports.com/api/Script/get-event/3933",
    "https://public.totalglobalsports.com/api/Script/get-schedule/3933",
    // Try the ecnl subdomain
    "https://ecnl.totalglobalsports.com/api/events",
    "https://ecnl.totalglobalsports.com/api/Script/get-event-list",
  ];

  for (const url of apiPatterns) {
    const data = await fetchJSON(url);
    if (data) {
      console.log(`  ✅ ${url.split("/").slice(-3).join("/")}: ${typeof data === "string" ? data.substring(0, 200) : JSON.stringify(data).substring(0, 300)}`);
    } else {
      console.log(`  ❌ ${url.split("/").slice(-3).join("/")}`);
    }
  }

  // Strategy 2: Check the HTML page source for embedded data
  console.log("\n2. Checking page source for embedded event lists...\n");
  const pageUrl = "https://public.totalglobalsports.com/public/event/3933/schedules-standings";
  const html = await fetchHTML(pageUrl);
  if (html) {
    console.log(`  Page size: ${html.length} bytes`);
    // Look for JSON data
    const jsonMatches = html.match(/window\.__[A-Z_]+__\s*=\s*(\{[^;]+\})/g);
    if (jsonMatches) {
      console.log(`  Found ${jsonMatches.length} window.__DATA__ blocks`);
      jsonMatches.forEach((m, i) => console.log(`    ${i}: ${m.substring(0, 200)}`));
    }

    // Look for event references
    const eventRefs = html.match(/event\/(\d{4})/g);
    if (eventRefs) {
      const uniqueIds = [...new Set(eventRefs.map(e => e.replace("event/", "")))].sort();
      console.log(`  Event IDs in HTML: ${uniqueIds.join(", ")}`);
    }

    // Check for API endpoints in JS
    const apiRefs = html.match(/api\/Script\/[a-z-]+/gi);
    if (apiRefs) {
      const unique = [...new Set(apiRefs)];
      console.log(`  API endpoints in HTML: ${unique.join(", ")}`);
    }
  }

  // Strategy 3: Probe event IDs via API (if conference-standings works)
  console.log("\n3. Probing event IDs 3880-3960 via API...\n");

  const discoveredEvents = [];

  // Try conference-standings API for each event ID
  for (let id = 3880; id <= 3960; id++) {
    const url = `https://public.totalglobalsports.com/api/Script/get-conference-standings/${id}/0/0/0/0`;
    const data = await fetchJSON(url);
    if (data && typeof data !== "string" && data !== null) {
      const info = typeof data === "object" ?
        (data.EventName || data.eventName || data.Name || data.name || JSON.stringify(data).substring(0, 100)) :
        String(data).substring(0, 100);
      console.log(`  ✅ ${id}: ${info}`);
      discoveredEvents.push({ id, data: info });
    }
    // No delay needed for API calls (usually)
  }

  // Also try get-event-info pattern
  if (discoveredEvents.length === 0) {
    console.log("  Conference-standings API didn't work. Trying other patterns...\n");

    for (let id = 3880; id <= 3960; id++) {
      const patterns = [
        `https://public.totalglobalsports.com/api/Script/get-event-info/${id}`,
        `https://public.totalglobalsports.com/api/event/${id}`,
      ];
      for (const url of patterns) {
        const data = await fetchJSON(url);
        if (data && data !== "" && data !== "null") {
          console.log(`  ✅ ${id} (${url.split("/").slice(-2).join("/")}): ${JSON.stringify(data).substring(0, 200)}`);
          discoveredEvents.push({ id, data });
          break;
        }
      }
    }
  }

  // Strategy 4: Try broader range for national events
  console.log("\n4. Probing broader range (3800-3830, 3960-4060) for Pre-ECNL and national events...\n");
  for (let id = 3800; id <= 3810; id++) {
    const data = await fetchJSON(`https://public.totalglobalsports.com/api/Script/get-conference-standings/${id}/0/0/0/0`);
    if (data && typeof data === "object") {
      console.log(`  ✅ ${id}: ${JSON.stringify(data).substring(0, 200)}`);
    }
  }
  for (let id = 3970; id <= 3990; id++) {
    const data = await fetchJSON(`https://public.totalglobalsports.com/api/Script/get-conference-standings/${id}/0/0/0/0`);
    if (data && typeof data === "object") {
      console.log(`  ✅ ${id}: ${JSON.stringify(data).substring(0, 200)}`);
    }
  }

  console.log(`\n=== Summary: ${discoveredEvents.length} events discovered ===`);
  discoveredEvents.forEach(e => console.log(`  ${e.id}: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data).substring(0, 100)}`));

  console.log("\n=== DONE ===");
}

main().catch(console.error);
