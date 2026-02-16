/**
 * Discover SportsAffinity league GUIDs for OR, NE, PA-W
 * (MN and UT already discovered — see discover_sa_leagues.cjs output)
 */
const puppeteer = require('puppeteer');

const STATES = [
  { state: 'OR', subdomains: ['oysa'] },
  { state: 'NE', subdomains: ['nebraskasoccer'] },
  { state: 'PA-W', subdomains: ['pawest', 'pawesthighperformance'] },
];

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  for (const s of STATES) {
    console.log('\n=== ' + s.state + ' ===');
    for (const sub of s.subdomains) {
      const url = 'https://' + sub + '.sportsaffinity.com/tour/public/info/tournamentlist.asp?sessionguid=&section=gaming';
      const page = await browser.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const events = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href*="tournamentguid"]'));
          const seen = new Set();
          return anchors.filter(a => {
            const m = a.href.match(/tournamentguid=([A-F0-9-]+)/i);
            if (m && !seen.has(m[1])) { seen.add(m[1]); return true; }
            return false;
          }).map(a => ({
            name: a.textContent.trim().split('\n')[0].trim(),
            guid: a.href.match(/tournamentguid=([A-F0-9-]+)/i)[1]
          }));
        });
        if (events.length > 0) {
          console.log('  ' + sub + ': Found ' + events.length + ' leagues');
          events.forEach(e => console.log('    "' + e.name + '" -> ' + e.guid));
        } else {
          const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
          console.log('  ' + sub + ': No leagues found. Body: ' + text.substring(0, 200));
        }
      } catch (err) {
        console.log('  ' + sub + ': Error: ' + err.message);
      }
      await page.close();
    }

    // Also check tournaments
    for (const sub of s.subdomains) {
      const url = 'https://' + sub + '.sportsaffinity.com/tour/public/info/tournamentlist.asp?sessionguid=';
      const page = await browser.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const events = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href*="tournamentguid"]'));
          const seen = new Set();
          return anchors.filter(a => {
            const m = a.href.match(/tournamentguid=([A-F0-9-]+)/i);
            if (m && !seen.has(m[1])) { seen.add(m[1]); return true; }
            return false;
          }).map(a => ({
            name: a.textContent.trim().split('\n')[0].trim(),
            guid: a.href.match(/tournamentguid=([A-F0-9-]+)/i)[1]
          }));
        });
        if (events.length > 0) {
          console.log('  ' + sub + ' [TOURNAMENTS]: Found ' + events.length);
          events.forEach(e => console.log('    "' + e.name + '" -> ' + e.guid));
        }
      } catch (err) {
        // ignore
      }
      await page.close();
    }
  }

  await browser.close();
  console.log('\nDONE');
}

main().catch(err => { console.error(err); process.exit(1); });
