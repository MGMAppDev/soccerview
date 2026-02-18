/**
 * Probe AthleteOne Phase 7: Click via evaluate + intercept response
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const EVENT_ID = 3979;

async function probe() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const newApiHits = [];

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('api.athleteone.com') && !url.includes('datadog')
        && !url.includes('nav-settings') && !url.includes('get-event-details')
        && !url.includes('get-event-schedule-or-standings')) {
      try {
        const body = await res.text();
        const parsed = JSON.parse(body);
        newApiHits.push({ url, data: parsed.data });
        console.log(`\n🎯 NEW API: ${url}`);
        const d = parsed.data;
        if (Array.isArray(d)) {
          console.log(`  Array[${d.length}]`);
          if (d[0]) {
            console.log('  Keys:', Object.keys(d[0]).join(', '));
            console.log('  Sample[0]:', JSON.stringify(d[0]).slice(0, 600));
          }
        } else if (d && typeof d === 'object') {
          console.log('  Keys:', Object.keys(d).join(', '));
          console.log('  Sample:', JSON.stringify(d).slice(0, 600));
        }
      } catch (_) {}
    }
  });

  await page.goto(`https://app.athleteone.com/public/event/${EVENT_ID}/schedules-standings`, {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 2000));

  // Look at ALL text nodes containing "Schedules"
  const scheduleInfo = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() === 'Schedules' || node.textContent.trim() === 'Schedule') {
        const el = node.parentElement;
        hits.push({
          tag: el.tagName,
          class: el.className.slice(0, 80),
          outerHTML: el.outerHTML.slice(0, 200),
          parentTag: el.parentElement?.tagName,
          parentClass: el.parentElement?.className?.slice(0, 80),
        });
      }
    }
    return hits;
  });
  console.log(`Found ${scheduleInfo.length} "Schedules" elements:`);
  scheduleInfo.forEach((s, i) => console.log(`  [${i}] <${s.tag} class="${s.class}"> parent: <${s.parentTag} class="${s.parentClass}">\n      ${s.outerHTML}`));

  if (scheduleInfo.length > 0) {
    // Click the first one
    console.log('\nClicking first "Schedules" element...');
    const clicked = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.trim() === 'Schedules') {
          const el = node.parentElement;
          const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
          el.dispatchEvent(event);
          return el.outerHTML.slice(0, 100);
        }
      }
      return null;
    });
    console.log('Clicked:', clicked);
    await new Promise(r => setTimeout(r, 4000));

    console.log('Current URL after click:', page.url());
    console.log('New API hits:', newApiHits.length);
  }

  // Try clicking on a flight-level element
  if (newApiHits.length === 0) {
    console.log('\nTrying flight-level click...');
    const flightClick = await page.evaluate(() => {
      // Find elements that say "Flight A", "Flight B" etc.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.trim().startsWith('Flight')) {
          const el = node.parentElement;
          el.click();
          return { text: node.textContent.trim(), tag: el.tagName, class: el.className.slice(0, 60) };
        }
      }
      return null;
    });
    console.log('Flight click:', flightClick);
    await new Promise(r => setTimeout(r, 4000));
    console.log('New API hits after flight click:', newApiHits.length);
  }

  // Check page structure change
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('\nPage text (first 500 chars):', bodyText);

  console.log('\n=== New API endpoints found ===');
  newApiHits.forEach(h => console.log(' -', h.url));

  await browser.close();
}

probe().catch(e => { console.error('Error:', e.message); process.exit(1); });
