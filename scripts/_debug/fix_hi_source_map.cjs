/**
 * Register HI Oahu League events in source_entity_map for Tier 0 resolution
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const events = [
    ['hi-fall2024', 'Oahu League Fall 2024/25 Season'],
    ['hi-fall2025', 'Oahu League Fall 2025/26 Season'],
    ['hi-spring2025', 'Oahu League Spring 2024/25 Season'],
    ['hi-spring2026', 'Oahu League Spring 2025/26 Season'],
  ];

  for (const [eid, ename] of events) {
    const league = await pool.query('SELECT id FROM leagues WHERE name = $1', [ename]);
    if (league.rows.length > 0) {
      const r = await pool.query(
        "INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id) VALUES ('league', 'sportsaffinity', $1, $2) ON CONFLICT DO NOTHING RETURNING sv_id",
        [eid, league.rows[0].id]
      );
      console.log(`  ${eid} -> ${r.rowCount > 0 ? 'registered' : 'already exists'} (${league.rows[0].id.substring(0, 8)})`);
    } else {
      console.log(`  ${eid} - league not found`);
    }
  }

  // Verify HI counts
  const hiLeagues = await pool.query("SELECT COUNT(*) FROM leagues WHERE state = 'HI'");
  const hiTeams = await pool.query("SELECT COUNT(*) FROM teams_v2 WHERE state = 'HI'");
  const hiMatches = await pool.query("SELECT COUNT(*) FROM matches_v2 m JOIN leagues l ON m.league_id = l.id WHERE l.state = 'HI' AND m.deleted_at IS NULL");

  console.log('\n=== HI Final Counts ===');
  console.log('  Leagues:', hiLeagues.rows[0].count);
  console.log('  Teams:', hiTeams.rows[0].count);
  console.log('  Matches:', hiMatches.rows[0].count);

  pool.end();
}

main().catch(console.error);
