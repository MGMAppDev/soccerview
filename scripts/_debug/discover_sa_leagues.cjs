/**
 * Discover SportsAffinity league GUIDs from public tournament list pages
 * BACK DOOR: /tour/public/info/tournamentlist.asp?section=gaming is PUBLIC
 */
const puppeteer = require('puppeteer');

const STATES = [
  {
    state: 'MN',
    name: 'Minnesota Youth Soccer',
    subdomains: ['mnyouth', 'minnesotayouthsoccer'],
  },
  {
    state: 'UT',
    name: 'Utah Youth Soccer',
    subdomains: ['uysa'],
  },
  {
    state: 'OR',
    name: 'Oregon Youth Soccer',
    subdomains: ['oysa'],
  },
  {
    state: 'NE',
    name: 'Nebraska Soccer',
    subdomains: ['nebraskasoccer'],
  },
  {
    state: 'PA-W',
    name: 'PA West Soccer',
    subdomains: ['pawest', 'pawesthighperformance'],
  },
  {
    state: 'GA',
    name: 'Georgia Soccer (reference)',
    subdomains: ['gs'],
  },
];

async function discoverLeagues(browser, state) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${state.name} (${state.state})`);
  console.log('='.repeat(60));

  for (const subdomain of state.subdomains) {
    const leagueUrl = `https://${subdomain}.sportsaffinity.com/tour/public/info/tournamentlist.asp?sessionguid=&section=gaming`;
    const tournamentUrl = `https://${subdomain}.sportsaffinity.com/tour/public/info/tournamentlist.asp?sessionguid=`;

    for (const [label, url] of [['LEAGUES', leagueUrl], ['TOURNAMENTS', tournamentUrl]]) {
      const page = await browser.newPage();
      try {
        console.log(`\n  [${label}] ${subdomain}.sportsaffinity.com`);
        const response = await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        console.log(`  Status: ${response.status()}`);

        // Extract tournament/league links with GUIDs
        const events = await page.evaluate(() => {
          const results = [];
          // Look for links containing tournamentguid
          const anchors = Array.from(document.querySelectorAll('a[href*="tournamentguid"]'));
          for (const a of anchors) {
            const href = a.href || '';
            const text = a.textContent.trim();
            const guidMatch = href.match(/tournamentguid=([A-F0-9-]+)/i);
            if (guidMatch) {
              results.push({
                name: text,
                guid: guidMatch[1],
                href: href,
              });
            }
          }

          // Also check for table rows with event names
          const rows = Array.from(document.querySelectorAll('tr'));
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length >= 2) {
              const text = cells[0]?.textContent?.trim() || '';
              const link = row.querySelector('a[href*="tournamentguid"]');
              if (link && text && !results.find(r => r.name === text)) {
                const guidMatch = link.href.match(/tournamentguid=([A-F0-9-]+)/i);
                if (guidMatch) {
                  results.push({ name: text, guid: guidMatch[1], href: link.href });
                }
              }
            }
          }

          // Get all visible text that might contain league names
          const bodyText = document.body?.innerText || '';
          return { events: results, bodyPreview: bodyText.substring(0, 1000) };
        });

        if (events.events.length > 0) {
          console.log(`  Found ${events.events.length} events:`);
          events.events.forEach(e => {
            console.log(`    "${e.name}" → GUID: ${e.guid}`);
          });
        } else {
          console.log(`  No events with GUIDs found`);
          console.log(`  Body preview: ${events.bodyPreview.substring(0, 300)}`);
        }

      } catch (err) {
        console.log(`  Error: ${err.message}`);
      } finally {
        await page.close();
      }
    }
  }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    for (const state of STATES) {
      await discoverLeagues(browser, state);
    }
  } finally {
    await browser.close();
  }

  console.log('\n\nDONE — Use discovered GUIDs to add staticEvents to sportsaffinity.js adapter');
}

main().catch(err => { console.error(err); process.exit(1); });
