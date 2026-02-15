const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://soccer.sincsports.com/schedule.aspx?tid=VESL', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const divs = await page.evaluate(() => {
    const links = [];
    document.querySelectorAll('a[href*="div="]').forEach(a => {
      const href = a.getAttribute('href');
      const m = href.match(/div=([A-Za-z0-9]+)/);
      if (m) links.push({ code: m[1], text: a.textContent.trim() });
    });
    const seen = new Set();
    return links.filter(l => { if (seen.has(l.code)) return false; seen.add(l.code); return true; });
  });

  console.log('VESL divisions: ' + divs.length);
  divs.forEach(d => console.log('  ' + d.code + ': ' + d.text));

  // Quick test: scrape first real division (skip "N" header)
  const testDiv = divs.find(d => d.code.startsWith('U')) || divs[1];
  if (!testDiv) {
    console.log('No testable division found');
    await browser.close();
    return;
  }
  console.log('\nTest division: ' + testDiv.code + ' (' + testDiv.text + ')');

  const divPage = await browser.newPage();
  await divPage.goto('https://soccer.sincsports.com/schedule.aspx?tid=VESL&year=2026&stid=VESL&syear=2026&div=' + testDiv.code, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const matchCount = await divPage.evaluate(() => {
    let count = 0;
    document.querySelectorAll('.game-row').forEach(row => {
      if (row.querySelector('.hometeam') && row.querySelector('.awayteam')) count++;
    });
    return count;
  });
  console.log('Matches in test div: ' + matchCount);

  // Also check standings
  const standingsCount = await divPage.evaluate(() => {
    const standsDiv = document.querySelector('#divStds');
    if (!standsDiv) return 0;
    let count = 0;
    const children = standsDiv.children;
    for (let i = 0; i < children.length; i++) {
      if (children[i].querySelector('a[href*="team="]')) count++;
    }
    return count;
  });
  console.log('Standings teams: ' + standingsCount);

  await browser.close();
})();
