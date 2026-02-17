require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Check existing GA matches in matches_v2
  const { rows } = await pool.query(`
    SELECT
      COALESCE(l.name, t.name) as event_name,
      LEFT(m.source_match_key, 20) as key_prefix,
      COUNT(*) as cnt
    FROM matches_v2 m
    LEFT JOIN leagues l ON m.league_id = l.id
    LEFT JOIN tournaments t ON m.tournament_id = t.id
    WHERE (m.source_match_key LIKE 'gotsport-42137%'
        OR m.source_match_key LIKE 'gotsport-42138%'
        OR m.source_match_key LIKE 'gotsport-44874%'
        OR m.source_match_key LIKE 'gotsport-45530%')
      AND m.deleted_at IS NULL
    GROUP BY COALESCE(l.name, t.name), LEFT(m.source_match_key, 20)
    ORDER BY cnt DESC
    LIMIT 20
  `);
  console.log('Existing GA matches in matches_v2 by event:');
  rows.forEach(r => console.log('  ' + (r.event_name || 'NULL') + ' | ' + r.key_prefix + ' | count: ' + r.cnt));

  // Check staging for these events
  const { rows: staged } = await pool.query(`
    SELECT event_id, event_name, COUNT(*) as cnt
    FROM staging_games
    WHERE event_id IN ('42137', '42138', '44874', '45530')
    GROUP BY event_id, event_name
    ORDER BY cnt DESC
  `);
  console.log('\nStaged GA matches (not yet processed):');
  staged.forEach(r => console.log('  event ' + r.event_id + ' (' + (r.event_name || 'NULL') + '): ' + r.cnt));

  // Also check what GA-related tournaments exist
  const { rows: tours } = await pool.query(`
    SELECT t.name, t.source_event_id, COUNT(m.id) as match_count
    FROM tournaments t
    LEFT JOIN matches_v2 m ON m.tournament_id = t.id AND m.deleted_at IS NULL
    WHERE t.name ILIKE '%girl%academy%' OR t.name ILIKE '%GA %' OR t.name ILIKE '%JGAL%'
    GROUP BY t.name, t.source_event_id
    ORDER BY match_count DESC
    LIMIT 20
  `);
  console.log('\nGA-related tournaments in DB:');
  tours.forEach(r => console.log('  ' + r.name + ' | ' + (r.source_event_id || 'NULL') + ' | ' + r.match_count + ' matches'));

  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
