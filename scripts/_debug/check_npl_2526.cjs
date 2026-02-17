require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Check which NPL leagues we have for 2025-26 vs 2024-25
  const npl18 = [
    'Central States NPL',
    'CPSL NPL',
    'FCL NPL',
    'Frontier Premier',
    'Great Lakes Alliance',
    'Mid-Atlantic Premier',
    'MDL NPL',
    'Minnesota NPL',
    'Mountain West NPL',
    'JPL MW',
    'NISL NPL',
    'NorCal NPL',
    'Red River NPL',
    'SOCAL NPL',
    'South Atlantic Premier',
    'SAPL NPL',
    'STXCL',
    'TCSL NPL',
    'VPSL NPL',
    'WPL',
  ];

  console.log('Checking each of the 18 NPL leagues for 2025-26 coverage...\n');

  for (const term of npl18) {
    const { rows } = await pool.query(
      `SELECT name, state FROM leagues WHERE name ILIKE $1 ORDER BY name DESC LIMIT 5`,
      [`%${term}%`]
    );
    if (rows.length > 0) {
      const has2526 = rows.some(r => r.name.includes('25-26') || r.name.includes('25/26') || r.name.includes('2025-26') || r.name.includes('2025/26') || r.name.includes('2026'));
      const label = has2526 ? '✅ HAS 2025-26' : '⚠️  ONLY OLDER SEASONS';
      console.log(`${label}: "${term}"`);
      rows.forEach(r => console.log(`    - "${r.name}"`));
    } else {
      console.log(`❌ NOT IN DB: "${term}"`);
    }
  }

  // Check event IDs from source_entity_map for key leagues
  console.log('\n\nChecking source_entity_map for NPL event registrations...');
  const { rows: semap } = await pool.query(`
    SELECT sem.source_platform, sem.source_entity_id,
           COALESCE(l.name, t.name) as entity_name,
           sem.entity_type
    FROM source_entity_map sem
    LEFT JOIN leagues l ON sem.sv_id = l.id::text::uuid AND sem.entity_type = 'league'
    LEFT JOIN tournaments t ON sem.sv_id = t.id::text::uuid AND sem.entity_type = 'tournament'
    WHERE (COALESCE(l.name, t.name) ILIKE '%NPL%'
       OR COALESCE(l.name, t.name) ILIKE '%Premier League%'
       OR COALESCE(l.name, t.name) ILIKE '%Red River%'
       OR COALESCE(l.name, t.name) ILIKE '%Mountain West%'
       OR COALESCE(l.name, t.name) ILIKE '%Minnesota NPL%')
    AND sem.source_platform IN ('gotsport', 'htgsports')
    ORDER BY entity_name NULLS LAST
    LIMIT 40
  `);
  if (semap.length > 0) {
    console.log(`Found ${semap.length} NPL source_entity_map entries:`);
    semap.forEach(r => console.log(`  [${r.source_platform}:${r.source_entity_id}] "${r.entity_name}" (${r.entity_type})`));
  }

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
