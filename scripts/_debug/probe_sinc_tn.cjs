const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: data.substring(0, 3000) }));
    }).on('error', reject);
  });
}

async function main() {
  const tids = ['TZ1186', 'TZ2026', 'TZSP26', 'TZSP2026', 'TZSPRING26'];
  for (const tid of tids) {
    const r = await fetch(`https://soccer.sincsports.com/schedule.aspx?tid=${tid}`);
    const hasTeams = r.body.includes('Team') && !r.body.includes('currently offline') && !r.body.includes('No schedules');
    const offline = r.body.includes('currently offline');
    const notFound = r.body.includes('not found') || r.status === 404;
    const redirect = r.location || '';
    console.log(`TID ${tid}: status=${r.status} offline=${offline} notFound=${notFound} hasTeams=${hasTeams} redirect=${redirect}`);
  }
}
main().catch(e => console.error('Error:', e.message));
