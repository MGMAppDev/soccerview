require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const platforms = ['totalglobalsports', 'demosphere', 'sincsports', 'athleteone', 'squadi'];
  console.log('Per-platform unique source home IDs and existing SEM team entries:');
  for (const platform of platforms) {
    const r1 = await pool.query(
      `SELECT COUNT(DISTINCT raw_data->>'source_home_team_id') as home_ids
       FROM staging_games
       WHERE source_platform = $1
         AND processed_at IS NOT NULL
         AND raw_data->>'source_home_team_id' IS NOT NULL`,
      [platform]
    );
    const r2 = await pool.query(
      `SELECT COUNT(*) FROM source_entity_map
       WHERE source_platform = $1 AND entity_type = 'team'`,
      [platform]
    );
    console.log(
      ' ', platform.padEnd(22),
      '| unique src_home_ids:', String(r1.rows[0].home_ids).padStart(5),
      '| SEM team entries:', r2.rows[0].count
    );
  }

  // Mappable pairs: staging source IDs joined to sv_uuid via source_match_key
  const r3 = await pool.query(`
    SELECT
      sg.source_platform,
      COUNT(DISTINCT (sg.raw_data->>'source_home_team_id') || '|' || CAST(m.home_team_id AS TEXT)) AS mappable_home,
      COUNT(DISTINCT (sg.raw_data->>'source_away_team_id') || '|' || CAST(m.away_team_id AS TEXT)) AS mappable_away
    FROM staging_games sg
    JOIN matches_v2 m ON m.source_match_key = sg.source_match_key
    WHERE sg.raw_data->>'source_home_team_id' IS NOT NULL
      AND sg.processed_at IS NOT NULL
      AND m.deleted_at IS NULL
    GROUP BY sg.source_platform
    ORDER BY mappable_home DESC
  `);
  console.log('\nMappable (source_id -> sv_uuid) pairs via source_match_key join:');
  r3.rows.forEach(r => console.log(
    ' ', r.source_platform?.padEnd(22),
    '| home pairs:', String(r.mappable_home).padStart(5),
    '| away pairs:', r.mappable_away
  ));

  // Already-covered by SEM (avoid double-counting)
  console.log('\nSummary: NEW SEM entries to backfill (mappable_home - existing SEM):');
  for (const row of r3.rows) {
    const existing = await pool.query(
      `SELECT COUNT(*) FROM source_entity_map WHERE source_platform = $1 AND entity_type = 'team'`,
      [row.source_platform]
    );
    const net = Number(row.mappable_home) - Number(existing.rows[0].count);
    console.log(
      ' ', row.source_platform?.padEnd(22),
      '| mappable:', String(row.mappable_home).padStart(5),
      '| existing SEM:', String(existing.rows[0].count).padStart(5),
      '| net new:', Math.max(0, net)
    );
  }

  pool.end();
}

check().catch(e => { console.error(e.message); pool.end(); });
