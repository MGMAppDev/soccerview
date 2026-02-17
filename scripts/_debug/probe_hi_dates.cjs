/**
 * Probe HI Oahu League date format in schedule pages
 * Need to understand how dates associate with match tables
 */
require('dotenv').config();
const https = require('https');
const cheerio = require('cheerio');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  const url = 'https://ol-fall-25-26.sportsaffinity.com/tour/public/info/schedule_results2.asp?sessionguid=&flightguid=392E430B-57C8-4BD0-AC1A-2975799D3081&tournamentguid=AD6E28FC-3EBE-46E9-842B-66E6A2EEB086';

  console.log('Fetching B14 flight (most matches)...\n');
  const html = await fetchUrl(url);
  const $ = cheerio.load(html);

  // Walk the DOM and log element types near dates
  console.log('=== DOM walk: elements containing date strings ===\n');

  const MONTHS_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i;

  function walkForDates(node, depth = 0) {
    if (!node) return;

    if (node.type === 'tag') {
      // Check direct text children for dates
      const directText = $(node).contents().filter(function() {
        return this.type === 'text';
      }).text().trim();

      if (MONTHS_RE.test(directText) && directText.length < 200) {
        const indent = '  '.repeat(depth);
        console.log(`${indent}<${node.tagName}> (text): "${directText.substring(0, 100)}"`);

        // Show parent chain
        let parent = node.parent;
        let chain = [];
        while (parent && parent.type === 'tag') {
          chain.push(parent.tagName);
          parent = parent.parent;
        }
        console.log(`${indent}  Parent chain: ${chain.reverse().join(' > ')}`);

        // Show siblings
        const prev = $(node).prev();
        const next = $(node).next();
        if (prev.length) {
          console.log(`${indent}  Prev sibling: <${prev[0].tagName}> "${prev.text().trim().substring(0, 50)}"`);
        }
        if (next.length) {
          console.log(`${indent}  Next sibling: <${next[0].tagName}> "${next.text().trim().substring(0, 50)}"`);
        }
        console.log('');
      }

      // Recurse
      const children = node.children || [];
      for (const child of children) {
        walkForDates(child, depth + 1);
      }
    }
  }

  const root = $('body')[0] || $.root()[0];
  if (root && root.children) {
    for (const child of root.children) {
      walkForDates(child, 0);
    }
  }

  // Also search raw HTML for context around date strings
  console.log('\n=== Raw HTML context around dates ===\n');
  const dateRe = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/gi;
  let match;
  let dateCount = 0;
  while ((match = dateRe.exec(html)) !== null && dateCount < 5) {
    const start = Math.max(0, match.index - 100);
    const end = Math.min(html.length, match.index + match[0].length + 100);
    const context = html.substring(start, end).replace(/\s+/g, ' ');
    console.log(`Date: ${match[0]}`);
    console.log(`Context: ...${context}...`);
    console.log('');
    dateCount++;
  }
}

main().catch(console.error);
