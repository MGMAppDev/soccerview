require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Check for specific NPL member leagues in detail
  const searchTerms = [
    'SOCAL', 'SoCal', 'Southern California',
    'Frontier Premier',
    'Mid-Atlantic Premier', 'MAPL',
    'Minnesota NPL', 'TCSL NPL',
    'MDL NPL', 'Midwest Developmental',
    'STXCL', 'South Texas',
    'Red River',
    'Great Lakes Alliance',
    'Mountain West NPL',
    'JPL MW',
  ];

  for (const term of searchTerms) {
    const { rows } = await pool.query(
      `SELECT id, name, state FROM leagues WHERE name ILIKE $1 LIMIT 5`,
      [`%${term}%`]
    );
    if (rows.length > 0) {
      console.log(`\n"${term}" found (${rows.length}):`);
      rows.forEach(r => console.log(`  [${r.id}] "${r.name}" state:${r.state}`));
    } else {
      console.log(`\n"${term}" -> NOT FOUND in leagues`);
    }
  }

  // Also check tournaments for any NPL-named entries
  const { rows: tourney } = await pool.query(`
    SELECT id, name, state FROM tournaments
    WHERE name ILIKE '%SOCAL NPL%' OR name ILIKE '%SoCal NPL%' OR name ILIKE '%Southern California NPL%'
    OR name ILIKE '%MDL NPL%' OR name ILIKE '%Midwest Developmental%'
    OR name ILIKE '%Minnesota NPL%' OR name ILIKE '%TCSL NPL%' OR name ILIKE '%STXCL NPL%'
    LIMIT 20
  `);
  if (tourney.length > 0) {
    console.log('\n\nNPL entries in TOURNAMENTS table:');
    tourney.forEach(r => console.log(`  [${r.id}] "${r.name}" state:${r.state}`));
  } else {
    console.log('\n\nNo NPL entries found in tournaments table');
  }

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
