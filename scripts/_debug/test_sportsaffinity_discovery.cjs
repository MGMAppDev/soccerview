/**
 * Discover ALL Georgia Soccer tournaments on SportsAffinity.
 * Check both Boys and Girls, and multiple seasons.
 * Also check if Spring 2026 has data yet.
 */
const https = require('https');
const cheerio = require('cheerio');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

const SEASONS = [
  { label: 'Fall 2025', subdomain: 'gs-fall25gplacadathclrias', guid: 'E7A6731D-D5FF-41B4-9C3C-300ECEE69150' },
  { label: 'Spring 2026', subdomain: 'gs', guid: 'CE35DE7A-39D2-40C0-BA3B-2A46C862535C' },
  { label: 'Spring 2025', subdomain: 'gs-spr25acadathclrias', guid: '6F94BCCC-EAAD-4369-8598-ECDF00068393' },
  { label: 'Fall 2024', subdomain: 'gs-fall24gplacadathclrias', guid: '7336D9D7-3A6F-46FD-9A85-D263981782DF' },
];

(async () => {
  for (const season of SEASONS) {
    console.log(`\n=== ${season.label} ===`);
    const base = `https://${season.subdomain}.sportsaffinity.com/tour/public/info`;
    const url = `${base}/accepted_list.asp?sessionguid=&tournamentguid=${season.guid}`;

    try {
      const { status, html } = await fetchUrl(url);
      if (status !== 200) {
        console.log(`  Status: ${status} (skipping)`);
        continue;
      }

      const $ = cheerio.load(html);

      // Count flights by age code
      const flights = {};
      const seenGuids = new Set();
      $('a[href*="flightguid"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const flightMatch = href.match(/flightguid=([A-F0-9-]+)/i);
        const ageMatch = href.match(/agecode=([A-Z]\d+)/i);
        if (!flightMatch) return;
        const guid = flightMatch[1].toUpperCase();
        if (seenGuids.has(guid)) return;
        seenGuids.add(guid);
        const age = ageMatch ? ageMatch[1] : 'Unknown';
        flights[age] = (flights[age] || 0) + 1;
      });

      console.log(`  Flights: ${seenGuids.size}`);
      Object.entries(flights).sort().forEach(([age, count]) => {
        console.log(`    ${age}: ${count} flights`);
      });

      // Check for Girls flights
      const hasGirls = Object.keys(flights).some(k => k.startsWith('G'));
      console.log(`  Girls flights: ${hasGirls ? 'YES' : 'NO (Boys only)'}`);

      // Page title for tournament name
      const title = $('title').text().trim();
      console.log(`  Title: ${title}`);

    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Also check Georgia Soccer main page for other tournament links
  console.log('\n\n=== CHECKING georgiasoccer.org FOR MORE TOURNAMENTS ===');
  try {
    const { html } = await fetchUrl('https://www.georgiasoccer.org/leagues');
    const $ = cheerio.load(html);
    const saLinks = [];
    $('a[href*="sportsaffinity"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const text = $(a).text().trim();
      if (href && !saLinks.find(l => l.href === href)) {
        saLinks.push({ href: href.substring(0, 120), text: text.substring(0, 80) });
      }
    });
    console.log(`SportsAffinity links found: ${saLinks.length}`);
    saLinks.forEach(l => console.log(`  "${l.text}" → ${l.href}`));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
