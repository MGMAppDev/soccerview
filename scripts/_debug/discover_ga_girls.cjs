/**
 * Discover GA Girls SportsAffinity event GUIDs.
 * GA Boys uses subdomain "gs-fall25gplacadathclrias". Need to find Girls equivalent.
 * Also check if GA Boys events already include Girls flights.
 */
require("dotenv").config();
const cheerio = require("cheerio");

// Known GA subdomains
const GA_SUBDOMAINS = [
  "gs-fall25gplacadathclrias",  // Fall 2025 GA Boys
  "gs-spr25acadathclrias",       // Spring 2025 GA
  "gs-fall24gplacadathclrias",   // Fall 2024 GA
  "gs",                          // Current/base GA
];

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    return { status: res.status, url: res.url, html: await res.text() };
  } catch (err) {
    return { status: 0, url, html: "", error: err.message };
  }
}

async function checkFlightsForGender(subdomain, guid, eventName) {
  const url = `https://${subdomain}.sportsaffinity.com/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid=${guid}`;
  const result = await fetchPage(url);

  if (result.url.includes("UnPublished") || result.status !== 200) {
    return { accessible: false };
  }

  const $ = cheerio.load(result.html);
  const flights = { boys: 0, girls: 0, unknown: 0 };
  const agecodes = new Set();

  $('a[href*="flightguid"]').each((_, a) => {
    const href = $(a).attr("href") || "";
    const am = href.match(/agecode=([A-Z]\d+)/i);
    if (am) {
      agecodes.add(am[1]);
      if (am[1].startsWith("B") || am[1].startsWith("b")) flights.boys++;
      else if (am[1].startsWith("G") || am[1].startsWith("g")) flights.girls++;
      else flights.unknown++;
    } else {
      flights.unknown++;
    }
  });

  return { accessible: true, flights, agecodes: [...agecodes] };
}

async function discoverEvents(subdomain) {
  const base = `https://${subdomain}.sportsaffinity.com/tour/public/info`;
  const events = [];

  for (const section of ["gaming", ""]) {
    for (const tab of ["current", "past"]) {
      const url = `${base}/tournamentlist.asp?sessionguid=&tourtab=${tab}${section ? `&section=${section}` : ""}`;
      const result = await fetchPage(url);

      if (result.error || result.url.includes("UnPublished")) continue;

      const $ = cheerio.load(result.html);
      $("a").each((_, a) => {
        const href = $(a).attr("href") || "";
        const text = $(a).text().trim();
        const gm = href.match(/tournamentguid=([A-F0-9-]+)/i);
        if (gm && text && !text.includes("Venue") && !text.includes("Field Closures")) {
          events.push({
            name: text,
            guid: gm[1],
            section: section || "tournaments",
            tab,
          });
        }
      });
    }
  }

  // Deduplicate by GUID
  const seen = new Set();
  return events.filter((e) => {
    if (seen.has(e.guid)) return false;
    seen.add(e.guid);
    return true;
  });
}

async function main() {
  console.log("=== GA Girls SportsAffinity GUID Discovery ===\n");

  // Step 1: Check existing GA events for Girls flights
  console.log("Step 1: Check if existing GA events contain Girls flights...\n");

  const existingEvents = [
    { subdomain: "gs-fall25gplacadathclrias", guid: "E7A6731D-D5FF-41B4-9C3C-300ECEE69150", name: "Fall 2025 GPL" },
    { subdomain: "gs", guid: "CE35DE7A-39D2-40C0-BA3B-2A46C862535C", name: "Spring 2026 GPL" },
  ];

  for (const ev of existingEvents) {
    console.log(`  ${ev.name} (${ev.subdomain}):`);
    const result = await checkFlightsForGender(ev.subdomain, ev.guid, ev.name);
    if (result.accessible) {
      console.log(`    Boys: ${result.flights.boys} | Girls: ${result.flights.girls} | Unknown: ${result.flights.unknown}`);
      console.log(`    Agecodes: ${result.agecodes.join(", ")}`);
    } else {
      console.log(`    NOT ACCESSIBLE (unpublished or error)`);
    }
  }

  // Step 2: Discover ALL events on each GA subdomain
  console.log("\n\nStep 2: Discover ALL events on GA subdomains...\n");

  for (const subdomain of GA_SUBDOMAINS) {
    console.log(`\n--- Subdomain: ${subdomain} ---`);
    const events = await discoverEvents(subdomain);
    console.log(`Found ${events.length} events:`);

    // Look for girls-specific events
    const girlsEvents = events.filter(
      (e) =>
        e.name.toLowerCase().includes("girl") ||
        e.name.toLowerCase().includes("athena") ||
        e.name.toLowerCase().includes("she")
    );

    if (girlsEvents.length > 0) {
      console.log(`\n  ** GIRLS EVENTS FOUND: **`);
      for (const ge of girlsEvents) {
        console.log(`    "${ge.name}" GUID=${ge.guid} (${ge.tab}/${ge.section})`);
      }
    }

    // Also list all events for reference
    for (const e of events) {
      const isGirls = e.name.toLowerCase().includes("girl") || e.name.toLowerCase().includes("athena");
      console.log(`  ${isGirls ? "** " : "   "}"${e.name}" GUID=${e.guid} (${e.tab}/${e.section})`);
    }
  }

  // Step 3: Try common GA Girls subdomain patterns
  console.log("\n\nStep 3: Try common Girls subdomain patterns...\n");
  const girlsSubdomainGuesses = [
    "gs-fall25gplacadathclrias",  // Same as boys — might have both
    "gs-fall25-girls",
    "gs-fall25girls",
    "gs-fall25athena",
    "gs-fall25gplacadathclriasgirls",
    "gasoccer",
    "georgia",
    "georgiasoccer",
  ];

  for (const sub of girlsSubdomainGuesses) {
    if (GA_SUBDOMAINS.includes(sub)) continue; // Skip already tested
    const testUrl = `https://${sub}.sportsaffinity.com/tour/public/info/tournamentlist.asp?sessionguid=`;
    try {
      const result = await fetchPage(testUrl);
      const accessible = result.status === 200 && !result.url.includes("UnPublished");
      if (accessible) {
        console.log(`  ✅ ${sub} — ACCESSIBLE! (${result.html.length} bytes)`);
        // Check for events
        const events = await discoverEvents(sub);
        console.log(`     Found ${events.length} events`);
        events.slice(0, 10).forEach((e) => console.log(`       "${e.name}" GUID=${e.guid}`));
      } else {
        console.log(`  ❌ ${sub} — ${result.status} (${result.url.includes("UnPublished") ? "UnPublished" : "other"})`);
      }
    } catch (err) {
      console.log(`  ❌ ${sub} — Error: ${err.message}`);
    }
  }

  console.log("\n=== DONE ===");
}

main().catch(console.error);
