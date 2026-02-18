/**
 * Probe AthleteOne platform — Session 113
 *
 * STXCL (South Texas Champions League) uses AthleteOne:
 * - ECNL-RL Girls: app.athleteone.com/public/event/3979/schedules-standings
 * - ECNL-RL Boys: app.athleteone.com/public/event/3973/schedules-standings
 * - ECL: app.athleteone.com/public/event/4184/schedules-standings
 *
 * Use Puppeteer to intercept network requests and find the API endpoints
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const EVENT_ID = 3979; // ECNL-RL Girls STXCL

async function probe() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const apiCalls = [];

  // Intercept all network requests to find API endpoints
  page.on('request', req => {
    const url = req.url();
    if (url.includes('api') || url.includes('json') || url.includes('schedule') ||
        url.includes('standing') || url.includes('group') || url.includes('event')) {
      apiCalls.push({ url, method: req.method() });
    }
  });

  page.on('response', async res => {
    const url = res.url();
    const contentType = res.headers()['content-type'] || '';
    if (contentType.includes('json')) {
      try {
        const body = await res.text();
        console.log(`\n=== JSON API call: ${url} ===`);
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed)) {
          console.log(`Array with ${parsed.length} items`);
          if (parsed.length > 0) console.log('First item keys:', Object.keys(parsed[0]));
          if (parsed.length > 0) console.log('Sample:', JSON.stringify(parsed[0]).slice(0, 300));
        } else {
          console.log('Keys:', Object.keys(parsed));
          console.log('Preview:', JSON.stringify(parsed).slice(0, 500));
        }
      } catch (e) {
        // ignore non-JSON
      }
    }
  });

  console.log(`Navigating to AthleteOne event ${EVENT_ID}...`);
  await page.goto(`https://app.athleteone.com/public/event/${EVENT_ID}/schedules-standings`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  // Wait a bit for any lazy-loaded data
  await new Promise(r => setTimeout(r, 3000));

  // Check page content
  const title = await page.title();
  console.log('\nPage title:', title);

  const text = await page.evaluate(() => document.body.innerText.slice(0, 1000));
  console.log('Page text preview:', text);

  // Try to find group/division elements
  const groups = await page.evaluate(() => {
    const selectors = ['[class*="group"]', '[class*="division"]', '[class*="tab"]', '[class*="bracket"]'];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        return Array.from(els).slice(0, 5).map(el => ({
          tag: el.tagName,
          class: el.className.slice(0, 50),
          text: el.innerText?.slice(0, 50)
        }));
      }
    }
    return null;
  });
  console.log('\nGroup elements:', groups);

  console.log('\n=== All API calls intercepted ===');
  apiCalls.forEach(c => console.log(` ${c.method} ${c.url}`));

  await browser.close();
}

probe().catch(e => { console.error('Error:', e.message); process.exit(1); });
