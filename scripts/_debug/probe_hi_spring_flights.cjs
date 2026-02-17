/**
 * Quick check: what flights does HI Spring 2026 have? (Boys/Girls?)
 */
require('dotenv').config();
const https = require('https');
const cheerio = require('cheerio');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
}

async function main() {
  // Check Spring 2026
  const springHtml = await fetchUrl('https://ol-spring-25-26.sportsaffinity.com/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid=94D44303-F331-4505-92B2-813593B3FC50');
  const $ = cheerio.load(springHtml);

  const flights = [];
  const seenGuids = new Set();
  $('a[href*="flightguid"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const fm = href.match(/flightguid=([A-F0-9-]+)/i);
    const am = href.match(/agecode=([A-Z]\d+)/i);
    if (!fm) return;
    const guid = fm[1].toUpperCase();
    if (seenGuids.has(guid)) return;
    seenGuids.add(guid);
    flights.push({ guid, agecode: am ? am[1] : null });
  });

  console.log('Spring 2026 flights:');
  for (const f of flights) {
    console.log(`  ${f.agecode || '?'}: ${f.guid.substring(0, 8)}...`);
  }

  // Also check if there's a separate Girls season
  // Try common patterns
  const girlsGuesses = [
    { name: 'Girls Fall 25-26', subdomain: 'ol-girls-fall-25-26', guid: 'AD6E28FC-3EBE-46E9-842B-66E6A2EEB086' },
    { name: 'Winter Comp', subdomain: 'ol-winter-25-26', guid: 'AD6E28FC-3EBE-46E9-842B-66E6A2EEB086' },
  ];

  // Check oahuleague.com schedules page for all season links
  console.log('\nChecking oahuleague.com for all season links...');
  const mainHtml = await fetchUrl('https://www.oahuleague.com/schedule/schedules/');
  const $m = cheerio.load(mainHtml);

  // Angular site may not have static content, but let's check
  console.log(`Body length: ${mainHtml.length}`);

  // Search for any sportsaffinity URLs
  const saUrls = mainHtml.match(/[a-z0-9-]+\.sportsaffinity\.com/gi) || [];
  const uniqueSaUrls = [...new Set(saUrls)];
  console.log(`\nSportsAffinity subdomains found:`);
  uniqueSaUrls.forEach(u => console.log(`  ${u}`));

  // Search for tournament GUIDs
  const guids = mainHtml.match(/[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}/gi) || [];
  const uniqueGuids = [...new Set(guids)];
  console.log(`\nGUIDs found: ${uniqueGuids.length}`);
  uniqueGuids.forEach(g => console.log(`  ${g}`));
}

main().catch(console.error);
