/**
 * Probe AthleteOne Phase 5: Find exact element for schedule click
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const EVENT_ID = 3979;

async function probe() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const apiHits = [];

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('api.athleteone.com') && !url.includes('datadog') && !url.includes('nav-settings') && !url.includes('get-event-details') && !url.includes('get-event-schedule-or-standings')) {
      try {
        const body = await res.text();
        const parsed = JSON.parse(body);
        apiHits.push({ url, parsed });
        console.log(`\n🎯 FOUND NEW API: ${url}`);
        if (parsed.data) {
          const d = parsed.data;
          if (Array.isArray(d)) {
            console.log(`  Array[${d.length}]`, d[0] ? 'keys: ' + Object.keys(d[0]).join(', ') : 'empty');
            if (d.length > 0) console.log('  Sample:', JSON.stringify(d[0]).slice(0, 600));
          } else {
            console.log('  Keys:', Object.keys(d).join(', '));
            console.log('  Sample:', JSON.stringify(d).slice(0, 600));
          }
        }
      } catch (_) {}
    }
  });

  await page.goto(`https://app.athleteone.com/public/event/${EVENT_ID}/schedules-standings`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  await new Promise(r => setTimeout(r, 2000));

  // Get all hrefs and text
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[href]')).map(el => ({
      tag: el.tagName,
      href: el.href,
      text: el.innerText?.trim().slice(0, 50),
    })).filter(l => l.text);
  });

  console.log('All links with href:');
  allLinks.forEach(l => console.log(`  [${l.tag}] "${l.text}" -> ${l.href?.slice(0, 80)}`));

  // Try navigating to any schedule-looking href
  const schedLinks = allLinks.filter(l =>
    l.href && (l.href.includes('schedule') || l.href.includes('standing') || l.href.includes('flight'))
  );
  console.log('\nSchedule/standing links:', schedLinks);

  if (schedLinks.length === 0) {
    // Click on any element with text "Schedules"
    const el = await page.$x('//*[text()="Schedules"]');
    if (el.length > 0) {
      console.log('\nFound "Schedules" text element, clicking...');
      await el[0].click();
      await new Promise(r => setTimeout(r, 3000));
    } else {
      // Try clicking by innerText
      const clicked = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.textContent.trim() === 'Schedules') {
            let el = node.parentElement;
            el.click();
            return el.outerHTML.slice(0, 100);
          }
        }
        return null;
      });
      console.log('Clicked by text:', clicked);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Check page URL after click
  console.log('Current URL:', page.url());

  console.log('\n=== API hits found ===');
  if (apiHits.length === 0) {
    console.log('No new API endpoints — schedule link may navigate or open via router');
    // Try direct URL patterns based on href structure we found
  }
  apiHits.forEach(h => console.log(' -', h.url));

  await browser.close();
}

probe().catch(e => { console.error('Error:', e.message); process.exit(1); });
