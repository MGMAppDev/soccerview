/**
 * Probe SDL (Sporting Development League) on PlayMetrics
 * Check what leagues/seasons exist for org 1133 (SDL).
 */

const puppeteer = require('puppeteer');

async function probe() {
  console.log('🔍 Probing SDL leagues on PlayMetrics\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // Check the SDL org page - PlayMetrics org pages list all leagues
    // Try the org page URL pattern
    const urls = [
      // Known SDL league IDs
      'https://playmetricssports.com/g/leagues/1133-1550-26d1bb55/league_view.html',  // Boys
      'https://playmetricssports.com/g/leagues/1133-1563-d15ba886/league_view.html',  // Girls
    ];

    for (const url of urls) {
      console.log(`\n📄 Loading: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(resolve => setTimeout(resolve, 8000));

      const data = await page.evaluate(() => {
        // Get page title/header info
        const title = document.title;
        const headerTitle = document.querySelector('.header__title')?.textContent?.trim() || '';
        const headerSubtitle = document.querySelector('.header__subtitle')?.textContent?.trim() || '';

        // Get division cards
        const cards = Array.from(document.querySelectorAll('.league-divisions__grid__card'));
        const divisions = cards.map(card => {
          const nameEl = card.querySelector('.league-divisions__grid__card__name');
          return nameEl ? nameEl.textContent.trim() : null;
        }).filter(Boolean);

        // Look for any navigation links to other seasons/leagues
        const allLinks = Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.textContent.trim().substring(0, 80),
          href: a.getAttribute('href') || '',
        })).filter(l => l.href.includes('/g/leagues/') || l.href.includes('1133'));

        // Check for breadcrumb or back links
        const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb a, [class*="back"] a, [class*="header"] a')).map(a => ({
          text: a.textContent.trim(),
          href: a.getAttribute('href') || '',
        }));

        return { title, headerTitle, headerSubtitle, divisions, allLinks: allLinks.slice(0, 20), breadcrumbs };
      });

      console.log(`   Title: ${data.title}`);
      console.log(`   Header: ${data.headerTitle} / ${data.headerSubtitle}`);
      console.log(`   Divisions: ${data.divisions.length}`);
      data.divisions.forEach(d => console.log(`     - ${d}`));

      if (data.breadcrumbs.length > 0) {
        console.log(`   Breadcrumbs:`);
        data.breadcrumbs.forEach(b => console.log(`     "${b.text}" → ${b.href}`));
      }

      if (data.allLinks.length > 0) {
        console.log(`   Links with league/org refs:`);
        data.allLinks.forEach(l => console.log(`     "${l.text}" → ${l.href}`));
      }
    }

    // Try to find org-level page that lists all SDL leagues
    console.log('\n\n📄 Trying SDL org page...');
    const orgUrl = 'https://playmetricssports.com/g/orgs/1133/org_view.html';
    try {
      await page.goto(orgUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 5000));
      const orgData = await page.evaluate(() => {
        return {
          title: document.title,
          bodySnippet: document.body.textContent.replace(/\s+/g, ' ').trim().substring(0, 500),
          links: Array.from(document.querySelectorAll('a[href*="leagues"]')).map(a => ({
            text: a.textContent.trim().substring(0, 80),
            href: a.getAttribute('href') || '',
          })).slice(0, 30),
        };
      });
      console.log(`   Title: ${orgData.title}`);
      console.log(`   Body: ${orgData.bodySnippet.substring(0, 200)}`);
      if (orgData.links.length > 0) {
        console.log(`   League links found: ${orgData.links.length}`);
        orgData.links.forEach(l => console.log(`     "${l.text}" → ${l.href}`));
      }
    } catch (e) {
      console.log(`   Org page failed: ${e.message}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

probe().catch(console.error);
