#!/usr/bin/env node
// Backfill source_entity_map for all 76 ECNL/ECRL/Pre-ECNL events
// Maps TGS event IDs → league UUIDs for Tier 0 resolution on future scrapes
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// TGS event IDs and names from totalglobalsports.js adapter
const TGS_EVENTS = [
  // ECNL Boys
  { id: 3880, name: "ECNL Boys Mid-Atlantic 2025-26" },
  { id: 3881, name: "ECNL Boys Midwest 2025-26" },
  { id: 3882, name: "ECNL Boys Mountain 2025-26" },
  { id: 3883, name: "ECNL Boys New England 2025-26" },
  { id: 3884, name: "ECNL Boys North Atlantic 2025-26" },
  { id: 3885, name: "ECNL Boys Northern Cal 2025-26" },
  { id: 3886, name: "ECNL Boys Northwest 2025-26" },
  { id: 3887, name: "ECNL Boys Ohio Valley 2025-26" },
  { id: 3888, name: "ECNL Boys Southeast 2025-26" },
  { id: 3889, name: "ECNL Boys Southwest 2025-26" },
  { id: 3890, name: "ECNL Boys Texas 2025-26" },
  // ECNL Girls
  { id: 3925, name: "ECNL Girls Mid-Atlantic 2025-26" },
  { id: 3926, name: "ECNL Girls Midwest 2025-26" },
  { id: 3927, name: "ECNL Girls New England 2025-26" },
  { id: 3928, name: "ECNL Girls North Atlantic 2025-26" },
  { id: 3929, name: "ECNL Girls Northern Cal 2025-26" },
  { id: 3930, name: "ECNL Girls Northwest 2025-26" },
  { id: 3931, name: "ECNL Girls Ohio Valley 2025-26" },
  { id: 3932, name: "ECNL Girls Southeast 2025-26" },
  { id: 3933, name: "ECNL Girls Southwest 2025-26" },
  { id: 3934, name: "ECNL Girls Texas 2025-26" },
  // ECNL RL Boys
  { id: 3891, name: "ECNL RL Boys Carolinas 2025-26" },
  { id: 3892, name: "ECNL RL Boys Chicago Metro 2025-26" },
  { id: 3893, name: "ECNL RL Boys Far West 2025-26" },
  { id: 3894, name: "ECNL RL Boys Florida 2025-26" },
  { id: 3895, name: "ECNL RL Boys Frontier 2025-26" },
  { id: 3896, name: "ECNL RL Boys Golden State 2025-26" },
  { id: 3897, name: "ECNL RL Boys Greater Michigan 2025-26" },
  { id: 3898, name: "ECNL RL Boys Greater Michigan Alliance 2025-26" },
  { id: 3899, name: "ECNL RL Boys Great Lakes Alliance 2025-26" },
  { id: 3900, name: "ECNL RL Boys Gulf Coast 2025-26" },
  { id: 3901, name: "ECNL RL Boys Heartland 2025-26" },
  { id: 3902, name: "ECNL RL Boys Mid-America 2025-26" },
  { id: 3903, name: "ECNL RL Boys Midwest 2025-26" },
  { id: 3904, name: "ECNL RL Boys Mountain 2025-26" },
  { id: 3905, name: "ECNL RL Boys New England 2025-26" },
  { id: 3906, name: "ECNL RL Boys NorCal 2025-26" },
  { id: 3907, name: "ECNL RL Boys North Atlantic 2025-26" },
  { id: 3908, name: "ECNL RL Boys Northeast 2025-26" },
  { id: 3909, name: "ECNL RL Boys NTX 2025-26" },
  { id: 3910, name: "ECNL RL Boys Northwest 2025-26" },
  { id: 3911, name: "ECNL RL Boys SoCal 2025-26" },
  { id: 3912, name: "ECNL RL Boys Southeast 2025-26" },
  { id: 3913, name: "ECNL RL Boys Texas 2025-26" },
  { id: 3915, name: "ECNL RL Boys Virginia 2025-26" },
  // ECNL RL Girls
  { id: 3935, name: "ECNL RL Girls Carolinas 2025-26" },
  { id: 3936, name: "ECNL RL Girls Florida 2025-26" },
  { id: 3937, name: "ECNL RL Girls Frontier 2025-26" },
  { id: 3938, name: "ECNL RL Girls Golden State 2025-26" },
  { id: 3939, name: "ECNL RL Girls Great Lakes Alliance 2025-26" },
  { id: 3940, name: "ECNL RL Girls Greater Michigan Alliance 2025-26" },
  { id: 3941, name: "ECNL RL Girls Gulf Coast 2025-26" },
  { id: 3942, name: "ECNL RL Girls Heartland 2025-26" },
  { id: 3943, name: "ECNL RL Girls Mid-America 2025-26" },
  { id: 3944, name: "ECNL RL Girls Mountain 2025-26" },
  { id: 3945, name: "ECNL RL Girls New England 2025-26" },
  { id: 3946, name: "ECNL RL Girls NorCal 2025-26" },
  { id: 3947, name: "ECNL RL Girls North Atlantic 2025-26" },
  { id: 3948, name: "ECNL RL Girls Northeast 2025-26" },
  { id: 3949, name: "ECNL RL Girls Northwest 2025-26" },
  { id: 3950, name: "ECNL RL Girls NTX 2025-26" },
  { id: 3951, name: "ECNL RL Girls Ohio Valley 2025-26" },
  { id: 3952, name: "ECNL RL Girls Southeast 2025-26" },
  { id: 3953, name: "ECNL RL Girls Southern Cal 2025-26" },
  { id: 3954, name: "ECNL RL Girls Southwest 2025-26" },
  { id: 3955, name: "ECNL RL Girls Texas 2025-26" },
  { id: 3957, name: "ECNL RL Girls Virginia 2025-26" },
  // Pre-ECNL Boys
  { id: 3916, name: "Pre-ECNL Boys Lake Michigan 2025-26" },
  { id: 3918, name: "Pre-ECNL Boys Northeast 2025-26" },
  { id: 3919, name: "Pre-ECNL Boys New England 2025-26" },
  { id: 3920, name: "Pre-ECNL Boys North Atlantic 2025-26" },
  { id: 3921, name: "Pre-ECNL Boys NTX 2025 Fall" },
  { id: 3922, name: "Pre-ECNL Boys Ohio Valley 2025-26" },
  { id: 3923, name: "Pre-ECNL Boys SoCal 2025-26" },
  // Pre-ECNL Girls
  { id: 3958, name: "Pre-ECNL Girls Lake Michigan 2025-26" },
  { id: 3959, name: "Pre-ECNL Girls North Atlantic 2025-26" },
  { id: 3960, name: "Pre-ECNL Girls New England 2025-26" },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log(`TGS events to map: ${TGS_EVENTS.length}`);

  // Get all ECNL leagues
  const { rows: leagues } = await pool.query(`
    SELECT id, name FROM leagues
    WHERE name ILIKE '%ecnl%' OR name ILIKE '%ecrl%' OR name ILIKE '%pre-ecnl%'
  `);
  console.log(`ECNL leagues in DB: ${leagues.length}`);

  // Build name → UUID map
  const nameToId = new Map();
  for (const l of leagues) {
    nameToId.set(l.name.toLowerCase(), l.id);
  }

  let matched = 0, notFound = 0, alreadyExists = 0;
  const inserts = [];

  for (const ev of TGS_EVENTS) {
    const leagueId = nameToId.get(ev.name.toLowerCase());
    if (!leagueId) {
      console.log(`  NOT FOUND: ${ev.name} (TGS ID ${ev.id})`);
      notFound++;
      continue;
    }

    // Check if already exists
    const { rows: existing } = await pool.query(`
      SELECT 1 FROM source_entity_map
      WHERE entity_type = 'league'
        AND source_platform = 'totalglobalsports'
        AND source_entity_id = $1
    `, [String(ev.id)]);

    if (existing.length > 0) {
      alreadyExists++;
      continue;
    }

    inserts.push({ tgsId: String(ev.id), leagueId, name: ev.name });
    matched++;
  }

  console.log(`\nResults: ${matched} to insert, ${alreadyExists} already exist, ${notFound} not found`);

  if (inserts.length > 0 && !dryRun) {
    // Bulk insert
    const values = inserts.map((_, i) => `('league', 'totalglobalsports', $${i*2+1}, $${i*2+2})`).join(', ');
    const params = inserts.flatMap(r => [r.tgsId, r.leagueId]);
    await pool.query(`
      INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
      VALUES ${values}
      ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
    `, params);
    console.log(`Inserted ${inserts.length} source_entity_map entries`);

    // Also update source_event_id on leagues for traceability
    for (const ins of inserts) {
      await pool.query(`
        UPDATE leagues SET source_event_id = $1
        WHERE id = $2 AND (source_event_id IS NULL OR source_event_id = '')
      `, [`tgs-${ins.tgsId}`, ins.leagueId]);
    }
    console.log(`Updated source_event_id on ${inserts.length} leagues`);
  } else if (inserts.length > 0) {
    console.log('\nWould insert:');
    inserts.slice(0, 5).forEach(r => console.log(`  TGS ${r.tgsId} → ${r.leagueId.substring(0,8)} (${r.name})`));
    if (inserts.length > 5) console.log(`  ... and ${inserts.length - 5} more`);
  }

  // Verify
  const { rows: verifyCount } = await pool.query(`
    SELECT COUNT(*) as cnt
    FROM source_entity_map
    WHERE source_platform = 'totalglobalsports' AND entity_type = 'league'
  `);
  console.log(`\nTotal TGS league entries in source_entity_map: ${verifyCount[0].cnt}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
