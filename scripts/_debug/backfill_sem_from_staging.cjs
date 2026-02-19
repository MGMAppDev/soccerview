/**
 * backfill_sem_from_staging.cjs
 * 
 * Backfills source_entity_map entries for teams where we have source IDs
 * in staging_games.raw_data but no SEM entry yet.
 * 
 * Method: Join staging_games to matches_v2 via source_match_key to get
 * the deterministic source_id -> sv_uuid mapping, then INSERT ON CONFLICT DO NOTHING.
 *
 * Targets: demosphere (2,425), sincsports (1,194), athleteone (831), totalglobalsports (75)
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PLATFORMS = ['demosphere', 'sincsports', 'athleteone', 'totalglobalsports'];

async function backfillPlatform(platform) {
  console.log(`\n--- ${platform} ---`);

  // Collect all (source_id -> sv_uuid) pairs from both home and away sides
  // Join staging_games to matches_v2 via source_match_key (deterministic)
  const { rows: homePairs } = await pool.query(`
    SELECT DISTINCT
      sg.raw_data->>'source_home_team_id' AS source_entity_id,
      m.home_team_id AS sv_id
    FROM staging_games sg
    JOIN matches_v2 m ON m.source_match_key = sg.source_match_key
    WHERE sg.source_platform = $1
      AND sg.raw_data->>'source_home_team_id' IS NOT NULL
      AND sg.processed_at IS NOT NULL
      AND m.deleted_at IS NULL
      AND m.home_team_id IS NOT NULL
  `, [platform]);

  const { rows: awayPairs } = await pool.query(`
    SELECT DISTINCT
      sg.raw_data->>'source_away_team_id' AS source_entity_id,
      m.away_team_id AS sv_id
    FROM staging_games sg
    JOIN matches_v2 m ON m.source_match_key = sg.source_match_key
    WHERE sg.source_platform = $1
      AND sg.raw_data->>'source_away_team_id' IS NOT NULL
      AND sg.processed_at IS NOT NULL
      AND m.deleted_at IS NULL
      AND m.away_team_id IS NOT NULL
  `, [platform]);

  // Merge and deduplicate (a source_id might map to multiple sv_ids if there's a conflict — keep first)
  const seen = new Map();
  for (const row of [...homePairs, ...awayPairs]) {
    if (!seen.has(row.source_entity_id)) {
      seen.set(row.source_entity_id, row.sv_id);
    } else if (seen.get(row.source_entity_id) !== row.sv_id) {
      // Conflict: same source ID maps to different sv_ids (merge artifact)
      // Keep the one already in the map (first seen wins)
      console.log(`  CONFLICT: source_id ${row.source_entity_id} -> ${seen.get(row.source_entity_id)} vs ${row.sv_id} — keeping first`);
    }
  }

  console.log(`  Unique (source_id -> sv_uuid) pairs found: ${seen.size}`);

  // Insert in batches of 500
  const pairs = Array.from(seen.entries()); // [[source_entity_id, sv_id], ...]
  let inserted = 0;
  let skipped = 0;
  const BATCH_SIZE = 500;

  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);
    // Build VALUES clause
    const values = [];
    const params = [];
    let paramIdx = 1;
    for (const [sourceId, svId] of batch) {
      values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      params.push('team', platform, sourceId, svId);
    }
    const sql = `
      INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
      VALUES ${values.join(', ')}
      ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
    `;
    const result = await pool.query(sql, params);
    inserted += result.rowCount;
    skipped += batch.length - result.rowCount;
    process.stdout.write(`  Progress: ${Math.min(i + BATCH_SIZE, pairs.length)}/${pairs.length}\r`);
  }

  console.log(`  Inserted: ${inserted} new SEM entries`);
  console.log(`  Skipped:  ${skipped} (already existed)`);
  return inserted;
}

async function main() {
  console.log('SEM Backfill from staging_games source IDs');
  console.log('===========================================');

  // Pre-check totals
  const before = await pool.query(`SELECT COUNT(*) FROM source_entity_map WHERE entity_type = 'team'`);
  console.log(`SEM team entries before: ${before.rows[0].count}`);

  let totalInserted = 0;
  for (const platform of PLATFORMS) {
    const n = await backfillPlatform(platform);
    totalInserted += n;
  }

  const after = await pool.query(`SELECT COUNT(*) FROM source_entity_map WHERE entity_type = 'team'`);
  console.log(`\n===========================================`);
  console.log(`SEM team entries after:  ${after.rows[0].count}`);
  console.log(`Total new entries:       ${totalInserted}`);

  // Final breakdown
  const breakdown = await pool.query(`
    SELECT source_platform, COUNT(*) 
    FROM source_entity_map 
    WHERE entity_type = 'team' 
      AND source_platform = ANY($1)
    GROUP BY source_platform 
    ORDER BY COUNT(*) DESC
  `, [PLATFORMS]);
  console.log('\nFinal SEM team entries per platform:');
  breakdown.rows.forEach(r => console.log(' ', r.source_platform?.padEnd(22), r.count));

  pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); pool.end(); process.exit(1); });
