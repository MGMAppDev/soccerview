require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // The 18 official NPL member leagues with their known GotSport event IDs
  const npl18 = [
    { name: 'Central States NPL', terms: ['Central States NPL'] },
    { name: 'CPSL NPL Division (MD/DC)', terms: ['CPSL NPL', 'Chesapeake Premier'] },
    { name: 'FCL NPL Division (Florida)', terms: ['FCL NPL', 'FCL National Premier'] },
    { name: 'Frontier Premier League', terms: ['Frontier Premier'] },
    { name: 'Great Lakes Alliance NPL', terms: ['Great Lakes Alliance_NPL', 'Great Lakes Alliance NPL'] },
    { name: 'Mid-Atlantic Premier League', terms: ['Mid-Atlantic Premier'] },
    { name: 'MDL NPL Division', terms: ['MDL NPL', 'Midwest Developmental League', 'Great Lakes Alliance_MDL'] },
    { name: 'Minnesota NPL', terms: ['Minnesota NPL'] },
    { name: 'Mountain West NPL (JPL)', terms: ['Mountain West NPL', 'JPL Mountain West', 'JPL MW NPL'] },
    { name: 'NISL NPL Division', terms: ['NISL NPL', 'NISL - 2025', 'NISL - 202'] },
    { name: 'NorCal NPL Division', terms: ['NorCal NPL', 'NorCal Spring NPL'] },
    { name: 'Red River NPL', terms: ['Red River NPL'] },
    { name: 'SOCAL NPL Division', terms: ['SOCAL NPL', 'SoCal NPL', 'SOCAL Fall League'] },
    { name: 'South Atlantic Premier League (SAPL)', terms: ['South Atlantic Premier', 'SAPL NPL'] },
    { name: 'STXCL NPL Division', terms: ['STXCL', 'South Texas Champions'] },
    { name: 'TCSL NPL Division', terms: ['TCSL NPL', 'Minnesota NPL', 'Twin Cities NPL'] },
    { name: 'VPSL NPL Division', terms: ['VPSL NPL'] },
    { name: 'WPL NPL Division', terms: ['WPL', 'Washington Premier'] },
  ];

  console.log('=== Full NPL Coverage Audit (leagues + tournaments) ===\n');

  for (const league of npl18) {
    let found = false;
    let has2526 = false;
    let matchCount = 0;
    let names = [];

    for (const term of league.terms) {
      // Check leagues table
      const { rows: lRows } = await pool.query(
        `SELECT l.id, l.name, l.state, COUNT(m.id) as match_count
         FROM leagues l
         LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
         WHERE l.name ILIKE $1
         GROUP BY l.id, l.name, l.state
         LIMIT 3`,
        [`%${term}%`]
      );
      // Check tournaments table
      const { rows: tRows } = await pool.query(
        `SELECT t.id, t.name, t.state, COUNT(m.id) as match_count
         FROM tournaments t
         LEFT JOIN matches_v2 m ON m.tournament_id = t.id AND m.deleted_at IS NULL
         WHERE t.name ILIKE $1
         GROUP BY t.id, t.name, t.state
         LIMIT 3`,
        [`%${term}%`]
      );

      const allRows = [...lRows, ...tRows];
      if (allRows.length > 0) {
        found = true;
        allRows.forEach(r => {
          const n = r.name;
          if (n.includes('25-26') || n.includes('25/26') || n.includes('2025-26') || n.includes('2025/26') || n.includes('2026')) {
            has2526 = true;
          }
          matchCount += parseInt(r.match_count || 0);
          names.push(`"${r.name}" (${r.match_count} matches)`);
        });
      }
    }

    let status;
    if (!found) status = '❌ NOT IN DB';
    else if (has2526 && matchCount > 0) status = `✅ 2025-26 + ${matchCount} matches`;
    else if (has2526) status = `⚠️  2025-26 but 0 matches`;
    else if (matchCount > 0) status = `⚠️  OLDER SEASON, ${matchCount} matches`;
    else status = `⚠️  IN DB but 0 matches`;

    console.log(`${status}: ${league.name}`);
    if (names.length > 0 && names.length <= 4) {
      names.forEach(n => console.log(`    ${n}`));
    }
  }

  // Check specific event IDs mentioned in research
  console.log('\n\n=== Verifying specific GotSport event IDs ===');
  const eventIds = [
    { id: '43086', desc: 'SOCAL Fall League 2025-26' },
    { id: '43157', desc: 'GLA NPL 2025-26' },
    { id: '43156', desc: 'MDL 2025-26' },
    { id: '44839', desc: 'Mountain West NPL 25/26' },
    { id: '44970', desc: 'FCL NPL 25/26 (Florida)' },
    { id: '45036', desc: 'Mid-Atlantic PL 2025/26' },
    { id: '47013', desc: 'Minnesota NPL 2025-26' },
    { id: '44015', desc: 'Frontier PL 2025-26' },
  ];

  for (const ev of eventIds) {
    const { rows: lRows } = await pool.query(
      `SELECT l.name, COUNT(m.id) as match_count
       FROM leagues l
       LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
       WHERE l.id = (SELECT sv_id::uuid FROM source_entity_map WHERE source_entity_id = $1 AND source_platform = 'gotsport' AND entity_type = 'league' LIMIT 1)
       GROUP BY l.name`,
      [ev.id]
    );
    const { rows: tRows } = await pool.query(
      `SELECT t.name, COUNT(m.id) as match_count
       FROM tournaments t
       LEFT JOIN matches_v2 m ON m.tournament_id = t.id AND m.deleted_at IS NULL
       WHERE t.id = (SELECT sv_id::uuid FROM source_entity_map WHERE source_entity_id = $1 AND source_platform = 'gotsport' AND entity_type = 'tournament' LIMIT 1)
       GROUP BY t.name`,
      [ev.id]
    );
    const all = [...lRows, ...tRows];
    if (all.length > 0) {
      all.forEach(r => console.log(`  GS:${ev.id} -> "${r.name}" | ${r.match_count} matches`));
    } else {
      console.log(`  GS:${ev.id} (${ev.desc}) -> not mapped or 0 matches in DB`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
