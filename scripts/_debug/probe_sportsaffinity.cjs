/**
 * Probe SportsAffinity/Sports Connect platforms for public API endpoints
 * Goal: Discover how to access MN, UT, OR, NE, PA-W league data
 */
const puppeteer = require('puppeteer');

const TARGETS = [
  {
    state: 'MN',
    name: 'Minnesota Youth Soccer',
    urls: [
      'https://mnyouth.sportsaffinity.com',
      'https://minnesotayouthsoccer.sportsaffinity.com',
    ]
  },
  {
    state: 'UT',
    name: 'Utah Youth Soccer',
    urls: [
      'https://uysa.sportsaffinity.com',
      'https://uysa.affinitysoccer.com',
    ]
  },
  {
    state: 'OR',
    name: 'Oregon Youth Soccer',
    urls: [
      'https://oysa.sportsaffinity.com',
      'https://oysa.affinitysoccer.com',
    ]
  },
  {
    state: 'NE',
    name: 'Nebraska Soccer',
    urls: [
      'https://nebraskasoccer.sportsaffinity.com',
    ]
  },
  {
    state: 'GA',
    name: 'Georgia Soccer (reference)',
    urls: [
      'https://gs-fall25gplacadathclrias.sportsaffinity.com/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid=E7A6731D-D5FF-41B4-9C3C-300ECEE69150',
    ]
  },
];

async function probeTarget(browser, target) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Probing: ${target.name} (${target.state})`);
  console.log('='.repeat(60));

  for (const url of target.urls) {
    const page = await browser.newPage();
    const apiCalls = [];

    // Intercept all XHR/fetch requests to find API endpoints
    page.on('request', req => {
      const type = req.resourceType();
      if (type === 'xhr' || type === 'fetch') {
        apiCalls.push({
          method: req.method(),
          url: req.url(),
        });
      }
    });

    try {
      console.log(`\n  URL: ${url}`);
      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      console.log(`  Status: ${response.status()}`);
      console.log(`  Final URL: ${page.url()}`);

      // Wait a moment for any lazy-loaded API calls
      await new Promise(r => setTimeout(r, 3000));

      // Get page title
      const title = await page.title();
      console.log(`  Title: ${title}`);

      // Look for links to tournaments, leagues, schedules
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        return anchors
          .filter(a => {
            const href = (a.href || '').toLowerCase();
            const text = (a.textContent || '').toLowerCase();
            return href.includes('tour') || href.includes('league') ||
                   href.includes('schedule') || href.includes('standings') ||
                   href.includes('flight') || href.includes('division') ||
                   text.includes('league') || text.includes('schedule') ||
                   text.includes('standings') || text.includes('tournament');
          })
          .map(a => ({ text: a.textContent.trim().substring(0, 80), href: a.href }))
          .slice(0, 20);
      });

      if (links.length > 0) {
        console.log(`  Relevant links found (${links.length}):`);
        links.forEach(l => console.log(`    ${l.text} → ${l.href}`));
      }

      // Look for any forms or search inputs
      const forms = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('form'))
          .map(f => ({ action: f.action, method: f.method, id: f.id }))
          .slice(0, 5);
      });
      if (forms.length > 0) {
        console.log(`  Forms: ${JSON.stringify(forms)}`);
      }

      // Report API calls
      if (apiCalls.length > 0) {
        console.log(`  API calls intercepted (${apiCalls.length}):`);
        apiCalls.forEach(a => console.log(`    ${a.method} ${a.url}`));
      }

      // Look for embedded data or config
      const embeddedData = await page.evaluate(() => {
        // Check for window config objects
        const configs = [];
        for (const key of Object.keys(window)) {
          if (key.includes('config') || key.includes('Config') ||
              key.includes('API') || key.includes('api') ||
              key.includes('data') || key.includes('Data')) {
            const val = window[key];
            if (val && typeof val === 'object') {
              configs.push({ key, sample: JSON.stringify(val).substring(0, 200) });
            }
          }
        }
        return configs;
      });
      if (embeddedData.length > 0) {
        console.log(`  Embedded configs:`);
        embeddedData.forEach(d => console.log(`    ${d.key}: ${d.sample}`));
      }

      // Check page body text for clues
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
      console.log(`  Body preview: ${bodyText.substring(0, 200)}`);

    } catch (err) {
      console.log(`  Error: ${err.message}`);
    } finally {
      await page.close();
    }
  }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    for (const target of TARGETS) {
      await probeTarget(browser, target);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
