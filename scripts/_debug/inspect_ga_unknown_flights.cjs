/**
 * Inspect the 92 "unknown" flights in GA Fall 2025 event.
 * These are likely Girls flights without agecodes in the URL.
 * Need to determine: What metadata can we extract from link text, TD cells, or schedule pages?
 */
require("dotenv").config();
const cheerio = require("cheerio");

const SUBDOMAIN = "gs-fall25gplacadathclrias";
const TOURNAMENT_GUID = "E7A6731D-D5FF-41B4-9C3C-300ECEE69150";
const BASE_URL = `https://${SUBDOMAIN}.sportsaffinity.com/tour/public/info`;

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  return { status: res.status, url: res.url, html: await res.text() };
}

async function main() {
  console.log("=== GA Unknown Flights Investigation ===\n");

  // Fetch accepted_list
  const url = `${BASE_URL}/accepted_list.asp?sessionguid=&tournamentguid=${TOURNAMENT_GUID}`;
  const result = await fetchPage(url);
  const $ = cheerio.load(result.html);

  // Categorize ALL flight links
  const allFlights = [];
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

    // Get the row context
    const row = $(a).closest("tr");
    const rowCells = [];
    row.find("td").each((_, td) => {
      rowCells.push($(td).text().trim());
    });

    allFlights.push({
      guid,
      agecode: am ? am[1] : null,
      linkText: text,
      rowCells,
      href: href.substring(0, 200),
    });
  });

  console.log(`Total unique flights: ${allFlights.length}`);

  // Separate known (with agecode) vs unknown
  const known = allFlights.filter((f) => f.agecode);
  const unknown = allFlights.filter((f) => !f.agecode);

  console.log(`\nKnown (with agecode): ${known.length}`);
  for (const f of known.slice(0, 5)) {
    console.log(`  ${f.agecode} | text="${f.linkText}" | cells=[${f.rowCells.join(" | ")}]`);
  }

  console.log(`\nUnknown (no agecode): ${unknown.length}`);
  console.log("\nFirst 30 unknown flights:");
  for (const f of unknown.slice(0, 30)) {
    console.log(`  text="${f.linkText}" | cells=[${f.rowCells.join(" | ")}] | guid=${f.guid.substring(0, 8)}...`);
  }

  // Try to find patterns in link text / row cells for Girls
  console.log("\n\n=== Pattern analysis in unknown flights ===");
  const patterns = {
    hasGirls: unknown.filter((f) => f.rowCells.some((c) => /girl|athena|she/i.test(c)) || /girl|athena/i.test(f.linkText)),
    hasBoys: unknown.filter((f) => f.rowCells.some((c) => /\bboy\b/i.test(c)) || /\bboy\b/i.test(f.linkText)),
    hasU12: unknown.filter((f) => f.rowCells.some((c) => /U-?\d{1,2}/i.test(c)) || /U-?\d{1,2}/i.test(f.linkText)),
    hasAge: unknown.filter((f) => f.rowCells.some((c) => /\b(12|13|14|15|16|17|18|19)U/i.test(c) || /U(12|13|14|15|16|17|18|19)/i.test(c))),
    hasGender: unknown.filter((f) => f.rowCells.some((c) => /\b[BG]\d{1,2}\b/i.test(c))),
    hasGPL: unknown.filter((f) => f.rowCells.some((c) => /GPL|Athena|Classic|Academy|RIAS|Champ|Conf/i.test(c)) || /GPL|Athena|Classic|Academy|RIAS|Champ|Conf/i.test(f.linkText)),
    hasBirthYear: unknown.filter((f) => f.rowCells.some((c) => /20[01]\d/i.test(c)) || /20[01]\d/i.test(f.linkText)),
  };

  for (const [name, matches] of Object.entries(patterns)) {
    console.log(`  ${name}: ${matches.length} flights`);
    if (matches.length > 0 && matches.length <= 10) {
      matches.forEach((f) => console.log(`    text="${f.linkText}" | cells=[${f.rowCells.join(" | ")}]`));
    } else if (matches.length > 10) {
      matches.slice(0, 3).forEach((f) => console.log(`    text="${f.linkText}" | cells=[${f.rowCells.join(" | ")}]`));
    }
  }

  // Sample a few unknown flights' schedule pages to see what data they contain
  console.log("\n\n=== Sampling 3 unknown flight schedule pages ===\n");
  for (const flight of unknown.slice(0, 3)) {
    console.log(`--- Flight: "${flight.linkText}" (${flight.guid.substring(0, 8)}...) ---`);
    const schedUrl = `${BASE_URL}/schedule_results2.asp?sessionguid=&flightguid=${flight.guid}&tournamentguid=${TOURNAMENT_GUID}`;
    const schedResult = await fetchPage(schedUrl);
    const $s = cheerio.load(schedResult.html);

    // Get page title or header
    const title = $s("title").text().trim();
    console.log(`  Title: "${title}"`);

    // Check <b> date headers
    const headers = [];
    $s("b").each((_, b) => {
      const text = $s(b).text().trim();
      if (text.match(/\d{4}/) || text.length > 5) headers.push(text);
    });
    console.log(`  Headers (${headers.length}): ${headers.slice(0, 5).join(" | ")}`);

    // Count match tables and rows
    let matchTables = 0;
    let matchRows = 0;
    $s("table").each((_, table) => {
      const headerText = $s(table).find("tr").first().text();
      if (headerText.includes("Home Team") || headerText.includes("Home")) {
        matchTables++;
        matchRows += $s(table).find("tr").length - 1;
      }
    });
    console.log(`  Match tables: ${matchTables} | Match rows: ${matchRows}`);

    // Show first few match rows
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

    // Look at ALL text on the page for clues about gender/age
    const allText = $s("body").text();
    const genderClues = allText.match(/\b(Girls?|Boys?|Athena|Classic|U\d{1,2}|B\d{1,2}|G\d{1,2})\b/gi);
    if (genderClues) {
      const clueFreq = {};
      genderClues.forEach((c) => { clueFreq[c] = (clueFreq[c] || 0) + 1; });
      console.log(`  Gender/age clues: ${JSON.stringify(clueFreq)}`);
    }

    console.log();
    // Rate limit
    await new Promise(r => setTimeout(r, 1500));
  }

  // Also extract flight names from TD cells using our existing pattern
  console.log("\n=== Flight names from TD cells ===");
  const flightNames = new Map();
  const allTdTexts = [];
  $("td").each((_, td) => {
    const text = $(td).text().trim();
    if (text && text.length > 3 && text.length < 100) allTdTexts.push(text);
    // Existing regex
    const nameMatch = text.match(/^(\d{1,2}U[BG])\s+(.+)/i);
    if (nameMatch) {
      const row = $(td).closest("tr");
      const link = row.find('a[href*="flightguid"]').first();
      if (link.length) {
        const href = link.attr("href") || "";
        const fm = href.match(/flightguid=([A-F0-9-]+)/i);
        if (fm) flightNames.set(fm[1].toUpperCase(), text);
      }
    }
  });
  console.log(`  Matched via existing regex: ${flightNames.size}`);

  // Try broader patterns
  const broadPatterns = [
    /^(\d{1,2}U[BG])\s+(.+)/i,       // Current: "12UB Pre GPL"
    /^([BG]\d{1,2})\s+(.+)/i,          // Alt: "B12 Pre GPL"
    /^(U\d{1,2})\s+([BG])\s+(.+)/i,   // "U12 B Pre GPL"
    /^(U\d{1,2}[BG]?)\s+(.+)/i,       // "U12 Pre GPL" or "U12B Pre GPL"
    /.*\b(U\d{1,2})\b.*/i,             // Contains U12 anywhere
    /.*\b(\d{1,2}U[BG])\b.*/i,        // Contains 12UB anywhere
    /.*(GPL|Athena|Classic|Academy|RIAS|Champ|Conf|Pre).*/i,  // League level keywords
  ];

  for (const pat of broadPatterns) {
    const matches = allTdTexts.filter((t) => pat.test(t));
    console.log(`  Pattern ${pat.source}: ${matches.length} matches`);
    if (matches.length > 0 && matches.length <= 5) {
      matches.forEach((t) => console.log(`    "${t}"`));
    } else if (matches.length > 5) {
      matches.slice(0, 3).forEach((t) => console.log(`    "${t}"`));
    }
  }

  console.log("\n=== DONE ===");
}

main().catch(console.error);
