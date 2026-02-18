/**
 * Check coverage for MS/SD/WY/ND/NM states
 * Session 112
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Check specific event IDs discovered by research
  const gotsportEvents = [
    { id: '40362', name: 'MS Mid South Conference 2024-25' },
    { id: '34558', name: 'NM USYS Desert Conference 2024-25' },
    { id: '32734', name: 'WY Yellowstone Premier League 2024-25' },
    { id: '24591', name: 'NM Desert Conference (older)' },
    { id: '44839', name: 'JPL Mountain West NPL (includes WY/SD)' },
  ];

  console.log('GotSport event match counts:');
  for (const e of gotsportEvents) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as cnt FROM matches_v2 WHERE source_match_key LIKE $1 AND deleted_at IS NULL`,
      [`gotsport-${e.id}-%`]
    );
    const cnt = parseInt(rows[0].cnt);
    console.log(`  ${e.id} (${e.name}): ${cnt > 0 ? cnt + ' matches ✅' : 'NO DATA ❌'}`);
  }

  // Check HTG event 13170 (Snake River)
  const { rows: htg } = await pool.query(
    `SELECT COUNT(*) as cnt FROM matches_v2 WHERE source_match_key LIKE $1 AND deleted_at IS NULL`,
    [`htg-13170-%`]
  );
  console.log(`  13170 HTG Snake River: ${parseInt(htg[0].cnt) > 0 ? htg[0].cnt + ' matches ✅' : 'NO DATA ❌'}`);

  // Check state-level match counts for WY, NM, MS, SD, ND
  console.log('\nCurrent matches by state:');
  const { rows: stateCounts } = await pool.query(`
    SELECT t.state, COUNT(DISTINCT m.id) as matches, COUNT(DISTINCT t.id) as teams
    FROM matches_v2 m
    JOIN teams_v2 t ON (m.home_team_id = t.id OR m.away_team_id = t.id)
    WHERE m.deleted_at IS NULL
      AND t.state IN ('WY', 'NM', 'MS', 'SD', 'ND')
    GROUP BY t.state
    ORDER BY matches DESC
  `);
  stateCounts.forEach(r => console.log(`  ${r.state}: ${r.matches} matches, ${r.teams} teams`));

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
