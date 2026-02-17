require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('=== Final NPL Gap Verification ===\n');

  // 1. Confirm STXCL NPL is not in DB under any name
  console.log('1. STXCL NPL (South Texas Champions League) variants:');
  const stxclTerms = ['STXCL', 'South Texas Champions', 'South Texas NPL', 'STXCL NPL'];
  for (const term of stxclTerms) {
    const { rows: l } = await pool.query(`SELECT name, state FROM leagues WHERE name ILIKE $1 LIMIT 3`, [`%${term}%`]);
    const { rows: t } = await pool.query(`SELECT name, state FROM tournaments WHERE name ILIKE $1 LIMIT 3`, [`%${term}%`]);
    if (l.length + t.length > 0) {
      console.log(`  FOUND "${term}":`, [...l, ...t].map(r => r.name));
    } else {
      console.log(`  "${term}": not found`);
    }
  }

  // 2. Confirm TCSL NPL TX is not in DB under any name
  console.log('\n2. TCSL NPL TX (Texas Club Soccer League NPL) variants:');
  const tcslTerms = ['Texas Club Soccer League', 'TCSL NPL', 'NPL North Texas', 'NTXRPL NPL'];
  for (const term of tcslTerms) {
    const { rows: l } = await pool.query(`SELECT name, state FROM leagues WHERE name ILIKE $1 LIMIT 3`, [`%${term}%`]);
    const { rows: t } = await pool.query(`SELECT name, state FROM tournaments WHERE name ILIKE $1 LIMIT 3`, [`%${term}%`]);
    if (l.length + t.length > 0) {
      console.log(`  FOUND "${term}":`, [...l, ...t].map(r => r.name));
    } else {
      console.log(`  "${term}": not found`);
    }
  }

  // 3. Check TGS source_entity_map for event 3989
  console.log('\n3. TGS event 3989 in source_entity_map:');
  const { rows: tgs } = await pool.query(`
    SELECT * FROM source_entity_map WHERE source_entity_id = '3989' AND source_platform = 'totalglobalsports'
  `);
  console.log(`  ${tgs.length > 0 ? 'FOUND: ' + JSON.stringify(tgs[0]) : 'NOT FOUND'}`);

  // 4. Check AthleteOne in source_entity_map
  console.log('\n4. AthleteOne in source_entity_map (any events):');
  const { rows: ao } = await pool.query(`
    SELECT COUNT(*) as cnt FROM source_entity_map WHERE source_platform = 'athleteone'
  `);
  console.log(`  AthleteOne entries: ${ao[0].cnt}`);

  // 5. Check staging_games for any STXCL or TCSL NPL TX
  console.log('\n5. Staging games for STXCL or TCSL NPL TX:');
  const { rows: sg } = await pool.query(`
    SELECT source_platform, event_id, event_name, COUNT(*) as cnt
    FROM staging_games
    WHERE event_name ILIKE '%STXCL%'
       OR event_name ILIKE '%South Texas Champions%'
       OR event_name ILIKE '%Texas Club Soccer League%'
       OR event_name ILIKE '%NPL North Texas%'
    GROUP BY source_platform, event_id, event_name
    LIMIT 10
  `);
  if (sg.length > 0) {
    sg.forEach(r => console.log(`  ${r.source_platform}:${r.event_id} "${r.event_name}" (${r.cnt} records)`));
  } else {
    console.log('  NO staging records found');
  }

  // 6. Summary: What are ALL 18 NPL leagues and their DB status?
  console.log('\n\n=== COMPLETE NPL 18-LEAGUE STATUS SUMMARY ===');
  const npl18Summary = [
    { name: 'Central States NPL', dbId: 'GS:46428', matches: 12, status: '✅ IN DB' },
    { name: 'CPSL NPL (MD/DC)', dbId: 'GS:43268', matches: 28, status: '✅ IN DB' },
    { name: 'FCL NPL Division (FL)', dbId: 'GS:44970', matches: 403, status: '✅ IN DB' },
    { name: 'Frontier Premier League', dbId: 'GS:44015', matches: 9, status: '✅ IN DB' },
    { name: 'Great Lakes Alliance NPL', dbId: 'GS:43157', matches: 227, status: '✅ IN DB' },
    { name: 'Mid-Atlantic Premier League', dbId: 'GS:45036', matches: 10, status: '✅ IN DB' },
    { name: 'MDL NPL (via GLA)', dbId: 'GS:43156', matches: 24, status: '✅ IN DB' },
    { name: 'Minnesota NPL', dbId: 'GS:47013', matches: 77, status: '✅ IN DB' },
    { name: 'Mountain West NPL (JPL)', dbId: 'GS:44839', matches: 147, status: '✅ IN DB' },
    { name: 'NISL NPL (N. Illinois)', dbId: 'GS:44630', matches: '954+', status: '✅ IN DB' },
    { name: 'NorCal NPL Division', dbId: 'GS:44145', matches: 99, status: '✅ IN DB' },
    { name: 'Red River NPL', dbId: 'GS:?', matches: 41, status: '✅ IN DB' },
    { name: 'SOCAL NPL Division', dbId: 'GS:43086', matches: 3116, status: '✅ IN DB' },
    { name: 'South Atlantic Premier League', dbId: 'various', matches: 147, status: '✅ IN DB' },
    { name: 'STXCL NPL', dbId: 'AthleteOne:~4184', matches: 0, status: '❌ MISSING' },
    { name: 'TCSL NPL (Texas)', dbId: 'TGS:3989', matches: 0, status: '❌ MISSING' },
    { name: 'VPSL NPL Division', dbId: 'GS:various', matches: 196, status: '✅ IN DB' },
    { name: 'WPL NPL Division', dbId: 'GS:various', matches: 434, status: '✅ IN DB' },
  ];

  npl18Summary.forEach((l, i) => {
    console.log(`${i+1}. ${l.status} ${l.name} | ${l.dbId}`);
  });

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
