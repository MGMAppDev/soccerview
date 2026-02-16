/**
 * Try extracting session GUIDs from PA-W tournament list and using them to access events.
 * Also try: direct schedule_results2, Wayback Machine cache, different URL patterns.
 */
require("dotenv").config();
const cheerio = require("cheerio");

const PAW_BASE = "https://pawest.sportsaffinity.com";

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  return { status: res.status, url: res.url, html: await res.text() };
}

async function main() {
  console.log("=== PA-W Session/URL Pattern Investigation ===\n");

  // Strategy 1: Check if the tournament list page provides session GUIDs in links
  console.log("1. Checking tournament list for session GUIDs...");
  const listUrl = `${PAW_BASE}/tour/public/info/tournamentlist.asp?sessionguid=&section=gaming`;
  const listResult = await fetchPage(listUrl);
  const $ = cheerio.load(listResult.html);

  const sessionGuids = new Set();
  $("a").each((_, a) => {
    const href = $(a).attr("href") || "";
    const sm = href.match(/sessionguid=([A-F0-9-]+)/i);
    if (sm && sm[1]) sessionGuids.add(sm[1]);
  });
  console.log(`   Session GUIDs found: ${sessionGuids.size}`);
  for (const sg of sessionGuids) console.log(`   ${sg}`);

  // Check all href patterns in tournament list
  const hrefPatterns = new Set();
  $("a").each((_, a) => {
    const href = $(a).attr("href") || "";
    if (href.includes("tournament") || href.includes("session") || href.includes("flight")) {
      // Extract the URL pattern (replace GUIDs with {guid})
      const pattern = href.replace(/[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}/gi, "{GUID}");
      hrefPatterns.add(pattern);
    }
  });
  console.log(`\n   URL patterns in tournament list:`);
  for (const p of hrefPatterns) console.log(`   ${p}`);

  // Strategy 2: Try the GLC with a session GUID if found
  const GLC_FALL = "A960EA85-CC2A-4797-B56B-A489591B0CD4";
  const GLC_SPRING = "ECCA2C2A-4BF9-43FE-8F75-5346D96736D8";

  if (sessionGuids.size > 0) {
    const session = [...sessionGuids][0];
    console.log(`\n2. Trying GLC with session GUID ${session}...`);
    const testUrl = `${PAW_BASE}/tour/public/info/accepted_list.asp?sessionguid=${session}&tournamentguid=${GLC_SPRING}`;
    const testResult = await fetchPage(testUrl);
    console.log(`   Status: ${testResult.status} | Redirected: ${testResult.url.includes("UnPublished")} | Size: ${testResult.html.length}`);
  }

  // Strategy 3: Try tournament info page (sometimes has different access)
  console.log("\n3. Trying tournament_info.asp...");
  for (const [name, guid] of [["Fall GLC", GLC_FALL], ["Spring GLC", GLC_SPRING]]) {
    const infoUrl = `${PAW_BASE}/tour/public/info/tournament_info.asp?sessionguid=&tournamentguid=${guid}`;
    const infoResult = await fetchPage(infoUrl);
    const isUnpub = infoResult.url.includes("UnPublished");
    console.log(`   ${name}: ${infoResult.status} | Unpub: ${isUnpub} | Size: ${infoResult.html.length}`);
    if (!isUnpub) {
      const $info = cheerio.load(infoResult.html);
      console.log(`   Title: "${$info("title").text().trim()}"`);
      // Look for flight/division links
      let flightLinks = 0;
      $info("a").each((_, a) => {
        const href = $info(a).attr("href") || "";
        if (href.includes("flight") || href.includes("schedule")) flightLinks++;
      });
      console.log(`   Flight/schedule links: ${flightLinks}`);
    }
  }

  // Strategy 4: Try alternative URL structures
  console.log("\n4. Trying alternative URL structures...");
  const altUrls = [
    `${PAW_BASE}/tour/public/info/schedule_list.asp?sessionguid=&tournamentguid=${GLC_SPRING}`,
    `${PAW_BASE}/tour/public/info/standings.asp?sessionguid=&tournamentguid=${GLC_SPRING}`,
    `${PAW_BASE}/tour/public/info/schedule_results.asp?sessionguid=&tournamentguid=${GLC_SPRING}`,
    `${PAW_BASE}/tour/public/info/teams.asp?sessionguid=&tournamentguid=${GLC_SPRING}`,
    `${PAW_BASE}/tour/public/info/brackets.asp?sessionguid=&tournamentguid=${GLC_SPRING}`,
  ];
  for (const url of altUrls) {
    const parts = url.split("/").pop().split("?")[0];
    const result = await fetchPage(url);
    const isUnpub = result.url.includes("UnPublished");
    console.log(`   ${parts}: ${result.status} | Unpub: ${isUnpub} | Size: ${result.html.length}`);
  }

  // Strategy 5: Check Wayback Machine for Fall GLC
  console.log("\n5. Checking Wayback Machine for Fall GLC...");
  const waybackUrl = `https://web.archive.org/web/2025*/https://pawest.sportsaffinity.com/tour/public/info/accepted_list.asp*tournamentguid=${GLC_FALL}`;
  try {
    const wayRes = await fetch(`https://archive.org/wayback/available?url=pawest.sportsaffinity.com/tour/public/info/accepted_list.asp?tournamentguid=${GLC_FALL}&timestamp=20251115`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const wayData = await wayRes.json();
    console.log(`   Wayback result:`, JSON.stringify(wayData));
  } catch (err) {
    console.log(`   Wayback error: ${err.message}`);
  }

  // Strategy 6: Try a currently-published PA-W event to see if the site is working at all
  console.log("\n6. Testing a current PA-W tournament (State Cup)...");
  const stateCupGuid = "CDDF6DEC-3F2C-4477-AB8C-58A9D27C3B61";
  const cupUrl = `${PAW_BASE}/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid=${stateCupGuid}`;
  const cupResult = await fetchPage(cupUrl);
  const cupUnpub = cupResult.url.includes("UnPublished");
  console.log(`   State Cup: ${cupResult.status} | Unpub: ${cupUnpub} | Size: ${cupResult.html.length}`);
  if (!cupUnpub) {
    const $cup = cheerio.load(cupResult.html);
    let cupFlights = 0;
    $cup('a[href*="flightguid"]').each(() => cupFlights++);
    console.log(`   Flight links: ${cupFlights}`);
  }

  console.log("\n=== DONE ===");
}

main().catch(console.error);
