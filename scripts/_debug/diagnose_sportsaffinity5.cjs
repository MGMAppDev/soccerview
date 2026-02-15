/**
 * Verify SportsAffinity schedule pages work with plain HTTP + Cheerio (no Puppeteer).
 * Also extract ALL match data from one flight to verify parsing logic.
 * Also discover ALL flight GUIDs for the Fall 2025 tournament.
 */
const https = require('https');
const cheerio = require('cheerio');

const FALL_2025 = {
  subdomain: 'gs-fall25gplacadathclrias',
  tournamentGuid: 'E7A6731D-D5FF-41B4-9C3C-300ECEE69150',
  testFlight: '942EC597-3CD7-4A14-A2E9-BD0444C775B1', // B12
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

(async () => {
  const base = `https://${FALL_2025.subdomain}.sportsaffinity.com/tour/public/info`;

  // Step 1: Fetch schedule page with plain HTTP
  console.log('=== STEP 1: Plain HTTP Fetch ===');
  const schedUrl = `${base}/schedule_results2.asp?sessionguid=&flightguid=${FALL_2025.testFlight}&tournamentguid=${FALL_2025.tournamentGuid}`;
  const { status, html } = await fetch(schedUrl);
  console.log(`Status: ${status}, HTML: ${html.length} chars`);

  if (status !== 200) {
    console.log('ERROR: HTTP failed. May need Puppeteer.');
    console.log('Response preview:', html.substring(0, 500));
    return;
  }

  // Step 2: Parse with Cheerio
  console.log('\n=== STEP 2: Parse Match Data with Cheerio ===');
  const $ = cheerio.load(html);

  // Find match tables (those with "Game | Venue | Time" headers)
  const matches = [];
  let currentDate = null;

  // The date headers are text content before each table
  // Look for all tables and check their headers
  $('table').each((i, table) => {
    const rows = $(table).find('tr');
    if (rows.length < 2) return;

    // Check if first row has match table headers
    const headerCells = $(rows[0]).find('td, th');
    const headerText = headerCells.map((_, c) => $(c).text().trim()).get().join('|');

    if (headerText.includes('Game') && headerText.includes('Home Team') && headerText.includes('Away Team')) {
      // This is a match table - extract matches from data rows
      rows.slice(1).each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 10) return;

        const gameNum = $(cells[0]).text().trim();
        const venue = $(cells[1]).text().trim();
        const time = $(cells[2]).text().trim();
        const field = $(cells[3]).text().trim();
        const group = $(cells[4]).text().trim();
        const homeTeam = $(cells[5]).text().trim();
        const homeScore = $(cells[6]).text().trim();
        // cells[7] = "vs."
        const awayTeam = $(cells[8]).text().trim();
        const awayScore = $(cells[9]).text().trim();

        if (gameNum && homeTeam && awayTeam) {
          matches.push({
            gameNum, venue, time, field, group,
            homeTeam, homeScore, awayTeam, awayScore,
            date: currentDate,
          });
        }
      });
    }
  });

  // Now find date headers - they appear as bold text before each table
  // Pattern: "Bracket - Saturday, September 06, 2025"
  const datePattern = /Bracket\s*-\s*\w+,\s+(\w+\s+\d{1,2},\s+\d{4})/g;
  const dateMatches = [...html.matchAll(datePattern)];
  console.log(`Found ${dateMatches.length} date headers:`);
  dateMatches.forEach(m => console.log(`  ${m[1]}`));

  // Better approach: Find dates by walking the DOM
  // Each date is a <b> or text node before a match table
  const allText = $('body').text();
  const dateHeaders = [];
  const dateRegex = /Bracket\s*-\s*\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/g;
  let dm;
  while ((dm = dateRegex.exec(allText)) !== null) {
    dateHeaders.push({ month: dm[1], day: dm[2], year: dm[3], full: dm[0] });
  }

  console.log(`\nParsed date headers: ${dateHeaders.length}`);
  dateHeaders.forEach(d => console.log(`  ${d.month} ${d.day}, ${d.year}`));

  // Match dates to matches by position in HTML
  // Count match tables to map them to date headers
  let matchTableIndex = 0;
  let currentDateIdx = 0;
  const matchesWithDates = [];

  $('table').each((i, table) => {
    const rows = $(table).find('tr');
    if (rows.length < 2) return;
    const headerCells = $(rows[0]).find('td, th');
    const headerText = headerCells.map((_, c) => $(c).text().trim()).get().join('|');

    if (headerText.includes('Game') && headerText.includes('Home Team')) {
      // Check preceding text for date
      // Walk backwards in the HTML to find date
      const tableHtmlPos = html.indexOf($(table).html().substring(0, 50));

      // Find the closest date header BEFORE this table
      let bestDateIdx = -1;
      for (let d = 0; d < dateHeaders.length; d++) {
        const datePos = html.indexOf(dateHeaders[d].full);
        if (datePos !== -1 && datePos < tableHtmlPos) {
          bestDateIdx = d;
        }
      }

      const dateHeader = bestDateIdx >= 0 ? dateHeaders[bestDateIdx] : null;
      const dateStr = dateHeader ? `${dateHeader.month} ${dateHeader.day}, ${dateHeader.year}` : 'Unknown';

      rows.slice(1).each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 10) return;

        const gameNum = $(cells[0]).text().trim();
        const venue = $(cells[1]).text().trim();
        const time = $(cells[2]).text().trim();
        const field = $(cells[3]).text().trim();
        const group = $(cells[4]).text().trim();
        const homeTeam = $(cells[5]).text().trim();
        const homeScore = $(cells[6]).text().trim();
        const awayTeam = $(cells[8]).text().trim();
        const awayScore = $(cells[9]).text().trim();

        if (gameNum && homeTeam && awayTeam) {
          matchesWithDates.push({
            gameNum, date: dateStr, time, venue, field, group,
            homeTeam, homeScore, awayTeam, awayScore,
          });
        }
      });
    }
  });

  console.log(`\n=== ALL MATCHES (${matchesWithDates.length}) ===`);
  matchesWithDates.forEach(m => {
    const score = (m.homeScore && m.awayScore && m.homeScore !== '' && m.awayScore !== '')
      ? `${m.homeScore}-${m.awayScore}` : 'TBD';
    console.log(`  [${m.gameNum}] ${m.date} ${m.time} | ${m.homeTeam} ${score} ${m.awayTeam}`);
  });

  // Data quality
  const withScores = matchesWithDates.filter(m => m.homeScore && m.awayScore && m.homeScore !== '').length;
  const withDates = matchesWithDates.filter(m => m.date !== 'Unknown').length;
  const uniqueTeams = new Set([...matchesWithDates.map(m => m.homeTeam), ...matchesWithDates.map(m => m.awayTeam)]);

  console.log(`\n=== DATA QUALITY ===`);
  console.log(`Total matches: ${matchesWithDates.length}`);
  console.log(`With scores: ${withScores}`);
  console.log(`With dates: ${withDates}`);
  console.log(`Unique teams: ${uniqueTeams.size}`);

  // Step 3: Discover all flight GUIDs
  console.log('\n\n=== STEP 3: Discover ALL Flight GUIDs ===');
  const acceptedUrl = `${base}/accepted_list.asp?sessionguid=&tournamentguid=${FALL_2025.tournamentGuid}`;
  const { status: s2, html: acceptedHtml } = await fetch(acceptedUrl);
  console.log(`Accepted list status: ${s2}, HTML: ${acceptedHtml.length} chars`);

  const $acc = cheerio.load(acceptedHtml);
  const flights = [];
  $acc('a[href*="flightguid"]').each((_, a) => {
    const href = $acc(a).attr('href') || '';
    const text = $acc(a).text().trim();
    const flightMatch = href.match(/flightguid=([A-F0-9-]+)/i);
    if (flightMatch && text && !flights.find(f => f.guid === flightMatch[1])) {
      flights.push({ guid: flightMatch[1], name: text });
    }
  });

  console.log(`\nFound ${flights.length} flights:`);
  flights.forEach(f => console.log(`  ${f.guid} → ${f.name}`));

  // Group by age
  const ageGroups = {};
  flights.forEach(f => {
    const ageMatch = f.name.match(/(\d{1,2}U[BG]|\d{1,2}[UB][BG]?)\b/i) || f.name.match(/^(\d+)/);
    const age = ageMatch ? ageMatch[1] : 'Unknown';
    if (!ageGroups[age]) ageGroups[age] = [];
    ageGroups[age].push(f.name);
  });

  console.log(`\nAge group breakdown:`);
  Object.entries(ageGroups).sort().forEach(([age, names]) => {
    console.log(`  ${age}: ${names.length} flights`);
    names.forEach(n => console.log(`    - ${n}`));
  });

  console.log('\nDone.');
})().catch(e => { console.error(e.message, e.stack); process.exit(1); });
