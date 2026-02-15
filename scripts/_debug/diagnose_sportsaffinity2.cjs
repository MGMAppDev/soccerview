/**
 * Find Georgia Soccer schedule URLs from georgiasoccer.org.
 * Then probe the SportsAffinity API for Georgia leagues.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  // Step 1: Visit georgiasoccer.org/schedules to find sctour links
  console.log('1. Visiting georgiasoccer.org...');
  await page.goto('https://www.georgiasoccer.org/schedules/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const gsLinks = await page.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll('a'));
    const scLinks = allLinks
      .filter(a => a.href && (a.href.includes('sportsaffinity') || a.href.includes('sctour')))
      .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 60) }));

    // Also get all links that might point to schedules
    const schedLinks = allLinks
      .filter(a => a.href && (a.href.includes('schedule') || a.href.includes('league') || a.href.includes('standings')))
      .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 60) }));

    // Get all iframes too
    const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);

    return { scLinks, schedLinks: schedLinks.slice(0, 20), iframes };
  });

  console.log('\nSportsAffinity links:');
  gsLinks.scLinks.forEach(l => console.log(`  ${l.text}: ${l.href}`));
  console.log('\nSchedule-related links:');
  gsLinks.schedLinks.forEach(l => console.log(`  ${l.text}: ${l.href}`));
  console.log('\nIframes:', gsLinks.iframes);

  // Step 2: Try other possible Georgia Soccer pages
  const urlsToTry = [
    'https://www.georgiasoccer.org/leagues/',
    'https://www.georgiasoccer.org/competitions/',
    'https://www.georgiasoccer.org/premier/',
  ];

  for (const url of urlsToTry) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 3000));
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
          .filter(a => a.href && (a.href.includes('sportsaffinity') || a.href.includes('sctour')))
          .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 60) }));
      });
      if (links.length > 0) {
        console.log(`\n${url}:`);
        links.forEach(l => console.log(`  ${l.text}: ${l.href}`));
      }
    } catch {}
  }

  // Step 3: Try gs.sportsaffinity.com to find tournament listing (may redirect to login)
  console.log('\n\n2. Trying gs.sportsaffinity.com...');
  try {
    const apiCalls = [];
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('/api/') || url.includes('tournament') || url.includes('schedule')) {
        const ct = (resp.headers()['content-type'] || '');
        let body = '';
        if (ct.includes('json')) {
          try { body = (await resp.text()).substring(0, 300); } catch {}
        }
        apiCalls.push({ url: url.substring(0, 200), status: resp.status(), body });
      }
    });

    await page.goto('https://gs.sportsaffinity.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const gsPageInfo = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      bodyText: document.body.innerText.substring(0, 500),
    }));
    console.log('Title:', gsPageInfo.title);
    console.log('URL:', gsPageInfo.url);
    console.log('Body:', gsPageInfo.bodyText.substring(0, 200));

    if (apiCalls.length > 0) {
      console.log('\nAPI calls captured:');
      apiCalls.forEach(c => console.log(`  ${c.status} ${c.url} ${c.body}`));
    }
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Step 4: Search for Georgia Soccer on sctour directly
  console.log('\n\n3. Probing sctour API for known Georgia org patterns...');

  // Try common org ID patterns from Georgia Soccer
  const orgIds = [
    '359d4418-200b-48cf-aa0a-460d4cf90f21', // Found in research
    '890ac201-a728-4076-8637-7342ac2403e1',  // Tested (turned out to be CT)
  ];

  for (const orgId of orgIds) {
    try {
      const resp = await page.goto(`https://sctour.sportsaffinity.com/api/page-header?organizationId=${orgId}&tournamentId=00000000-0000-0000-0000-000000000000`, {
        waitUntil: 'networkidle2',
        timeout: 15000,
      });
      const body = await page.evaluate(() => document.body.innerText);
      console.log(`  Org ${orgId.substring(0, 8)}: ${body.substring(0, 200)}`);
    } catch (e) {
      console.log(`  Org ${orgId.substring(0, 8)}: ${e.message}`);
    }
  }

  // Step 5: Try direct API call for known schedule
  console.log('\n\n4. Testing API endpoints...');
  const knownUrl = 'https://sctour.sportsaffinity.com/api/schedules?organizationId=359d4418-200b-48cf-aa0a-460d4cf90f21&tournamentId=0951180f-0913-4c36-ba08-85af82996f96';
  try {
    await page.goto(knownUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    const body = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log(`API schedules: ${body.substring(0, 400)}`);
  } catch (e) {
    console.log(`API error: ${e.message}`);
  }

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
