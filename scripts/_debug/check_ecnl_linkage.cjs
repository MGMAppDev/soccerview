#!/usr/bin/env node
// Check ECNL league linkage and source_entity_map entries
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Count ECNL leagues
  const { rows: ecnlLeagues } = await pool.query(`
    SELECT id, name, source_event_id
    FROM leagues
    WHERE name ILIKE '%ecnl%' OR name ILIKE '%ecrl%' OR name ILIKE '%pre-ecnl%'
    ORDER BY name
  `);
  console.log('ECNL leagues in DB:', ecnlLeagues.length);
  ecnlLeagues.slice(0, 10).forEach(r => console.log('  ' + r.id.substring(0,8) + ' | ' + r.name + ' | src: ' + r.source_event_id));
  if (ecnlLeagues.length > 10) console.log('  ... and ' + (ecnlLeagues.length - 10) + ' more');

  // 2. Count ECNL tournaments (should be 0 after reclassification)
  const { rows: ecnlTournaments } = await pool.query(`
    SELECT id, name, source_event_id
    FROM tournaments
    WHERE name ILIKE '%ecnl%' OR name ILIKE '%ecrl%' OR name ILIKE '%pre-ecnl%'
    LIMIT 10
  `);
  console.log('\nECNL tournaments still in DB:', ecnlTournaments.length);
  ecnlTournaments.forEach(r => console.log('  ' + r.id.substring(0,8) + ' | ' + r.name));

  // 3. Check source_entity_map for ECNL leagues
  const leagueIds = ecnlLeagues.map(r => r.id);
  if (leagueIds.length > 0) {
    const { rows: semEntries } = await pool.query(`
      SELECT source_platform, entity_type, source_entity_id, sv_id
      FROM source_entity_map
      WHERE sv_id = ANY($1::uuid[])
    `, [leagueIds]);
    console.log('\nsource_entity_map entries for ECNL leagues:', semEntries.length);
    semEntries.slice(0, 10).forEach(r =>
      console.log('  ' + r.source_platform + ' | ' + r.entity_type + ' | ' + r.source_entity_id)
    );
    if (semEntries.length > 10) console.log('  ... and ' + (semEntries.length - 10) + ' more');

    // Check if any point to 'tournament' entity_type
    const tournamentType = semEntries.filter(r => r.entity_type === 'tournament');
    console.log('\n  Entries with entity_type="tournament":', tournamentType.length);
    const leagueType = semEntries.filter(r => r.entity_type === 'league');
    console.log('  Entries with entity_type="league":', leagueType.length);
  }

  // 4. Check ECNL match linkage
  const { rows: matchStats } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(league_id) as with_league,
      COUNT(tournament_id) as with_tournament
    FROM matches_v2
    WHERE deleted_at IS NULL
      AND (
        league_id IN (SELECT id FROM leagues WHERE name ILIKE '%ecnl%' OR name ILIKE '%ecrl%' OR name ILIKE '%pre-ecnl%')
        OR tournament_id IN (SELECT id FROM tournaments WHERE name ILIKE '%ecnl%' OR name ILIKE '%ecrl%' OR name ILIKE '%pre-ecnl%')
      )
  `);
  console.log('\nECNL match linkage:');
  console.log('  Total:', matchStats[0].total);
  console.log('  With league_id:', matchStats[0].with_league);
  console.log('  With tournament_id:', matchStats[0].with_tournament);

  // 5. Check source_entity_map totals for TGS
  const { rows: tgsTotals } = await pool.query(`
    SELECT entity_type, COUNT(*) as cnt
    FROM source_entity_map
    WHERE source_platform IN ('totalglobalsports', 'tgs')
    GROUP BY entity_type
  `);
  console.log('\nTGS/totalglobalsports source_entity_map totals:');
  if (tgsTotals.length === 0) console.log('  (none found)');
  tgsTotals.forEach(r => console.log('  ' + r.entity_type + ': ' + r.cnt));

  // 6. Sample some ECNL league source_event_ids to understand format
  console.log('\nSample ECNL league source_event_ids:');
  ecnlLeagues.slice(0, 5).forEach(r => console.log('  ' + r.source_event_id + ' -> ' + r.name));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
