const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });

  // Test all VESL divisions for data
  const divCodes = ['U09M01', 'U10M01', 'U11M01', 'U12M01', 'U15M01', 'U09F01', 'U10F01', 'U12F01', 'U15F01'];

  for (const code of divCodes) {
    const page = await browser.newPage();
    await page.goto('https://soccer.sincsports.com/schedule.aspx?tid=VESL&year=2026&stid=VESL&syear=2026&div=' + code, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const stats = await page.evaluate(() => {
      let matches = 0;
      document.querySelectorAll('.game-row').forEach(row => {
        if (row.querySelector('.hometeam') && row.querySelector('.awayteam')) matches++;
      });
      const standsDiv = document.querySelector('#divStds');
      let standings = 0;
      if (standsDiv) {
        for (const c of standsDiv.children) {
          if (c.querySelector('a[href*="team="]')) standings++;
        }
      }
      return { matches, standings };
    });

    console.log(code + ': ' + stats.matches + ' matches, ' + stats.standings + ' standings teams');
    await page.close();
  }

  // Also check TN Fall (TZ1185) even though it was reported offline
  console.log('\n--- TZ1185 (TN Fall) ---');
  const fallPage = await browser.newPage();
  await fallPage.goto('https://soccer.sincsports.com/schedule.aspx?tid=TZ1185', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const fallDivs = await fallPage.evaluate(() => {
    const links = [];
    document.querySelectorAll('a[href*="div="]').forEach(a => {
      const href = a.getAttribute('href');
      const m = href.match(/div=([A-Za-z0-9]+)/);
      if (m) links.push({ code: m[1], text: a.textContent.trim() });
    });
    const seen = new Set();
    return links.filter(l => { if (seen.has(l.code)) return false; seen.add(l.code); return true; });
  });
  console.log('TZ1185 divisions: ' + fallDivs.length);
  fallDivs.forEach(d => console.log('  ' + d.code + ': ' + d.text));

  // Test first TN Fall division if any
  const tnDiv = fallDivs.find(d => d.code.startsWith('U'));
  if (tnDiv) {
    const tnPage = await browser.newPage();
    await tnPage.goto('https://soccer.sincsports.com/schedule.aspx?tid=TZ1185&year=2025&stid=TZ1185&syear=2025&div=' + tnDiv.code, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    const tnStats = await tnPage.evaluate(() => {
      let matches = 0;
      document.querySelectorAll('.game-row').forEach(row => {
        if (row.querySelector('.hometeam') && row.querySelector('.awayteam')) matches++;
      });
      return { matches };
    });
    console.log(tnDiv.code + ': ' + tnStats.matches + ' matches');
    await tnPage.close();
  }

  await browser.close();
})();
