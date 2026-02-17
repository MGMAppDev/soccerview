/**
 * RI Super Liga - Try multiple approaches to find data
 * Per Principle 42: Never accept "blocked"
 */
require('dotenv').config();
const https = require('https');
const http = require('http');
const querystring = require('querystring');

function fetchUrl(url) {
  const proto = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = proto.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function postUrl(url, params) {
  const body = querystring.stringify(params);
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proto = url.startsWith('https') ? https : http;
    const req = proto.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.thesuperliga.com/',
        'Origin': 'https://www.thesuperliga.com'
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

const GA_SNIPPET_LEN = 832; // The GA-only response length

async function main() {
  console.log('=== RI Super Liga Fallback Probe ===\n');
  console.log('GA-only response threshold: ≤' + GA_SNIPPET_LEN + ' bytes\n');

  // Approach 1: Try many league/age combos for getScores
  console.log('--- Approach 1: Brute-force POST combos ---\n');

  const ageGroups = ['7U', '8U', '9U', '10U', '11U', '12U', '13U', '14U', '15U', '16U', '17U', '19U',
                     'U7', 'U8', 'U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U15', 'U16', 'U17', 'U19',
                     '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '19'];
  const leagues = ['Spring', 'Fall', 'Spring 2025', 'Fall 2025', 'Spring 2026', 'Fall 2024',
                   'Spring 25', 'Fall 25', 'spring', 'fall', 'SPRING', 'FALL',
                   'spring-2025', 'fall-2025', '2025', '2026', 'current'];
  const divisions = ['Anchor', 'Classic Gold', 'Classic Blue', 'Rhody', 'Gold', 'Silver', 'Blue', 'White',
                     '1', '2', '3', '4', 'A', 'B', 'C', 'D', 'anchor', 'classic'];

  let found = false;
  for (const league of leagues) {
    if (found) break;
    for (const age of ageGroups.slice(0, 12)) { // Use first format
      if (found) break;
      try {
        const r = await postUrl('https://www.thesuperliga.com/actions/getScores.php', {
          thing_code: age,
          league,
          age_group: age
        });
        if (r.body.length > GA_SNIPPET_LEN) {
          console.log(`  FOUND DATA! age=${age}, league=${league}: ${r.body.length} bytes`);
          console.log(`  Snippet: ${r.body.substring(0, 300).replace(/\s+/g, ' ')}`);
          found = true;
        }
      } catch (e) { /* skip */ }
    }
  }
  if (!found) console.log('  No data found via getScores.php\n');

  // Approach 2: Try getStandings with same combos
  console.log('--- Approach 2: getStandings brute-force ---\n');
  found = false;
  for (const league of leagues) {
    if (found) break;
    for (const age of ageGroups.slice(0, 12)) {
      if (found) break;
      for (const div of divisions.slice(0, 4)) {
        try {
          const r = await postUrl('https://www.thesuperliga.com/actions/getStandings.php', {
            thing_code: age,
            league,
            age_group: age,
            division: div
          });
          if (r.body.length > GA_SNIPPET_LEN) {
            console.log(`  FOUND! age=${age}, league=${league}, div=${div}: ${r.body.length} bytes`);
            console.log(`  Snippet: ${r.body.substring(0, 300).replace(/\s+/g, ' ')}`);
            found = true;
            break;
          }
        } catch (e) { /* skip */ }
      }
    }
  }
  if (!found) console.log('  No data found via getStandings.php\n');

  // Approach 3: Try getSchedule with town codes
  console.log('--- Approach 3: getSchedule brute-force ---\n');
  found = false;
  const towns = ['All', 'CYSA', 'OSNK', 'Middletown', 'Seekonk', 'East Providence',
                 'Portsmouth', 'South County', 'Smithfield', 'Warwick', 'Cranston',
                 'all', 'EP', 'SC', 'NK', 'MW', 'PT', 'SM', 'WK', 'CR'];
  for (const league of ['Spring', 'Fall', 'Spring 2025', 'Fall 2025', 'Spring 2026']) {
    if (found) break;
    for (const age of ['U12', 'U13', 'U14', '12U', '13U', 'All']) {
      if (found) break;
      for (const town of towns) {
        try {
          const r = await postUrl('https://www.thesuperliga.com/actions/getSchedule.php', {
            thing_code: town,
            league,
            age_group: age
          });
          if (r.body.length > GA_SNIPPET_LEN) {
            console.log(`  FOUND! town=${town}, league=${league}, age=${age}: ${r.body.length} bytes`);
            console.log(`  Snippet: ${r.body.substring(0, 300).replace(/\s+/g, ' ')}`);
            found = true;
            break;
          }
        } catch (e) { /* skip */ }
      }
    }
  }
  if (!found) console.log('  No data found via getSchedule.php\n');

  // Approach 4: Look for other PHP endpoints or data files
  console.log('--- Approach 4: Probe other URLs ---\n');
  const urls = [
    'https://www.thesuperliga.com/actions/',
    'https://www.thesuperliga.com/api/',
    'https://www.thesuperliga.com/data/',
    'https://www.thesuperliga.com/json/',
    'https://www.thesuperliga.com/admin/',
    'https://www.thesuperliga.com/actions/getLeagues.php',
    'https://www.thesuperliga.com/actions/getAgeGroups.php',
    'https://www.thesuperliga.com/actions/getDivisions.php',
    'https://www.thesuperliga.com/actions/getSeasons.php',
    'https://www.thesuperliga.com/actions/getTeams.php',
    'https://www.thesuperliga.com/actions/getGames.php',
    'https://www.thesuperliga.com/actions/getResults.php',
    'https://www.thesuperliga.com/actions/getData.php',
    'https://www.thesuperliga.com/actions/getAll.php',
    'https://www.thesuperliga.com/robots.txt',
    'https://www.thesuperliga.com/sitemap.xml',
  ];

  for (const url of urls) {
    try {
      const r = await fetchUrl(url);
      if (r.status === 200 && r.body.length > 100 && !r.body.includes('_gaq') && !r.body.includes('404')) {
        console.log(`  ${r.status} ${url}: ${r.body.length} bytes`);
        if (r.body.length < 1000) console.log(`    ${r.body.substring(0, 200).replace(/\s+/g, ' ')}`);
      } else {
        console.log(`  ${r.status} ${url}: ${r.body.length} bytes (GA only or empty)`);
      }
    } catch (e) {
      console.log(`  ERR ${url}: ${e.message}`);
    }
  }

  // Approach 5: Check Wayback Machine
  console.log('\n--- Approach 5: Wayback Machine ---\n');
  try {
    const r = await fetchUrl('https://web.archive.org/web/2025/https://www.thesuperliga.com/');
    console.log(`Wayback status: ${r.status}`);
    if (r.headers.location) console.log(`Redirect: ${r.headers.location}`);
    // Check for saved snapshots
    const cdx = await fetchUrl('https://web.archive.org/cdx/search/cdx?url=thesuperliga.com/actions/getScores.php&output=text&limit=5');
    console.log(`CDX API: ${cdx.body.length > 0 ? cdx.body.substring(0, 500) : 'no results'}`);
  } catch (e) {
    console.log(`  Wayback error: ${e.message}`);
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
