/**
 * Debug script to inspect HTGSports page structure
 * Check what dropdowns and options exist on Sporting Classic 2025
 */
require('dotenv').config();
const puppeteer = require('puppeteer');

async function debugPage() {
  const eventId = 13418; // Sporting Classic 2025
  const url = `https://events.htgsports.net/?eventid=${eventId}#/scheduleresults`;

  console.log(`Opening: ${url}`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('table.table-striped', { timeout: 15000 });

  // Wait for page to fully render
  await new Promise(r => setTimeout(r, 3000));

  // Get ALL dropdowns on the page
  const dropdownInfo = await page.evaluate(() => {
    const results = [];
    const selects = document.querySelectorAll('select');

    selects.forEach((select, idx) => {
      const options = Array.from(select.querySelectorAll('option'));
      results.push({
        index: idx,
        className: select.className,
        id: select.id,
        name: select.name,
        optionCount: options.length,
        options: options.slice(0, 30).map(opt => ({
          value: opt.value,
          text: opt.textContent.trim().substring(0, 80),
        })),
      });
    });

    return results;
  });

  console.log('\n=== ALL DROPDOWNS ===');
  dropdownInfo.forEach(dd => {
    console.log(`\nDropdown #${dd.index}:`);
    console.log(`  class: "${dd.className}"`);
    console.log(`  id: "${dd.id}"`);
    console.log(`  name: "${dd.name}"`);
    console.log(`  options (${dd.optionCount} total):`);
    dd.options.forEach(opt => {
      console.log(`    - "${opt.text}" (value: ${opt.value})`);
    });
    if (dd.optionCount > 30) {
      console.log(`    ... and ${dd.optionCount - 30} more options`);
    }
  });

  // Check for any tabs or navigation elements
  const navInfo = await page.evaluate(() => {
    // Check for tabs
    const tabs = Array.from(document.querySelectorAll('[role="tab"], .nav-tab, .tab, [data-toggle="tab"]'));

    // Check for any links that might be division selectors
    const links = Array.from(document.querySelectorAll('a'));
    const divisionLinks = links.filter(a =>
      a.textContent.match(/U-?\d+|Boys|Girls|2017|2016|2015|2014|2013|2012|2011|2010/i)
    ).slice(0, 20);

    return {
      tabs: tabs.map(t => ({ text: t.textContent.trim(), href: t.href })),
      divisionLinks: divisionLinks.map(a => ({ text: a.textContent.trim().substring(0, 60), href: a.href })),
    };
  });

  console.log('\n=== TABS ===');
  console.log(`Found ${navInfo.tabs.length} tabs`);
  navInfo.tabs.slice(0, 10).forEach(t => console.log(`  - ${t.text}`));

  console.log('\n=== DIVISION-LIKE LINKS ===');
  console.log(`Found ${navInfo.divisionLinks.length} links`);
  navInfo.divisionLinks.forEach(l => console.log(`  - ${l.text}`));

  // Get current visible table info
  const tableInfo = await page.evaluate(() => {
    const tables = document.querySelectorAll('table.table-striped');
    const results = [];

    tables.forEach((table, idx) => {
      const rows = table.querySelectorAll('tr');
      const headers = table.querySelectorAll('th');

      results.push({
        index: idx,
        rowCount: rows.length,
        headers: Array.from(headers).map(h => h.textContent.trim()),
        firstFewRows: Array.from(rows).slice(0, 5).map(row => {
          const cells = row.querySelectorAll('td');
          return Array.from(cells).map(c => c.textContent.trim().substring(0, 30)).join(' | ');
        }),
      });
    });

    return results;
  });

  console.log('\n=== TABLES ===');
  tableInfo.forEach(t => {
    console.log(`\nTable #${t.index}: ${t.rowCount} rows`);
    console.log(`  Headers: ${t.headers.join(' | ')}`);
    console.log('  Sample rows:');
    t.firstFewRows.forEach(r => console.log(`    ${r}`));
  });

  // Look for age group filter specifically
  console.log('\n=== SEARCHING FOR AGE GROUP PATTERNS ===');
  const pageContent = await page.content();

  // Check for common age group patterns in the HTML
  const patterns = [
    /U-?11\b/gi,
    /U-?12\b/gi,
    /U-?13\b/gi,
    /U-?14\b/gi,
    /U-?15\b/gi,
    /2014\s*(Boys|Girls|B|G)/gi,
    /2015\s*(Boys|Girls|B|G)/gi,
    /(Boys|Girls)\s*2014/gi,
    /(Boys|Girls)\s*2015/gi,
  ];

  patterns.forEach(p => {
    const matches = pageContent.match(p);
    if (matches) {
      console.log(`  ${p}: ${matches.length} matches found - ${[...new Set(matches)].slice(0, 5).join(', ')}`);
    }
  });

  await browser.close();
  console.log('\nDone.');
}

debugPage().catch(console.error);
