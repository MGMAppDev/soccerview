/**
 * Session 104: Scrape remaining WI PlayMetrics events that timed out or weren't reached.
 * Runs each directly via coreScraper with proper timeout handling.
 */
require('dotenv').config();
const { execSync } = require('child_process');

// Events that the wrapper didn't reach or timed out on
const REMAINING = [
  'maysa-spring-2025',
  'east-central-fall-2025',
  'east-central-spring-2025',
  'cwsl-current',
];

async function main() {
  console.log('=== Remaining WI PlayMetrics Events ===\n');
  const results = [];

  for (const eventId of REMAINING) {
    console.log(`\n--- ${eventId} ---`);
    try {
      const output = execSync(
        `node scripts/universal/coreScraper.js --adapter playmetrics --event ${eventId}`,
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          timeout: 600000, // 10 min
          env: { ...process.env },
          maxBuffer: 1024 * 1024 * 50, // 50MB buffer
        }
      );

      const matchLine = output.match(/Matches staged:\s*(\d+)/i)
        || output.match(/Total.*?(\d+)\s*unique/i)
        || output.match(/(\d+)\s*unique\s*matches/i);
      const count = matchLine ? parseInt(matchLine[1]) : 0;

      console.log(`  → ${count} matches`);
      results.push({ id: eventId, matches: count, status: 'OK' });

      const lines = output.split('\n').filter(l => l.trim());
      lines.slice(-5).forEach(l => console.log(`  ${l.trim()}`));
    } catch (error) {
      const stdout = error.stdout || '';
      const matchLine = stdout.match(/Matches staged:\s*(\d+)/i)
        || stdout.match(/(\d+)\s*unique\s*matches/i);
      const count = matchLine ? parseInt(matchLine[1]) : 0;

      if (count > 0) {
        console.log(`  → ${count} matches (with warnings)`);
        results.push({ id: eventId, matches: count, status: 'PARTIAL' });
      } else {
        console.error(`  ERROR: ${error.message?.substring(0, 200)}`);
        results.push({ id: eventId, matches: 0, status: 'ERROR' });
      }
    }
  }

  console.log('\n\n=== RESULTS ===');
  let total = 0;
  for (const r of results) {
    console.log(`  ${r.id}: ${r.matches} (${r.status})`);
    total += r.matches;
  }
  console.log(`  TOTAL: ${total} additional WI matches`);
}

main().catch(err => { console.error(err); process.exit(1); });
