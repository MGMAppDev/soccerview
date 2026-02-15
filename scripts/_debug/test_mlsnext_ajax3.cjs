/**
 * Test: AJAX with correct parameters, try different status values to get completed matches.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  console.log('1. Navigating to establish session...');
  await page.goto('https://www.modular11.com/schedule?year=14', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // Test with correct parameters
  const tests = [
    { label: 'status=scheduled (future)', status: 'scheduled', start: '2026-02-14 00:00:00', end: '2026-07-31 23:59:59', matchType: 2 },
    { label: 'status=played (past)', status: 'played', start: '2025-08-01 00:00:00', end: '2026-02-14 23:59:59', matchType: 2 },
    { label: 'status=completed (past)', status: 'completed', start: '2025-08-01 00:00:00', end: '2026-02-14 23:59:59', matchType: 2 },
    { label: 'status=0 (all)', status: '0', start: '2025-08-01 00:00:00', end: '2026-07-31 23:59:59', matchType: 2 },
    { label: 'status=empty (all)', status: '', start: '2025-08-01 00:00:00', end: '2026-07-31 23:59:59', matchType: 2 },
    { label: 'match_type=28 (Flex)', status: 'played', start: '2025-08-01 00:00:00', end: '2026-02-14 23:59:59', matchType: 28 },
    { label: 'match_type=29 (League)', status: 'played', start: '2025-08-01 00:00:00', end: '2026-02-14 23:59:59', matchType: 29 },
  ];

  for (const test of tests) {
    const result = await page.evaluate(async (params) => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: 'timeout' }), 15000);
        $.ajax({
          url: '/public_schedule/league/get_matches',
          type: 'GET',
          data: {
            open_page: 0,
            academy: 0,
            tournament: 12,
            gender: 0,
            age: 14,
            brackets: '',
            groups: '',
            group: '',
            match_number: 0,
            status: params.status,
            match_type: params.matchType,
            schedule: 0,
            team: 0,
            teamPlayer: 0,
            location: 0,
            as_referee: 0,
            report_status: 0,
            start_date: params.start,
            end_date: params.end,
          },
          success: function (html) {
            clearTimeout(timeout);
            const container = document.createElement('div');
            container.innerHTML = html;
            const links = container.querySelectorAll('a[href*="match_details"]');
            const uids = new Set();
            links.forEach(l => {
              const m = l.getAttribute('href').match(/match_details\/(\d+)/);
              if (m) uids.add(m[1]);
            });

            // Try to extract one match's data from HTML
            let sampleMatch = null;
            if (html.length > 200) {
              // Look for table structures
              const tables = container.querySelectorAll('table');
              if (tables.length > 0) {
                const firstRow = tables[0].querySelector('tr');
                if (firstRow) {
                  sampleMatch = firstRow.innerHTML.substring(0, 300);
                }
              }
            }

            const isError = html.includes('field is required') || html.includes('invalid');

            resolve({
              htmlLength: html.length,
              matchUids: uids.size,
              isError,
              preview: html.substring(0, 200),
              sampleMatch,
            });
          },
          error: function (xhr) {
            clearTimeout(timeout);
            resolve({ error: `${xhr.status} ${xhr.statusText}` });
          },
        });
      });
    }, test);

    const icon = result.isError ? '❌' : result.matchUids > 0 ? '✅' : '⚠️';
    console.log(`\n${icon} ${test.label}`);
    console.log(`   HTML: ${result.htmlLength} chars, UIDs: ${result.matchUids}`);
    if (result.error) console.log(`   Error: ${result.error}`);
    if (result.isError) console.log(`   Server error: ${result.preview}`);
    if (result.matchUids > 0 && result.sampleMatch) {
      console.log(`   Sample: ${result.sampleMatch.substring(0, 200)}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // Now test page 0 vs page 1 to understand pagination
  console.log('\n\n=== PAGINATION TEST (status=scheduled, match_type=2) ===');
  for (let p = 0; p < 3; p++) {
    const result = await page.evaluate(async (pageNum) => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: 'timeout' }), 15000);
        $.ajax({
          url: '/public_schedule/league/get_matches',
          type: 'GET',
          data: {
            open_page: pageNum,
            academy: 0,
            tournament: 12,
            gender: 0,
            age: 14,
            brackets: '',
            groups: '',
            group: '',
            match_number: 0,
            status: 'scheduled',
            match_type: 2,
            schedule: 0,
            team: 0,
            teamPlayer: 0,
            location: 0,
            as_referee: 0,
            report_status: 0,
            start_date: '2026-02-14 00:00:00',
            end_date: '2026-07-31 23:59:59',
          },
          success: function (html) {
            clearTimeout(timeout);
            const container = document.createElement('div');
            container.innerHTML = html;
            const links = container.querySelectorAll('a[href*="match_details"]');
            const uids = new Set();
            links.forEach(l => {
              const m = l.getAttribute('href').match(/match_details\/(\d+)/);
              if (m) uids.add(m[1]);
            });
            resolve({ htmlLength: html.length, matchUids: uids.size });
          },
          error: function (xhr) {
            clearTimeout(timeout);
            resolve({ error: `${xhr.status}` });
          },
        });
      });
    }, p);
    console.log(`   Page ${p}: ${result.htmlLength} chars, ${result.matchUids} UIDs`);
    await new Promise(r => setTimeout(r, 500));
  }

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
