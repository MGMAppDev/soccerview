require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Check USYS NL tournaments (should be leagues)
  const { rows: tours } = await pool.query(`
    SELECT t.name, t.source_event_id, COUNT(m.id) as match_count
    FROM tournaments t
    LEFT JOIN matches_v2 m ON m.tournament_id = t.id AND m.deleted_at IS NULL
    WHERE (t.name ILIKE '%USYS%' OR t.name ILIKE '%national league%'
        OR t.name ILIKE '%NL Club%' OR t.name ILIKE '%NL Team%'
        OR t.name ILIKE '%Winter Event%')
    GROUP BY t.name, t.source_event_id
    ORDER BY match_count DESC
    LIMIT 30
  `);
  console.log('USYS NL tournaments (should be leagues?):');
  tours.forEach(r => console.log('  ' + r.match_count + ' | ' + r.name + ' | ' + (r.source_event_id || 'NULL')));

  // Check USYS NL leagues
  const { rows: leagues } = await pool.query(`
    SELECT l.name, l.source_event_id, COUNT(m.id) as match_count
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE (l.name ILIKE '%USYS%' OR l.name ILIKE '%national league%'
        OR l.name ILIKE '%NL Club%' OR l.name ILIKE '%NL Team%'
        OR l.name ILIKE '%Girls Academy%' OR l.name ILIKE '%JGAL%')
    GROUP BY l.name, l.source_event_id
    ORDER BY match_count DESC
    LIMIT 30
  `);
  console.log('\nUSYS NL + GA leagues:');
  leagues.forEach(r => console.log('  ' + r.match_count + ' | ' + r.name + ' | ' + (r.source_event_id || 'NULL')));

  // Total USYS NL counts
  const { rows: counts } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM matches_v2 m
       JOIN leagues l ON m.league_id = l.id
       WHERE (l.name ILIKE '%USYS%' OR l.name ILIKE '%national league%')
         AND m.deleted_at IS NULL) as nl_league_matches,
      (SELECT COUNT(*) FROM matches_v2 m
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE (t.name ILIKE '%USYS%' OR t.name ILIKE '%national league%')
         AND m.deleted_at IS NULL) as nl_tournament_matches
  `);
  console.log('\nUSYS NL total matches:', JSON.stringify(counts[0]));

  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
