const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://soccer.sincsports.com/schedule.aspx?tid=NCCSL', { waitUntil: 'networkidle2', timeout: 30000 });
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

  console.log('NCCSL divisions: ' + divs.length);
  divs.slice(0, 15).forEach(d => console.log('  ' + d.code + ': ' + d.text));
  if (divs.length > 15) console.log('  ... and ' + (divs.length - 15) + ' more');

  // Test first real division for data
  const testDiv = divs.find(d => d.code.startsWith('U'));
  if (testDiv) {
    console.log('\nTest division: ' + testDiv.code + ' (' + testDiv.text + ')');
    const divPage = await browser.newPage();
    await divPage.goto('https://soccer.sincsports.com/schedule.aspx?tid=NCCSL&year=2026&stid=NCCSL&syear=2026&div=' + testDiv.code, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const stats = await divPage.evaluate(() => {
      let matches = 0;
      let withScores = 0;
      document.querySelectorAll('.game-row').forEach(row => {
        if (!row.querySelector('.hometeam') || !row.querySelector('.awayteam')) return;
        matches++;
        const scoreContainer = row.querySelector('.col-3.text-right') || row.querySelector('.col-3');
        if (scoreContainer) {
          const scoreDivs = scoreContainer.querySelectorAll("div[style*='color']");
          if (scoreDivs.length >= 2) {
            const h = parseInt(scoreDivs[0].textContent.trim(), 10);
            if (!isNaN(h)) withScores++;
          }
        }
      });
      const standsDiv = document.querySelector('#divStds');
      let standings = 0;
      if (standsDiv) {
        for (const c of standsDiv.children) {
          if (c.querySelector('a[href*="team="]')) standings++;
        }
      }
      return { matches, withScores, scheduled: matches - withScores, standings };
    });

    console.log('Matches: ' + stats.matches + ' (' + stats.withScores + ' with scores, ' + stats.scheduled + ' scheduled)');
    console.log('Standings teams: ' + stats.standings);
    await divPage.close();
  }

  await browser.close();
})();
