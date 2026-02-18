/**
 * Probe AthleteOne Phase 4: Navigate to schedule view and intercept API call
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const EVENT_ID = 3979;
const FLIGHT_ID = 38917; // Girls G2008/2007 Flight A (6 teams, active schedule)
const DIV_ID = 18629;

async function probe() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const apiHits = [];

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('api.athleteone.com') && !url.includes('datadog') && !url.includes('nav-settings') && !url.includes('get-event-details')) {
      try {
        const body = await res.text();
        const parsed = JSON.parse(body);
        apiHits.push({ url, parsed });
        console.log(`\n📡 NEW API: ${url}`);
        if (parsed.data) {
          const d = parsed.data;
          if (Array.isArray(d)) {
            console.log(`  Array[${d.length}] keys:`, d[0] ? Object.keys(d[0]).join(', ') : 'empty');
            if (d.length > 0) console.log('  Sample:', JSON.stringify(d[0]).slice(0, 500));
          } else {
            console.log('  Keys:', Object.keys(d).join(', '));
            console.log('  Sample:', JSON.stringify(d).slice(0, 500));
          }
        }
      } catch (_) {}
    }
  });

  // Try navigating to specific schedule URL patterns
  const urlsToTry = [
    `https://app.athleteone.com/public/event/${EVENT_ID}/schedules/${DIV_ID}/${FLIGHT_ID}`,
    `https://app.athleteone.com/public/event/${EVENT_ID}/schedule/${FLIGHT_ID}`,
    `https://app.athleteone.com/public/event/${EVENT_ID}/flight/${FLIGHT_ID}/schedule`,
    `https://app.athleteone.com/public/event/${EVENT_ID}/division/${DIV_ID}/flight/${FLIGHT_ID}`,
  ];

  for (const url of urlsToTry) {
    console.log('\nTrying:', url);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      const pageUrl = page.url();
      const title = await page.title();
      console.log('Resolved to:', pageUrl, '| Title:', title);
      if (apiHits.length > 3) break; // Found what we need
    } catch (e) {
      console.log('Error:', e.message.slice(0, 50));
    }
  }

  // Go back to main page and try clicking
  console.log('\nGoing to main page...');
  await page.goto(`https://app.athleteone.com/public/event/${EVENT_ID}/schedules-standings`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  // Look for any interactive elements
  const links = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a, span[onclick], div[onclick], button'));
    return all.slice(0, 30).map(el => ({
      tag: el.tagName,
      text: el.innerText?.trim().slice(0, 30),
      href: el.getAttribute('href'),
      class: el.className?.slice(0, 40),
    }));
  });
  console.log('Interactive elements:');
  links.forEach(l => console.log(`  [${l.tag}] "${l.text}" href=${l.href} class=${l.class}`));

  // Try clicking first flight-related element
  const firstFlight = await page.$('.flight-name, .flight, [class*="flight"]');
  if (firstFlight) {
    console.log('\nClicking flight element...');
    await firstFlight.click();
    await page.waitForTimeout(3000);
  }

  console.log('\n=== All new API endpoints found ===');
  apiHits.forEach(h => console.log(' -', h.url));

  await browser.close();
}

probe().catch(e => { console.error('Error:', e.message); process.exit(1); });
