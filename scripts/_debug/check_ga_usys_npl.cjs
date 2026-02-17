require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('=== GIRLS ACADEMY CHECK ===\n');

  const { rows: gaLeagues } = await pool.query(`
    SELECT l.id, l.name, l.state, COUNT(m.id) as match_count
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE l.name ILIKE '%girls academy%' OR l.name ILIKE '% GA %'
       OR l.name ILIKE 'GA %' OR l.name ILIKE '% GA'
    GROUP BY l.id, l.name, l.state ORDER BY match_count DESC LIMIT 30
  `);
  console.log('GA Leagues (' + gaLeagues.length + '):');
  gaLeagues.forEach(r => console.log('  ' + r.match_count + ' matches | ' + r.name + ' | state=' + r.state + ' | id=' + r.id));

  const { rows: gaTournaments } = await pool.query(`
    SELECT t.id, t.name, t.state, COUNT(m.id) as match_count
    FROM tournaments t
    LEFT JOIN matches_v2 m ON m.tournament_id = t.id AND m.deleted_at IS NULL
    WHERE t.name ILIKE '%girls academy%' OR t.name ILIKE '% GA %'
       OR t.name ILIKE 'GA %' OR t.name ILIKE '% GA'
    GROUP BY t.id, t.name, t.state ORDER BY match_count DESC LIMIT 30
  `);
  console.log('\nGA Tournaments (' + gaTournaments.length + '):');
  gaTournaments.forEach(r => console.log('  ' + r.match_count + ' matches | ' + r.name + ' | state=' + r.state + ' | id=' + r.id));

  console.log('\n=== USYS NL CHECK ===\n');

  const { rows: usysLeagues } = await pool.query(`
    SELECT l.id, l.name, l.state, COUNT(m.id) as match_count
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE l.name ILIKE '%usys%' OR l.name ILIKE '%national league%'
    GROUP BY l.id, l.name, l.state ORDER BY match_count DESC LIMIT 40
  `);
  console.log('USYS NL Leagues (' + usysLeagues.length + '):');
  usysLeagues.forEach(r => console.log('  ' + r.match_count + ' matches | ' + r.name + ' | state=' + r.state + ' | id=' + r.id));

  const { rows: usysTournaments } = await pool.query(`
    SELECT t.id, t.name, t.state, COUNT(m.id) as match_count
    FROM tournaments t
    LEFT JOIN matches_v2 m ON m.tournament_id = t.id AND m.deleted_at IS NULL
    WHERE t.name ILIKE '%usys%' OR t.name ILIKE '%national league%'
    GROUP BY t.id, t.name, t.state ORDER BY match_count DESC LIMIT 40
  `);
  console.log('\nUSYS NL Tournaments (' + usysTournaments.length + '):');
  usysTournaments.forEach(r => console.log('  ' + r.match_count + ' matches | ' + r.name + ' | state=' + r.state + ' | id=' + r.id));

  console.log('\n=== NPL CHECK ===\n');

  const { rows: nplLeagues } = await pool.query(`
    SELECT l.id, l.name, l.state, COUNT(m.id) as match_count
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE l.name ILIKE '%npl%' OR l.name ILIKE '%national premier%'
    GROUP BY l.id, l.name, l.state ORDER BY match_count DESC LIMIT 50
  `);
  console.log('NPL Leagues (' + nplLeagues.length + '):');
  nplLeagues.forEach(r => console.log('  ' + r.match_count + ' matches | ' + r.name + ' | state=' + r.state + ' | id=' + r.id));

  const { rows: nplTournaments } = await pool.query(`
    SELECT t.id, t.name, t.state, COUNT(m.id) as match_count
    FROM tournaments t
    LEFT JOIN matches_v2 m ON m.tournament_id = t.id AND m.deleted_at IS NULL
    WHERE t.name ILIKE '%npl%' OR t.name ILIKE '%national premier%'
    GROUP BY t.id, t.name, t.state ORDER BY match_count DESC LIMIT 50
  `);
  console.log('\nNPL Tournaments (' + nplTournaments.length + '):');
  nplTournaments.forEach(r => console.log('  ' + r.match_count + ' matches | ' + r.name + ' | state=' + r.state + ' | id=' + r.id));

  // Summary totals
  const { rows: totals } = await pool.query(`
    SELECT
      (SELECT COUNT(m.id) FROM matches_v2 m JOIN leagues l ON l.id = m.league_id
       WHERE m.deleted_at IS NULL AND (l.name ILIKE '%girls academy%' OR l.name ILIKE '% GA %' OR l.name ILIKE 'GA %')) AS ga_league_matches,
      (SELECT COUNT(m.id) FROM matches_v2 m JOIN tournaments t ON t.id = m.tournament_id
       WHERE m.deleted_at IS NULL AND (t.name ILIKE '%girls academy%' OR t.name ILIKE '% GA %' OR t.name ILIKE 'GA %')) AS ga_tourn_matches,
      (SELECT COUNT(m.id) FROM matches_v2 m JOIN leagues l ON l.id = m.league_id
       WHERE m.deleted_at IS NULL AND (l.name ILIKE '%usys%' OR l.name ILIKE '%national league%')) AS usys_league_matches,
      (SELECT COUNT(m.id) FROM matches_v2 m JOIN tournaments t ON t.id = m.tournament_id
       WHERE m.deleted_at IS NULL AND (t.name ILIKE '%usys%' OR t.name ILIKE '%national league%')) AS usys_tourn_matches,
      (SELECT COUNT(m.id) FROM matches_v2 m JOIN leagues l ON l.id = m.league_id
       WHERE m.deleted_at IS NULL AND (l.name ILIKE '%npl%' OR l.name ILIKE '%national premier%')) AS npl_league_matches,
      (SELECT COUNT(m.id) FROM matches_v2 m JOIN tournaments t ON t.id = m.tournament_id
       WHERE m.deleted_at IS NULL AND (t.name ILIKE '%npl%' OR t.name ILIKE '%national premier%')) AS npl_tourn_matches
  `);
  console.log('\n=== SUMMARY ===');
  console.log('Girls Academy  - leagues:', totals[0].ga_league_matches, '| tournaments:', totals[0].ga_tourn_matches);
  console.log('USYS NL        - leagues:', totals[0].usys_league_matches, '| tournaments:', totals[0].usys_tourn_matches);
  console.log('NPL            - leagues:', totals[0].npl_league_matches, '| tournaments:', totals[0].npl_tourn_matches);

  await pool.end();
}

main().catch(console.error);
