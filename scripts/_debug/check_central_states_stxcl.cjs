require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Check Central States NPL - is event 46428 in source_entity_map or staging?
  console.log('=== Central States NPL Check ===');

  const { rows: sem } = await pool.query(`
    SELECT source_entity_id, source_platform, entity_type, sv_id
    FROM source_entity_map
    WHERE source_entity_id IN ('46428', '43428', '45428', '47428', '48428')
    AND source_platform = 'gotsport'
  `);
  console.log('source_entity_map for event 46428:', sem.length > 0 ? sem : 'NOT FOUND');

  // Check staging_games for Central States NPL
  const { rows: staging } = await pool.query(`
    SELECT source_platform, event_id, event_name, COUNT(*) as cnt
    FROM staging_games
    WHERE event_name ILIKE '%Central States NPL%'
       OR event_id = '46428'
    GROUP BY source_platform, event_id, event_name
    LIMIT 5
  `);
  console.log('staging_games for Central States NPL:', staging.length > 0 ? staging : 'NOT FOUND');

  // Also check staging_games for any "NPL- Central States"
  const { rows: staging2 } = await pool.query(`
    SELECT source_platform, event_id, event_name, COUNT(*) as cnt
    FROM staging_games
    WHERE event_name ILIKE '%Central States%'
    GROUP BY source_platform, event_id, event_name
    LIMIT 5
  `);
  console.log('staging_games for "Central States":', staging2);

  // Check GotSport scraper config for any Central States event
  console.log('\n=== STXCL NPL Check ===');
  const { rows: stxcl } = await pool.query(`
    SELECT source_platform, event_id, event_name, COUNT(*) as cnt
    FROM staging_games
    WHERE event_name ILIKE '%STXCL%' OR event_name ILIKE '%South Texas%'
    GROUP BY source_platform, event_id, event_name
    LIMIT 5
  `);
  console.log('staging_games for STXCL:', stxcl.length > 0 ? stxcl : 'NOT FOUND');

  // What GotSport event IDs are in our scraper config?
  console.log('\n=== GotSport static events in gotsport adapter ===');
  // Check what matches we have from gotsport in the 45000-50000 ID range
  const { rows: gs } = await pool.query(`
    SELECT sem.source_entity_id, COALESCE(l.name, t.name) as name,
           COUNT(m.id) as matches
    FROM source_entity_map sem
    LEFT JOIN leagues l ON sem.sv_id = l.id::text::uuid AND sem.entity_type = 'league'
    LEFT JOIN tournaments t ON sem.sv_id = t.id::text::uuid AND sem.entity_type = 'tournament'
    LEFT JOIN matches_v2 m ON (m.league_id = l.id OR m.tournament_id = t.id) AND m.deleted_at IS NULL
    WHERE sem.source_platform = 'gotsport'
    AND sem.source_entity_id::bigint BETWEEN 45000 AND 50000
    AND sem.entity_type IN ('league', 'tournament')
    GROUP BY sem.source_entity_id, l.name, t.name
    HAVING COUNT(m.id) > 0
    ORDER BY COUNT(m.id) DESC
    LIMIT 20
  `);
  console.log('GotSport events 45000-50000 with matches:');
  gs.forEach(r => console.log(`  GS:${r.source_entity_id} "${r.name}" ${r.matches} matches`));

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
