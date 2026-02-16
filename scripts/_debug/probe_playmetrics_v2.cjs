/**
 * PlayMetrics Structure Probe V2
 * ===============================
 *
 * Deep dive into div structure and navigation patterns.
 */

const puppeteer = require('puppeteer');

async function probePlayMetrics() {
  console.log('🔍 PlayMetrics Detailed Probe V2\n');

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
    console.log('⏳ Waiting 10 seconds for SPA...\n');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Extract detailed structure
    const structure = await page.evaluate(() => {
      // Find all clickable elements (tabs, buttons, links)
      const clickables = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"], .tab, .nav-item'));

      // Find elements with "schedule", "standings", "match", "game", "team" in class or text
      const relevantElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const classes = el.className || '';
        const text = el.textContent || '';
        const id = el.id || '';

        return (
          (classes.toLowerCase && (
            classes.toLowerCase().includes('schedule') ||
            classes.toLowerCase().includes('standing') ||
            classes.toLowerCase().includes('match') ||
            classes.toLowerCase().includes('game') ||
            classes.toLowerCase().includes('team') ||
            classes.toLowerCase().includes('division') ||
            classes.toLowerCase().includes('tier')
          )) ||
          (id.toLowerCase && (
            id.toLowerCase().includes('schedule') ||
            id.toLowerCase().includes('standing') ||
            id.toLowerCase().includes('match')
          ))
        );
      });

      // Check for Vue/React app root
      const appRoot = document.querySelector('#app, [id*="app"], [id*="root"]');

      // Look for team names (likely in divs/spans)
      const possibleTeams = Array.from(document.querySelectorAll('div, span, p')).filter(el => {
        const text = el.textContent.trim();
        // Team names often have club names + age group
        return text.length > 10 && text.length < 80 &&
               (text.match(/\b(FC|SC|United|Academy|Rush|Sporting|Real)\b/i) ||
                text.match(/U\d{1,2}\b/) ||
                text.match(/20\d{2}\b/));
      }).slice(0, 20); // First 20 matches

      // Look for score patterns
      const possibleScores = Array.from(document.querySelectorAll('div, span')).filter(el => {
        const text = el.textContent.trim();
        return text.match(/^\d+\s*[-:]\s*\d+$/) || text === 'vs' || text === '-';
      }).slice(0, 10);

      // Get all text content to see what's visible
      const bodyText = document.body.textContent.replace(/\s+/g, ' ').trim().substring(0, 1000);

      return {
        clickables: clickables.slice(0, 15).map(el => ({
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 40),
          className: el.className,
          id: el.id,
          role: el.getAttribute('role'),
        })),
        relevantElements: relevantElements.slice(0, 10).map(el => ({
          tag: el.tagName,
          className: el.className,
          id: el.id,
          text: el.textContent.trim().substring(0, 60),
        })),
        appRoot: appRoot ? {
          id: appRoot.id,
          className: appRoot.className,
          childCount: appRoot.children.length,
        } : null,
        possibleTeams: possibleTeams.map(el => ({
          tag: el.tagName,
          text: el.textContent.trim(),
          className: el.className,
        })),
        possibleScores: possibleScores.map(el => ({
          tag: el.tagName,
          text: el.textContent.trim(),
          className: el.className,
        })),
        bodyText,
      };
    });

    console.log('🎯 Clickable Elements (Tabs/Buttons/Links):');
    structure.clickables.forEach((el, i) => {
      console.log(`   [${i}] ${el.tag}: "${el.text}" (class: ${el.className || 'none'}, id: ${el.id || 'none'}, role: ${el.role || 'none'})`);
    });
    console.log();

    console.log('📋 Relevant Elements (Schedule/Standing/Match keywords):');
    structure.relevantElements.forEach(el => {
      console.log(`   ${el.tag}.${el.className || 'none'}: ${el.text}`);
    });
    console.log();

    if (structure.appRoot) {
      console.log('🏗️  Vue/React App Root:');
      console.log(`   ID: ${structure.appRoot.id}`);
      console.log(`   Class: ${structure.appRoot.className}`);
      console.log(`   Children: ${structure.appRoot.childCount}`);
      console.log();
    }

    console.log('⚽ Possible Team Names:');
    structure.possibleTeams.slice(0, 8).forEach(el => {
      console.log(`   ${el.tag}: ${el.text}`);
    });
    if (structure.possibleTeams.length > 8) {
      console.log(`   ... and ${structure.possibleTeams.length - 8} more`);
    }
    console.log();

    console.log('🎯 Possible Scores:');
    structure.possibleScores.forEach(el => {
      console.log(`   ${el.tag}: "${el.text}" (${el.className || 'none'})`);
    });
    console.log();

    console.log('📄 Body Text (first 1000 chars):');
    console.log(`   ${structure.bodyText}`);
    console.log();

    // Try clicking on common navigation elements
    console.log('🔍 Testing Navigation...');
    const navTests = [
      { selector: 'button:has-text("Schedule")', name: 'Schedule button' },
      { selector: 'button:has-text("Standings")', name: 'Standings button' },
      { selector: 'a:has-text("Schedule")', name: 'Schedule link' },
      { selector: '[role="tab"]:has-text("Schedule")', name: 'Schedule tab' },
    ];

    for (const test of navTests) {
      try {
        const element = await page.$(test.selector);
        if (element) {
          console.log(`   ✅ Found: ${test.name}`);
        }
      } catch (e) {
        // Selector not found or invalid
      }
    }

    console.log('\n📸 Screenshot saved: scripts/_debug/playmetrics_v2_screenshot.png');
    await page.screenshot({ path: 'scripts/_debug/playmetrics_v2_screenshot.png', fullPage: true });

    console.log('\n✅ Probe complete. Browser will stay open for 60 seconds for manual inspection.');
    console.log('   Look for: navigation tabs, team names, match results, division structure');
    await new Promise(resolve => setTimeout(resolve, 60000));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

probePlayMetrics().catch(console.error);
