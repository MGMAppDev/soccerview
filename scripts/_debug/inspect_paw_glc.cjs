/**
 * Diagnostic: Inspect PA-W GLC accepted_list.asp HTML structure
 * Determines why flight parser finds null agecodes and "Unknown" names.
 */
require("dotenv").config();
const cheerio = require("cheerio");

const TOURNAMENT_GUID = "A960EA85-CC2A-4797-B56B-A489591B0CD4";
const SUBDOMAIN = "pawest";
const BASE_URL = `https://${SUBDOMAIN}.sportsaffinity.com/tour/public/info`;

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  console.log("=== PA-W GLC Flight Discovery Diagnostic ===\n");

  // Step 1: Fetch accepted_list.asp
  const acceptedUrl = `${BASE_URL}/accepted_list.asp?sessionguid=&tournamentguid=${TOURNAMENT_GUID}`;
  console.log(`Fetching: ${acceptedUrl}\n`);

  const html = await fetchPage(acceptedUrl);
  console.log(`HTML size: ${html.length} bytes\n`);

  const $ = cheerio.load(html);

  // Step 2: Find ALL links with flightguid
  console.log("=== ALL flightguid links ===");
  const allLinks = [];
  $('a[href*="flightguid"]').each((i, a) => {
    const href = $(a).attr("href") || "";
    const text = $(a).text().trim();
    allLinks.push({ href, text });
    if (i < 10) {
      console.log(`  Link ${i}: text="${text}" href="${href.substring(0, 120)}..."`);
    }
  });
  console.log(`  Total flightguid links: ${allLinks.length}\n`);

  // Step 3: Check for agecode in URLs
  console.log("=== Agecode analysis ===");
  let withAgecode = 0;
  let withoutAgecode = 0;
  const agecodes = new Set();
  for (const link of allLinks) {
    const ageMatch = link.href.match(/agecode=([A-Z0-9]+)/i);
    if (ageMatch) {
      withAgecode++;
      agecodes.add(ageMatch[1]);
    } else {
      withoutAgecode++;
    }
  }
  console.log(`  Links with agecode: ${withAgecode}`);
  console.log(`  Links without agecode: ${withoutAgecode}`);
  console.log(`  Unique agecodes: ${[...agecodes].join(", ") || "NONE"}\n`);

  // Step 4: Check unique flight GUIDs
  console.log("=== Unique flights ===");
  const flightGuids = new Map(); // guid -> { texts, agecodes }
  for (const link of allLinks) {
    const fm = link.href.match(/flightguid=([A-F0-9-]+)/i);
    if (!fm) continue;
    const guid = fm[1].toUpperCase();
    if (!flightGuids.has(guid)) {
      flightGuids.set(guid, { texts: new Set(), agecodes: new Set() });
    }
    const entry = flightGuids.get(guid);
    if (link.text) entry.texts.add(link.text);
    const am = link.href.match(/agecode=([A-Z0-9]+)/i);
    if (am) entry.agecodes.add(am[1]);
  }
  console.log(`  Unique flight GUIDs: ${flightGuids.size}`);
  let fi = 0;
  for (const [guid, info] of flightGuids) {
    if (fi < 30) {
      console.log(
        `    ${guid.substring(0, 8)}... texts=[${[...info.texts].join(", ")}] agecodes=[${[...info.agecodes].join(", ")}]`
      );
    }
    fi++;
  }
  console.log();

  // Step 5: Check <td> cells for flight names
  console.log("=== TD cell analysis ===");
  const tdTexts = [];
  $("td").each((_, td) => {
    const text = $(td).text().trim();
    if (text && text.length > 2 && text.length < 100) {
      tdTexts.push(text);
    }
  });
  console.log(`  Total non-empty <td> cells: ${tdTexts.length}`);

  // Check which match the current regex
  const currentRegex = /^(\d{1,2}U[BG])\s+(.+)/i;
  const matchingCurrent = tdTexts.filter((t) => currentRegex.test(t));
  console.log(`  Matching current regex (\\d{1,2}U[BG] ...): ${matchingCurrent.length}`);
  if (matchingCurrent.length > 0) {
    matchingCurrent.slice(0, 5).forEach((t) => console.log(`    "${t}"`));
  }

  // Check for alternative patterns
  const altPatterns = [
    { name: "U followed by number", regex: /U-?\d{1,2}/i },
    { name: "Boys or Girls", regex: /\b(Boys|Girls|Boy|Girl)\b/i },
    { name: "B followed by digits", regex: /^[BG]\d{1,2}\b/i },
    { name: "Age group like U12", regex: /\bU\d{1,2}\b/i },
    { name: "Division/Group/Flight", regex: /\b(Division|Group|Flight|Bracket|Conference|Tier)\b/i },
    { name: "Birth year 20xx", regex: /\b20[01]\d\b/ },
    { name: "GLC/NAL/E64", regex: /\b(GLC|NAL|E64|Elite)\b/i },
  ];
  console.log("\n  Alternative pattern matches in TD cells:");
  for (const pat of altPatterns) {
    const matches = tdTexts.filter((t) => pat.regex.test(t));
    console.log(`    ${pat.name}: ${matches.length} matches`);
    if (matches.length > 0 && matches.length <= 10) {
      matches.forEach((t) => console.log(`      "${t}"`));
    } else if (matches.length > 10) {
      matches.slice(0, 5).forEach((t) => console.log(`      "${t}"`));
      console.log(`      ... and ${matches.length - 5} more`);
    }
  }

  // Step 6: Sample full rows that contain flightguid links
  console.log("\n=== Sample rows with flight links ===");
  let rowCount = 0;
  $("tr").each((_, tr) => {
    const rowLinks = $(tr).find('a[href*="flightguid"]');
    if (rowLinks.length > 0 && rowCount < 10) {
      const cells = [];
      $(tr)
        .find("td")
        .each((_, td) => {
          cells.push($(td).text().trim());
        });
      console.log(`  Row ${rowCount}: [${cells.join(" | ")}]`);
      rowCount++;
    }
  });

  // Step 7: Look at link text more broadly
  console.log("\n=== All link texts (from flight links) ===");
  const linkTexts = new Set();
  $('a[href*="flightguid"]').each((_, a) => {
    const text = $(a).text().trim();
    if (text) linkTexts.add(text);
  });
  console.log(`  Unique link texts: ${linkTexts.size}`);
  for (const t of [...linkTexts].slice(0, 30)) {
    console.log(`    "${t}"`);
  }

  // Step 8: If we found flights, try fetching one schedule page
  if (flightGuids.size > 0) {
    const firstGuid = [...flightGuids.keys()][0];
    console.log(`\n=== Sample schedule page (flight ${firstGuid.substring(0, 8)}...) ===`);
    const schedUrl = `${BASE_URL}/schedule_results2.asp?sessionguid=&flightguid=${firstGuid}&tournamentguid=${TOURNAMENT_GUID}`;
    console.log(`Fetching: ${schedUrl}\n`);

    try {
      const schedHtml = await fetchPage(schedUrl);
      console.log(`Schedule HTML size: ${schedHtml.length} bytes`);
      const $s = cheerio.load(schedHtml);

      // Check for date headers
      const dateHeaders = [];
      $s("b").each((_, b) => {
        const text = $s(b).text().trim();
        if (text.match(/\d{4}/) || text.match(/\w+day/i)) {
          dateHeaders.push(text);
        }
      });
      console.log(`  Date headers (<b> tags): ${dateHeaders.length}`);
      dateHeaders.slice(0, 5).forEach((d) => console.log(`    "${d}"`));

      // Check for match tables
      let matchTables = 0;
      $s("table").each((_, table) => {
        const headerText = $s(table).find("tr").first().text();
        if (headerText.includes("Home Team") || headerText.includes("Home")) {
          matchTables++;
          if (matchTables <= 2) {
            console.log(`\n  Match table ${matchTables} header: "${headerText.substring(0, 100)}"`);
            const rows = $s(table).find("tr").slice(1, 4); // First 3 data rows
            rows.each((ri, row) => {
              const cells = [];
              $s(row)
                .find("td")
                .each((_, td) => cells.push($s(td).text().trim()));
              console.log(`    Row ${ri}: [${cells.join(" | ")}]`);
            });
          }
        }
      });
      console.log(`  Total match tables: ${matchTables}`);

      // Check page title or tournament name
      const title = $s("title").text().trim();
      console.log(`\n  Page title: "${title}"`);
    } catch (err) {
      console.error(`  Schedule fetch error: ${err.message}`);
    }
  }

  console.log("\n=== DONE ===");
}

main().catch(console.error);
