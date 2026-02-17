/**
 * Probe GotSport Aspire league results page to check column order
 * Event 42138 (Girls Academy Aspire), checking first group
 */
const https = require('https');

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  // Step 1: Get group IDs from event page
  const eventHtml = await fetchPage('https://system.gotsport.com/org_event/events/42138');
  const groupRegex = /group=(\d+)/g;
  const groups = new Set();
  let m;
  while ((m = groupRegex.exec(eventHtml)) !== null) {
    groups.add(m[1]);
  }
  const groupList = Array.from(groups);
  console.log(`Found ${groupList.length} groups for event 42138`);

  // Step 2: Fetch first group results page
  const firstGroup = groupList[0];
  console.log(`Fetching results for group ${firstGroup}...`);
  const resultsHtml = await fetchPage(`https://system.gotsport.com/org_event/events/42138/results?group=${firstGroup}`);

  // Extract column headers
  const thRegex = /<th[^>]*>(.*?)<\/th>/gs;
  const headers = [];
  while ((m = thRegex.exec(resultsHtml)) !== null) {
    const text = m[1].replace(/<[^>]*>/g, '').trim();
    headers.push(text);
  }
  console.log('\nColumn headers:', headers);

  // Extract first 3 data rows
  const tableRegex = /<table[^>]*class='[^']*table-bordered[^']*'[^>]*>([\s\S]*?)<\/table>/;
  const tableMatch = tableRegex.exec(resultsHtml);
  if (tableMatch) {
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
    let rowCount = 0;
    while ((m = rowRegex.exec(tableMatch[1])) !== null) {
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
      const cells = [];
      let c;
      while ((c = cellRegex.exec(m[1])) !== null) {
        const text = c[1].replace(/<[^>]*>/g, '').trim();
        cells.push(text);
      }
      if (cells.length > 0) {
        rowCount++;
        if (rowCount <= 3) {
          console.log(`\nRow ${rowCount} (${cells.length} cols):`);
          cells.forEach((cell, i) => {
            console.log(`  [${i}]: "${cell}"`);
          });
        }
      }
    }
    console.log(`\nTotal rows: ${rowCount}`);
  }

  // Also check the heading
  const headingRegex = /<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/g;
  while ((m = headingRegex.exec(resultsHtml)) !== null) {
    const text = m[1].replace(/<[^>]*>/g, '').trim();
    if (text && (text.includes('Female') || text.includes('Male') || /U\d+/.test(text))) {
      console.log('\nDivision heading:', text);
    }
  }
}

main().catch(e => console.error(e));
