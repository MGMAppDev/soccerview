/**
 * Diagnostic 3: List ALL available PA-W tournaments and leagues
 * Check both the "tournaments" and "leagues" (gaming) sections.
 */
require("dotenv").config();
const cheerio = require("cheerio");

const SUBDOMAIN = "pawest";
const BASE_URL = `https://${SUBDOMAIN}.sportsaffinity.com`;

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  console.log(`  HTTP ${res.status} → ${res.url}`);
  return res.text();
}

async function main() {
  console.log("=== PA West Available Events ===\n");

  // Check tournaments page
  for (const section of ["", "gaming"]) {
    const label = section === "gaming" ? "LEAGUES" : "TOURNAMENTS";
    const url = `${BASE_URL}/tour/public/info/tournamentlist.asp?sessionguid=` +
      (section ? `&section=${section}` : "");
    console.log(`\n=== ${label} (${url}) ===`);
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // Find links to tournaments
    const events = [];
    $("a").each((_, a) => {
      const href = $(a).attr("href") || "";
      const text = $(a).text().trim();
      if (href.includes("tournamentguid") || href.includes("accepted_list")) {
        const guidMatch = href.match(/tournamentguid=([A-F0-9-]+)/i);
        events.push({
          text,
          href: href.substring(0, 150),
          guid: guidMatch ? guidMatch[1] : "unknown",
        });
      }
    });

    if (events.length > 0) {
      console.log(`  Found ${events.length} events:`);
      for (const e of events) {
        console.log(`    "${e.text}" GUID=${e.guid}`);
      }
    } else {
      console.log("  No events found with tournament links.");

      // Dump the page content for analysis
      const tds = [];
      $("td").each((_, td) => {
        const text = $(td).text().trim();
        if (text && text.length > 3 && text.length < 200) tds.push(text);
      });
      console.log(`  TD cells with content: ${tds.length}`);
      tds.slice(0, 20).forEach((t) => console.log(`    "${t}"`));

      // Check for any links
      const links = [];
      $("a").each((_, a) => {
        const href = $(a).attr("href") || "";
        const text = $(a).text().trim();
        if (text && !href.includes("javascript") && text !== "Click Here To Go Back") {
          links.push({ text: text.substring(0, 60), href: href.substring(0, 100) });
        }
      });
      console.log(`\n  Links: ${links.length}`);
      links.slice(0, 30).forEach((l) => console.log(`    "${l.text}" → ${l.href}`));
    }
  }

  // Also try the "past tournaments" tab
  console.log("\n=== PAST TOURNAMENTS (?tourtab=past) ===");
  const pastUrl = `${BASE_URL}/tour/public/info/tournamentlist.asp?sessionguid=&tourtab=past`;
  console.log(`Fetching: ${pastUrl}`);
  const pastHtml = await fetchPage(pastUrl);
  const $p = cheerio.load(pastHtml);

  const pastEvents = [];
  $p("a").each((_, a) => {
    const href = $p(a).attr("href") || "";
    const text = $p(a).text().trim();
    if (href.includes("tournamentguid")) {
      const guidMatch = href.match(/tournamentguid=([A-F0-9-]+)/i);
      pastEvents.push({
        text,
        guid: guidMatch ? guidMatch[1] : "unknown",
      });
    }
  });
  console.log(`  Found ${pastEvents.length} past events:`);
  pastEvents.forEach((e) => console.log(`    "${e.text}" GUID=${e.guid}`));

  // Try past leagues too
  console.log("\n=== PAST LEAGUES (?section=gaming&tourtab=past) ===");
  const pastLeaguesUrl = `${BASE_URL}/tour/public/info/tournamentlist.asp?sessionguid=&section=gaming&tourtab=past`;
  console.log(`Fetching: ${pastLeaguesUrl}`);
  const pastLeaguesHtml = await fetchPage(pastLeaguesUrl);
  const $pl = cheerio.load(pastLeaguesHtml);

  const pastLeagues = [];
  $pl("a").each((_, a) => {
    const href = $pl(a).attr("href") || "";
    const text = $pl(a).text().trim();
    if (href.includes("tournamentguid")) {
      const guidMatch = href.match(/tournamentguid=([A-F0-9-]+)/i);
      pastLeagues.push({
        text,
        guid: guidMatch ? guidMatch[1] : "unknown",
      });
    }
  });
  console.log(`  Found ${pastLeagues.length} past leagues:`);
  pastLeagues.forEach((e) => console.log(`    "${e.text}" GUID=${e.guid}`));

  console.log("\n=== DONE ===");
}

main().catch(console.error);
