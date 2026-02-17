require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Check TGS event 3989 - the TCSL NPL TX North Texas
  console.log('=== TGS TCSL NPL event 3989 ===');
  const { rows: sem } = await pool.query(`
    SELECT sem.source_entity_id, sem.source_platform, sem.entity_type, sem.sv_id,
           COALESCE(l.name, t.name) as name
    FROM source_entity_map sem
    LEFT JOIN leagues l ON sem.sv_id = l.id::text::uuid AND sem.entity_type = 'league'
    LEFT JOIN tournaments t ON sem.sv_id = t.id::text::uuid AND sem.entity_type = 'tournament'
    WHERE sem.source_entity_id = '3989'
    AND sem.source_platform = 'totalglobalsports'
  `);
  console.log('TGS:3989 mapping:', sem.length > 0 ? sem : 'NOT FOUND');

  // Search for Texas Club Soccer League or TCSL NPL in leagues/tournaments
  console.log('\n=== TCSL Texas in leagues ===');
  const { rows: tcsl } = await pool.query(`
    SELECT l.id, l.name, l.state, COUNT(m.id) as match_cnt
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE l.name ILIKE '%Texas Club Soccer%' OR l.name ILIKE '%TCSL NPL%' OR l.name ILIKE '%TCSL%NPL%'
    GROUP BY l.id, l.name, l.state
    LIMIT 10
  `);
  tcsl.forEach(r => console.log(`  "${r.name}" state:${r.state} matches:${r.match_cnt}`));

  // Also check for NPL North Texas in TGS
  console.log('\n=== NPL North Texas in leagues/tournaments ===');
  const { rows: ntx } = await pool.query(`
    SELECT COALESCE(l.name, t.name) as name, COALESCE(l.state, t.state) as state
    FROM source_entity_map sem
    LEFT JOIN leagues l ON sem.sv_id = l.id::text::uuid AND sem.entity_type = 'league'
    LEFT JOIN tournaments t ON sem.sv_id = t.id::text::uuid AND sem.entity_type = 'tournament'
    WHERE sem.source_platform = 'totalglobalsports'
    AND (COALESCE(l.name, t.name) ILIKE '%Texas%NPL%'
      OR COALESCE(l.name, t.name) ILIKE '%NPL%Texas%'
      OR COALESCE(l.name, t.name) ILIKE '%TCSL%'
      OR COALESCE(l.name, t.name) ILIKE '%North Texas%')
    LIMIT 10
  `);
  ntx.forEach(r => console.log(`  "${r.name}" state:${r.state}`));

  // Check all TGS leagues we have
  console.log('\n=== All TGS leagues in our DB ===');
  const { rows: tgs } = await pool.query(`
    SELECT COALESCE(l.name, t.name) as name,
           sem.source_entity_id,
           COUNT(m.id) as match_cnt,
           sem.entity_type
    FROM source_entity_map sem
    LEFT JOIN leagues l ON sem.sv_id = l.id::text::uuid AND sem.entity_type = 'league'
    LEFT JOIN tournaments t ON sem.sv_id = t.id::text::uuid AND sem.entity_type = 'tournament'
    LEFT JOIN matches_v2 m ON (m.league_id = l.id OR m.tournament_id = t.id) AND m.deleted_at IS NULL
    WHERE sem.source_platform = 'totalglobalsports'
    AND sem.entity_type IN ('league', 'tournament')
    GROUP BY sem.source_entity_id, l.name, t.name, sem.entity_type
    ORDER BY COUNT(m.id) DESC
    LIMIT 20
  `);
  tgs.forEach(r => console.log(`  TGS:${r.source_entity_id} "${r.name}" (${r.entity_type}) ${r.match_cnt} matches`));

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
