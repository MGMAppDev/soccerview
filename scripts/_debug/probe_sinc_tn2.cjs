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
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function main() {
  for (const tid of ['TZ1186', 'TZ2026']) {
    const r = await fetch(`https://soccer.sincsports.com/schedule.aspx?tid=${tid}`);
    console.log(`\n=== TID ${tid} (status ${r.status}) ===`);
    // Show first 2000 chars
    console.log(r.body.substring(0, 2000));
  }
}
main().catch(e => console.error('Error:', e.message));
