/**
 * Probe AthleteOne Phase 8: Find standings API endpoint + verify schedule endpoint
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const EVENT_ID = 3979;

async function probe() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const allApiHits = {};

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('api.athleteone.com') && !url.includes('datadog')) {
      try {
        const body = await res.text();
        const parsed = JSON.parse(body);
        allApiHits[url] = parsed.data;
        if (!url.includes('nav-settings') && !url.includes('get-event-details') && !url.includes('get-event-schedule-or-standings')) {
          console.log(`\n📡 API: ${url}`);
          const d = parsed.data;
          if (Array.isArray(d)) {
            console.log(`  Array[${d.length}]`, d[0] ? 'keys: ' + Object.keys(d[0]).slice(0, 8).join(', ') : 'empty');
            if (d[0]) console.log('  Sample:', JSON.stringify(d[0]).slice(0, 300));
          } else if (d && typeof d === 'object') {
            console.log('  Keys:', Object.keys(d).join(', '));
            console.log('  Sample:', JSON.stringify(d).slice(0, 300));
          }
        }
      } catch (_) {}
    }
  });

  await page.goto(`https://app.athleteone.com/public/event/${EVENT_ID}/schedules-standings`, {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 2000));

  // 1. Click Schedules first
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() === 'Schedules') {
        node.parentElement.click();
        return;
      }
    }
  });
  await new Promise(r => setTimeout(r, 3000));

  // 2. Go back and click Standings
  await page.goto(`https://app.athleteone.com/public/event/${EVENT_ID}/schedules-standings`, {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 2000));

  console.log('\nClicking Standings...');
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() === 'Standings') {
        node.parentElement.click();
        return;
      }
    }
  });
  await new Promise(r => setTimeout(r, 3000));

  console.log('URL after Standings click:', page.url());

  console.log('\n=== All unique API endpoints found ===');
  Object.keys(allApiHits).forEach(url => {
    if (!url.includes('nav-settings') && !url.includes('get-event-details') && !url.includes('get-event-schedule-or-standings') && !url.includes('datadog')) {
      console.log(' -', url);
    }
  });

  await browser.close();
}

probe().catch(e => { console.error('Error:', e.message); process.exit(1); });
