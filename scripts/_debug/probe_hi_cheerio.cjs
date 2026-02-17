/**
 * Probe HI Oahu League with Cheerio (same approach as SA adapter)
 * Parse actual match data structure
 */
require('dotenv').config();
const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  // Load cheerio
  let cheerio;
  try {
    cheerio = require('cheerio');
  } catch (e) {
    console.error('cheerio not installed. Run: npm install cheerio');
    process.exit(1);
  }

  const subdomain = 'ol-fall-25-26';
  const guid = 'AD6E28FC-3EBE-46E9-842B-66E6A2EEB086';
  const baseUrl = `https://${subdomain}.sportsaffinity.com/tour/public/info`;

  // Step 1: Parse accepted_list to get flights
  console.log('=== Step 1: Parse Accepted List ===\n');
  const acceptedHtml = await fetchUrl(`${baseUrl}/accepted_list.asp?sessionguid=&tournamentguid=${guid}`);
  const $acc = cheerio.load(acceptedHtml);

  // Extract flights
  const flights = [];
  const seenGuids = new Set();

  $acc('a[href*="flightguid"]').each((_, a) => {
    const href = $acc(a).attr('href') || '';
    const flightMatch = href.match(/flightguid=([A-F0-9-]+)/i);
    const ageMatch = href.match(/agecode=([A-Z]\d+)/i);
    if (!flightMatch) return;

    const fguid = flightMatch[1].toUpperCase();
    if (seenGuids.has(fguid)) return;
    seenGuids.add(fguid);

    flights.push({
      guid: fguid,
      agecode: ageMatch ? ageMatch[1] : null,
    });
  });

  // Extract flight names from <td> cells
  const flightNames = new Map();
  $acc('td').each((_, td) => {
    const text = $acc(td).text().trim();
    const nameMatch = text.match(/^(\d{1,2}U[BG])\s+(.+)/i);
    if (nameMatch) {
      const row = $acc(td).closest('tr');
      const link = row.find('a[href*="flightguid"]').first();
      if (link.length) {
        const href = link.attr('href') || '';
        const fm = href.match(/flightguid=([A-F0-9-]+)/i);
        if (fm) {
          flightNames.set(fm[1].toUpperCase(), text);
        }
      }
    }
  });

  for (const flight of flights) {
    flight.name = flightNames.get(flight.guid) || flight.agecode || 'Unknown';
  }

  console.log(`Found ${flights.length} flights:`);
  for (const f of flights) {
    console.log(`  ${f.agecode || '?'}: ${f.name} (${f.guid.substring(0, 8)}...)`);
  }

  // Step 2: Parse first 3 flights' schedule pages
  console.log('\n=== Step 2: Parse Schedule Pages ===\n');

  for (let i = 0; i < Math.min(3, flights.length); i++) {
    const flight = flights[i];
    console.log(`\n--- Flight ${i + 1}: ${flight.name} (${flight.agecode}) ---`);

    const schedUrl = `${baseUrl}/schedule_results2.asp?sessionguid=&flightguid=${flight.guid}&tournamentguid=${guid}`;
    const schedHtml = await fetchUrl(schedUrl);
    const $ = cheerio.load(schedHtml);

    // Look for ALL <b> tags and their text
    console.log('\n  <b> tags (potential date headers):');
    let bCount = 0;
    $('b').each((_, b) => {
      const text = $(b).text().trim();
      if (text.length > 5 && text.length < 100) {
        bCount++;
        if (bCount <= 10) console.log(`    "${text}"`);
      }
    });
    console.log(`    Total: ${bCount} <b> tags with text`);

    // Look for ANY date-like patterns in the HTML
    const datePatterns = schedHtml.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/gi) || [];
    const uniqueDates = [...new Set(datePatterns)];
    console.log(`\n  Date patterns found: ${uniqueDates.length}`);
    uniqueDates.slice(0, 5).forEach(d => console.log(`    ${d}`));

    // Also look for numeric date patterns
    const numDates = schedHtml.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) || [];
    const uniqueNumDates = [...new Set(numDates)];
    console.log(`  Numeric date patterns: ${uniqueNumDates.length}`);
    uniqueNumDates.slice(0, 5).forEach(d => console.log(`    ${d}`));

    // Find tables with "Home Team" header
    const matchTables = [];
    $('table').each((_, table) => {
      const headerRow = $(table).find('tr').first();
      const headerText = headerRow.text();
      if (headerText.includes('Home') || headerText.includes('Away')) {
        matchTables.push(table);
      }
    });
    console.log(`\n  Match tables: ${matchTables.length}`);

    if (matchTables.length > 0) {
      // Parse first match table
      const firstTable = matchTables[0];
      const headers = [];
      $(firstTable).find('tr').first().find('td, th').each((_, cell) => {
        headers.push($(cell).text().trim());
      });
      console.log(`  Headers: ${headers.join(' | ')}`);

      // Parse first 3 match rows
      const rows = $(firstTable).find('tr').slice(1);
      console.log(`  Data rows: ${rows.length}`);

      rows.slice(0, 3).each((_, row) => {
        const cells = [];
        $(row).find('td').each((_, cell) => {
          cells.push($(cell).text().trim());
        });
        console.log(`  Row: [${cells.join('] [')}]`);
      });
    }

    // Count total matches
    let totalMatches = 0;
    for (const table of matchTables) {
      totalMatches += $(table).find('tr').length - 1; // subtract header row
    }
    console.log(`  Total match rows across all tables: ${totalMatches}`);

    // Slow down
    await new Promise(r => setTimeout(r, 2000));
  }

  // Step 3: Count total matches across ALL flights
  console.log('\n\n=== Step 3: Count All Flights ===\n');
  let grandTotal = 0;
  for (const flight of flights) {
    const schedUrl = `${baseUrl}/schedule_results2.asp?sessionguid=&flightguid=${flight.guid}&tournamentguid=${guid}`;
    const schedHtml = await fetchUrl(schedUrl);
    const $ = cheerio.load(schedHtml);

    let matchCount = 0;
    $('table').each((_, table) => {
      const headerRow = $(table).find('tr').first();
      const headerText = headerRow.text();
      if (headerText.includes('Home') || headerText.includes('Away')) {
        matchCount += $(table).find('tr').length - 1;
      }
    });

    console.log(`  ${flight.agecode || '?'} ${flight.name}: ${matchCount} matches`);
    grandTotal += matchCount;

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n  TOTAL FALL 2025/26 MATCHES: ${grandTotal}`);

  // Step 4: Quick check Spring 2026
  console.log('\n=== Step 4: Spring 2026 Quick Check ===\n');
  const springGuid = '94D44303-F331-4505-92B2-813593B3FC50';
  const springSubdomain = 'ol-spring-25-26';
  const springBaseUrl = `https://${springSubdomain}.sportsaffinity.com/tour/public/info`;
  const springAccHtml = await fetchUrl(`${springBaseUrl}/accepted_list.asp?sessionguid=&tournamentguid=${springGuid}`);
  const $sAcc = cheerio.load(springAccHtml);

  const springFlights = new Set();
  $sAcc('a[href*="flightguid"]').each((_, a) => {
    const href = $sAcc(a).attr('href') || '';
    const fm = href.match(/flightguid=([A-F0-9-]+)/i);
    if (fm) springFlights.add(fm[1].toUpperCase());
  });
  console.log(`Spring 2026: ${springFlights.size} flights`);

  let springTotal = 0;
  for (const fguid of springFlights) {
    const schedUrl = `${springBaseUrl}/schedule_results2.asp?sessionguid=&flightguid=${fguid}&tournamentguid=${springGuid}`;
    const schedHtml = await fetchUrl(schedUrl);
    const $ = cheerio.load(schedHtml);

    let matchCount = 0;
    $('table').each((_, table) => {
      const headerRow = $(table).find('tr').first();
      if (headerRow.text().includes('Home') || headerRow.text().includes('Away')) {
        matchCount += $(table).find('tr').length - 1;
      }
    });
    springTotal += matchCount;
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`Spring 2026 total matches: ${springTotal}`);

  console.log(`\n\n=== GRAND TOTAL (Fall + Spring): ${grandTotal + springTotal} ===`);
}

main().catch(console.error);
