/**
 * Probe RI Super Liga with Puppeteer to discover dropdown values
 * The site populates dropdowns via server-side JS, not static HTML
 */
require('dotenv').config();
const puppeteer = require('puppeteer');

async function main() {
  console.log('=== RI Super Liga Puppeteer Probe ===\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    console.log('Loading thesuperliga.com...');
    await page.goto('https://www.thesuperliga.com/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('Page loaded. Waiting for dropdowns...');
    await new Promise(r => setTimeout(r, 3000));

    // Click the Spring tab to activate it
    console.log('Clicking Spring tab...');
    try {
      await page.click('a[href="#tabs-2"]');
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log('  Could not click Spring tab, trying alternative...');
      // Try clicking by text
      await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of links) {
          if (link.textContent.trim().toLowerCase().includes('spring')) {
            link.click();
            break;
          }
        }
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    // Extract all dropdown options
    console.log('\n--- Extracting Dropdowns ---\n');

    const dropdowns = await page.evaluate(() => {
      const result = {};
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const id = sel.id || sel.name || 'unknown';
        const options = [];
        for (const opt of sel.options) {
          if (opt.value) {
            options.push({ value: opt.value, text: opt.textContent.trim() });
          }
        }
        if (options.length > 0) {
          result[id] = options;
        }
      }
      return result;
    });

    for (const [id, options] of Object.entries(dropdowns)) {
      console.log(`Dropdown: ${id} (${options.length} options)`);
      for (const opt of options) {
        console.log(`  "${opt.value}" → ${opt.text}`);
      }
      console.log('');
    }

    // Try a POST with actual values if we found them
    if (dropdowns.scores_age_group && dropdowns.scores_league && dropdowns.scores_select) {
      console.log('\n--- Testing POST with actual values ---\n');

      const ageGroup = dropdowns.scores_age_group[0]?.value;
      const league = dropdowns.scores_league[0]?.value;
      const division = dropdowns.scores_select[0]?.value;

      if (ageGroup && league && division) {
        console.log(`Testing: age=${ageGroup}, league=${league}, div=${division}`);

        // Use page.evaluate to make the POST request
        const postResult = await page.evaluate(async (params) => {
          const body = new URLSearchParams(params).toString();
          const response = await fetch('/actions/getScores.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
          });
          return await response.text();
        }, { thing_code: ageGroup, league, age_group: ageGroup });

        console.log(`Response length: ${postResult.length}`);
        if (postResult.length > 100) {
          console.log(`Snippet: ${postResult.substring(0, 500).replace(/\s+/g, ' ')}`);
        }
      }
    }

    // Also try to discover how the cascading dropdowns work
    console.log('\n--- Cascading Dropdown Test ---\n');

    // Select first age group in scores section
    if (dropdowns.scores_age_group && dropdowns.scores_age_group.length > 0) {
      const firstAge = dropdowns.scores_age_group[0].value;
      console.log(`Selecting age group: ${firstAge}`);

      await page.select('#scores_age_group', firstAge);
      await new Promise(r => setTimeout(r, 2000));

      // Check if league dropdown now has options
      const leagueOptions = await page.evaluate(() => {
        const sel = document.querySelector('#scores_league');
        if (!sel) return [];
        return Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() })).filter(o => o.value);
      });
      console.log(`League options after selecting age: ${leagueOptions.length}`);
      leagueOptions.forEach(o => console.log(`  "${o.value}" → ${o.text}`));

      // Select first league
      if (leagueOptions.length > 0) {
        const firstLeague = leagueOptions[0].value;
        console.log(`\nSelecting league: ${firstLeague}`);
        await page.select('#scores_league', firstLeague);
        await new Promise(r => setTimeout(r, 2000));

        // Check divisions
        const divOptions = await page.evaluate(() => {
          const sel = document.querySelector('#scores_select');
          if (!sel) return [];
          return Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() })).filter(o => o.value);
        });
        console.log(`Division options: ${divOptions.length}`);
        divOptions.forEach(o => console.log(`  "${o.value}" → ${o.text}`));

        // Click the Scores button/trigger
        if (divOptions.length > 0) {
          const firstDiv = divOptions[0].value;
          console.log(`\nSelecting division: ${firstDiv}`);
          await page.select('#scores_select', firstDiv);
          await new Promise(r => setTimeout(r, 1000));

          // Trigger getSomething('scores')
          console.log('Triggering getSomething("scores")...');
          await page.evaluate(() => {
            if (typeof getSomething === 'function') {
              getSomething('scores');
            }
          });
          await new Promise(r => setTimeout(r, 3000));

          // Get the result
          const displayContent = await page.evaluate(() => {
            const el = document.querySelector('#spring_display');
            return el ? el.innerHTML : 'NO #spring_display found';
          });
          console.log(`Display content length: ${displayContent.length}`);
          if (displayContent.length > 50) {
            console.log(`Snippet: ${displayContent.substring(0, 800).replace(/\s+/g, ' ')}`);
          }
        }
      }
    }

    // Also check Schedule tab dropdowns
    console.log('\n--- Schedule Dropdowns ---\n');
    if (dropdowns.schedule_age_group && dropdowns.schedule_age_group.length > 0) {
      console.log(`Schedule age groups: ${dropdowns.schedule_age_group.length}`);
      dropdowns.schedule_age_group.forEach(o => console.log(`  "${o.value}" → ${o.text}`));
    }
    if (dropdowns.schedule_league && dropdowns.schedule_league.length > 0) {
      console.log(`Schedule leagues: ${dropdowns.schedule_league.length}`);
      dropdowns.schedule_league.forEach(o => console.log(`  "${o.value}" → ${o.text}`));
    }

    // Check what tab structure looks like
    console.log('\n--- Page Structure ---\n');
    const pageInfo = await page.evaluate(() => {
      const tabs = document.querySelectorAll('[id^="tabs-"]');
      return Array.from(tabs).map(t => ({
        id: t.id,
        visible: t.style.display !== 'none',
        childCount: t.children.length,
        textPreview: t.textContent.trim().substring(0, 100)
      }));
    });
    pageInfo.forEach(t => console.log(`  ${t.id}: visible=${t.visible}, children=${t.childCount}, text="${t.textPreview}"`));

  } finally {
    await browser.close();
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
