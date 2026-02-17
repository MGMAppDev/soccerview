/**
 * Probe RI Super Liga (thesuperliga.com) endpoints
 * Test both GET and POST requests to understand the data structure
 */
require('dotenv').config();
const http = require('http');
const https = require('https');
const querystring = require('querystring');

function fetchUrl(url, options = {}) {
  const proto = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        ...options.headers
      },
      timeout: 15000
    };

    const req = proto.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function postUrl(url, params) {
  const body = querystring.stringify(params);
  return fetchUrl(url, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'Referer': 'https://www.thesuperliga.com/',
      'Origin': 'https://www.thesuperliga.com'
    }
  });
}

async function main() {
  console.log('=== RI Super Liga Probe ===\n');

  // 1. Fetch main page
  console.log('--- Step 1: Fetch main page ---');
  try {
    const mainPage = await fetchUrl('https://www.thesuperliga.com/');
    console.log(`Status: ${mainPage.status}`);
    console.log(`Body length: ${mainPage.body.length}`);

    // Extract select dropdowns
    const selectMatches = mainPage.body.match(/<select[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/select>/gi) || [];
    console.log(`Select dropdowns found: ${selectMatches.length}`);

    for (const sel of selectMatches) {
      const idMatch = sel.match(/id="([^"]*)"/);
      const options = sel.match(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/gi) || [];
      if (idMatch) {
        console.log(`\n  Dropdown: ${idMatch[1]} (${options.length} options)`);
        options.slice(0, 10).forEach(opt => {
          const vMatch = opt.match(/value="([^"]*)"/);
          const tMatch = opt.match(/>([^<]*)/);
          if (vMatch && tMatch) {
            console.log(`    "${vMatch[1]}" → ${tMatch[1].trim()}`);
          }
        });
        if (options.length > 10) console.log(`    ... and ${options.length - 10} more`);
      }
    }

    // Look for getSomething function patterns
    const functionCalls = mainPage.body.match(/getSomething\(['"](\w+)['"]\)/gi) || [];
    console.log(`\ngetSomething calls: ${functionCalls.join(', ') || 'none found'}`);

    // Look for PHP endpoints
    const phpEndpoints = mainPage.body.match(/actions\/\w+\.php/gi) || [];
    const uniqueEndpoints = [...new Set(phpEndpoints)];
    console.log(`PHP endpoints: ${uniqueEndpoints.join(', ') || 'none found'}`);

    // Check for tab structure
    const tabs = mainPage.body.match(/<a[^>]*href="#tabs-(\d+)"[^>]*>([^<]*)/gi) || [];
    console.log(`\nTabs: ${tabs.length}`);
    tabs.forEach(t => {
      const m = t.match(/href="#tabs-(\d+)"[^>]*>([^<]*)/);
      if (m) console.log(`  Tab ${m[1]}: ${m[2].trim()}`);
    });

  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // 2. Try POST to getScores.php with various params
  console.log('\n\n--- Step 2: Test POST endpoints ---');

  // Try common age groups
  const ageGroups = ['U8', 'U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U15', 'U16', 'U17', 'U19'];
  const divisions = ['Anchor', 'Classic Gold', 'Classic Blue', 'Rhody', 'Gold', 'Silver', 'Blue', 'White'];
  const leagues = ['Spring', 'Fall', 'Spring 2025', 'Fall 2025', 'Spring 2026'];

  // Try getScores.php
  console.log('\nTesting getScores.php...');
  for (const age of ['U11', 'U13', 'U15']) {
    for (const league of ['Spring', 'Spring 2026', 'Fall 2025']) {
      for (const div of ['Anchor', 'Classic Gold', '1', 'A']) {
        try {
          const result = await postUrl('https://www.thesuperliga.com/actions/getScores.php', {
            thing_code: age,
            league: league,
            age_group: age,
            division: div
          });
          if (result.body.length > 100 && !result.body.includes('_gaq')) {
            console.log(`  getScores(${age}, ${league}, ${div}): ${result.status}, ${result.body.length} bytes`);
            const snippet = result.body.substring(0, 300).replace(/\s+/g, ' ');
            console.log(`    Snippet: ${snippet.substring(0, 250)}`);
            // Don't try more - we found data
            break;
          }
        } catch (e) {
          // skip
        }
      }
    }
  }

  // Try getStandings.php
  console.log('\nTesting getStandings.php...');
  for (const age of ['U11', 'U13', 'U15']) {
    for (const league of ['Spring', 'Spring 2026', 'Fall 2025']) {
      for (const div of ['Anchor', 'Classic Gold', '1', 'A']) {
        try {
          const result = await postUrl('https://www.thesuperliga.com/actions/getStandings.php', {
            thing_code: age,
            league: league,
            age_group: age,
            division: div
          });
          if (result.body.length > 100 && !result.body.includes('_gaq')) {
            console.log(`  getStandings(${age}, ${league}, ${div}): ${result.status}, ${result.body.length} bytes`);
            const snippet = result.body.substring(0, 300).replace(/\s+/g, ' ');
            console.log(`    Snippet: ${snippet.substring(0, 250)}`);
            break;
          }
        } catch (e) {
          // skip
        }
      }
    }
  }

  // Try getSchedule.php
  console.log('\nTesting getSchedule.php...');
  for (const league of ['Spring', 'Spring 2026', 'Fall 2025']) {
    for (const age of ['U11', 'U13', 'U15']) {
      try {
        const result = await postUrl('https://www.thesuperliga.com/actions/getSchedule.php', {
          thing_code: 'All',
          league: league,
          age_group: age
        });
        if (result.body.length > 100 && !result.body.includes('_gaq')) {
          console.log(`  getSchedule(All, ${league}, ${age}): ${result.status}, ${result.body.length} bytes`);
          const snippet = result.body.substring(0, 500).replace(/\s+/g, ' ');
          console.log(`    Snippet: ${snippet.substring(0, 400)}`);
          break;
        }
      } catch (e) {
        // skip
      }
    }
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
