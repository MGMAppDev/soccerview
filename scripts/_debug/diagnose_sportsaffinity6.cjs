/**
 * Fix date detection + flight name discovery for SportsAffinity adapter.
 * 1. Walk HTML more carefully for date sections
 * 2. Get flight names from surrounding context on accepted_list.asp
 */
const https = require('https');
const cheerio = require('cheerio');

const FALL_2025 = {
  subdomain: 'gs-fall25gplacadathclrias',
  tournamentGuid: 'E7A6731D-D5FF-41B4-9C3C-300ECEE69150',
  testFlight: '942EC597-3CD7-4A14-A2E9-BD0444C775B1',
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

function parseMonthDay(monthStr, dayStr, yearStr) {
  const months = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
    July: 6, August: 7, September: 8, October: 9, November: 10, December: 11 };
  return new Date(parseInt(yearStr), months[monthStr] || 0, parseInt(dayStr));
}

(async () => {
  const base = `https://${FALL_2025.subdomain}.sportsaffinity.com/tour/public/info`;

  // === PART 1: Fix date detection ===
  console.log('=== PART 1: Fix Date Detection ===');
  const schedUrl = `${base}/schedule_results2.asp?sessionguid=&flightguid=${FALL_2025.testFlight}&tournamentguid=${FALL_2025.tournamentGuid}`;
  const { html } = await fetch(schedUrl);
  const $ = cheerio.load(html);

  // Strategy: find all <b> or <td> elements containing "Bracket - [Day], [Month] [Date], [Year]"
  const dateElements = [];
  $('b, td, th, div, span, font').each((i, el) => {
    const text = $(el).text().trim();
    const m = text.match(/Bracket\s*-\s*\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/);
    if (m) {
      // Get the position of this element in the document
      const outerHtml = $.html(el);
      dateElements.push({
        tag: el.tagName,
        text: text.substring(0, 80),
        month: m[1], day: m[2], year: m[3],
        date: parseMonthDay(m[1], m[2], m[3]),
        htmlPos: html.indexOf(outerHtml.substring(0, 30)),
      });
    }
  });

  console.log(`Found ${dateElements.length} date elements:`);
  dateElements.forEach(d => {
    console.log(`  <${d.tag}> at pos ${d.htmlPos}: ${d.month} ${d.day}, ${d.year} → ${d.date.toISOString().split('T')[0]}`);
  });

  // Now: approach 2 - look for the SECTION headers as <b> tags containing "Bracket - "
  // Then find the NEXT match table after each date header
  console.log('\n--- Approach 2: Walk elements in order ---');

  // Get all bold text that contains date headers
  const sections = [];
  let curDate = null;

  // Use the raw HTML to find date sections - they appear as bold text before tables
  // Split by date header pattern
  const dateRegex = /Bracket\s*-\s*\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/g;
  let lastEnd = 0;
  let match;
  const datePositions = [];

  while ((match = dateRegex.exec(html)) !== null) {
    const dateStr = `${match[1]} ${match[2]}, ${match[3]}`;
    const date = parseMonthDay(match[1], match[2], match[3]);
    datePositions.push({ pos: match.index, dateStr, date: date.toISOString().split('T')[0] });
  }

  console.log(`Date positions in HTML (${datePositions.length}):`);
  datePositions.forEach(d => console.log(`  pos ${d.pos}: ${d.dateStr} → ${d.date}`));

  // Now for each match table, find which date header is closest BEFORE it
  // Find all match tables by looking for "Game" header pattern in HTML
  const matchTables = [];
  const tableRegex = /<table[^>]*>/gi;
  let tMatch;
  while ((tMatch = tableRegex.exec(html)) !== null) {
    // Check if this table has match headers within the next ~500 chars
    const after = html.substring(tMatch.index, tMatch.index + 500);
    if (after.includes('Home Team') && after.includes('Away Team')) {
      // Find the closest date header before this table
      let dateForTable = null;
      for (const dp of datePositions) {
        if (dp.pos < tMatch.index) {
          dateForTable = dp;
        }
      }
      matchTables.push({
        tablePos: tMatch.index,
        date: dateForTable ? dateForTable.date : 'Unknown',
        dateStr: dateForTable ? dateForTable.dateStr : 'Unknown',
      });
    }
  }

  console.log(`\nMatch tables found: ${matchTables.length}`);
  matchTables.forEach(t => console.log(`  pos ${t.tablePos}: ${t.date}`));

  // Now parse all matches with correct dates
  const allMatches = [];
  let tableIdx = 0;

  $('table').each((i, table) => {
    const rows = $(table).find('tr');
    if (rows.length < 2) return;

    const headerCells = $(rows[0]).find('td, th');
    const headerText = headerCells.map((_, c) => $(c).text().trim()).get().join('|');

    if (headerText.includes('Game') && headerText.includes('Home Team')) {
      // Find the date for this table
      const tableHtml = $.html(table).substring(0, 30);
      const pos = html.indexOf(tableHtml);

      let dateForTable = 'Unknown';
      for (const dp of datePositions) {
        if (dp.pos < pos) dateForTable = dp.date;
      }

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
          allMatches.push({
            gameNum, date: dateForTable, time, venue, field, group,
            homeTeam, homeScore, awayTeam, awayScore,
          });
        }
      });
    }
  });

  console.log(`\n=== ALL MATCHES WITH DATES (${allMatches.length}) ===`);
  allMatches.forEach(m => {
    const score = m.homeScore && m.awayScore ? `${m.homeScore}-${m.awayScore}` : 'TBD';
    console.log(`  [${m.gameNum}] ${m.date} ${m.time} | ${m.homeTeam} ${score} ${m.awayTeam}`);
  });

  const withDates = allMatches.filter(m => m.date !== 'Unknown').length;
  console.log(`\nDate coverage: ${withDates}/${allMatches.length} (${Math.round(withDates / allMatches.length * 100)}%)`);

  // === PART 2: Fix flight name discovery ===
  console.log('\n\n=== PART 2: Fix Flight Name Discovery ===');
  const acceptedUrl = `${base}/accepted_list.asp?sessionguid=&tournamentguid=${FALL_2025.tournamentGuid}`;
  const { html: acceptedHtml } = await fetch(acceptedUrl);
  const $acc = cheerio.load(acceptedHtml);

  // Look for the structure around flight links
  // Find all elements that contain flight GUIDs
  const flightLinks = [];
  $acc('a[href*="flightguid"]').each((_, a) => {
    const href = $acc(a).attr('href') || '';
    const flightMatch = href.match(/flightguid=([A-F0-9-]+)/i);
    if (!flightMatch) return;

    const guid = flightMatch[1];
    const linkText = $acc(a).text().trim();

    // Get parent and grandparent context for the flight name
    const parent = $acc(a).parent();
    const grandparent = parent.parent();
    const parentText = parent.text().trim().substring(0, 100);
    const gpText = grandparent.text().trim().substring(0, 150);

    flightLinks.push({ guid, linkText, parentText, gpText, href: href.substring(0, 120) });
  });

  console.log(`Flight links found: ${flightLinks.length}`);
  // Show unique
  const seen = new Set();
  flightLinks.forEach(f => {
    if (seen.has(f.guid)) return;
    seen.add(f.guid);
    console.log(`\n  GUID: ${f.guid}`);
    console.log(`  Link text: "${f.linkText}"`);
    console.log(`  Parent: "${f.parentText}"`);
    console.log(`  Grandparent: "${f.gpText}"`);
    console.log(`  Href: ${f.href}`);
  });

  // Try a different approach: look for the schedule links specifically
  // The accepted_list page should have age group headers with flight names
  console.log('\n\n--- Looking for age group / flight name patterns ---');

  // Check for section headers on the page
  $acc('b, strong, h2, h3, h4, th').each((i, el) => {
    const text = $acc(el).text().trim();
    if (text.match(/\d{1,2}U[BG]|Pre.?GPL|Academy|Champ|RIAS|Classic|U\d{1,2}/i) && text.length < 100) {
      console.log(`  <${el.tagName}> "${text}"`);
    }
  });

  // Check for td elements with age group info
  console.log('\n--- TD cells with age info ---');
  $acc('td').each((i, el) => {
    const text = $acc(el).text().trim();
    if (text.match(/^\d{1,2}U[BG]\b/i) && text.length < 100) {
      console.log(`  <td> "${text}"`);
    }
  });

  // Maybe the flight names are in the schedule_results2.asp pages themselves
  // Check our test page's title for the flight name
  console.log('\n--- Flight name from schedule page ---');
  const title = $('title').text().trim();
  console.log('Page title:', title);

  // Check for flight name in the page body
  $('b, td, th').each((i, el) => {
    const text = $(el).text().trim();
    if (text.includes('Team Schedules') || text.includes('12UB') || text.includes('Pre GPL')) {
      if (text.length < 100) console.log(`  <${el.tagName}> "${text}"`);
    }
  });

  console.log('\nDone.');
})().catch(e => { console.error(e.message, e.stack); process.exit(1); });
