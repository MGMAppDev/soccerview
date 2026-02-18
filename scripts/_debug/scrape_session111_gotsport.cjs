/**
 * Session 111: Scrape newly discovered GotSport events
 * FL, MO, IN, TX high-priority events
 */
require('dotenv').config();
const { execSync } = require('child_process');

const events = [
  // FL - FSPL main event
  { id: 43009, name: 'FL FSPL 2025-26' },
  { id: 45008, name: 'FL West Florida Premier League' },
  { id: 45052, name: 'FL Southeast Florida Premier League' },
  // MO - SLYSA
  { id: 44132, name: 'MO SLYSA Fall 2025' },
  // IN - ISL Spring 2026
  { id: 49628, name: 'IN ISL Spring 2026' },
  // TX - GCL + EDPL South
  { id: 44745, name: 'TX GCL 2025-26' },
  { id: 45379, name: 'TX EDPL Fall 2025 South' },
];

(async () => {
  console.log('Session 111: Scraping newly discovered GotSport events');
  console.log('='.repeat(60));

  let totalStaged = 0;

  for (const event of events) {
    console.log(`\nScraping: ${event.name} (event ${event.id})`);
    try {
      const output = execSync(
        `node scripts/universal/coreScraper.js --adapter gotsport --event ${event.id}`,
        { timeout: 120000, encoding: 'utf8', cwd: process.cwd() }
      );
      // Extract staged count
      const stagedMatch = output.match(/Staged:\s*(\d+)/);
      const staged = stagedMatch ? parseInt(stagedMatch[1], 10) : 0;
      console.log(`  Staged: ${staged}`);
      totalStaged += staged;
    } catch (err) {
      const output = err.stdout || '';
      const stagedMatch = output.match(/Staged:\s*(\d+)/);
      const staged = stagedMatch ? parseInt(stagedMatch[1], 10) : 0;
      console.log(`  Staged: ${staged} (with warnings)`);
      totalStaged += staged;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total staged: ${totalStaged}`);
  console.log('Next: node scripts/maintenance/fastProcessStaging.cjs --source gotsport');
})();
