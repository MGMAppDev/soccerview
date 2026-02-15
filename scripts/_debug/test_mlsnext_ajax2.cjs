/**
 * Diagnostic: Intercept the actual AJAX call the page makes to see ALL parameters.
 * Also inspect how the daterangepicker is actually stored.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  // Intercept ALL requests to get_matches
  const interceptedCalls = [];
  page.on('request', (req) => {
    if (req.url().includes('get_matches')) {
      interceptedCalls.push({
        url: req.url(),
        method: req.method(),
        postData: req.postData() || null,
        headers: Object.fromEntries(
          Object.entries(req.headers()).filter(([k]) => !['accept', 'user-agent', 'sec-'].some(p => k.startsWith(p)))
        ),
      });
    }
  });

  console.log('1. Navigating to schedule page (year=14 = U16)...');
  await page.goto('https://www.modular11.com/schedule?year=14', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 8000));

  console.log('\n=== INTERCEPTED get_matches CALLS ===');
  interceptedCalls.forEach((c, i) => {
    console.log(`\nCall ${i + 1}:`);
    console.log(`  URL: ${c.url}`);
    console.log(`  Method: ${c.method}`);
    if (c.postData) console.log(`  POST data: ${c.postData}`);
  });

  // Check jQuery data on datefilter
  console.log('\n=== DATEFILTER INVESTIGATION ===');
  const drpInfo = await page.evaluate(() => {
    const dateInput = document.querySelector('input[name="datefilter"]');
    if (!dateInput) return { error: 'No datefilter input' };

    const result = {
      value: dateInput.value,
      id: dateInput.id,
      className: dateInput.className,
    };

    // Check jQuery data keys
    if (typeof $ !== 'undefined') {
      const $el = $(dateInput);
      const data = $el.data();
      result.jqueryDataKeys = Object.keys(data);
      result.jqueryDataTypes = {};
      for (const [k, v] of Object.entries(data)) {
        result.jqueryDataTypes[k] = typeof v;
        if (typeof v === 'object' && v !== null) {
          result.jqueryDataTypes[k] = `object(${Object.keys(v).slice(0, 10).join(',')})`;
        }
      }
    }

    // Check for global schedule vars
    result.windowKeys = Object.keys(window).filter(k =>
      k.toLowerCase().includes('schedule') ||
      k.toLowerCase().includes('date') ||
      k.toLowerCase().includes('filter') ||
      k.toLowerCase().includes('league') ||
      k.toLowerCase().includes('match')
    ).slice(0, 20);

    return result;
  });
  console.log(JSON.stringify(drpInfo, null, 2));

  // Look at the page's JS files to find the AJAX call code
  console.log('\n=== FINDING AJAX CALL SOURCE ===');
  const ajaxSource = await page.evaluate(() => {
    // Search all script tags for the get_matches call
    const scripts = document.querySelectorAll('script');
    const results = [];
    for (const s of scripts) {
      const text = s.textContent;
      if (text.includes('get_matches')) {
        // Extract the AJAX call context (100 chars before and 500 after)
        const idx = text.indexOf('get_matches');
        const start = Math.max(0, idx - 200);
        const end = Math.min(text.length, idx + 800);
        results.push(text.substring(start, end));
      }
    }
    return results;
  });
  ajaxSource.forEach((s, i) => {
    console.log(`\nSource ${i + 1}:`);
    console.log(s);
  });

  // Check what selects exist on page and their current values
  console.log('\n=== SELECT ELEMENTS (CURRENT VALUES) ===');
  const selects = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('select')).map(s => ({
      name: s.name,
      id: s.id,
      value: s.value,
      selectedText: s.options[s.selectedIndex]?.text?.trim() || '',
      allOptions: Array.from(s.options).slice(0, 10).map(o => `${o.value}:${o.text.trim().substring(0, 30)}`),
    }));
  });
  selects.forEach(s => {
    console.log(`\n${s.name || s.id}: value="${s.value}" (${s.selectedText})`);
    console.log(`  Options: ${s.allOptions.join(' | ')}`);
  });

  // Check for hidden inputs that might carry match_type
  console.log('\n=== HIDDEN/SPECIAL INPUTS ===');
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({
      name: i.name, type: i.type, id: i.id, value: i.value.substring(0, 100),
    }));
  });
  inputs.forEach(i => console.log(`  ${i.type} name="${i.name}" id="${i.id}" value="${i.value}"`));

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
