/**
 * Quick count: How many matches per age group?
 * Just fetch page 0 of each to get pagination info.
 */
const puppeteer = require('puppeteer');

const AGE_GROUPS = [
  { uid: 21, label: 'U13' },
  { uid: 22, label: 'U14' },
  { uid: 33, label: 'U15' },
  { uid: 14, label: 'U16' },
  { uid: 15, label: 'U17' },
  { uid: 26, label: 'U19' },
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  console.log('Establishing session...');
  await page.goto('https://www.modular11.com/schedule?year=21', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  let totalEstimate = 0;

  for (const age of AGE_GROUPS) {
    const result = await page.evaluate(async (ageUid) => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: 'timeout' }), 20000);
        $.ajax({
          url: '/public_schedule/league/get_matches',
          type: 'GET',
          data: {
            open_page: 0, academy: 0, tournament: 12, gender: 0, age: ageUid,
            brackets: '', groups: '', group: '', match_number: 0,
            status: 'all', match_type: 2, schedule: 0, team: 0,
            teamPlayer: 0, location: 0, as_referee: 0, report_status: 0,
            start_date: '2025-08-01 00:00:00', end_date: '2026-07-31 23:59:59',
          },
          success: function (html) {
            clearTimeout(timeout);
            const container = document.createElement('div');
            container.innerHTML = html;
            const rows = container.querySelectorAll('.container-row');
            let lastPage = 0;
            container.querySelectorAll('[js-page]').forEach(el => {
              const p = parseInt(el.getAttribute('js-page'), 10);
              if (!isNaN(p) && p > lastPage) lastPage = p;
            });

            // Get unique divisions
            const divisions = new Set();
            container.querySelectorAll('[js-match-group]').forEach(el => {
              divisions.add(el.getAttribute('js-match-group'));
            });

            resolve({ rows: rows.length, lastPage, divisions: [...divisions] });
          },
          error: function () { clearTimeout(timeout); resolve({ error: true }); },
        });
      });
    }, age.uid);

    if (result.error) {
      console.log(`${age.label}: ERROR`);
    } else {
      const estimated = result.rows * Math.max(result.lastPage, 1);
      totalEstimate += estimated;
      console.log(`${age.label}: ${result.rows}/page, ${result.lastPage} pages → ~${estimated} matches | Divisions: ${result.divisions.join(', ')}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n=== TOTAL ESTIMATED: ~${totalEstimate} matches across all age groups ===`);

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error(e.message); process.exit(1); });
