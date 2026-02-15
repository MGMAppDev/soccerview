/**
 * Probe actual schedule_results2.asp page HTML structure for Georgia Soccer.
 * Need to understand how match data (teams, scores, dates) is structured.
 * Testing B12 flight from Fall 2025 tournament.
 */
const puppeteer = require('puppeteer');

const FALL_2025 = {
  subdomain: 'gs-fall25gplacadathclrias',
  tournamentGuid: 'E7A6731D-D5FF-41B4-9C3C-300ECEE69150',
  flights: {
    B12: '942EC597-3CD7-4A14-A2E9-BD0444C775B1',
    B13: '70FE1CB5-9862-41DD-9419-DCAB6BC49785',
    B14: 'EBD0E900-0019-417F-AFAE-6CD67A4D5A0E',
  }
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  const baseUrl = `https://${FALL_2025.subdomain}.sportsaffinity.com/tour/public/info`;
  const scheduleUrl = `${baseUrl}/schedule_results2.asp?sessionguid=&flightguid=${FALL_2025.flights.B12}&tournamentguid=${FALL_2025.tournamentGuid}`;

  console.log('Fetching schedule page...');
  console.log('URL:', scheduleUrl);

  const response = await page.goto(scheduleUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('Status:', response.status());

  // Get full page HTML structure
  const analysis = await page.evaluate(() => {
    const body = document.body;
    if (!body) return { error: 'No body' };

    const html = body.innerHTML;
    const text = body.innerText;

    // Find tables
    const tables = document.querySelectorAll('table');
    const tableInfo = [];
    tables.forEach((t, i) => {
      const rows = t.querySelectorAll('tr');
      const firstRowCells = rows[0] ? Array.from(rows[0].querySelectorAll('td, th')).map(c => c.textContent.trim().substring(0, 50)) : [];
      const secondRowCells = rows[1] ? Array.from(rows[1].querySelectorAll('td, th')).map(c => c.textContent.trim().substring(0, 80)) : [];
      tableInfo.push({
        index: i,
        rows: rows.length,
        cols: rows[0] ? rows[0].querySelectorAll('td, th').length : 0,
        firstRow: firstRowCells,
        secondRow: secondRowCells,
        className: t.className,
        id: t.id,
      });
    });

    // Find forms
    const forms = document.querySelectorAll('form');
    const formInfo = Array.from(forms).map(f => ({
      action: f.action?.substring(0, 100),
      method: f.method,
      id: f.id,
    }));

    // Look for common match patterns
    const matchPatterns = {
      'vs': (html.match(/vs\b/gi) || []).length,
      'score': (html.match(/score/gi) || []).length,
      'game': (html.match(/game/gi) || []).length,
      'match': (html.match(/match/gi) || []).length,
      'team': (html.match(/team/gi) || []).length,
      'date': (html.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g) || []).length,
      'time': (html.match(/\d{1,2}:\d{2}\s*(am|pm)/gi) || []).length,
      'links': document.querySelectorAll('a[href]').length,
    };

    // Get text preview (first 3000 chars)
    const textPreview = text.substring(0, 3000);

    // Get all unique class names
    const allClasses = new Set();
    document.querySelectorAll('*').forEach(el => {
      el.classList.forEach(c => allClasses.add(c));
    });

    // Find any score-like patterns (e.g., "3-1", "2 - 0", etc.)
    const scoreMatches = text.match(/\b\d+\s*[-:]\s*\d+\b/g) || [];

    return {
      htmlLength: html.length,
      textLength: text.length,
      tables: tableInfo,
      forms: formInfo,
      matchPatterns,
      textPreview,
      uniqueClasses: Array.from(allClasses).sort().slice(0, 50),
      scoreMatches: scoreMatches.slice(0, 20),
      title: document.title,
    };
  });

  console.log('\n=== PAGE ANALYSIS ===');
  console.log('Title:', analysis.title);
  console.log('HTML:', analysis.htmlLength, 'chars | Text:', analysis.textLength, 'chars');

  console.log('\n=== TABLES ===');
  analysis.tables.forEach(t => {
    console.log(`\nTable ${t.index}: ${t.rows} rows, ${t.cols} cols, class="${t.className}", id="${t.id}"`);
    if (t.firstRow.length) console.log('  Header:', t.firstRow.join(' | '));
    if (t.secondRow.length) console.log('  Row 1:', t.secondRow.join(' | '));
  });

  console.log('\n=== MATCH PATTERNS ===');
  Object.entries(analysis.matchPatterns).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });

  console.log('\n=== SCORE-LIKE MATCHES ===');
  console.log(analysis.scoreMatches.join(', '));

  console.log('\n=== CLASSES (first 50) ===');
  console.log(analysis.uniqueClasses.join(', '));

  console.log('\n=== TEXT PREVIEW (first 3000 chars) ===');
  console.log(analysis.textPreview);

  // Now get raw HTML of the main content area
  const rawHtml = await page.evaluate(() => {
    // Look for the main schedule table or content area
    const mainTable = document.querySelector('table.schedule, table.results, #scheduleTable, .schedule-table');
    if (mainTable) return mainTable.outerHTML.substring(0, 5000);

    // If no specific schedule table, get the largest table
    const tables = Array.from(document.querySelectorAll('table'));
    if (tables.length === 0) return 'NO TABLES FOUND';

    // Sort by row count
    tables.sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length);
    return tables[0].outerHTML.substring(0, 5000);
  });

  console.log('\n=== LARGEST TABLE HTML (first 5000 chars) ===');
  console.log(rawHtml);

  // Also try to get a single match row in detail
  const matchRow = await page.evaluate(() => {
    // Find rows that look like match data (have score-like patterns)
    const allRows = document.querySelectorAll('tr');
    for (const row of allRows) {
      const text = row.textContent;
      // Look for rows with date + team names + score
      if (text.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/) && text.match(/\d+\s*[-:]\s*\d+/)) {
        const cells = Array.from(row.querySelectorAll('td')).map((td, i) => ({
          index: i,
          text: td.textContent.trim().substring(0, 100),
          html: td.innerHTML.substring(0, 200),
          colSpan: td.colSpan,
          className: td.className,
        }));
        return { html: row.outerHTML.substring(0, 2000), cells };
      }
    }
    return null;
  });

  if (matchRow) {
    console.log('\n=== SAMPLE MATCH ROW ===');
    console.log('HTML:', matchRow.html);
    console.log('\nCells:');
    matchRow.cells.forEach(c => {
      console.log(`  [${c.index}] class="${c.className}" colspan=${c.colSpan}: "${c.text}"`);
    });
  } else {
    console.log('\n=== NO MATCH ROW FOUND WITH DATE+SCORE PATTERN ===');
  }

  // Also check if standings page works
  const standingsUrl = `${baseUrl}/standings.asp?sessionguid=&flightguid=${FALL_2025.flights.B12}&tournamentguid=${FALL_2025.tournamentGuid}`;
  console.log('\n\n=== CHECKING STANDINGS PAGE ===');
  await page.goto(standingsUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  const standingsAnalysis = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    const result = [];
    tables.forEach((t, i) => {
      const rows = t.querySelectorAll('tr');
      const firstRowCells = rows[0] ? Array.from(rows[0].querySelectorAll('td, th')).map(c => c.textContent.trim().substring(0, 30)) : [];
      const secondRowCells = rows[1] ? Array.from(rows[1].querySelectorAll('td, th')).map(c => c.textContent.trim().substring(0, 50)) : [];
      if (rows.length > 2) {
        result.push({
          index: i, rows: rows.length, cols: firstRowCells.length,
          firstRow: firstRowCells, secondRow: secondRowCells,
        });
      }
    });
    return result;
  });

  console.log('Tables with >2 rows:');
  standingsAnalysis.forEach(t => {
    console.log(`  Table ${t.index}: ${t.rows} rows, ${t.cols} cols`);
    console.log('    Header:', t.firstRow.join(' | '));
    console.log('    Row 1:', t.secondRow.join(' | '));
  });

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error(e.message); process.exit(1); });
