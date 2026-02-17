/**
 * Probe RI Super Liga - deeper investigation
 */
require('dotenv').config();
const puppeteer = require('puppeteer');

async function main() {
  console.log('=== RI Super Liga Puppeteer Probe v2 ===\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // Enable request logging
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('thesuperliga') || url.includes('action')) {
        console.log(`  [NETWORK] ${response.status()} ${url.substring(0, 100)}`);
      }
    });

    // Try both HTTP and HTTPS
    console.log('Loading https://www.thesuperliga.com/ ...');
    const resp = await page.goto('https://www.thesuperliga.com/', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    console.log(`Status: ${resp.status()}`);
    console.log(`URL: ${page.url()}`);

    await new Promise(r => setTimeout(r, 5000));

    // Check if jQuery loaded
    const hasJquery = await page.evaluate(() => typeof $ !== 'undefined' || typeof jQuery !== 'undefined');
    console.log(`jQuery loaded: ${hasJquery}`);

    // Check for tabs
    const tabsExist = await page.evaluate(() => {
      const tabs = document.getElementById('tabs');
      return tabs ? { found: true, display: tabs.style.display, innerHTML: tabs.innerHTML.substring(0, 200) } : { found: false };
    });
    console.log(`Tabs element: ${JSON.stringify(tabsExist)}`);

    // List ALL select elements
    const allSelects = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      return Array.from(selects).map(s => ({
        id: s.id,
        name: s.name,
        optionCount: s.options.length,
        options: Array.from(s.options).slice(0, 5).map(o => ({ v: o.value, t: o.textContent.trim() })),
        visible: s.offsetParent !== null,
        parentId: s.parentElement?.id
      }));
    });
    console.log(`\nAll <select> elements: ${allSelects.length}`);
    allSelects.forEach(s => {
      console.log(`  #${s.id} (${s.optionCount} opts, visible: ${s.visible}, parent: ${s.parentId})`);
      s.options.forEach(o => console.log(`    "${o.v}" → "${o.t}"`));
    });

    // Check if there's a Spring season section
    console.log('\nLooking for Spring section...');
    const springSection = await page.evaluate(() => {
      const tabs2 = document.getElementById('tabs-2');
      if (!tabs2) return 'tabs-2 not found';
      return {
        display: getComputedStyle(tabs2).display,
        html: tabs2.innerHTML.substring(0, 500),
        children: tabs2.children.length
      };
    });
    console.log(`Spring section: ${JSON.stringify(springSection).substring(0, 300)}`);

    // Try clicking Spring tab more forcefully
    console.log('\nForce-clicking Spring tab...');
    await page.evaluate(() => {
      // Try jQuery tabs API
      if (typeof $ !== 'undefined' && typeof $.fn.tabs !== 'undefined') {
        $('#tabs').tabs('option', 'active', 2);
      }
      // Also try direct show
      const t2 = document.getElementById('tabs-2');
      if (t2) t2.style.display = 'block';
    });
    await new Promise(r => setTimeout(r, 3000));

    // Check selects again
    const selectsAfter = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      return Array.from(selects).map(s => ({
        id: s.id,
        optionCount: s.options.length,
        firstOpts: Array.from(s.options).slice(0, 3).map(o => `${o.value}:${o.textContent.trim()}`)
      }));
    });
    console.log(`\nSelects after tab click: ${selectsAfter.length}`);
    selectsAfter.forEach(s => console.log(`  #${s.id}: ${s.optionCount} opts [${s.firstOpts.join(', ')}]`));

    // Check for AJAX/dynamically loaded data
    console.log('\nChecking for dynamically loaded content...');
    const bodyLength = await page.evaluate(() => document.body.innerHTML.length);
    console.log(`Body innerHTML length: ${bodyLength}`);

    // Look for any data tables or content
    const tables = await page.evaluate(() => {
      const tbls = document.querySelectorAll('table');
      return Array.from(tbls).map(t => ({
        rows: t.rows.length,
        text: t.textContent.trim().substring(0, 100)
      }));
    });
    console.log(`Tables: ${tables.length}`);
    tables.slice(0, 3).forEach(t => console.log(`  ${t.rows} rows: "${t.text}"`));

    // Try fetching a PHP endpoint directly from the page context
    console.log('\nDirect POST test from page context...');
    const postResult = await page.evaluate(async () => {
      try {
        const resp = await fetch('https://www.thesuperliga.com/actions/getScores.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'thing_code=U12&league=Spring&age_group=U12&division=Anchor'
        });
        return { status: resp.status, text: await resp.text() };
      } catch (e) {
        return { error: e.message };
      }
    });
    console.log(`POST result: status=${postResult.status}, length=${postResult.text?.length}`);
    if (postResult.text?.length > 50) {
      console.log(`Snippet: ${postResult.text.substring(0, 300).replace(/\s+/g, ' ')}`);
    }

    // Check page for any data loading patterns
    console.log('\nSearching for data-loading patterns...');
    const scripts = await page.evaluate(() => {
      const scriptTags = document.querySelectorAll('script');
      return Array.from(scriptTags)
        .map(s => s.textContent)
        .filter(t => t.includes('$.post') || t.includes('getSomething') || t.includes('getSchedule') || t.includes('age_group'))
        .map(t => t.substring(0, 500));
    });
    console.log(`Script tags with data patterns: ${scripts.length}`);
    scripts.forEach((s, i) => console.log(`  Script ${i}: ${s.replace(/\s+/g, ' ').substring(0, 200)}`));

  } finally {
    await browser.close();
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
