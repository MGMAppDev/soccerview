#!/usr/bin/env node
/**
 * quick_tgs_probe.cjs - Discover ECNL/ECRL events from TotalGlobalSports
 *
 * Probes event IDs 3880-3960 on public.totalglobalsports.com,
 * extracts event names from the Angular SPA, and reports hits
 * containing ECNL, ECRL, or Pre-ECNL keywords.
 *
 * Usage:
 *   node scripts/_debug/quick_tgs_probe.cjs
 *   node scripts/_debug/quick_tgs_probe.cjs --start 3900 --end 3950
 */

'use strict';

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteerExtra.use(StealthPlugin());

// --- Configuration ---
const DEFAULT_START = 3880;
const DEFAULT_END = 3960;
const PAGE_DELAY_MS = 2000;
const SPA_SETTLE_MS = 5000;
const NAV_TIMEOUT_MS = 30000;

const BASE_URL = 'https://public.totalglobalsports.com/public/event';

// Conference / region prefixes that often start the event name line
const CONFERENCE_PREFIXES = [
  'Southwest', 'Northeast', 'Mid-Atlantic', 'Texas', 'Ohio Valley',
  'Heartland', 'Mountain', 'Frontier', 'Florida', 'Northwest',
  'Southeast', 'Midwest', 'SoCal', 'North Atlantic', 'Mid-America',
  'Golden State', 'NorCal', 'New England', 'Great Lakes',
];

// Keywords that mark a hit
const HIT_KEYWORDS = ['ECNL', 'ECRL', 'Pre-ECNL'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let start = DEFAULT_START;
  let end = DEFAULT_END;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) start = parseInt(args[i + 1], 10);
    if (args[i] === '--end' && args[i + 1]) end = parseInt(args[i + 1], 10);
  }

  return { start, end };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isHit(text) {
  if (!text) return false;
  const upper = text.toUpperCase();
  return HIT_KEYWORDS.some(kw => upper.includes(kw.toUpperCase()));
}
/**
 * Extract a meaningful event name from the page using multiple strategies.
 * Returns { name: string|null, rawSnippets: string[] }
 */
async function extractEventInfo(page) {
  return page.evaluate((conferencePrefixes) => {
    const results = { name: null, rawSnippets: [] };

    // Strategy 1: mat-toolbar or toolbar element text
    const toolbar = document.querySelector('mat-toolbar, [role="toolbar"], .mat-toolbar');
    if (toolbar) {
      const text = toolbar.innerText.trim();
      if (text && text.length > 2 && text.length < 300) {
        results.rawSnippets.push('[toolbar] ' + text);
        if (!results.name) results.name = text;
      }
    }

    // Strategy 2: h1 / h2 headers
    for (const tag of ['h1', 'h2']) {
      const els = document.querySelectorAll(tag);
      for (const el of els) {
        const text = el.innerText.trim();
        if (text && text.length > 2 && text.length < 300) {
          results.rawSnippets.push('[' + tag + '] ' + text);
          if (!results.name) results.name = text;
        }
      }
    }

    // Strategy 3: page title
    if (document.title && document.title.length > 2) {
      results.rawSnippets.push('[title] ' + document.title);
      if (!results.name) results.name = document.title;
    }

    // Strategy 4: body text lines matching conference prefixes or ECNL keywords
    const bodyLines = (document.body.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
    const ecnlPattern = /ecnl|ecrl|pre-ecnl/i;
    for (let i = 0; i < bodyLines.length; i++) {
      const line = bodyLines[i];
      if (line.length < 3 || line.length > 300) continue;

      // Check if line starts with a known conference prefix
      let startsWithConference = false;
      for (let j = 0; j < conferencePrefixes.length; j++) {
        if (line.toLowerCase().indexOf(conferencePrefixes[j].toLowerCase()) === 0) {
          startsWithConference = true;
          break;
        }
      }

      if (startsWithConference || ecnlPattern.test(line)) {
        results.rawSnippets.push('[body] ' + line);
        // Prefer ECNL-containing lines as the name
        if (ecnlPattern.test(line)) {
          results.name = line;
        }
      }
    }

    return results;
  }, CONFERENCE_PREFIXES);
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { start, end } = parseArgs();
  const total = end - start + 1;

  console.log('='.repeat(70));
  console.log('TotalGlobalSports ECNL/ECRL Event Probe');
  console.log('Range: ' + start + ' - ' + end + '  (' + total + ' IDs)');
  console.log('Delay between pages: ' + PAGE_DELAY_MS + 'ms  |  SPA settle: ' + SPA_SETTLE_MS + 'ms');
  console.log('='.repeat(70));
  console.log('');

  const browser = await puppeteerExtra.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  );
  // Block images/fonts/media to speed things up
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  const hits = [];       // { id, name, snippets }
  const errors = [];     // { id, error }
  const notFound = [];   // IDs with no content / 404

  for (let id = start; id <= end; id++) {
    const idx = id - start + 1;
    const url = BASE_URL + '/' + id + '/schedules-standings';
    process.stdout.write('[' + idx + '/' + total + '] Event ' + id + ' ... ');

    try {
      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: NAV_TIMEOUT_MS,
      });

      const status = response ? response.status() : 0;

      if (status === 404 || status >= 400) {
        console.log('HTTP ' + status + ' -- skipped');
        notFound.push(id);
        await sleep(PAGE_DELAY_MS);
        continue;
      }

      // Let Angular SPA settle
      await sleep(SPA_SETTLE_MS);

      const info = await extractEventInfo(page);

      // Check if any snippet is a hit
      const allText = [info.name || ''].concat(info.rawSnippets).join(' ');
      const hitFound = isHit(allText);

      if (hitFound) {
        const entry = { id: id, name: info.name, snippets: info.rawSnippets };
        hits.push(entry);
        console.log('** HIT ** ' + (info.name || '(name from snippets)'));
        if (info.rawSnippets.length > 0) {
          for (const s of info.rawSnippets) {
            console.log('          ' + s);
          }
        }
      } else if (info.name) {
        console.log(info.name.substring(0, 80));
      } else {
        console.log('(no content / empty page)');
        notFound.push(id);
      }
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.indexOf('Navigation timeout') !== -1 || msg.indexOf('net::ERR_') !== -1) {
        console.log('TIMEOUT/ERROR -- ' + msg.substring(0, 60));
        notFound.push(id);
      } else {
        console.log('ERROR -- ' + msg.substring(0, 80));
        errors.push({ id: id, error: msg.substring(0, 120) });
      }
    }

    // Delay between requests
    if (id < end) {
      await sleep(PAGE_DELAY_MS);
    }
  }

  await browser.close();
  // --- Summary ---
  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('Total probed:    ' + total);
  console.log('ECNL/ECRL hits:  ' + hits.length);
  console.log('Not found/empty: ' + notFound.length);
  console.log('Errors:          ' + errors.length);
  console.log('');

  if (hits.length > 0) {
    console.log('--- ECNL / ECRL Events Found ---');
    console.log('');
    const padId = 6;
    const padName = 60;
    console.log('ID'.padEnd(padId) + ' ' + 'Event Name'.padEnd(padName));
    console.log('-'.repeat(padId) + ' ' + '-'.repeat(padName));
    for (const h of hits) {
      const name = (h.name || h.snippets[0] || '(unknown)').substring(0, padName);
      console.log(String(h.id).padEnd(padId) + ' ' + name);
    }
    console.log('');

    // Machine-readable output for easy copy-paste into adapter config
    console.log('--- Adapter staticEvents format ---');
    console.log('');
    for (const h of hits) {
      const safeName = (h.name || '').replace(/['"]/g, '');
      console.log('  { eventId: \'' + h.id + '\', name: \'' + safeName + '\', year: 2026 },');
    }
  } else {
    console.log('No ECNL/ECRL events found in the probed range.');
  }

  if (errors.length > 0) {
    console.log('');
    console.log('--- Errors ---');
    for (const e of errors) {
      console.log('  Event ' + e.id + ': ' + e.error);
    }
  }

  console.log('');
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});