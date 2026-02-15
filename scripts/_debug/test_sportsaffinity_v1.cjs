/**
 * Test SportsAffinity adapter v1.0 parsing logic.
 * Uses plain HTTP + Cheerio (same as adapter).
 * Tests against B12 flight from Fall 2025 GA tournament.
 */
const https = require('https');
const cheerio = require('cheerio');

const FALL_2025 = {
  subdomain: 'gs-fall25gplacadathclrias',
  tournamentGuid: 'E7A6731D-D5FF-41B4-9C3C-300ECEE69150',
};

const MONTHS = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

function parseFullDate(month, day, year) {
  const mm = MONTHS[month];
  if (!mm) return null;
  return `${year}-${mm}-${String(day).padStart(2, '0')}`;
}

(async () => {
  const base = `https://${FALL_2025.subdomain}.sportsaffinity.com/tour/public/info`;

  // Step 1: Discover flights
  console.log('=== STEP 1: Discover Flights ===');
  const acceptedUrl = `${base}/accepted_list.asp?sessionguid=&tournamentguid=${FALL_2025.tournamentGuid}`;
  const { html: accHtml } = await fetchUrl(acceptedUrl);
  const $acc = cheerio.load(accHtml);

  const flights = [];
  const seenGuids = new Set();

  $acc('a[href*="flightguid"]').each((_, a) => {
    const href = $acc(a).attr('href') || '';
    const flightMatch = href.match(/flightguid=([A-F0-9-]+)/i);
    const ageMatch = href.match(/agecode=([A-Z]\d+)/i);
    if (!flightMatch) return;
    const guid = flightMatch[1].toUpperCase();
    if (seenGuids.has(guid)) return;
    seenGuids.add(guid);
    flights.push({ guid, agecode: ageMatch ? ageMatch[1] : null });
  });

  // Get flight names
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
        if (fm) flightNames.set(fm[1].toUpperCase(), text);
      }
    }
  });

  for (const flight of flights) {
    flight.name = flightNames.get(flight.guid) || flight.agecode || 'Unknown';
  }

  console.log(`Found ${flights.length} flights:`);
  const ageSummary = {};
  flights.forEach(f => {
    const age = f.agecode || 'Unknown';
    ageSummary[age] = (ageSummary[age] || 0) + 1;
    console.log(`  ${f.agecode}: ${f.name} (${f.guid.substring(0, 8)}...)`);
  });
  console.log('\nAge summary:');
  Object.entries(ageSummary).sort().forEach(([age, count]) => console.log(`  ${age}: ${count} flights`));

  // Step 2: Parse matches from first 3 flights
  console.log('\n=== STEP 2: Parse Matches (first 3 flights) ===');
  let totalMatches = 0;
  let totalWithDates = 0;
  let totalWithScores = 0;

  const testFlights = flights.slice(0, 3);
  for (const flight of testFlights) {
    console.log(`\n--- ${flight.agecode}: ${flight.name} ---`);
    const schedUrl = `${base}/schedule_results2.asp?sessionguid=&flightguid=${flight.guid}&tournamentguid=${FALL_2025.tournamentGuid}`;
    const { html } = await fetchUrl(schedUrl);
    const $ = cheerio.load(html);

    // DOM walk for date + match association
    const matches = [];
    let currentDate = null;

    function walkNode(node) {
      if (!node) return;
      if (node.type === 'tag') {
        if (node.tagName === 'b') {
          const text = $(node).text().trim();
          const dateMatch = text.match(/Bracket\s*-\s*\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/);
          if (dateMatch) {
            currentDate = parseFullDate(dateMatch[1], dateMatch[2], dateMatch[3]);
          }
        }
        if (node.tagName === 'table') {
          const headerRow = $(node).find('tr').first();
          const headerText = headerRow.text();
          if (headerText.includes('Home Team') && headerText.includes('Away Team')) {
            $(node).find('tr').slice(1).each((_, row) => {
              const cells = $(row).find('td');
              if (cells.length < 10) return;
              const gameNum = $(cells[0]).text().trim();
              const venue = $(cells[1]).text().trim();
              const time = $(cells[2]).text().trim();
              const homeTeam = $(cells[5]).text().trim();
              const homeScore = $(cells[6]).text().trim();
              const awayTeam = $(cells[8]).text().trim();
              const awayScore = $(cells[9]).text().trim();
              if (gameNum && homeTeam && awayTeam) {
                matches.push({ gameNum, date: currentDate, time, homeTeam, homeScore, awayTeam, awayScore });
              }
            });
          }
        }
        const children = node.children || [];
        for (const child of children) walkNode(child);
      }
    }

    const root = $('body')[0] || $.root()[0];
    if (root && root.children) {
      for (const child of root.children) walkNode(child);
    }

    const withDates = matches.filter(m => m.date).length;
    const withScores = matches.filter(m => m.homeScore && m.awayScore && m.homeScore !== '').length;
    totalMatches += matches.length;
    totalWithDates += withDates;
    totalWithScores += withScores;

    console.log(`  Matches: ${matches.length} | With dates: ${withDates} | With scores: ${withScores}`);

    // Show first 3 matches
    matches.slice(0, 3).forEach(m => {
      const score = m.homeScore && m.awayScore ? `${m.homeScore}-${m.awayScore}` : 'TBD';
      console.log(`  [${m.gameNum}] ${m.date || 'NO DATE'} ${m.time} | ${m.homeTeam} ${score} ${m.awayTeam}`);
    });

    // Show unique teams
    const teams = new Set([...matches.map(m => m.homeTeam), ...matches.map(m => m.awayTeam)]);
    console.log(`  Unique teams: ${teams.size}`);

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Flights tested: ${testFlights.length}/${flights.length}`);
  console.log(`Total matches: ${totalMatches}`);
  console.log(`With dates: ${totalWithDates}/${totalMatches} (${totalMatches > 0 ? Math.round(totalWithDates / totalMatches * 100) : 0}%)`);
  console.log(`With scores: ${totalWithScores}/${totalMatches} (${totalMatches > 0 ? Math.round(totalWithScores / totalMatches * 100) : 0}%)`);

  // Step 3: Estimate total match count (all flights)
  console.log('\n=== STEP 3: Estimate Total ===');
  const avgPerFlight = totalMatches / testFlights.length;
  console.log(`Avg matches per flight: ${avgPerFlight.toFixed(1)}`);
  console.log(`Estimated total (${flights.length} flights): ~${Math.round(avgPerFlight * flights.length)}`);

  console.log('\nDone.');
})().catch(e => { console.error(e.message, e.stack); process.exit(1); });
