/**
 * Session 106 — Scrape Girls Academy + USYS National League GotSport Events
 *
 * Runs coreScraper for each event sequentially with rate limiting.
 * Pattern from Session 104 (scrape_session104_gotsport.cjs).
 *
 * Events:
 *   - Girls Academy: 42137, 42138, 44874, 45530
 *   - USYS NL Team Premier: 50925, 50944, 46789, 50933, 50867, 46794, 46792, 50910
 *   - USYS NL Club P1: 50936, 50937, 50938, 50939, 50940, 50941, 50942
 *   - USYS NL Club P2: 50931, 50922, 50923, 51345
 *   - USYS NL Winter: 50935, 50898
 */
require('dotenv').config();
const { execSync } = require('child_process');

const EVENTS = [
  // =============================================
  // Girls Academy (4 events)
  // =============================================
  { id: '42137', name: 'Girls Academy League 2025-26 (Tier 1)', group: 'GA' },
  { id: '42138', name: 'Girls Academy Aspire League 2025-26', group: 'GA' },
  { id: '44874', name: 'Junior Girls Academy League (JGAL) 2025-26', group: 'GA' },
  { id: '45530', name: 'Florida Girls Academy League 2025-26', group: 'GA' },

  // =============================================
  // USYS NL Team Premier (8 new conferences)
  // =============================================
  { id: '50925', name: 'USYS NL Team Desert 2025-26', group: 'USYS-Team' },
  { id: '50944', name: 'USYS NL Team Great Lakes 2025-26', group: 'USYS-Team' },
  { id: '46789', name: 'USYS NL Team Mid Atlantic 2025-26', group: 'USYS-Team' },
  { id: '50933', name: 'USYS NL Team Mid South 2025-26', group: 'USYS-Team' },
  { id: '50867', name: 'USYS NL Team Midwest 2025-26', group: 'USYS-Team' },
  { id: '46794', name: 'USYS NL Team New England 2025-26', group: 'USYS-Team' },
  { id: '46792', name: 'USYS NL Team North Atlantic 2025-26', group: 'USYS-Team' },
  { id: '50910', name: 'USYS NL Team Piedmont 2025-26', group: 'USYS-Team' },

  // =============================================
  // USYS NL Club Premier 1 (7 new conferences)
  // =============================================
  { id: '50936', name: 'USYS NL Club P1 Frontier 2025-26', group: 'USYS-Club1' },
  { id: '50937', name: 'USYS NL Club P1 Great Lakes 2025-26', group: 'USYS-Club1' },
  { id: '50938', name: 'USYS NL Club P1 Midwest 2025-26', group: 'USYS-Club1' },
  { id: '50939', name: 'USYS NL Club P1 Northeast 2025-26', group: 'USYS-Club1' },
  { id: '50940', name: 'USYS NL Club P1 Pacific 2025-26', group: 'USYS-Club1' },
  { id: '50941', name: 'USYS NL Club P1 Piedmont 2025-26', group: 'USYS-Club1' },
  { id: '50942', name: 'USYS NL Club P1 Southeast 2025-26', group: 'USYS-Club1' },

  // =============================================
  // USYS NL Club Premier 2 (4 new conferences)
  // =============================================
  { id: '50931', name: 'USYS NL Club P2 Desert 2025-26', group: 'USYS-Club2' },
  { id: '50922', name: 'USYS NL Club P2 Great Lakes 2025-26', group: 'USYS-Club2' },
  { id: '50923', name: 'USYS NL Club P2 Midwest 2025-26', group: 'USYS-Club2' },
  { id: '51345', name: 'USYS NL Club P2 Piedmont 2025-26', group: 'USYS-Club2' },

  // =============================================
  // USYS NL Winter Events (2 events)
  // =============================================
  { id: '50935', name: 'USYS NL Winter Event Nov 2025', group: 'USYS-Winter' },
  { id: '50898', name: 'USYS NL Winter Event Jan 2026', group: 'USYS-Winter' },
];

// Allow filtering by group: node scrape_session106_gotsport.cjs --group GA
const filterGroup = process.argv.find(a => a.startsWith('--group='))?.split('=')[1]
  || (process.argv.includes('--group') ? process.argv[process.argv.indexOf('--group') + 1] : null);

const eventsToScrape = filterGroup
  ? EVENTS.filter(e => e.group === filterGroup)
  : EVENTS;

async function main() {
  console.log('=== Session 106: Scraping Girls Academy + USYS NL GotSport Events ===\n');
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

      // Show last few lines of output for context
      const lines = output.split('\n').filter(l => l.trim());
      const lastLines = lines.slice(-6);
      lastLines.forEach(l => console.log(`  ${l.trim()}`));
    } catch (error) {
      const stderr = error.stderr || '';
      const stdout = error.stdout || '';
      console.error(`  ERROR: ${error.message?.substring(0, 200)}`);

      // Try to extract match count even from failed runs
      const matchLine = (stdout + stderr).match(/Matches staged:\s*(\d+)/i)
        || (stdout + stderr).match(/(\d+)\s*match(es)? staged/i);
      const count = matchLine ? parseInt(matchLine[1]) : 0;

      results.push({ ...ev, matches: count, status: 'ERROR' });

      // Show last lines for debugging
      const lines = (stdout + stderr).split('\n').filter(l => l.trim());
      lines.slice(-5).forEach(l => console.log(`  ${l.trim()}`));
    }
  }

  // Summary by group
  console.log('\n\n=== RESULTS SUMMARY ===\n');
  const groups = [...new Set(eventsToScrape.map(e => e.group))];
  let grandTotal = 0;

  for (const grp of groups) {
    const groupResults = results.filter(r => r.group === grp);
    const groupTotal = groupResults.reduce((sum, r) => sum + r.matches, 0);
    const errors = groupResults.filter(r => r.status === 'ERROR').length;
    console.log(`[${grp}] ${groupTotal} matches (${errors > 0 ? `${errors} errors` : 'all OK'})`);
    for (const r of groupResults) {
      const status = r.status === 'ERROR' ? '❌' : (r.matches === 0 ? '⚠️' : '✅');
      console.log(`  ${status} ${r.id} — ${r.name}: ${r.matches} matches`);
    }
    grandTotal += groupTotal;
    console.log();
  }

  console.log(`GRAND TOTAL: ${grandTotal} matches staged across ${results.length} events`);
  const errors = results.filter(r => r.status === 'ERROR').length;
  const empty = results.filter(r => r.status === 'OK' && r.matches === 0).length;
  if (errors > 0) console.log(`  ${errors} events had errors`);
  if (empty > 0) console.log(`  ${empty} events returned 0 matches (may be between seasons)`);
}

main().catch(err => { console.error(err); process.exit(1); });
