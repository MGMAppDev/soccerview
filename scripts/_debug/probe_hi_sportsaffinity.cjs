/**
 * Probe HI Oahu League SportsAffinity URLs
 * Tests accepted_list.asp and schedule_results2.asp for HI seasons
 */
require('dotenv').config();
const https = require('https');

const SEASONS = [
  { name: 'Fall 2025/26', subdomain: 'ol-fall-25-26', guid: 'AD6E28FC-3EBE-46E9-842B-66E6A2EEB086' },
  { name: 'Spring 2026', subdomain: 'ol-spring-25-26', guid: '94D44303-F331-4505-92B2-813593B3FC50' },
  // Past seasons - try common subdomain patterns
  { name: 'Spring 2025 (v1)', subdomain: 'ol-spring-24-25', guid: '896296D9-741D-4FFB-8B32-4BB6C07D274E' },
  { name: 'Fall 2024/25 (v1)', subdomain: 'ol-fall-24-25', guid: '9D2ADF88-D5D4-40EC-BD31-CE0FF1DCAEAB' },
  // Try without prefix
  { name: 'Fall 2025/26 (no prefix)', subdomain: 'oahu', guid: 'AD6E28FC-3EBE-46E9-842B-66E6A2EEB086' },
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      },
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

async function probeSeason(season) {
  const baseUrl = `https://${season.subdomain}.sportsaffinity.com/tour/public/info`;
  const acceptedUrl = `${baseUrl}/accepted_list.asp?sessionguid=&tournamentguid=${season.guid}`;

  console.log(`\n=== ${season.name} ===`);
  console.log(`  Subdomain: ${season.subdomain}`);
  console.log(`  URL: ${acceptedUrl}`);

  try {
    const result = await fetchUrl(acceptedUrl);
    console.log(`  Status: ${result.status}`);
    console.log(`  Body length: ${result.body.length}`);

    // Check for redirect
    if (result.status >= 300 && result.status < 400) {
      console.log(`  Redirect: ${result.headers.location}`);
    }

    // Check for common SportsAffinity patterns
    const hasFlightLinks = (result.body.match(/flightguid=/gi) || []).length;
    const hasAgeCode = (result.body.match(/agecode=/gi) || []).length;
    const hasSchedule = (result.body.match(/schedule_results/gi) || []).length;
    const hasTable = (result.body.match(/<table/gi) || []).length;
    const hasNotPublished = result.body.toLowerCase().includes('not yet published');
    const hasUnpublished = result.body.toLowerCase().includes('unpublished');

    console.log(`  Flight links: ${hasFlightLinks}`);
    console.log(`  Age code refs: ${hasAgeCode}`);
    console.log(`  Schedule refs: ${hasSchedule}`);
    console.log(`  Tables: ${hasTable}`);
    console.log(`  Not published: ${hasNotPublished}`);
    console.log(`  Unpublished: ${hasUnpublished}`);

    // Extract flight GUIDs if found
    if (hasFlightLinks > 0) {
      const flights = [];
      const regex = /flightguid=([A-F0-9-]+)/gi;
      let m;
      while ((m = regex.exec(result.body)) !== null) {
        if (!flights.includes(m[1])) flights.push(m[1]);
      }
      console.log(`  Unique flights: ${flights.length}`);
      flights.slice(0, 5).forEach(f => console.log(`    ${f}`));
      if (flights.length > 5) console.log(`    ... and ${flights.length - 5} more`);

      // Try fetching first flight's schedule
      if (flights.length > 0) {
        const schedUrl = `${baseUrl}/schedule_results2.asp?sessionguid=&flightguid=${flights[0]}&tournamentguid=${season.guid}`;
        console.log(`\n  Testing first flight schedule...`);
        try {
          const schedResult = await fetchUrl(schedUrl);
          console.log(`  Schedule status: ${schedResult.status}`);
          console.log(`  Schedule body length: ${schedResult.body.length}`);

          const matchRows = (schedResult.body.match(/Home Team|Away Team/gi) || []).length;
          const dateHeaders = (schedResult.body.match(/Bracket\s*-/gi) || []).length;
          const scores = (schedResult.body.match(/>\d+</g) || []).length;

          console.log(`  Match table headers: ${matchRows}`);
          console.log(`  Date headers: ${dateHeaders}`);
          console.log(`  Score cells: ${scores}`);

          // Extract a snippet
          if (schedResult.body.length > 100) {
            const snippet = schedResult.body.substring(0, 500).replace(/\s+/g, ' ');
            console.log(`  Snippet: ${snippet.substring(0, 300)}...`);
          }
        } catch (e) {
          console.log(`  Schedule fetch error: ${e.message}`);
        }
      }
    }

    // Show a snippet of the body
    if (result.body.length > 0 && hasFlightLinks === 0) {
      const snippet = result.body.substring(0, 500).replace(/\s+/g, ' ');
      console.log(`  Snippet: ${snippet.substring(0, 300)}...`);
    }

  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
}

async function main() {
  console.log('=== HI Oahu League SportsAffinity Probe ===\n');

  for (const season of SEASONS) {
    await probeSeason(season);
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
