/**
 * Check SEM (source_entity_map) gaps by platform
 * Session 112: Identify backfill opportunities
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Teams without SEM by match source platform
  const { rows } = await pool.query(`
    SELECT
      CASE
        WHEN m.source_match_key LIKE 'gotsport-%' THEN 'gotsport'
        WHEN m.source_match_key LIKE 'htg-%' THEN 'htgsports'
        WHEN m.source_match_key LIKE 'heartland-%' THEN 'heartland'
        WHEN m.source_match_key LIKE 'sincsports-%' THEN 'sincsports'
        WHEN m.source_match_key LIKE 'mlsnext-%' THEN 'mlsnext'
        WHEN m.source_match_key LIKE 'sportsaffinity-%' THEN 'sportsaffinity'
        WHEN m.source_match_key LIKE 'playmetrics-%' THEN 'playmetrics'
        WHEN m.source_match_key LIKE 'demosphere-%' THEN 'demosphere'
        WHEN m.source_match_key LIKE 'squadi-%' THEN 'squadi'
        WHEN m.source_match_key LIKE 'tgs-%' THEN 'totalglobalsports'
        WHEN m.source_match_key LIKE 'legacy-%' THEN 'legacy'
        ELSE 'other'
      END as platform,
      COUNT(DISTINCT t.id) as teams_without_sem
    FROM teams_v2 t
    JOIN matches_v2 m ON (m.home_team_id = t.id OR m.away_team_id = t.id)
    WHERE m.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM source_entity_map sem WHERE sem.entity_type = 'team' AND sem.sv_id = t.id)
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  console.log('Teams WITHOUT SEM entry, by match source:');
  rows.forEach(r => console.log(`  ${r.platform}: ${r.teams_without_sem}`));

  // Check what percentage of staging_games have source team IDs we could backfill from
  const { rows: sgStats } = await pool.query(`
    SELECT
      source_platform,
      COUNT(*) as total,
      COUNT(NULLIF(raw_data->>'source_home_team_id', '')) as has_home_id,
      COUNT(NULLIF(raw_data->>'source_away_team_id', '')) as has_away_id
    FROM staging_games
    WHERE processed = true
    GROUP BY source_platform
    ORDER BY total DESC
  `);
  console.log('\nStaging games with source team IDs:');
  sgStats.forEach(r => console.log(`  ${r.source_platform}: ${r.total} total, ${r.has_home_id} home IDs, ${r.has_away_id} away IDs`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
