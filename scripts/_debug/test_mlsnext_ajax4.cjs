/**
 * Inspect the actual HTML structure returned by the get_matches endpoint.
 * 167K chars came back but we found 0 match_details links - what's in there?
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  console.log('Navigating...');
  await page.goto('https://www.modular11.com/schedule?year=14', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

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
          match_number: 0,
          status: 'scheduled',
          match_type: 2,
          schedule: 0,
          team: 0,
          teamPlayer: 0,
          location: 0,
          as_referee: 0,
          report_status: 0,
          start_date: '2026-02-14 00:00:00',
          end_date: '2026-07-31 23:59:59',
        },
        success: function (html) {
          clearTimeout(timeout);
          const container = document.createElement('div');
          container.innerHTML = html;

          // Find ALL anchor links
          const allLinks = Array.from(container.querySelectorAll('a')).map(a => ({
            href: a.getAttribute('href') || '',
            text: a.textContent.trim().substring(0, 60),
            class: a.className.substring(0, 40),
          }));

          // Find all class names used
          const allClasses = new Set();
          container.querySelectorAll('*').forEach(el => {
            el.classList.forEach(c => allClasses.add(c));
          });

          // Find table structure
          const tables = Array.from(container.querySelectorAll('table'));
          const tableInfo = tables.map(t => ({
            class: t.className,
            rows: t.querySelectorAll('tr').length,
            firstRow: t.querySelector('tr')?.innerHTML?.substring(0, 300) || '',
          }));

          // Find specific div structures
          const divs = Array.from(container.querySelectorAll('div[class]')).slice(0, 30).map(d => ({
            class: d.className.substring(0, 60),
            childCount: d.children.length,
            text: d.textContent.trim().substring(0, 100),
          }));

          // Extract raw HTML sections at different positions
          const htmlSections = [
            { label: 'start', html: html.substring(0, 1000) },
            { label: 'mid', html: html.substring(Math.floor(html.length / 2), Math.floor(html.length / 2) + 1000) },
            { label: 'end', html: html.substring(html.length - 500) },
          ];

          // Count specific patterns
          const patterns = {
            'match_details': (html.match(/match_details/g) || []).length,
            'match-details': (html.match(/match-details/g) || []).length,
            'href=': (html.match(/href=/g) || []).length,
            'team': (html.match(/team/gi) || []).length,
            'score': (html.match(/score/gi) || []).length,
            'vs': (html.match(/\bvs\b/gi) || []).length,
            'container-table': (html.match(/container-table/g) || []).length,
            'match-row': (html.match(/match.?row/gi) || []).length,
            'game': (html.match(/\bgame\b/gi) || []).length,
            'FC': (html.match(/\bFC\b/g) || []).length,
            'SC': (html.match(/\bSC\b/g) || []).length,
          };

          resolve({
            htmlLength: html.length,
            linkCount: allLinks.length,
            sampleLinks: allLinks.slice(0, 20),
            classes: [...allClasses].slice(0, 50),
            tableInfo,
            divSample: divs.slice(0, 15),
            htmlSections,
            patterns,
          });
        },
        error: function (xhr) {
          clearTimeout(timeout);
          resolve({ error: `${xhr.status} ${xhr.statusText}` });
        },
      });
    });
  });

  console.log('\n=== HTML ANALYSIS ===');
  console.log('Length:', result.htmlLength);
  console.log('Links found:', result.linkCount);
  console.log('\nPattern counts:', JSON.stringify(result.patterns, null, 2));

  console.log('\n=== SAMPLE LINKS ===');
  result.sampleLinks?.forEach(l => console.log(`  ${l.href.substring(0, 80)} | "${l.text}" | .${l.class}`));

  console.log('\n=== CSS CLASSES ===');
  console.log(result.classes?.join(', '));

  console.log('\n=== TABLES ===');
  result.tableInfo?.forEach((t, i) => {
    console.log(`\nTable ${i}: .${t.class}, ${t.rows} rows`);
    console.log(`  First row: ${t.firstRow}`);
  });

  console.log('\n=== DIV STRUCTURE ===');
  result.divSample?.forEach(d => {
    console.log(`  .${d.class} (${d.childCount} children): "${d.text.substring(0, 60)}"`);
  });

  console.log('\n=== HTML SECTIONS ===');
  result.htmlSections?.forEach(s => {
    console.log(`\n--- ${s.label} ---`);
    console.log(s.html);
  });

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
