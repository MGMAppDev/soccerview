/**
 * Probe GotSport standings/results page structure
 * Fetches the raw HTML to analyze CSS selectors and page structure
 */
require('dotenv').config();
const https = require('https');
const http = require('http');

const URLS = [
  'https://system.gotsport.com/org_event/events/45671/results?group=399780',
  'https://system.gotsport.com/org_event/events/45671/results?group=400106',
];

async function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    };
    client.get(url, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`  Redirect ${res.statusCode} -> ${res.headers.location}`);
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function extractStandingsStructure(html) {
  const results = {};

  // Find all collapse sections (brackets)
  const collapseRegex = /id="(collapse-\d+)"/g;
  const collapses = [];
  let m;
  while ((m = collapseRegex.exec(html)) !== null) {
    collapses.push(m[1]);
  }
  results.collapseIds = collapses;

  // Find bracket headers
  const bracketRegex = /href="#collapse-\d+[^"]*"[^>]*>(.*?)<\/a>/g;
  const brackets = [];
  while ((m = bracketRegex.exec(html)) !== null) {
    brackets.push(m[1].trim());
  }
  results.bracketHeaders = brackets;

  // Find table classes
  const tableClassRegex = /<table[^>]*class="([^"]*)"[^>]*>/g;
  const tableClasses = [];
  while ((m = tableClassRegex.exec(html)) !== null) {
    tableClasses.push(m[1]);
  }
  results.tableClasses = tableClasses;

  // Find th content (column headers)
  const thRegex = /<th[^>]*>(.*?)<\/th>/gs;
  const headers = [];
  while ((m = thRegex.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]*>/g, '').trim();
    if (text && !headers.includes(text)) headers.push(text);
  }
  results.columnHeaders = headers;

  // Find team links in results table
  const teamLinkRegex = /<a[^>]*href="([^"]*schedules\?team=\d+)"[^>]*>(.*?)<\/a>/g;
  const teamLinks = [];
  while ((m = teamLinkRegex.exec(html)) !== null) {
    teamLinks.push({ href: m[1], name: m[2].trim() });
    if (teamLinks.length >= 5) break; // Just need a sample
  }
  results.sampleTeamLinks = teamLinks;

  // Find the first standings table HTML (extract ~2000 chars around first <table)
  const firstTableIdx = html.indexOf('<table', html.indexOf('collapse-'));
  if (firstTableIdx > -1) {
    results.firstTableRawSnippet = html.substring(firstTableIdx, firstTableIdx + 3000)
      .replace(/\n\s+/g, '\n');
  }

  // Find div wrappers around tables
  const divClassRegex = /<div[^>]*class="([^"]*panel[^"]*)"[^>]*>/g;
  const panelClasses = [];
  while ((m = divClassRegex.exec(html)) !== null) {
    panelClasses.push(m[1]);
  }
  results.panelClasses = panelClasses;

  // Check for card classes
  const cardClassRegex = /<div[^>]*class="([^"]*card[^"]*)"[^>]*>/g;
  const cardClasses = [];
  while ((m = cardClassRegex.exec(html)) !== null) {
    cardClasses.push(m[1]);
  }
  results.cardClasses = cardClasses;

  // Find data-* attributes
  const dataAttrRegex = /data-(\w+)="([^"]*)"/g;
  const dataAttrs = [];
  while ((m = dataAttrRegex.exec(html)) !== null) {
    const key = m[1];
    if (!dataAttrs.some(d => d.key === key)) {
      dataAttrs.push({ key, sampleValue: m[2] });
    }
  }
  results.dataAttributes = dataAttrs;

  // Find tiebreaker links
  const tiebreakerRegex = /href="([^"]*tiebreaker[^"]*)"/g;
  const tiebreakers = [];
  while ((m = tiebreakerRegex.exec(html)) !== null) {
    tiebreakers.push(m[1]);
  }
  results.tiebreakerLinks = tiebreakers;

  // Check for AJAX/XHR patterns
  const ajaxRegex = /(fetch|XMLHttpRequest|axios|\.ajax|\.get\(|\.post\()/g;
  results.hasAjaxPatterns = ajaxRegex.test(html);

  // Check for JSON data in script tags
  const scriptDataRegex = /(?:var|let|const)\s+(\w+)\s*=\s*(\[[\s\S]*?\]|\{[\s\S]*?\});/g;
  const scriptVars = [];
  while ((m = scriptDataRegex.exec(html)) !== null) {
    if (m[2].length < 500) {
      scriptVars.push({ name: m[1], preview: m[2].substring(0, 200) });
    } else {
      scriptVars.push({ name: m[1], preview: m[2].substring(0, 200) + '...' });
    }
  }
  results.scriptVariables = scriptVars;

  // Extract the area around the first "PTS" column header for exact structure
  const ptsIdx = html.indexOf('>PTS<');
  if (ptsIdx > -1) {
    results.aroundPTSHeader = html.substring(Math.max(0, ptsIdx - 500), ptsIdx + 500)
      .replace(/\n\s+/g, '\n');
  }

  return results;
}

async function main() {
  for (const url of URLS) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Fetching: ${url}`);
    console.log('='.repeat(80));

    try {
      const { statusCode, body, headers } = await fetchPage(url);
      console.log(`Status: ${statusCode}`);
      console.log(`Content-Type: ${headers['content-type']}`);
      console.log(`Body length: ${body.length} chars`);

      if (statusCode === 200) {
        const structure = extractStandingsStructure(body);
        console.log('\n--- STRUCTURE ANALYSIS ---');
        console.log(JSON.stringify(structure, null, 2));
      } else {
        console.log('Non-200 response. First 500 chars:');
        console.log(body.substring(0, 500));
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }

    console.log();
  }
}

main();
