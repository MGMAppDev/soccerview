/**
 * PlayMetrics Date Structure Probe
 * Navigate through league → first division, then examine DOM for date structure.
 */

const puppeteer = require('puppeteer');

async function probe() {
  console.log('🔍 PlayMetrics Date Structure Probe\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // Step 1: Load league page
    const landingUrl = 'https://playmetricssports.com/g/leagues/1017-1482-91a2b806/league_view.html';
    console.log(`Loading league page: ${landingUrl}\n`);
    await page.goto(landingUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Get first division link
    const divisions = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.league-divisions__grid__card'));
      return cards.slice(0, 3).map(card => {
        const nameEl = card.querySelector('.league-divisions__grid__card__name');
        const linkEl = card.querySelector('a.button');
        return {
          name: nameEl ? nameEl.textContent.trim() : null,
          href: linkEl ? linkEl.getAttribute('href') : null,
        };
      }).filter(d => d.name && d.href);
    });

    if (divisions.length === 0) {
      console.log('No divisions found!');
      return;
    }

    console.log(`Found ${divisions.length} divisions. Using: ${divisions[0].name}`);
    console.log(`   URL: ${divisions[0].href}\n`);

    // Step 2: Navigate to first division
    const divUrl = `https://playmetricssports.com${divisions[0].href}`;
    await page.goto(divUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 8000));

    const result = await page.evaluate(() => {
      const output = {
        dateElements: [],
        tables: [],
        parentStructure: [],
        allH3s: [],
        allH4s: [],
        allBoldElements: [],
        scheduleSectionHTML: '',
      };

      const datePattern = /\w+day,\s+\w+\s+\d+,\s+\d{4}/;

      // Find ALL elements with date text (check own text content, not children)
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        null
      );

      while (walker.nextNode()) {
        const el = walker.currentNode;
        // Check if this element's OWN direct text children contain a date
        const directText = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3) // Text nodes only
          .map(n => n.textContent.trim())
          .join(' ');

        if (directText && datePattern.test(directText)) {
          output.dateElements.push({
            tag: el.tagName,
            className: (el.className || '').toString().substring(0, 100),
            text: directText.substring(0, 120),
            parentTag: el.parentElement?.tagName,
            parentClass: (el.parentElement?.className || '').toString().substring(0, 100),
            nextSibTag: el.nextElementSibling?.tagName || null,
            nextSibClass: (el.nextElementSibling?.className || '').toString().substring(0, 60),
          });
        }
      }

      // Find h3, h4, strong/bold elements
      const h3s = Array.from(document.querySelectorAll('h3, h4, h5'));
      output.allH3s = h3s.slice(0, 15).map(el => ({
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 120),
      }));

      // Find strong/b elements with date-like content
      const boldEls = Array.from(document.querySelectorAll('strong, b, [class*="date"], [class*="header"]'));
      output.allBoldElements = boldEls.slice(0, 15).map(el => ({
        tag: el.tagName,
        className: (el.className || '').toString().substring(0, 60),
        text: el.textContent.trim().substring(0, 120),
      }));

      // Find all tables and their context
      const tables = Array.from(document.querySelectorAll('table'));
      for (let i = 0; i < Math.min(tables.length, 6); i++) {
        const table = tables[i];
        const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());
        const rowCount = table.querySelectorAll('tr').length - 1;
        const isSchedule = headers.includes('Home Team') && headers.includes('Away Team');

        // Get first data row sample
        const firstRow = table.querySelector('tr:nth-child(2)');
        const firstRowCells = firstRow ? Array.from(firstRow.querySelectorAll('td')).map(td => td.textContent.trim()) : [];

        // Walk backward through prev siblings (max 3)
        const prevSiblings = [];
        let prev = table.previousElementSibling;
        let depth = 0;
        while (prev && depth < 3) {
          prevSiblings.push({
            tag: prev.tagName,
            className: (prev.className || '').toString().substring(0, 60),
            text: prev.textContent.trim().substring(0, 120),
          });
          prev = prev.previousElementSibling;
          depth++;
        }

        output.tables.push({
          index: i,
          isSchedule,
          headers: headers.join(' | '),
          rowCount,
          firstRow: firstRowCells.join(' | '),
          parentTag: table.parentElement?.tagName,
          parentClass: (table.parentElement?.className || '').toString().substring(0, 60),
          prevSiblings,
        });
      }

      // Get parent container's children sequence (for first schedule table)
      const scheduleTables = tables.filter(t => {
        const hs = Array.from(t.querySelectorAll('th')).map(h => h.textContent.trim());
        return hs.includes('Home Team');
      });

      if (scheduleTables.length > 0) {
        const parent = scheduleTables[0].parentElement;
        if (parent) {
          const children = Array.from(parent.children);
          output.parentStructure = children.slice(0, 30).map((child, idx) => {
            const isTable = child.tagName === 'TABLE';
            const headers = isTable ? Array.from(child.querySelectorAll('th')).map(h => h.textContent.trim()).join(', ') : '';
            const isSchedule = headers.includes('Home Team');
            return {
              idx,
              tag: child.tagName,
              className: (child.className || '').toString().substring(0, 60),
              text: child.textContent.trim().substring(0, 80),
              isSchedule,
            };
          });
        }
      }

      return output;
    });

    console.log('=== DATE ELEMENTS (elements with direct date text) ===');
    console.log(`Count: ${result.dateElements.length}`);
    result.dateElements.slice(0, 10).forEach((el, i) => {
      console.log(`  [${i}] <${el.tag} class="${el.className}">`);
      console.log(`       text: "${el.text}"`);
      console.log(`       parent: <${el.parentTag} class="${el.parentClass}">`);
      console.log(`       nextSib: <${el.nextSibTag} class="${el.nextSibClass}">`);
    });

    console.log('\n=== H3/H4/H5 HEADERS ===');
    result.allH3s.forEach((h, i) => console.log(`  [${i}] <${h.tag}> "${h.text}"`));

    console.log('\n=== BOLD / DATE-CLASS ELEMENTS ===');
    result.allBoldElements.slice(0, 10).forEach((b, i) => {
      console.log(`  [${i}] <${b.tag} class="${b.className}"> "${b.text}"`);
    });

    console.log('\n=== TABLES WITH CONTEXT ===');
    result.tables.forEach(t => {
      console.log(`\n  Table ${t.index}: ${t.isSchedule ? '*** SCHEDULE ***' : 'other'} | ${t.rowCount} rows`);
      console.log(`    Headers: ${t.headers}`);
      console.log(`    First row: ${t.firstRow.substring(0, 120)}`);
      console.log(`    Parent: <${t.parentTag} class="${t.parentClass}">`);
      console.log(`    Previous siblings:`);
      t.prevSiblings.forEach((s, i) => {
        console.log(`      [${i}] <${s.tag} class="${s.className}"> "${s.text.substring(0, 80)}"`);
      });
    });

    console.log('\n=== PARENT CONTAINER CHILDREN (first 30) ===');
    result.parentStructure.forEach(c => {
      const marker = c.isSchedule ? ' <<< SCHEDULE TABLE' : '';
      console.log(`  [${c.idx}] <${c.tag} class="${c.className}"> "${c.text.substring(0, 60)}"${marker}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

probe().catch(console.error);
