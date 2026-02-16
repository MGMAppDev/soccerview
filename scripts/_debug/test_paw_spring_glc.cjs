/**
 * Test PA-W Spring 2026 GLC and also try Fall 2025 GLC direct schedule access.
 */
require("dotenv").config();
const cheerio = require("cheerio");

const PAW_BASE = "https://pawest.sportsaffinity.com/tour/public/info";

const EVENTS = [
  { name: "Spring 2026 GLC/NAL/E64", guid: "ECCA2C2A-4BF9-43FE-8F75-5346D96736D8", season: "spring" },
  { name: "Spring 2026 Classic League", guid: "289045CB-66E7-46B9-8EE8-6D31F3361119", season: "spring" },
  { name: "Fall 2025 GLC/NAL/E64 (archived)", guid: "A960EA85-CC2A-4797-B56B-A489591B0CD4", season: "fall-archived" },
];

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  return { status: res.status, finalUrl: res.url, html: await res.text() };
}

async function testEvent(event) {
  console.log(`\n=== ${event.name} (${event.guid.substring(0, 8)}...) ===`);

  // Test accepted_list
  const accUrl = `${PAW_BASE}/accepted_list.asp?sessionguid=&tournamentguid=${event.guid}`;
  const accResult = await fetchPage(accUrl);
  const redirected = accResult.finalUrl.includes("UnPublished");
  console.log(`  accepted_list: ${accResult.status} | Redirected: ${redirected} | Size: ${accResult.html.length}`);

  if (redirected) {
    console.log("  ** UNPUBLISHED — accepted_list not available **");
    return { flights: 0, flightGuids: [] };
  }

  const $ = cheerio.load(accResult.html);

  // Extract flights
  const flights = [];
  const seenGuids = new Set();
  $('a[href*="flightguid"]').each((_, a) => {
    const href = $(a).attr("href") || "";
    const text = $(a).text().trim();
    const fm = href.match(/flightguid=([A-F0-9-]+)/i);
    const am = href.match(/agecode=([A-Z0-9]+)/i);
    if (!fm) return;
    const guid = fm[1].toUpperCase();
    if (seenGuids.has(guid)) return;
    seenGuids.add(guid);
    flights.push({ guid, agecode: am ? am[1] : null, text });
  });

  // Also try extracting flight names from <td> cells
  const flightNames = new Map();
  $("td").each((_, td) => {
    const text = $(td).text().trim();
    if (text && text.length > 3 && text.length < 100) {
      // Try matching various patterns
      const row = $(td).closest("tr");
      const link = row.find('a[href*="flightguid"]').first();
      if (link.length) {
        const href = link.attr("href") || "";
        const fm = href.match(/flightguid=([A-F0-9-]+)/i);
        if (fm) {
          flightNames.set(fm[1].toUpperCase(), text);
        }
      }
    }
  });

  console.log(`  Flights found: ${flights.length}`);
  for (const f of flights.slice(0, 15)) {
    const name = flightNames.get(f.guid) || "no-name-match";
    console.log(`    agecode=${f.agecode || "null"} text="${f.text}" name="${name}" guid=${f.guid.substring(0, 8)}...`);
  }
  if (flights.length > 15) console.log(`    ... +${flights.length - 15} more flights`);

  // Test first flight schedule
  if (flights.length > 0) {
    const firstFlight = flights[0];
    console.log(`\n  Testing schedule for first flight (${firstFlight.guid.substring(0, 8)}...):`);
    const schedUrl = `${PAW_BASE}/schedule_results2.asp?sessionguid=&flightguid=${firstFlight.guid}&tournamentguid=${event.guid}`;
    const schedResult = await fetchPage(schedUrl);
    const $s = cheerio.load(schedResult.html);

    // Count date headers and match tables
    let dateHeaders = 0;
    $s("b").each((_, b) => {
      if ($s(b).text().match(/\d{4}/)) dateHeaders++;
    });

    let matchTables = 0;
    let matchRows = 0;
    $s("table").each((_, table) => {
      const headerText = $s(table).find("tr").first().text();
      if (headerText.includes("Home Team") || headerText.includes("Home")) {
        matchTables++;
        matchRows += $s(table).find("tr").length - 1;
      }
    });

    console.log(`    Schedule size: ${schedResult.html.length} | Date headers: ${dateHeaders} | Match tables: ${matchTables} | Match rows: ${matchRows}`);

    // Show first few rows
    if (matchRows > 0) {
      let shown = 0;
      $s("table").each((_, table) => {
        const headerText = $s(table).find("tr").first().text();
        if (headerText.includes("Home Team") && shown < 3) {
          $s(table).find("tr").slice(1, 4).each((_, row) => {
            const cells = [];
            $s(row).find("td").each((_, td) => cells.push($s(td).text().trim()));
            console.log(`    Row: [${cells.join(" | ")}]`);
            shown++;
          });
        }
      });
    }
  }

  return { flights: flights.length, flightGuids: flights.map(f => f.guid) };
}

async function main() {
  for (const event of EVENTS) {
    await testEvent(event);
  }
  console.log("\n=== DONE ===");
}

main().catch(console.error);
