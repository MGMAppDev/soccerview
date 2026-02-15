/**
 * Test: Full scrape of ONE age group (U13) through Puppeteer.
 * Verifies pagination works across all pages, and match data is correct.
 * This is a standalone test (not through coreScraper) to isolate the adapter logic.
 */
const puppeteer = require('puppeteer');

const AGE = { uid: 21, label: 'U13' };

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  console.log('Establishing session...');
  await page.goto('https://www.modular11.com/schedule?year=21', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const allMatches = [];
  let pageNum = 0;
  let lastPage = 0;
  let hasMore = true;
  const startTime = Date.now();

  console.log(`\nScraping ${AGE.label} (UID: ${AGE.uid})...`);

  while (hasMore && pageNum < 100) {
    const result = await page.evaluate(async (ageUid, pageOffset) => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: 'timeout' }), 25000);
        $.ajax({
          url: '/public_schedule/league/get_matches',
          type: 'GET',
          data: {
            open_page: pageOffset, academy: 0, tournament: 12, gender: 0, age: ageUid,
            brackets: '', groups: '', group: '', match_number: 0,
            status: 'all', match_type: 2, schedule: 0, team: 0,
            teamPlayer: 0, location: 0, as_referee: 0, report_status: 0,
            start_date: '2025-08-01 00:00:00', end_date: '2026-07-31 23:59:59',
          },
          success: function (html) {
            clearTimeout(timeout);
            const container = document.createElement('div');
            container.innerHTML = html;
            const matches = [];
            container.querySelectorAll('.container-row').forEach(row => {
              const dr = row.querySelector('.table-content-row.hidden-xs');
              if (!dr) return;
              const cols = dr.querySelectorAll('.col-sm-1, .col-sm-2, .col-sm-3, .col-sm-5, .col-sm-6');
              const matchId = (cols[0]?.textContent?.trim() || '').match(/^(\d+)/)?.[1];
              const dateMatch = (cols[1]?.textContent?.trim() || '').match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}(?:am|pm)?)/i);
              const locationEl = row.querySelector('.container-location p[data-title]');
              const bracket = dr.getAttribute('js-match-bracket') || '';
              const group = dr.getAttribute('js-match-group') || '';

              let homeTeam = null, awayTeam = null;
              const tc = row.querySelectorAll('.container-first-team, .container-second-team');
              if (tc.length >= 2) {
                const h = tc[0].querySelector('[data-title]');
                const a = tc[1].querySelector('[data-title]');
                homeTeam = h ? h.getAttribute('data-title') : tc[0].textContent.trim();
                awayTeam = a ? a.getAttribute('data-title') : tc[1].textContent.trim();
              }
              if (!homeTeam || !awayTeam) {
                const dt = Array.from(row.querySelectorAll('[data-title]'))
                  .map(el => el.getAttribute('data-title'))
                  .filter(t => t && !t.includes('Stadium') && !t.includes('Field') && !t.includes('Center') && !t.includes('Park') && !t.includes('Complex'));
                if (dt.length >= 2) { homeTeam = homeTeam || dt[0]; awayTeam = awayTeam || dt[1]; }
              }

              const scoreText = row.querySelector('.score-match-table')?.textContent?.trim() || '';

              if (matchId) matches.push({ matchId, dateStr: dateMatch?.[1], timeStr: dateMatch?.[2], homeTeam, awayTeam, scoreText, bracket, group });
            });

            let lp = 0;
            container.querySelectorAll('[js-page]').forEach(el => {
              const p = parseInt(el.getAttribute('js-page'), 10);
              if (!isNaN(p) && p > lp) lp = p;
            });

            resolve({ matches, lastPage: lp });
          },
          error: function (xhr) { clearTimeout(timeout); resolve({ error: `${xhr.status}` }); },
        });
      });
    }, AGE.uid, pageNum);

    if (result.error) { console.log(`Page ${pageNum}: ERROR ${result.error}`); break; }
    if (!result.matches || result.matches.length === 0) { hasMore = false; break; }

    if (pageNum === 0) lastPage = result.lastPage;
    allMatches.push(...result.matches);

    if (pageNum % 10 === 0 || pageNum === lastPage) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  Page ${pageNum}/${lastPage}: +${result.matches.length} matches (total: ${allMatches.length}, ${elapsed}s)`);
    }

    pageNum++;
    if (pageNum > lastPage) hasMore = false;
    else await new Promise(r => setTimeout(r, 2000));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== ${AGE.label} COMPLETE ===`);
  console.log(`Total matches: ${allMatches.length}`);
  console.log(`Pages scraped: ${pageNum}`);
  console.log(`Time: ${elapsed}s`);

  // Data quality
  const withTeams = allMatches.filter(m => m.homeTeam && m.awayTeam).length;
  const withDates = allMatches.filter(m => m.dateStr).length;
  const played = allMatches.filter(m => m.scoreText && m.scoreText !== 'TBD').length;
  const scheduled = allMatches.length - played;
  const uniqueTeams = new Set([...allMatches.map(m => m.homeTeam), ...allMatches.map(m => m.awayTeam)].filter(Boolean));
  const uniqueIds = new Set(allMatches.map(m => m.matchId));

  console.log(`\nData quality:`);
  console.log(`  Teams extracted: ${withTeams}/${allMatches.length} (${Math.round(withTeams / allMatches.length * 100)}%)`);
  console.log(`  Dates extracted: ${withDates}/${allMatches.length} (${Math.round(withDates / allMatches.length * 100)}%)`);
  console.log(`  Played (with scores): ${played}`);
  console.log(`  Scheduled (TBD): ${scheduled}`);
  console.log(`  Unique teams: ${uniqueTeams.size}`);
  console.log(`  Unique match IDs: ${uniqueIds.size} (dupes: ${allMatches.length - uniqueIds.size})`);

  // Divisions
  const divisions = {};
  allMatches.forEach(m => { divisions[m.group] = (divisions[m.group] || 0) + 1; });
  console.log(`\nDivision breakdown:`);
  Object.entries(divisions).sort((a, b) => b[1] - a[1]).forEach(([d, c]) => console.log(`  ${d}: ${c}`));

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
