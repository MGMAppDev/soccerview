require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  // Check staging for the specific match
  const r3 = await pool.query(
    `SELECT home_score, away_score, processed, scraped_at
     FROM staging_games
     WHERE source_match_key = 'gotsport-41948-5215'`
  );
  console.log('=== Staging for gotsport-41948-5215 ===');
  console.table(r3.rows);

  // ALL 0-0 matches by source type
  const r4 = await pool.query(`
    SELECT
      CASE
        WHEN source_match_key LIKE 'v1-legacy%' THEN 'v1-legacy'
        WHEN source_match_key LIKE 'legacy-%' THEN 'legacy'
        ELSE source_platform
      END as source,
      COUNT(*) as zero_zero_count
    FROM matches_v2
    WHERE home_score = 0 AND away_score = 0 AND deleted_at IS NULL
    GROUP BY 1 ORDER BY 2 DESC
  `);
  console.log('\n=== ALL 0-0 matches by source ===');
  console.table(r4.rows);

  // What percentage of all scored matches are 0-0?
  const r5 = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE home_score = 0 AND away_score = 0) as zero_zero,
      COUNT(*) FILTER (WHERE home_score IS NOT NULL AND away_score IS NOT NULL) as total_scored,
      ROUND(100.0 * COUNT(*) FILTER (WHERE home_score = 0 AND away_score = 0) /
        NULLIF(COUNT(*) FILTER (WHERE home_score IS NOT NULL AND away_score IS NOT NULL), 0), 1) as pct_zero
    FROM matches_v2 WHERE deleted_at IS NULL
  `);
  console.log('\n=== 0-0 as percentage of all scored ===');
  console.table(r5.rows);

  // For recent 0-0 prod matches, what does staging say?
  const r7 = await pool.query(`
    SELECT
      COUNT(*) as total_zero_zero_in_prod,
      COUNT(sg.id) as found_in_staging,
      COUNT(*) FILTER (WHERE sg.home_score IS NULL) as staging_says_null,
      COUNT(*) FILTER (WHERE sg.home_score = 0) as staging_says_zero,
      COUNT(*) FILTER (WHERE sg.home_score > 0 OR sg.away_score > 0) as staging_says_has_goals
    FROM matches_v2 m
    LEFT JOIN staging_games sg ON sg.source_match_key = m.source_match_key
    WHERE m.home_score = 0 AND m.away_score = 0 AND m.deleted_at IS NULL
  `);
  console.log('\n=== For ALL 0-0 prod matches, what does staging say? ===');
  console.table(r7.rows);

  // Check: do V1-legacy keys that got overwritten exist in audit?
  // How many 0-0 gotsport matches have a v1-legacy sibling?
  const r8 = await pool.query(`
    SELECT COUNT(*) as gotsport_zero_zero_with_v1_audit
    FROM matches_v2 m
    WHERE m.home_score = 0 AND m.away_score = 0 AND m.deleted_at IS NULL
      AND m.source_match_key LIKE 'gotsport-%'
      AND EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.record_id = m.id::text
          AND a.table_name = 'matches_v2'
          AND (a.old_data->>'source_match_key' LIKE 'v1-legacy%'
            OR a.new_data->>'source_match_key' LIKE 'v1-legacy%')
      )
  `);
  console.log('\n=== Gotsport 0-0 with v1-legacy in audit ===');
  console.table(r8.rows);

  // Simpler: check if any soft-deleted v1-legacy matches share the same date+teams
  const r9 = await pool.query(`
    SELECT COUNT(*) as v1_deleted_with_same_semantic_key
    FROM matches_v2 active
    JOIN matches_v2 deleted ON
      active.match_date = deleted.match_date
      AND active.home_team_id = deleted.home_team_id
      AND active.away_team_id = deleted.away_team_id
      AND deleted.source_match_key LIKE 'v1-legacy%'
      AND deleted.deleted_at IS NOT NULL
    WHERE active.home_score = 0 AND active.away_score = 0
      AND active.deleted_at IS NULL
      AND active.source_match_key LIKE 'gotsport-%'
    LIMIT 1
  `);
  console.log('\n=== Gotsport 0-0 with soft-deleted v1-legacy counterpart ===');
  console.table(r9.rows);

  // In real soccer, what % of matches are genuinely 0-0?
  // Check matches WITH actual goals to get a baseline
  const r10 = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE home_score = 0 AND away_score = 0) as zero_zero,
      COUNT(*) FILTER (WHERE home_score > 0 OR away_score > 0) as has_goals,
      COUNT(*) as total_scored,
      ROUND(100.0 * COUNT(*) FILTER (WHERE home_score = 0 AND away_score = 0) / COUNT(*), 1) as pct
    FROM matches_v2
    WHERE deleted_at IS NULL
      AND home_score IS NOT NULL AND away_score IS NOT NULL
      AND source_match_key NOT LIKE 'v1-legacy%'
      AND source_match_key NOT LIKE 'legacy-%'
  `);
  console.log('\n=== Non-legacy scored matches: 0-0 rate ===');
  console.table(r10.rows);

  await pool.end();
})();
