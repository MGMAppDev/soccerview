/**
 * Quick test of MLS Next adapter v2.0 parsing logic.
 * Tests: AJAX with status=all, div-based parsing, team name extraction.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  console.log('1. Establishing session...');
  await page.goto('https://www.modular11.com/schedule?year=14', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // Test with status=all for U16 (age=14), page 0
  console.log('2. Fetching U16 page 0 with status=all...');
  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ error: 'timeout' }), 25000);
      $.ajax({
        url: '/public_schedule/league/get_matches',
        type: 'GET',
        data: {
          open_page: 0, academy: 0, tournament: 12, gender: 0, age: 14,
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
          const rows = container.querySelectorAll('.container-row');

          rows.forEach((row) => {
            const desktopRow = row.querySelector('.table-content-row.hidden-xs');
            if (!desktopRow) return;

            const cols = desktopRow.querySelectorAll('.col-sm-1, .col-sm-2, .col-sm-3, .col-sm-5, .col-sm-6');

            // Match ID
            const firstCol = cols[0]?.textContent?.trim() || '';
            const matchIdMatch = firstCol.match(/^(\d+)/);
            const matchId = matchIdMatch ? matchIdMatch[1] : null;

            // Date/time
            const dateCol = cols[1]?.textContent?.trim() || '';
            const dateMatch = dateCol.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}(?:am|pm)?)/i);
            const dateStr = dateMatch ? dateMatch[1] : null;
            const timeStr = dateMatch ? dateMatch[2] : null;

            // Location
            const locationEl = row.querySelector('.container-location p[data-title]');
            const location = locationEl ? locationEl.getAttribute('data-title') : null;

            // Age
            const ageCol = cols[2]?.textContent?.trim() || '';

            // Competition + Division
            const bracket = desktopRow.getAttribute('js-match-bracket') || '';
            const group = desktopRow.getAttribute('js-match-group') || '';

            // Team names
            const teamContainers = row.querySelectorAll('.container-first-team, .container-second-team');
            let homeTeam = null, awayTeam = null;

            if (teamContainers.length >= 2) {
              const homeEl = teamContainers[0].querySelector('[data-title]');
              const awayEl = teamContainers[1].querySelector('[data-title]');
              homeTeam = homeEl ? homeEl.getAttribute('data-title') : teamContainers[0].textContent.trim();
              awayTeam = awayEl ? awayEl.getAttribute('data-title') : teamContainers[1].textContent.trim();
            }

            // Fallback
            if (!homeTeam || !awayTeam) {
              const allDataTitles = Array.from(row.querySelectorAll('[data-title]'))
                .map(el => el.getAttribute('data-title'))
                .filter(t => t && !t.includes('Stadium') && !t.includes('Field') &&
                  !t.includes('Center') && !t.includes('Park') && !t.includes('Complex'));
              if (allDataTitles.length >= 2) {
                homeTeam = homeTeam || allDataTitles[0];
                awayTeam = awayTeam || allDataTitles[1];
              }
            }

            // Score
            const scoreEl = row.querySelector('.score-match-table');
            const scoreText = scoreEl?.textContent?.trim() || '';

            if (matchId) {
              matches.push({ matchId, dateStr, timeStr, homeTeam, awayTeam, scoreText, location, ageCol, bracket, group });
            }
          });

          // Pagination
          let lastPage = 0;
          container.querySelectorAll('[js-page]').forEach(el => {
            const p = parseInt(el.getAttribute('js-page'), 10);
            if (!isNaN(p) && p > lastPage) lastPage = p;
          });

          resolve({ htmlLength: html.length, totalRows: rows.length, matchCount: matches.length, lastPage, matches });
        },
        error: function (xhr) {
          clearTimeout(timeout);
          resolve({ error: `${xhr.status} ${xhr.statusText}` });
        },
      });
    });
  });

  if (result.error) {
    console.log('ERROR:', result.error);
  } else {
    console.log(`\n=== RESULTS ===`);
    console.log(`HTML: ${result.htmlLength} chars`);
    console.log(`Rows: ${result.totalRows}`);
    console.log(`Parsed: ${result.matchCount} matches`);
    console.log(`Pages: ${result.lastPage}`);

    console.log(`\n=== SAMPLE MATCHES (first 5) ===`);
    result.matches.slice(0, 5).forEach((m, i) => {
      const score = m.scoreText || 'TBD';
      console.log(`  ${i + 1}. [${m.matchId}] ${m.dateStr} ${m.timeStr || ''} | ${m.homeTeam} ${score} ${m.awayTeam} | ${m.ageCol} | ${m.bracket} | ${m.group} | ${m.location || 'no location'}`);
    });

    // Check data quality
    const withTeams = result.matches.filter(m => m.homeTeam && m.awayTeam);
    const withDates = result.matches.filter(m => m.dateStr);
    const withScores = result.matches.filter(m => m.scoreText && m.scoreText !== 'TBD');
    const withLocation = result.matches.filter(m => m.location);

    console.log(`\n=== DATA QUALITY (page 0 only) ===`);
    console.log(`  Teams: ${withTeams.length}/${result.matchCount} (${Math.round(withTeams.length / result.matchCount * 100)}%)`);
    console.log(`  Dates: ${withDates.length}/${result.matchCount} (${Math.round(withDates.length / result.matchCount * 100)}%)`);
    console.log(`  Scores: ${withScores.length}/${result.matchCount} (${Math.round(withScores.length / result.matchCount * 100)}%)`);
    console.log(`  Locations: ${withLocation.length}/${result.matchCount} (${Math.round(withLocation.length / result.matchCount * 100)}%)`);

    // Estimate total matches
    if (result.lastPage > 0) {
      const estimatedTotal = result.matchCount * result.lastPage;
      console.log(`\n   Estimated U16 total: ~${estimatedTotal} matches (${result.lastPage} pages x ${result.matchCount}/page)`);
    }
  }

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
