/**
 * Extract exact HTML structure of match rows from Modular11 AJAX response.
 * Need to understand: match IDs, team names, scores, dates, division.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  console.log('Navigating...');
  await page.goto('https://www.modular11.com/schedule?year=14', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // Get scheduled matches (future) to see structure
  console.log('Fetching scheduled matches...');
  const scheduled = await page.evaluate(async () => {
    return new Promise((resolve) => {
      $.ajax({
        url: '/public_schedule/league/get_matches',
        type: 'GET',
        data: {
          open_page: 0, academy: 0, tournament: 12, gender: 0, age: 14,
          brackets: '', groups: '', group: '', match_number: 0,
          status: 'scheduled', match_type: 2, schedule: 0, team: 0,
          teamPlayer: 0, location: 0, as_referee: 0, report_status: 0,
          start_date: '2026-02-14 00:00:00', end_date: '2026-07-31 23:59:59',
        },
        success: function (html) {
          const container = document.createElement('div');
          container.innerHTML = html;

          // Get the first 3 match rows (desktop version)
          const rows = container.querySelectorAll('.table-content-row.hidden-xs');
          const matchRows = [];
          rows.forEach((row, i) => {
            if (i >= 3) return;
            matchRows.push({
              fullHtml: row.outerHTML.substring(0, 2000),
              attributes: Array.from(row.attributes).map(a => `${a.name}="${a.value.substring(0, 80)}"`),
              text: row.textContent.replace(/\s+/g, ' ').trim().substring(0, 200),
            });
          });

          // Also get all unique js-match-* attribute values
          const jsAttrs = {};
          container.querySelectorAll('[js-match-group]').forEach(el => {
            const val = el.getAttribute('js-match-group');
            jsAttrs[val] = (jsAttrs[val] || 0) + 1;
          });

          // Try getting match data from container-row elements
          const containerRows = container.querySelectorAll('.container-row');
          const rowData = [];
          containerRows.forEach((cr, i) => {
            if (i >= 5) return;
            // Extract all text content organized by column
            const cols = cr.querySelectorAll('.col-sm-1, .col-sm-2, .col-sm-3, .col-sm-5, .col-sm-6');
            const colTexts = Array.from(cols).map(c => c.textContent.replace(/\s+/g, ' ').trim().substring(0, 80));

            // Look for match ID
            const matchIdEl = cr.querySelector('[js-match-id], .match-id');
            const matchId = matchIdEl?.textContent?.trim() || cr.querySelector('.col-sm-1')?.textContent?.trim();

            // Look for score
            const scoreEl = cr.querySelector('[js-score-block], .score-match-table');
            const score = scoreEl?.textContent?.trim();

            // Team names
            const teamEls = cr.querySelectorAll('.match-academy-name');
            const teams = Array.from(teamEls).map(t => t.textContent?.trim() || t.getAttribute('title') || '');

            // Additional attributes
            const allAttrs = {};
            cr.querySelectorAll('*').forEach(el => {
              Array.from(el.attributes).forEach(a => {
                if (a.name.startsWith('js-') || a.name.startsWith('data-')) {
                  allAttrs[`${a.name}=${a.value.substring(0, 50)}`] = true;
                }
              });
            });

            rowData.push({
              colTexts,
              matchId,
              score,
              teams,
              attrs: Object.keys(allAttrs).slice(0, 20),
            });
          });

          resolve({
            totalRows: rows.length,
            totalContainerRows: containerRows.length,
            matchRows,
            jsMatchGroups: jsAttrs,
            rowData,
          });
        },
        error: function (xhr) {
          resolve({ error: `${xhr.status}` });
        },
      });
    });
  });

  console.log('\n=== MATCH DATA ===');
  console.log('Total desktop rows:', scheduled.totalRows);
  console.log('Total container-row:', scheduled.totalContainerRows);
  console.log('js-match-group values:', JSON.stringify(scheduled.jsMatchGroups));

  console.log('\n=== FIRST 3 DESKTOP ROWS ===');
  scheduled.matchRows?.forEach((r, i) => {
    console.log(`\n--- Row ${i} ---`);
    console.log('Attributes:', r.attributes.join(', '));
    console.log('Text:', r.text);
    console.log('HTML:', r.fullHtml.substring(0, 800));
  });

  console.log('\n=== EXTRACTED ROW DATA ===');
  scheduled.rowData?.forEach((r, i) => {
    console.log(`\n--- Container ${i} ---`);
    console.log('Match ID:', r.matchId);
    console.log('Score:', r.score);
    console.log('Teams:', r.teams.join(' | '));
    console.log('Cols:', r.colTexts.join(' | '));
    console.log('Attrs:', r.attrs.join(', '));
  });

  // Now try to get PLAYED/COMPLETED matches
  console.log('\n\n=== TRYING PLAYED MATCHES ===');
  // First test: status values
  for (const status of ['played', 'completed', 'finished', 'final', 'result']) {
    const res = await page.evaluate(async (s) => {
      return new Promise((resolve) => {
        $.ajax({
          url: '/public_schedule/league/get_matches',
          type: 'GET',
          data: {
            open_page: 0, academy: 0, tournament: 12, gender: 0, age: 14,
            brackets: '', groups: '', group: '', match_number: 0,
            status: s, match_type: 2, schedule: 0, team: 0,
            teamPlayer: 0, location: 0, as_referee: 0, report_status: 0,
            start_date: '2025-08-01 00:00:00', end_date: '2026-02-15 23:59:59',
          },
          success: function (html) {
            resolve({ status: s, len: html.length, preview: html.substring(0, 200) });
          },
          error: function () { resolve({ status: s, len: 0 }); },
        });
      });
    }, status);
    console.log(`  status="${res.status}": ${res.len} chars ${res.len < 200 ? '| ' + res.preview : ''}`);
    await new Promise(r => setTimeout(r, 500));
  }

  // Also try without status filter at all (remove the parameter)
  console.log('\n--- Without status parameter ---');
  const noStatus = await page.evaluate(async () => {
    return new Promise((resolve) => {
      $.ajax({
        url: '/public_schedule/league/get_matches',
        type: 'GET',
        data: {
          open_page: 0, academy: 0, tournament: 12, gender: 0, age: 14,
          brackets: '', groups: '', group: '', match_number: 0,
          match_type: 2, schedule: 0, team: 0,
          teamPlayer: 0, location: 0, as_referee: 0, report_status: 0,
          start_date: '2025-08-01 00:00:00', end_date: '2026-07-31 23:59:59',
        },
        success: function (html) {
          const container = document.createElement('div');
          container.innerHTML = html;
          const rows = container.querySelectorAll('.container-row');

          // Get first row score to see if it has actual scores
          let sampleScore = null;
          if (rows.length > 0) {
            const scoreEl = rows[0].querySelector('.score-match-table');
            sampleScore = scoreEl?.textContent?.trim();
          }
          resolve({ len: html.length, rows: rows.length, sampleScore });
        },
        error: function () { resolve({ error: true }); },
      });
    });
  });
  console.log(`  No status: ${noStatus.len} chars, ${noStatus.rows} rows, sample score: "${noStatus.sampleScore}"`);

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
