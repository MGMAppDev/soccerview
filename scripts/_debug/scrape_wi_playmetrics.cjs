/**
 * Session 104: Scrape new WI PlayMetrics events.
 * Runs coreScraper for each new WI event individually.
 */
require('dotenv').config();
const { execSync } = require('child_process');

// Only the NEW WI events (WYSA Fall/Spring already scraped in Session 103)
const NEW_EVENTS = [
  'wysa-state-champs-fall-2025',
  'wysa-state-champs-spring-2025',
  'wysa-presidents-cup-fall-2025',
  'wysa-presidents-cup-spring-2025',
  'maysa-fall-2025',
  'maysa-spring-2025',
  'east-central-fall-2025',
  'east-central-spring-2025',
  'cwsl-current',
];

async function main() {
  console.log('=== Session 104: Scraping New WI PlayMetrics Events ===\n');

  const results = [];

  for (const eventId of NEW_EVENTS) {
    console.log(`\n--- Scraping: ${eventId} ---`);
    try {
      const output = execSync(
        `node scripts/universal/coreScraper.js --adapter playmetrics --event ${eventId}`,
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          timeout: 600000,
          env: { ...process.env },
        }
      );

      // Extract match count
      const matchLine = output.match(/Matches staged:\s*(\d+)/i)
        || output.match(/Total.*?(\d+)\s*unique/i)
        || output.match(/(\d+)\s*matches/i);
      const count = matchLine ? parseInt(matchLine[1]) : 0;

      console.log(`  → ${count} matches`);
      results.push({ id: eventId, matches: count, status: 'OK' });

      // Show key lines
      const lines = output.split('\n').filter(l => l.trim());
      lines.slice(-5).forEach(l => console.log(`  ${l.trim()}`));
    } catch (error) {
      const stdout = error.stdout || '';
      console.error(`  ERROR: ${error.message?.substring(0, 200)}`);

      const matchLine = stdout.match(/Matches staged:\s*(\d+)/i)
        || stdout.match(/(\d+)\s*matches/i);
      const count = matchLine ? parseInt(matchLine[1]) : 0;
      results.push({ id: eventId, matches: count, status: 'ERROR' });
    }
  }

  console.log('\n\n=== RESULTS SUMMARY ===');
  let total = 0;
  for (const r of results) {
    console.log(`  ${r.id}: ${r.matches} matches (${r.status})`);
    total += r.matches;
  }
  console.log(`\n  TOTAL: ${total} WI matches across ${results.length} events`);
}

main().catch(err => { console.error(err); process.exit(1); });
