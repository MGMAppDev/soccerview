/**
 * Diagnostic: Understand the SportsAffinity sctour SPA structure.
 * Georgia Soccer schedule page - discover API calls, DOM structure, GUIDs.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  // Intercept ALL network requests
  const apiCalls = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    // Skip static assets
    if (url.includes('.js') || url.includes('.css') || url.includes('.png') ||
      url.includes('.woff') || url.includes('google') || url.includes('newrelic') ||
      url.includes('.svg') || url.includes('.ico') || url.includes('gtm')) return;

    try {
      const ct = (resp.headers()['content-type'] || '').substring(0, 60);
      let body = '';
      if (ct.includes('json') || ct.includes('html') || ct.includes('text')) {
        body = (await resp.text()).substring(0, 500);
      }
      apiCalls.push({
        url: url.substring(0, 200),
        status: resp.status(),
        ct,
        bodyPreview: body.substring(0, 200),
      });
    } catch {}
  });

  // Try a known Georgia schedule URL
  const scheduleUrl = 'https://sctour.sportsaffinity.com/schedules/890ac201-a728-4076-8637-7342ac2403e1/e8de748f-b283-46e4-a554-3a5872aff911?view=dates';
  console.log(`Navigating to Georgia schedule: ${scheduleUrl}`);
  await page.goto(scheduleUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 8000));

  // Check page state
  const pageInfo = await page.evaluate(() => {
    return {
      title: document.title,
      bodyLength: document.body.innerHTML.length,
      bodyText: document.body.innerText.substring(0, 500),
      hasLoading: document.body.innerText.includes('Loading'),
      hasError: document.body.innerText.includes('Error') || document.body.innerText.includes('error'),
    };
  });

  console.log('\n=== PAGE STATE ===');
  console.log('Title:', pageInfo.title);
  console.log('Body length:', pageInfo.bodyLength);
  console.log('Has Loading:', pageInfo.hasLoading);
  console.log('Has Error:', pageInfo.hasError);
  console.log('Body text:', pageInfo.bodyText.substring(0, 300));

  console.log('\n=== API CALLS ===');
  apiCalls.forEach(c => {
    console.log(`  ${c.status} ${c.url}`);
    if (c.bodyPreview && c.ct.includes('json')) {
      console.log(`    ${c.ct}: ${c.bodyPreview}`);
    }
  });

  // If page loaded, extract DOM structure
  if (pageInfo.bodyLength > 1000 && !pageInfo.hasLoading) {
    console.log('\n=== DOM STRUCTURE ===');
    const domInfo = await page.evaluate(() => {
      // Find all links to discover more GUIDs
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        href: a.getAttribute('href') || '',
        text: a.textContent.trim().substring(0, 60),
      })).filter(l => l.href && !l.href.startsWith('javascript'));

      // Find tables
      const tables = document.querySelectorAll('table');
      const tableInfo = Array.from(tables).map(t => ({
        class: t.className,
        rows: t.querySelectorAll('tr').length,
        firstRow: t.querySelector('tr')?.textContent?.replace(/\s+/g, ' ').trim().substring(0, 200),
      }));

      // Find selects/dropdowns
      const selects = Array.from(document.querySelectorAll('select')).map(s => ({
        name: s.name || s.id || s.className.substring(0, 30),
        options: Array.from(s.options).slice(0, 10).map(o => `${o.value.substring(0, 40)}:${o.text.trim().substring(0, 30)}`),
      }));

      // Find match-like elements
      const matchElements = document.querySelectorAll('[class*="match"], [class*="game"], [class*="schedule"], [class*="result"]');
      const matchInfo = Array.from(matchElements).slice(0, 5).map(el => ({
        class: el.className.substring(0, 60),
        text: el.textContent.replace(/\s+/g, ' ').trim().substring(0, 200),
      }));

      return { links: links.slice(0, 30), tableInfo, selects, matchInfo };
    });

    console.log('Links:', domInfo.links.length);
    domInfo.links.slice(0, 20).forEach(l => console.log(`  ${l.href.substring(0, 80)} | "${l.text}"`));
    console.log('\nTables:', domInfo.tableInfo.length);
    domInfo.tableInfo.forEach(t => console.log(`  .${t.class}: ${t.rows} rows | "${t.firstRow?.substring(0, 100)}"`));
    console.log('\nSelects:', domInfo.selects.length);
    domInfo.selects.forEach(s => {
      console.log(`  ${s.name}: ${s.options.join(' | ')}`);
    });
    console.log('\nMatch elements:', domInfo.matchInfo.length);
    domInfo.matchInfo.forEach(m => console.log(`  .${m.class}: "${m.text.substring(0, 150)}"`));
  }

  // If that URL didn't work, try the Georgia Soccer schedules landing page
  if (pageInfo.hasError || pageInfo.bodyLength < 1000) {
    console.log('\n\n=== TRYING GEORGIASOCCER.ORG SCHEDULES ===');
    await page.goto('https://www.georgiasoccer.org/schedules/', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    const gsLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .filter(a => a.href && (a.href.includes('sportsaffinity') || a.href.includes('sctour')))
        .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 60) }));
    });

    console.log('SportsAffinity links found:');
    gsLinks.forEach(l => console.log(`  ${l.href}`));
    console.log(`  Text: "${l.text}"`);
  }

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
