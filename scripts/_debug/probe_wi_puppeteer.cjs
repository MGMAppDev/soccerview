/**
 * Session 104: Quick Puppeteer probe of WI PlayMetrics leagues.
 * Renders the Vue SPA to check if divisions load.
 */
const puppeteer = require('puppeteer');

const LEAGUES = [
  { id: 'maysa-fall-2025', leagueId: '1027-1519-e326860f', name: 'MAYSA Fall 2025' },
  { id: 'east-central-fall-2025', leagueId: '1028-1508-d9de4618', name: 'East Central Fall 2025' },
  { id: 'cwsl-current', leagueId: '1033-1414-5115f522', name: 'Central WI Soccer League' },
];

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  for (const league of LEAGUES) {
    const url = `https://playmetricssports.com/g/leagues/${league.leagueId}/league_view.html`;
    console.log(`\n${league.name}: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 8000)); // Wait for Vue SPA

      // Check for division cards
      const result = await page.evaluate(() => {
        const cards = document.querySelectorAll('.league-divisions__grid__card');
        const title = document.querySelector('h1, h2, .league-header, .league-name');
        const bodyText = document.body.innerText.substring(0, 500);
        return {
          divisionCount: cards.length,
          title: title ? title.textContent.trim() : null,
          bodyPreview: bodyText,
        };
      });

      console.log(`  Divisions found: ${result.divisionCount}`);
      if (result.title) console.log(`  Title: ${result.title}`);
      console.log(`  Body preview: ${result.bodyPreview.substring(0, 200)}`);
    } catch (error) {
      console.log(`  ERROR: ${error.message.substring(0, 200)}`);
    }
  }

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
