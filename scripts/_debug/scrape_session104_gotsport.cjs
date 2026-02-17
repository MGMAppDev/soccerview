/**
 * Session 104 — Scrape all 8 IL + VA GotSport events
 *
 * Runs coreScraper for each event sequentially.
 * Uses child_process.execSync to capture output.
 */
require('dotenv').config();
const { execSync } = require('child_process');

const EVENTS = [
  // IL — NISL
  { id: '44630', name: 'NISL NPL Fall 2025', state: 'IL' },
  { id: '40124', name: 'NISL NPL Spring 2025', state: 'IL' },
  { id: '44632', name: 'NISL Club & Conference Fall 2025', state: 'IL' },
  { id: '41112', name: 'NISL Club & Conference Spring 2025', state: 'IL' },
  { id: '45100', name: 'SLYSA IL Central Division Fall 2025', state: 'IL' },
  // VA
  { id: '44587', name: 'Virginia Club Soccer League 2025-26', state: 'VA' },
  { id: '42891', name: 'VPSL NPL Fall 2025', state: 'VA' },
  { id: '41359', name: 'Tidewater Advanced Soccer League Spring 2025', state: 'VA' },
];

async function main() {
  console.log('=== Session 104: Scraping IL + VA GotSport Events ===\n');

  const results = [];

  for (const ev of EVENTS) {
    console.log(`\n--- Scraping ${ev.state}: ${ev.name} (Event ${ev.id}) ---`);
    try {
      const output = execSync(
        `node scripts/universal/coreScraper.js --adapter gotsport --event ${ev.id}`,
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          timeout: 600000, // 10 min per event
          env: { ...process.env },
        }
      );

      // Extract match count from output
      const matchLine = output.match(/Matches staged:\s*(\d+)/i)
        || output.match(/Total.*?(\d+)\s*unique/i)
        || output.match(/(\d+)\s*matches/i);
      const count = matchLine ? parseInt(matchLine[1]) : 0;

      console.log(`  → ${count} matches`);
      results.push({ ...ev, matches: count, status: 'OK' });

      // Extract more detail from last few lines
      const lines = output.split('\n').filter(l => l.trim());
      const lastLines = lines.slice(-5);
      lastLines.forEach(l => console.log(`  ${l.trim()}`));
    } catch (error) {
      const stderr = error.stderr || '';
      const stdout = error.stdout || '';
      console.error(`  ERROR: ${error.message?.substring(0, 200)}`);

      // Try to extract match count even from failed runs
      const matchLine = stdout.match(/Matches staged:\s*(\d+)/i)
        || stdout.match(/(\d+)\s*matches/i);
      const count = matchLine ? parseInt(matchLine[1]) : 0;

      results.push({ ...ev, matches: count, status: 'ERROR' });

      // Show last few lines
      const lines = (stdout + stderr).split('\n').filter(l => l.trim());
      lines.slice(-5).forEach(l => console.log(`  ${l.trim()}`));
    }
  }

  console.log('\n\n=== RESULTS SUMMARY ===');
  let total = 0;
  for (const r of results) {
    console.log(`  ${r.state} | ${r.name}: ${r.matches} matches (${r.status})`);
    total += r.matches;
  }
  console.log(`\n  TOTAL: ${total} matches across ${results.length} events`);
}

main().catch(err => { console.error(err); process.exit(1); });
