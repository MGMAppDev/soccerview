/**
 * Probe AthleteOne — Phase 3: Puppeteer click to intercept schedule/standings API
 * Navigate to the schedules page and click on a flight's Schedule link
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const EVENT_ID = 3979;

async function probe() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const apiHits = {};

  page.on('response', async res => {
    const url = res.url();
    const contentType = res.headers()['content-type'] || '';
    if (url.includes('api.athleteone.com') && !url.includes('datadog')) {
      try {
        const body = await res.text();
        const parsed = JSON.parse(body);
        apiHits[url] = parsed;
        console.log(`\n📡 API: ${url}`);
        if (parsed.data) {
          const d = parsed.data;
          if (Array.isArray(d)) {
            console.log(`  Array[${d.length}] keys:`, d[0] ? Object.keys(d[0]).join(', ') : 'empty');
            if (d[0]) console.log('  Sample:', JSON.stringify(d[0]).slice(0, 400));
          } else if (typeof d === 'object') {
            console.log('  Keys:', Object.keys(d).join(', '));
            console.log('  Sample:', JSON.stringify(d).slice(0, 400));
          }
        }
      } catch (_) {}
    }
  });

  console.log('Loading schedules/standings page...');
  await page.goto(`https://app.athleteone.com/public/event/${EVENT_ID}/schedules-standings`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  // Find and click on the first "Schedules" link for a flight with active schedule
  const scheduleLinks = await page.$$eval('a, button', els =>
    els.filter(el => el.innerText?.trim() === 'Schedules' || el.innerText?.trim() === 'Schedule')
       .map(el => ({ text: el.innerText, tag: el.tagName, href: el.href || null }))
       .slice(0, 3)
  );
  console.log('\nSchedule links found:', scheduleLinks);

  if (scheduleLinks.length > 0) {
    // Click the first schedule link
    const clicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button'));
      const schedLink = links.find(el => el.innerText?.trim() === 'Schedules' || el.innerText?.trim() === 'Schedule');
      if (schedLink) {
        schedLink.click();
        return schedLink.href || schedLink.innerText;
      }
      return null;
    });
    console.log('Clicked:', clicked);
    await page.waitForTimeout(3000);
  }

  // Also try clicking on "Standings"
  const standingsLinks = await page.$$eval('a, button', els =>
    els.filter(el => el.innerText?.trim() === 'Standings' || el.innerText?.trim() === 'Standing')
       .map(el => ({ text: el.innerText, tag: el.tagName, href: el.href || null }))
       .slice(0, 3)
  );
  console.log('Standings links found:', standingsLinks);

  if (standingsLinks.length > 0) {
    const clicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button'));
      const link = links.find(el => el.innerText?.trim() === 'Standings' || el.innerText?.trim() === 'Standing');
      if (link) {
        link.click();
        return link.href || link.innerText;
      }
      return null;
    });
    console.log('Clicked standings:', clicked);
    await page.waitForTimeout(3000);
  }

  console.log('\n=== All AthleteOne API endpoints captured ===');
  Object.keys(apiHits).forEach(url => console.log(' -', url));

  await browser.close();
}

probe().catch(e => { console.error('Error:', e.message); process.exit(1); });
