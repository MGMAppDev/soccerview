/**
 * Find GA Girls data - check Spring 2026 SA event and search GotSport.
 */
require("dotenv").config();
const cheerio = require("cheerio");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  return { status: res.status, url: res.url, html: await res.text() };
}

async function main() {
  console.log("=== Finding GA Girls Data ===\n");

  // 1. Check Spring 2026 GA event for Girls flights
  console.log("1. Spring 2026 GA event flights...");
  const springUrl = "https://gs.sportsaffinity.com/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid=CE35DE7A-39D2-40C0-BA3B-2A46C862535C";
  const springResult = await fetchPage(springUrl);

  if (!springResult.url.includes("UnPublished")) {
    const $ = cheerio.load(springResult.html);
    const flights = { boys: 0, girls: 0, total: 0 };
    const seenGuids = new Set();
    $('a[href*="flightguid"]').each((_, a) => {
      const href = $(a).attr("href") || "";
      const fm = href.match(/flightguid=([A-F0-9-]+)/i);
      const am = href.match(/agecode=([A-Z0-9]+)/i);
      if (!fm) return;
      const guid = fm[1].toUpperCase();
      if (seenGuids.has(guid)) return;
      seenGuids.add(guid);
      flights.total++;
      if (am) {
        if (am[1].startsWith("B") || am[1].startsWith("b")) flights.boys++;
        else if (am[1].startsWith("G") || am[1].startsWith("g")) flights.girls++;
      }
    });
    console.log(`   Total: ${flights.total} | Boys: ${flights.boys} | Girls: ${flights.girls}`);
  } else {
    console.log("   UNPUBLISHED");
  }

  // 2. Check what GA Girls teams exist in our database
  console.log("\n2. GA Girls teams in database...");
  const { rows: gaGirls } = await pool.query(`
    SELECT birth_year, COUNT(*) as cnt,
           SUM(CASE WHEN matches_played > 0 THEN 1 ELSE 0 END) as with_matches
    FROM teams_v2
    WHERE state = 'GA' AND gender = 'F' AND birth_year IS NOT NULL
    GROUP BY birth_year
    ORDER BY birth_year DESC
  `);
  console.log(`   GA Girls teams by birth_year:`);
  gaGirls.forEach((r) => console.log(`     ${r.birth_year}: ${r.cnt} teams (${r.with_matches} with matches)`));

  // 3. Check GA Girls matches in database
  const { rows: gaGirlsMatches } = await pool.query(`
    SELECT COUNT(*) as cnt
    FROM matches_v2 m
    JOIN teams_v2 ht ON m.home_team_id = ht.id
    WHERE ht.state = 'GA' AND ht.gender = 'F' AND m.deleted_at IS NULL
  `);
  console.log(`\n   GA Girls matches (as home): ${gaGirlsMatches[0]?.cnt}`);

  // 4. Check GotSport for GA Girls events
  console.log("\n3. GA Girls events in GotSport (checking leagues table)...");
  const { rows: gaLeagues } = await pool.query(`
    SELECT id, name, state, region, source_platform, season_id
    FROM leagues
    WHERE (state = 'GA' OR name ILIKE '%georgia%' OR name ILIKE '%GPL%')
    ORDER BY name
  `);
  console.log(`   GA leagues: ${gaLeagues.length}`);
  gaLeagues.forEach((l) => console.log(`     ${l.name} (state=${l.state}, platform=${l.source_platform})`));

  // 5. Check canonical_events for GA
  const { rows: gaEvents } = await pool.query(`
    SELECT canonical_name, source_platform, event_type
    FROM canonical_events
    WHERE canonical_name ILIKE '%georgia%' OR canonical_name ILIKE '%GPL%' OR canonical_name ILIKE '%athena%'
    ORDER BY canonical_name
    LIMIT 20
  `);
  console.log(`\n4. GA-related canonical events: ${gaEvents.length}`);
  gaEvents.forEach((e) => console.log(`     "${e.canonical_name}" (${e.source_platform}, ${e.event_type})`));

  // 6. Check GotSport for events with GA girls
  console.log("\n5. GotSport events with GA teams...");
  const { rows: gsEvents } = await pool.query(`
    SELECT DISTINCT l.name, l.state, l.source_platform, COUNT(m.id) as match_count
    FROM leagues l
    JOIN matches_v2 m ON m.league_id = l.id
    JOIN teams_v2 ht ON m.home_team_id = ht.id
    WHERE ht.state = 'GA' AND ht.gender = 'F' AND m.deleted_at IS NULL
    GROUP BY l.name, l.state, l.source_platform
    ORDER BY match_count DESC
    LIMIT 15
  `);
  console.log(`   Leagues with GA Girls matches:`);
  gsEvents.forEach((e) => console.log(`     "${e.name}" (${e.state}, ${e.source_platform}): ${e.match_count} matches`));

  // 7. Check tournaments too
  const { rows: gsTournaments } = await pool.query(`
    SELECT DISTINCT t.name, t.state, t.source_platform, COUNT(m.id) as match_count
    FROM tournaments t
    JOIN matches_v2 m ON m.tournament_id = t.id
    JOIN teams_v2 ht ON m.home_team_id = ht.id
    WHERE ht.state = 'GA' AND ht.gender = 'F' AND m.deleted_at IS NULL
    GROUP BY t.name, t.state, t.source_platform
    ORDER BY match_count DESC
    LIMIT 15
  `);
  console.log(`\n   Tournaments with GA Girls matches:`);
  gsTournaments.forEach((e) => console.log(`     "${e.name}" (${e.state}, ${e.source_platform}): ${e.match_count} matches`));

  // 8. Check the Fall 2021 Athena event to understand structure
  console.log("\n6. Checking last Athena event (Spring 2021)...");
  const athenaGuid = "D38BC090-35CB-4C34-BDBE-D79B8179A25C";
  const athenaUrl = `https://gs-fall25gplacadathclrias.sportsaffinity.com/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid=${athenaGuid}`;
  const athenaResult = await fetchPage(athenaUrl);
  if (!athenaResult.url.includes("UnPublished")) {
    const $a = cheerio.load(athenaResult.html);
    const athenaFlights = { boys: 0, girls: 0, total: 0 };
    const aseenGuids = new Set();
    $a('a[href*="flightguid"]').each((_, a) => {
      const href = $a(a).attr("href") || "";
      const fm = href.match(/flightguid=([A-F0-9-]+)/i);
      const am = href.match(/agecode=([A-Z0-9]+)/i);
      if (!fm) return;
      const guid = fm[1].toUpperCase();
      if (aseenGuids.has(guid)) return;
      aseenGuids.add(guid);
      athenaFlights.total++;
      if (am) {
        if (am[1].startsWith("B") || am[1].startsWith("b")) athenaFlights.boys++;
        else if (am[1].startsWith("G") || am[1].startsWith("g")) athenaFlights.girls++;
      }
    });
    console.log(`   Athena Spring 2021: Total: ${athenaFlights.total} | Boys: ${athenaFlights.boys} | Girls: ${athenaFlights.girls}`);
  } else {
    console.log("   UNPUBLISHED");
  }

  await pool.end();
  console.log("\n=== DONE ===");
}

main().catch(console.error);
