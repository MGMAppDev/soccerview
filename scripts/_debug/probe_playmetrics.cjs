/**
 * PlayMetrics Structure Probe
 * ============================
 *
 * Explore PlayMetrics page structure to understand data access patterns.
 * Target: Fall 2025 Colorado Advanced League
 */

const puppeteer = require('puppeteer');

async function probePlayMetrics() {
  console.log('🔍 PlayMetrics Structure Probe\n');

  const browser = await puppeteer.launch({
    headless: false, // Run visible to see what's happening
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const page = await browser.newPage();

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // Intercept network requests to see API calls
    const requests = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/') || req.url().includes('.json') || req.url().includes('/g/')) {
        requests.push({
          url: req.url(),
          method: req.method(),
          resourceType: req.resourceType(),
        });
      }
    });

    const responses = [];
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/api/') || url.includes('.json')) {
        responses.push({
          url,
          status: res.status(),
          contentType: res.headers()['content-type'],
        });
      }
    });

    // Navigate to Fall 2025 Colorado Advanced League
    const url = 'https://playmetricssports.com/g/leagues/1017-1482-91a2b806/league_view.html';
    console.log(`📄 Loading: ${url}\n`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for potential dynamic content
    console.log('⏳ Waiting 8 seconds for SPA to render...\n');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Extract page structure
    const pageData = await page.evaluate(() => {
      // Check for embedded data
      const scripts = Array.from(document.querySelectorAll('script'))
        .map(s => s.textContent)
        .filter(text => text.includes('window') || text.includes('data') || text.includes('league'));

      // Check for visible elements
      const tables = document.querySelectorAll('table');
      const divs = document.querySelectorAll('div[class*="league"], div[class*="match"], div[class*="team"], div[class*="schedule"]');
      const selects = document.querySelectorAll('select');
      const links = document.querySelectorAll('a[href*="team"], a[href*="game"], a[href*="match"]');

      return {
        title: document.title,
        tablesCount: tables.length,
        relevantDivsCount: divs.length,
        selectsCount: selects.length,
        teamLinksCount: links.length,
        hasScripts: scripts.length > 0,
        bodyClasses: document.body.className,
        bodyId: document.body.id,
      };
    });

    console.log('📊 Page Structure:');
    console.log(`   Title: ${pageData.title}`);
    console.log(`   Tables: ${pageData.tablesCount}`);
    console.log(`   Relevant divs: ${pageData.relevantDivsCount}`);
    console.log(`   Dropdowns: ${pageData.selectsCount}`);
    console.log(`   Team/Match links: ${pageData.teamLinksCount}`);
    console.log(`   Has scripts: ${pageData.hasScripts}`);
    console.log(`   Body classes: ${pageData.bodyClasses || 'none'}`);
    console.log(`   Body ID: ${pageData.bodyId || 'none'}`);
    console.log();

    console.log('🌐 Network Requests:');
    const apiRequests = requests.filter(r => r.url.includes('/api/'));
    if (apiRequests.length > 0) {
      apiRequests.forEach(req => {
        console.log(`   ${req.method} ${req.url}`);
      });
    } else {
      console.log('   No API requests detected');
    }
    console.log();

    console.log('📥 API Responses:');
    if (responses.length > 0) {
      responses.forEach(res => {
        console.log(`   ${res.status} ${res.url}`);
        console.log(`      Content-Type: ${res.contentType}`);
      });
    } else {
      console.log('   No API responses detected');
    }
    console.log();

    // Check for division/tier dropdown
    const divisions = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      if (selects.length === 0) return null;

      // Find dropdown that looks like divisions/tiers
      for (const select of selects) {
        const options = Array.from(select.options).map(opt => ({
          value: opt.value,
          text: opt.textContent.trim(),
        }));

        if (options.length > 0 && options.some(o => o.text.match(/tier|division|premier|gold|silver|bronze|u\d/i))) {
          return {
            id: select.id,
            name: select.name,
            className: select.className,
            options,
          };
        }
      }

      return null;
    });

    if (divisions) {
      console.log('📋 Division Dropdown Found:');
      console.log(`   ID: ${divisions.id}`);
      console.log(`   Name: ${divisions.name}`);
      console.log(`   Class: ${divisions.className}`);
      console.log(`   Options (${divisions.options.length}):`);
      divisions.options.slice(0, 12).forEach(opt => {
        console.log(`      ${opt.value}: ${opt.text}`);
      });
      if (divisions.options.length > 12) {
        console.log(`      ... and ${divisions.options.length - 12} more`);
      }
    } else {
      console.log('📋 No division dropdown found');
    }
    console.log();

    // Check for match table structure
    const matchTable = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      if (tables.length === 0) return null;

      // Find table with match data
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        if (rows.length > 5) { // More than just headers
          const firstRow = rows[1]; // Skip header
          if (firstRow) {
            const cells = Array.from(firstRow.querySelectorAll('td, th')).map(cell => ({
              tag: cell.tagName,
              text: cell.textContent.trim().substring(0, 50),
              className: cell.className,
            }));

            return {
              rowCount: rows.length,
              columnCount: cells.length,
              sampleRow: cells,
              tableClasses: table.className,
              tableId: table.id,
            };
          }
        }
      }

      return null;
    });

    if (matchTable) {
      console.log('📊 Match Table Found:');
      console.log(`   Rows: ${matchTable.rowCount}`);
      console.log(`   Columns: ${matchTable.columnCount}`);
      console.log(`   Table classes: ${matchTable.tableClasses || 'none'}`);
      console.log(`   Table ID: ${matchTable.tableId || 'none'}`);
      console.log('   Sample row:');
      matchTable.sampleRow.forEach((cell, i) => {
        console.log(`      [${i}] ${cell.tag}: ${cell.text}`);
      });
    } else {
      console.log('📊 No match table found - data may be in divs or loaded async');
    }
    console.log();

    // Save screenshot
    await page.screenshot({ path: 'scripts/_debug/playmetrics_screenshot.png', fullPage: true });
    console.log('📸 Screenshot saved: scripts/_debug/playmetrics_screenshot.png');

    console.log('\n✅ Probe complete. Browser will stay open for 30 seconds for manual inspection.');
    await new Promise(resolve => setTimeout(resolve, 30000));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

probePlayMetrics().catch(console.error);
