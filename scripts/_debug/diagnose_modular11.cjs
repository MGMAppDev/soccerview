/**
 * Diagnostic: Understand the exact DOM structure of the Modular11 schedule page.
 * This helps us build the correct Puppeteer interaction for the MLS Next adapter.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  // Intercept AJAX
  const ajaxCalls = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    const dominated = url.includes('.js') || url.includes('.css') || url.includes('.png') ||
      url.includes('.woff') || url.includes('google') || url.includes('pusher') ||
      url.includes('newrelic') || url.includes('rollbar') || url.includes('mixpanel');
    if (!dominated) {
      try {
        const ct = (resp.headers()['content-type'] || '').substring(0, 40);
        let body = '';
        if (ct.includes('json') || ct.includes('html')) {
          body = (await resp.text()).substring(0, 200);
        }
        ajaxCalls.push({ url: url.substring(0, 150), status: resp.status(), ct, body: body.substring(0, 100) });
      } catch {}
    }
  });

  console.log('Navigating to schedule page...');
  await page.goto('https://www.modular11.com/schedule?year=21', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // Get detailed DOM info
  const info = await page.evaluate(() => {
    const result = {};

    // All input elements
    result.inputs = Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type, class: i.className, id: i.id, placeholder: i.placeholder,
      name: i.name, value: i.value
    }));

    // All select elements
    result.selects = Array.from(document.querySelectorAll('select')).map(s => ({
      class: s.className, id: s.id, name: s.name,
      options: Array.from(s.options).slice(0, 15).map(o => ({ value: o.value, text: o.text.trim() }))
    }));

    // All buttons
    result.buttons = Array.from(document.querySelectorAll('button, .btn, input[type="submit"]')).map(b => ({
      text: b.textContent.trim().substring(0, 40), class: b.className.substring(0, 60), type: b.type
    }));

    // The full scheduleConfig script
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      if (s.textContent.includes('scheduleConfig')) {
        result.scheduleScript = s.textContent.substring(0, 2000);
      }
    }

    // External JS files
    result.externalScripts = Array.from(document.querySelectorAll('script[src]'))
      .map(s => s.src)
      .filter(s => {
        return !s.includes('google') && !s.includes('newrelic') && !s.includes('jquery') &&
          !s.includes('bootstrap') && !s.includes('rollbar') && !s.includes('mixpanel') &&
          !s.includes('pusher');
      });

    // Check for specific objects in the global scope
    result.globals = {
      hasJQuery: typeof $ !== 'undefined',
      hasScheduleConfig: typeof scheduleConfig !== 'undefined',
      scheduleConfigKeys: typeof scheduleConfig !== 'undefined' ? Object.keys(scheduleConfig) : [],
    };

    try {
      if (typeof scheduleConfig !== 'undefined') {
        result.scheduleConfigValue = JSON.parse(JSON.stringify(scheduleConfig));
      }
    } catch {}

    return result;
  });

  console.log('\n=== INPUTS ===');
  console.log(JSON.stringify(info.inputs, null, 2));
  console.log('\n=== SELECTS ===');
  console.log(JSON.stringify(info.selects, null, 2));
  console.log('\n=== BUTTONS ===');
  console.log(JSON.stringify(info.buttons, null, 2));
  console.log('\n=== GLOBALS ===');
  console.log(JSON.stringify(info.globals, null, 2));
  if (info.scheduleConfigValue) {
    console.log('\n=== SCHEDULE CONFIG VALUE ===');
    console.log(JSON.stringify(info.scheduleConfigValue, null, 2));
  }
  console.log('\n=== SCHEDULE SCRIPT ===');
  console.log(info.scheduleScript || 'Not found');
  console.log('\n=== EXTERNAL SCRIPTS ===');
  console.log(JSON.stringify(info.externalScripts, null, 2));
  console.log('\n=== AJAX CALLS ===');
  ajaxCalls.forEach(c => console.log(`  ${c.status} ${c.url} [${c.ct}] ${c.body || ''}`));

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
