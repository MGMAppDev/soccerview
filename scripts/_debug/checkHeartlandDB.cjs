/**
 * Check what Heartland data we already have in the database
 */
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  console.log("=== Heartland Data in Database ===\n");

  // Check staging
  const staging = await pool.query(`
    SELECT source_platform, COUNT(*) as cnt,
           MIN(match_date) as earliest, MAX(match_date) as latest,
           SUM(CASE WHEN processed THEN 1 ELSE 0 END) as processed_cnt,
           SUM(CASE WHEN NOT processed THEN 1 ELSE 0 END) as unprocessed_cnt
    FROM staging_games
    WHERE source_platform ILIKE '%heartland%'
    GROUP BY source_platform
    ORDER BY cnt DESC
  `);
  console.log("Staging games:");
  staging.rows.forEach(r => console.log(`  ${r.source_platform}: ${r.cnt} (${r.processed_cnt} processed, ${r.unprocessed_cnt} unprocessed) [${r.earliest} to ${r.latest}]`));

  // Check production matches
  const matches = await pool.query(`
    SELECT source_platform, COUNT(*) as cnt,
           MIN(match_date) as earliest, MAX(match_date) as latest,
           SUM(CASE WHEN home_score IS NOT NULL AND away_score IS NOT NULL THEN 1 ELSE 0 END) as with_scores,
           SUM(CASE WHEN home_score IS NULL OR away_score IS NULL THEN 1 ELSE 0 END) as without_scores
    FROM matches_v2
    WHERE source_platform ILIKE '%heartland%'
      AND deleted_at IS NULL
    GROUP BY source_platform
    ORDER BY cnt DESC
  `);
  console.log("\nProduction matches:");
  matches.rows.forEach(r => console.log(`  ${r.source_platform}: ${r.cnt} total (${r.with_scores} with scores, ${r.without_scores} scheduled) [${r.earliest} to ${r.latest}]`));

  // Check by season for Heartland
  const bySeason = await pool.query(`
    SELECT
      CASE
        WHEN match_date >= '2025-08-01' AND match_date < '2026-08-01' THEN '2025-2026'
        WHEN match_date >= '2024-08-01' AND match_date < '2025-08-01' THEN '2024-2025'
        ELSE 'other'
      END as season,
      COUNT(*) as cnt,
      SUM(CASE WHEN home_score IS NOT NULL THEN 1 ELSE 0 END) as with_scores
    FROM matches_v2
    WHERE source_platform ILIKE '%heartland%'
      AND deleted_at IS NULL
    GROUP BY 1
    ORDER BY 1
  `);
  console.log("\nHeartland matches by season:");
  bySeason.rows.forEach(r => console.log(`  ${r.season}: ${r.cnt} matches (${r.with_scores} with scores)`));

  // Check leagues/tournaments
  const events = await pool.query(`
    SELECT l.id, l.name, l.source_platform, COUNT(m.id) as match_count
    FROM leagues l
    LEFT JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    WHERE l.name ILIKE '%heartland%'
    GROUP BY l.id, l.name, l.source_platform
    ORDER BY match_count DESC
  `);
  console.log("\nHeartland leagues:");
  events.rows.forEach(r => console.log(`  ${r.name} (${r.source_platform}): ${r.match_count} matches`));

  // Check unprocessed staging details
  const unprocessed = await pool.query(`
    SELECT source_event_id, COUNT(*) as cnt,
           MIN(match_date) as earliest, MAX(match_date) as latest
    FROM staging_games
    WHERE source_platform ILIKE '%heartland%' AND NOT processed
    GROUP BY source_event_id
    ORDER BY cnt DESC
    LIMIT 10
  `);
  console.log("\nUnprocessed staging by event:");
  unprocessed.rows.forEach(r => console.log(`  ${r.source_event_id}: ${r.cnt} [${r.earliest} to ${r.latest}]`));

  await pool.end();
}

check().catch(e => { console.error(e); process.exit(1); });
