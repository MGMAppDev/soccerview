/**
 * Check match counts for all "between seasons" gap events
 * Session 112 - These were dismissed as "between seasons" but we ARE in the season
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const events = [
  { id: '5082',  name: 'AK UAYSL' },
  { id: '48452', name: 'KY Premier League' },
  { id: '40682', name: 'MT State Spring League' },
  { id: '45220', name: 'OK Premier League' },
  { id: '957',   name: 'ME State Premier (old)' },
  { id: '42137', name: 'Girls Academy Tier 1' },
  { id: '43009', name: 'FL FSPL' },
  { id: '45046', name: 'FL CFPL' },
  { id: '45052', name: 'FL SEFPL' },
];

async function main() {
  console.log('Checking match counts for "between seasons" gaps:\n');
  for (const e of events) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as cnt FROM matches_v2 WHERE source_match_key LIKE $1 AND deleted_at IS NULL`,
      [`gotsport-${e.id}-%`]
    );
    const cnt = parseInt(rows[0].cnt);
    const status = cnt === 0 ? '❌ ZERO - NEEDS RE-SCRAPE' : `✅ ${cnt} matches`;
    console.log(`  Event ${e.id} (${e.name}): ${status}`);
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
