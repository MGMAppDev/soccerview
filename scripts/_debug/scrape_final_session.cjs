/**
 * FINAL SESSION — Scrape All Missing GotSport Events (Block A3 + Block B)
 *
 * A3: STXCL World Cup events (46279 + 46278)
 * B1: FL leagues (43009 FSPL main + 45008 WFPL)
 * B2: IN league (49628 ISL Spring 2026)
 * B3: MO league (44132 SLYSA Fall 2025)
 * B4: TX leagues (44745 GCL 2025-26 + 45379 EDPL Fall South TX)
 * B5: GA re-scrape (42137 + 42138 + 44874 + 45530)
 *
 * Also verify B1 additional: 45046 (CFPL) + 45052 (SEFPL) already in DB
 */
require('dotenv').config();
const { execSync } = require('child_process');

const EVENTS = [
  // =============================================
  // A3: STXCL World Cup (TX-S, GotSport tournaments)
  // =============================================
  { id: '46279', name: 'STXCL World Cup Girls 2025-26', group: 'A3-STXCL' },
  { id: '46278', name: 'STXCL World Cup Boys 2025-26', group: 'A3-STXCL' },

  // =============================================
  // B1: Florida Leagues (discovered S111)
  // =============================================
  { id: '43009', name: 'Florida State Premier League 2025-26 (FSPL main)', group: 'B1-FL' },
  { id: '45008', name: 'West Florida Premier League 2025-26', group: 'B1-FL' },
  { id: '45046', name: 'Central Florida Premier League 2025-26 (verify)', group: 'B1-FL' },
  { id: '45052', name: 'Southeast Florida Premier League 2025-26 (verify)', group: 'B1-FL' },

  // =============================================
  // B2: Indiana League (discovered S111)
  // =============================================
  { id: '49628', name: 'Indiana Soccer League Spring 2026', group: 'B2-IN' },

  // =============================================
  // B3: Missouri League (discovered S111)
  // =============================================
  { id: '44132', name: 'SLYSA Fall 2025 (MO)', group: 'B3-MO' },

  // =============================================
  // B4: Texas Leagues (discovered S111)
  // =============================================
  { id: '44745', name: 'Girls Classic League 2025-26 (TX)', group: 'B4-TX' },
  { id: '45379', name: 'Eastern District Players League Fall 2025 (TX)', group: 'B4-TX' },

  // =============================================
  // B5: Girls Academy re-scrape (gap: 528 vs 800+ expected)
  // =============================================
  { id: '42137', name: 'Girls Academy Tier 1 2025-26', group: 'B5-GA' },
  { id: '42138', name: 'Girls Academy Aspire 2025-26', group: 'B5-GA' },
  { id: '44874', name: 'Junior Girls Academy League (JGAL) 2025-26', group: 'B5-GA' },
  { id: '45530', name: 'Florida Girls Academy League 2025-26', group: 'B5-GA' },
];

// Allow filtering by group: node scrape_final_session.cjs --group B5-GA
const filterGroup = process.argv.find(a => a.startsWith('--group='))?.split('=')[1]
  || (process.argv.includes('--group') ? process.argv[process.argv.indexOf('--group') + 1] : null);

const eventsToScrape = filterGroup
  ? EVENTS.filter(e => e.group === filterGroup)
  : EVENTS;

async function main() {
  console.log('=== FINAL SESSION: Scraping Missing GotSport Events (Block A3 + Block B) ===\n');
  if (filterGroup) console.log(`  Filtering to group: ${filterGroup}\n`);
  console.log(`  Events to scrape: ${eventsToScrape.length} of ${EVENTS.length} total\n`);

  const results = [];

  for (const ev of eventsToScrape) {
    console.log(`\n--- [${ev.group}] ${ev.name} (Event ${ev.id}) ---`);
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
        || output.match(/(\d+)\s*match(es)? staged/i)
        || output.match(/staged[:\s]+(\d+)/i);
      const count = matchLine ? parseInt(matchLine[1]) : 0;

      console.log(`  → ${count} matches staged`);
      results.push({ ...ev, matches: count, status: 'OK' });

      // Show last few lines of output
      const lines = output.split('\n').filter(l => l.trim());
      const lastLines = lines.slice(-5);
      lastLines.forEach(l => console.log(`  ${l.trim()}`));
    } catch (error) {
      const stderr = error.stderr || '';
      const stdout = error.stdout || '';
      console.error(`  ERROR: ${error.message?.substring(0, 200)}`);
      if (stderr) console.error(`  STDERR: ${stderr.substring(0, 300)}`);
      results.push({ ...ev, matches: 0, status: 'ERROR', error: error.message?.substring(0, 100) });
    }

    // Rate limit between events
    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary
  console.log('\n\n=== SUMMARY ===');
  console.log(`${'Group'.padEnd(15)} ${'Event'.padEnd(10)} ${'Matches'.padStart(8)}  Status`);
  console.log('-'.repeat(60));
  let totalMatches = 0;
  for (const r of results) {
    console.log(`${r.group.padEnd(15)} ${r.id.padEnd(10)} ${String(r.matches).padStart(8)}  ${r.status}`);
    totalMatches += r.matches;
  }
  console.log('-'.repeat(60));
  console.log(`${'TOTAL'.padEnd(26)} ${String(totalMatches).padStart(8)}`);
  console.log(`\n✅ Done. Run fastProcessStaging to promote staged matches.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
