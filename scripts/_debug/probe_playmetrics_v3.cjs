/**
 * PlayMetrics Structure Probe V3
 * ===============================
 *
 * Click into a division and extract match/standings data.
 */

const puppeteer = require('puppeteer');

async function probePlayMetrics() {
  console.log('🔍 PlayMetrics Division Deep Dive V3\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    const url = 'https://playmetricssports.com/g/leagues/1017-1482-91a2b806/league_view.html';
    console.log(`📄 Loading: ${url}\n`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('⏳ Waiting 8 seconds for SPA...\n');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Extract division links
    const divisions = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.league-divisions__grid__card'));
      return cards.map(card => {
        const nameEl = card.querySelector('.league-divisions__grid__card__name');
        const linkEl = card.querySelector('a.button');
        return {
          name: nameEl ? nameEl.textContent.trim() : null,
          href: linkEl ? linkEl.getAttribute('href') : null,
        };
      }).filter(d => d.name && d.href);
    });

    console.log(`Found ${divisions.length} divisions\n`);
    if (divisions.length === 0) {
      console.log('❌ No divisions found. Exiting.');
      return;
    }

    // Pick first division (U19G Premier 1)
    const targetDivision = divisions[0];
    console.log(`🎯 Navigating to: ${targetDivision.name}`);
    console.log(`   URL: ${targetDivision.href}\n`);

    // Click the division link
    await page.goto(`https://playmetricssports.com${targetDivision.href}`, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('⏳ Waiting 8 seconds for division page...\n');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Extract division page structure
    const divisionData = await page.evaluate(() => {
      // Look for tabs/navigation
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .tabs li, button[class*="tab"], a[class*="tab"]')).map(el => ({
        text: el.textContent.trim(),
        className: el.className,
        role: el.getAttribute('role'),
        href: el.getAttribute('href'),
      }));

      // Look for tables
      const tables = Array.from(document.querySelectorAll('table')).map((table, i) => {
        const rows = table.querySelectorAll('tr');
        const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());

        const sampleRows = Array.from(rows).slice(1, 4).map(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
          return cells;
        });

        return {
          index: i,
          headers,
          rowCount: rows.length - 1, // exclude header
          sampleRows,
          className: table.className,
        };
      });

      // Look for match/game cards (divs)
      const matchCards = Array.from(document.querySelectorAll('div[class*="match"], div[class*="game"], div[class*="fixture"]')).slice(0, 5).map(el => ({
        className: el.className,
        text: el.textContent.trim().substring(0, 100),
      }));

      // Check for team names
      const teamElements = Array.from(document.querySelectorAll('div, span, p')).filter(el => {
        const text = el.textContent.trim();
        return text.length > 10 && text.length < 80 &&
               (text.match(/\b(FC|SC|United|Academy|Rush|Sporting|Real|Pride|Storm)\b/i) ||
                text.match(/\b(Colorado|Denver|Boulder)\b/i));
      }).slice(0, 10).map(el => ({
        tag: el.tagName,
        className: el.className,
        text: el.textContent.trim(),
      }));

      // Page title
      const title = document.title;

      // Body text
      const bodyText = document.body.textContent.replace(/\s+/g, ' ').trim().substring(0, 1500);

      return {
        title,
        tabs,
        tables,
        matchCards,
        teamElements,
        bodyText,
      };
    });

    console.log(`📄 Division Page: ${divisionData.title}\n`);

    console.log('📑 Tabs/Navigation:');
    divisionData.tabs.slice(0, 10).forEach(tab => {
      console.log(`   "${tab.text}" (${tab.className || 'none'}, role: ${tab.role || 'none'})`);
    });
    console.log();

    console.log(`📊 Tables Found: ${divisionData.tables.length}`);
    divisionData.tables.forEach(table => {
      console.log(`\n   Table ${table.index}: ${table.rowCount} rows`);
      console.log(`   Headers: ${table.headers.join(' | ')}`);
      console.log(`   Sample rows:`);
      table.sampleRows.forEach((row, i) => {
        console.log(`      Row ${i + 1}: ${row.join(' | ')}`);
      });
    });
    console.log();

    if (divisionData.matchCards.length > 0) {
      console.log('🎴 Match/Game Cards:');
      divisionData.matchCards.forEach(card => {
        console.log(`   ${card.className}: ${card.text}`);
      });
      console.log();
    }

    console.log('⚽ Team Elements:');
    divisionData.teamElements.slice(0, 6).forEach(el => {
      console.log(`   ${el.tag}.${el.className || 'none'}: ${el.text}`);
    });
    console.log();

    console.log('📄 Body Text (first 1500 chars):');
    console.log(`   ${divisionData.bodyText}`);
    console.log();

    console.log('📸 Screenshot saved: scripts/_debug/playmetrics_v3_division.png');
    await page.screenshot({ path: 'scripts/_debug/playmetrics_v3_division.png', fullPage: true });

    console.log('\n✅ Division page loaded. Browser will stay open for 90 seconds.');
    console.log('   Manually inspect: tabs (Schedule/Standings), table structure, match format');
    await new Promise(resolve => setTimeout(resolve, 90000));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

probePlayMetrics().catch(console.error);
