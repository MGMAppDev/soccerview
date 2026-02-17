require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // What are those 6 staging records for Central States NPL?
  console.log('=== Central States NPL staging records ===');
  const { rows: sg } = await pool.query(`
    SELECT id, source_platform, event_id, event_name, home_team_name, away_team_name,
           match_date, home_score, away_score, processed_at, status
    FROM staging_games
    WHERE event_id = '46428'
    LIMIT 10
  `);
  sg.forEach(r => console.log(JSON.stringify(r, null, 2)));

  // Check what league was created for this event in source_entity_map
  console.log('\n=== League entity for GS:46428 ===');
  const { rows: l } = await pool.query(`
    SELECT l.*
    FROM leagues l
    WHERE l.id = (
      SELECT sv_id::uuid FROM source_entity_map
      WHERE source_entity_id = '46428' AND source_platform = 'gotsport' AND entity_type = 'league'
      LIMIT 1
    )
  `);
  console.log('League:', l.length > 0 ? l[0] : 'NOT FOUND');

  // Check matches for this league
  const { rows: m } = await pool.query(`
    SELECT COUNT(*) as cnt FROM matches_v2
    WHERE league_id = (
      SELECT sv_id::uuid FROM source_entity_map
      WHERE source_entity_id = '46428' AND source_platform = 'gotsport' AND entity_type = 'league'
      LIMIT 1
    )
    AND deleted_at IS NULL
  `);
  console.log('Matches for this league:', m[0]);

  // Also check spring event - look for any Central States NPL with a different event ID (Spring)
  console.log('\n=== Other Central States events ===');
  const { rows: other } = await pool.query(`
    SELECT DISTINCT event_id, event_name, COUNT(*) as cnt
    FROM staging_games
    WHERE event_name ILIKE '%Central States%'
    GROUP BY event_id, event_name
  `);
  other.forEach(r => console.log(`  GS:${r.event_id} "${r.event_name}" (${r.cnt} staging records)`));

  // Check whether the 6 records are processed or unprocessed
  console.log('\n=== Staging status breakdown ===');
  const { rows: status } = await pool.query(`
    SELECT status, COUNT(*) as cnt
    FROM staging_games
    WHERE event_id = '46428'
    GROUP BY status
  `);
  console.log('Status breakdown:', status);

  // Also check the NPPL - GSPL entry in leagues
  console.log('\n=== NPL - GSPL league ===');
  const { rows: gspl } = await pool.query(`
    SELECT l.id, l.name, l.state, COUNT(m.id) as match_cnt
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE l.name ILIKE '%GSPL%'
    GROUP BY l.id, l.name, l.state
  `);
  console.log('GSPL:', gspl);

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
