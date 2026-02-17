require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // What are those 6 staging records for Central States NPL?
  console.log('=== Central States NPL staging records ===');
  const { rows: sg } = await pool.query(`
    SELECT id, source_platform, event_id, event_name, home_team_name, away_team_name,
           match_date, home_score, away_score, processed_at
    FROM staging_games
    WHERE event_id = '46428'
    LIMIT 10
  `);
  sg.forEach(r => console.log(`  [${r.id?.toString().substring(0,8)}] ${r.home_team_name} vs ${r.away_team_name} | ${r.match_date} | processed: ${r.processed_at ? 'YES' : 'NO'}`));

  // Check what league was created for this event in source_entity_map
  console.log('\n=== League entity for GS:46428 ===');
  const { rows: l } = await pool.query(`
    SELECT l.id, l.name, l.state
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
  console.log('Matches for this league:', m[0].cnt);

  // Check all Central States events
  console.log('\n=== Other Central States events ===');
  const { rows: other } = await pool.query(`
    SELECT DISTINCT event_id, event_name, COUNT(*) as cnt
    FROM staging_games
    WHERE event_name ILIKE '%Central States%'
    GROUP BY event_id, event_name
  `);
  other.forEach(r => console.log(`  GS:${r.event_id} "${r.event_name}" (${r.cnt} staging records)`));

  // NPL - GSPL
  console.log('\n=== NPL - GSPL entry ===');
  const { rows: gspl } = await pool.query(`
    SELECT l.id, l.name, l.state, COUNT(m.id) as match_cnt
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE l.name ILIKE '%GSPL%' OR l.name ILIKE '%NPL%GSPL%'
    GROUP BY l.id, l.name, l.state
  `);
  gspl.forEach(r => console.log(`  "${r.name}" state:${r.state} matches:${r.match_cnt}`));

  // Look for Central States specific league events in gotsport adapter
  console.log('\n=== Any Central States-like content in gotsport events 44000-47000 ===');
  const { rows: gse } = await pool.query(`
    SELECT sem.source_entity_id, COALESCE(l.name, t.name) as name,
           COUNT(m.id) as match_cnt
    FROM source_entity_map sem
    LEFT JOIN leagues l ON sem.sv_id = l.id::text::uuid AND sem.entity_type = 'league'
    LEFT JOIN tournaments t ON sem.sv_id = t.id::text::uuid AND sem.entity_type = 'tournament'
    LEFT JOIN matches_v2 m ON (m.league_id = l.id OR m.tournament_id = t.id) AND m.deleted_at IS NULL
    WHERE sem.source_platform = 'gotsport'
    AND sem.source_entity_id IN ('43800', '43801', '43802', '44800', '44850', '44428', '45428', '46428', '47428', '46000', '46100', '46200', '46300', '46400', '46500', '46600', '46700', '46800', '46900', '47000')
    GROUP BY sem.source_entity_id, l.name, t.name
    ORDER BY sem.source_entity_id::bigint
  `);
  gse.forEach(r => console.log(`  GS:${r.source_entity_id} "${r.name}" ${r.match_cnt} matches`));

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
