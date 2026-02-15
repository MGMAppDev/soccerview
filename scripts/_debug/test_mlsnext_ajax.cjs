/**
 * Quick test: Verify MLS Next AJAX endpoint returns match data.
 * Tests the core mechanism before running the full adapter.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  console.log('1. Navigating to schedule page to establish session...');
  await page.goto('https://www.modular11.com/schedule?year=21', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // Set date range to full season
  console.log('2. Setting daterangepicker to full season...');
  const drpResult = await page.evaluate(() => {
    try {
      const dateInput = document.querySelector('input[name="datefilter"]');
      if (!dateInput) return { error: 'No datefilter input' };
      const drp = $(dateInput).data('daterangepicker');
      if (!drp) return { error: 'No daterangepicker instance' };
      drp.setStartDate('08/01/2025');
      drp.setEndDate('07/31/2026');
      drp.callback(drp.startDate, drp.endDate, 'Custom Range');
      return { success: true, value: dateInput.value };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('   DRP result:', JSON.stringify(drpResult));
  await new Promise(r => setTimeout(r, 3000));

  // Test AJAX for U16 (UID 14) — should have most data
  console.log('\n3. Testing AJAX call for U16 (age=14)...');
  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ error: 'timeout' }), 20000);
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
          match_number: '',
        },
        success: function (html) {
          clearTimeout(timeout);

          // Parse the HTML to find match data
          const container = document.createElement('div');
          container.innerHTML = html;

          // Find match_details links
          const links = container.querySelectorAll('a[href*="match_details"]');
          const uids = [];
          links.forEach(link => {
            const m = link.getAttribute('href').match(/match_details\/(\d+)/);
            if (m) uids.push(m[1]);
          });

          // Find any table rows
          const tables = container.querySelectorAll('table');
          let tableInfo = [];
          tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            tableInfo.push({
              rows: rows.length,
              firstRowCells: rows[0] ? Array.from(rows[0].querySelectorAll('td,th')).map(c => c.textContent.trim().substring(0, 50)) : []
            });
          });

          // Find team names in the HTML
          const teamElements = container.querySelectorAll('.team-name, [class*="team"], .home-team, .away-team');
          const teamNames = Array.from(teamElements).map(el => el.textContent.trim()).slice(0, 10);

          // Find score elements
          const scoreElements = container.querySelectorAll('.score, [class*="score"], .result');
          const scores = Array.from(scoreElements).map(el => el.textContent.trim()).slice(0, 10);

          resolve({
            htmlLength: html.length,
            preview: html.substring(0, 500),
            matchUids: [...new Set(uids)].slice(0, 20),
            totalUids: [...new Set(uids)].length,
            tables: tableInfo,
            teamNames,
            scores,
            hasContent: html.includes('match_details') || html.includes('team') || tables.length > 0,
          });
        },
        error: function (xhr) {
          clearTimeout(timeout);
          resolve({ error: `${xhr.status} ${xhr.statusText}` });
        },
      });
    });
  });

  console.log('\n=== AJAX RESULT ===');
  console.log('HTML Length:', result.htmlLength || 0);
  console.log('Has Content:', result.hasContent || false);
  console.log('Match UIDs found:', result.totalUids || 0);
  if (result.matchUids?.length > 0) {
    console.log('Sample UIDs:', result.matchUids.slice(0, 5).join(', '));
  }
  if (result.tables?.length > 0) {
    console.log('Tables:', JSON.stringify(result.tables));
  }
  if (result.teamNames?.length > 0) {
    console.log('Team names:', result.teamNames.join(', '));
  }
  if (result.scores?.length > 0) {
    console.log('Scores:', result.scores.join(', '));
  }
  if (result.error) {
    console.log('ERROR:', result.error);
  }
  if (result.htmlLength > 0 && result.totalUids === 0) {
    console.log('\nHTML Preview:', result.preview);
  }

  // If we got match UIDs, test enrichment with one
  if (result.matchUids?.length > 0) {
    const testUid = result.matchUids[0];
    console.log(`\n4. Testing match details enrichment for UID ${testUid}...`);

    await page.goto(`https://www.modular11.com/match_details/${testUid}/2`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await new Promise(r => setTimeout(r, 3000));

    const detailData = await page.evaluate(() => {
      // Check page title
      const title = document.title;

      // Look for match data in scripts
      const scripts = document.querySelectorAll('script');
      let scriptData = null;
      for (const s of scripts) {
        const text = s.textContent;
        if (text.includes('"score_home"') || text.includes('"team_home"') || text.includes('"UID"')) {
          scriptData = text.substring(0, 1500);
          break;
        }
        if (text.includes('matchDetails') || text.includes('matchData')) {
          scriptData = text.substring(0, 1500);
          break;
        }
      }

      // Fallback: look for data in the DOM
      const bodyText = document.body.innerText.substring(0, 1000);

      // Look for specific elements
      const teamEls = document.querySelectorAll('.team-name, [class*="team"], h2, h3');
      const teamTexts = Array.from(teamEls).map(el => el.textContent.trim()).filter(t => t.length > 2).slice(0, 10);

      return { title, scriptData, bodyText, teamTexts };
    });

    console.log('Title:', detailData.title);
    if (detailData.scriptData) {
      console.log('Script data found:', detailData.scriptData.substring(0, 500));
    } else {
      console.log('No inline script data found');
      console.log('Body text:', detailData.bodyText.substring(0, 300));
    }
    if (detailData.teamTexts.length > 0) {
      console.log('DOM team elements:', detailData.teamTexts.join(' | '));
    }
  }

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
