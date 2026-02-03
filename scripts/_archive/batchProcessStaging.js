/**
 * Batch Process Staging Games - FAST SQL-based approach
 *
 * Instead of processing one record at a time via API calls,
 * this uses direct SQL to bulk process staging_games into matches_v2.
 *
 * ~100x faster than the JavaScript validation pipeline.
 *
 * Usage: node scripts/maintenance/batchProcessStaging.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 BATCH PROCESS STAGING GAMES - Fast SQL Mode");
  console.log("=".repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 1800000, // 30 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // Step 1: Count pending staging records
    const countResult = await client.query(`
      SELECT COUNT(*) as cnt FROM staging_games WHERE processed = false
    `);
    const pendingCount = parseInt(countResult.rows[0].cnt);
    console.log(`📊 Pending staging_games: ${pendingCount.toLocaleString()}\n`);

    if (pendingCount === 0) {
      console.log("✅ No pending records to process");
      return;
    }

    // Step 2: Create temp table for team matching results
    console.log("🔄 Step 1: Building team mapping table...");
    const startTime = Date.now();

    await client.query(`
      DROP TABLE IF EXISTS _staging_team_map;

      CREATE TEMP TABLE _staging_team_map AS
      WITH staging_names AS (
        -- Get unique team names from staging
        SELECT DISTINCT home_team_name AS team_name FROM staging_games WHERE processed = false AND home_team_name IS NOT NULL
        UNION
        SELECT DISTINCT away_team_name AS team_name FROM staging_games WHERE processed = false AND away_team_name IS NOT NULL
      ),
      parsed AS (
        -- Parse birth year and canonical name from team names
        SELECT
          team_name,
          LOWER(REGEXP_REPLACE(team_name, '\\s+', ' ', 'g')) AS canonical,
          -- Extract 4-digit birth year (2010-2019)
          (REGEXP_MATCH(team_name, '\\b(201[0-9])\\b'))[1]::int AS birth_year_explicit,
          -- Extract age from U-format (U11, U12, etc) and calculate birth year
          CASE
            WHEN team_name ~* '\\bU[-]?(\\d+)\\b'
            THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - (REGEXP_MATCH(team_name, '\\bU[-]?(\\d+)\\b', 'i'))[1]::int
            ELSE NULL
          END AS birth_year_from_age
        FROM staging_names
      ),
      with_birth_year AS (
        SELECT
          team_name,
          canonical,
          COALESCE(birth_year_explicit, birth_year_from_age) AS birth_year
        FROM parsed
      )
      SELECT
        s.team_name AS staging_name,
        s.canonical,
        s.birth_year,
        -- Try to find matching team in teams_v2
        COALESCE(
          -- Exact canonical match with birth year
          (SELECT id FROM teams_v2 t WHERE LOWER(t.display_name) = s.canonical AND t.birth_year = s.birth_year LIMIT 1),
          -- Fuzzy: display_name contains staging name
          (SELECT id FROM teams_v2 t WHERE LOWER(t.display_name) ILIKE '%' || REPLACE(s.team_name, ' ', '%') || '%' AND t.birth_year = s.birth_year LIMIT 1),
          -- Fuzzy: staging name contains key parts of display_name
          (SELECT id FROM teams_v2 t WHERE s.canonical ILIKE '%' || LOWER(SPLIT_PART(t.display_name, ' ', 1)) || '%'
           AND s.canonical ILIKE '%' || COALESCE(NULLIF((REGEXP_MATCH(t.display_name, '\\d+'))[1], ''), 'XXXX') || '%'
           AND t.birth_year = s.birth_year LIMIT 1)
        ) AS matched_team_id
      FROM with_birth_year s;
    `);

    const mapResult = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(matched_team_id) as matched,
        COUNT(*) - COUNT(matched_team_id) as unmatched
      FROM _staging_team_map
    `);
    console.log(`   Teams in staging: ${mapResult.rows[0].total}`);
    console.log(`   Matched to existing teams: ${mapResult.rows[0].matched}`);
    console.log(`   New teams needed: ${mapResult.rows[0].unmatched}`);
    console.log(`   Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

    // Step 3: Create new teams for unmatched names
    console.log("🔄 Step 2: Creating new teams for unmatched names...");
    const step2Start = Date.now();

    const newTeamsResult = await client.query(`
      INSERT INTO teams_v2 (
        display_name,
        canonical_name,
        birth_year,
        state,
        gender,
        elo_rating,
        matches_played,
        wins,
        losses,
        draws
      )
      SELECT DISTINCT
        staging_name,
        canonical,
        birth_year,
        'XX', -- Unknown state
        CASE
          WHEN staging_name ILIKE '%boys%' OR staging_name ~* '\\bB\\d' OR staging_name ~* '\\d+B\\b' THEN 'M'::gender_type
          WHEN staging_name ILIKE '%girls%' OR staging_name ~* '\\bG\\d' OR staging_name ~* '\\d+G\\b' THEN 'F'::gender_type
          ELSE NULL
        END,
        1500,
        0, 0, 0, 0
      FROM _staging_team_map
      WHERE matched_team_id IS NULL
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    console.log(`   Created ${newTeamsResult.rowCount || 0} new teams`);
    console.log(`   Time: ${((Date.now() - step2Start) / 1000).toFixed(1)}s\n`);

    // Step 4: Rebuild mapping - use DISTINCT ON to ensure exactly one team per staging_name
    console.log("🔄 Step 3: Building final team mappings (one team per name)...");
    const step3Start = Date.now();

    // Use DISTINCT ON to get exactly one team per staging_name (oldest team wins)
    await client.query(`
      DROP TABLE IF EXISTS _final_team_map;

      CREATE TEMP TABLE _final_team_map AS
      SELECT DISTINCT ON (sn.team_name)
        sn.team_name AS staging_name,
        t.id AS team_id
      FROM (
        SELECT DISTINCT home_team_name AS team_name FROM staging_games WHERE processed = false AND home_team_name IS NOT NULL
        UNION
        SELECT DISTINCT away_team_name AS team_name FROM staging_games WHERE processed = false AND away_team_name IS NOT NULL
      ) sn
      JOIN teams_v2 t ON t.display_name = sn.team_name
      ORDER BY sn.team_name, t.created_at ASC;

      -- Add index for faster joins
      CREATE INDEX idx_ftm_staging ON _final_team_map (staging_name);
    `);

    const finalMapResult = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(team_id) as matched
      FROM _final_team_map
    `);
    console.log(`   Final team mapping: ${finalMapResult.rows[0].matched}/${finalMapResult.rows[0].total}`);
    console.log(`   Time: ${((Date.now() - step3Start) / 1000).toFixed(1)}s\n`);

    // Step 5: Insert matches from staging to matches_v2 (in batches)
    console.log("🔄 Step 4: Inserting matches to matches_v2...");
    const step4Start = Date.now();

    // First, create a temp table with the matches to insert (deduped)
    await client.query(`
      DROP TABLE IF EXISTS _matches_to_insert;

      CREATE TEMP TABLE _matches_to_insert AS
      SELECT DISTINCT ON (sg.match_date::date, hm.team_id, am.team_id, sg.home_score, sg.away_score)
        sg.id as staging_id,
        sg.match_date::date as match_date,
        hm.team_id as home_team_id,
        am.team_id as away_team_id,
        sg.home_score,
        sg.away_score,
        sg.source_platform,
        sg.source_match_key
      FROM staging_games sg
      JOIN _final_team_map hm ON sg.home_team_name = hm.staging_name
      JOIN _final_team_map am ON sg.away_team_name = am.staging_name
      WHERE sg.processed = false
        AND sg.match_date IS NOT NULL
        AND sg.home_score IS NOT NULL
        AND sg.away_score IS NOT NULL
        AND hm.team_id != am.team_id;

      CREATE INDEX idx_mti_staging ON _matches_to_insert(staging_id);
    `);

    const matchCountResult = await client.query(`SELECT COUNT(*) as cnt FROM _matches_to_insert`);
    const totalMatches = parseInt(matchCountResult.rows[0].cnt);
    console.log(`   Matches to process: ${totalMatches.toLocaleString()}`);

    // Process in batches of 500
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    let batchNum = 0;

    while (true) {
      const offset = batchNum * BATCH_SIZE;

      const insertResult = await client.query(`
        INSERT INTO matches_v2 (
          match_date,
          home_team_id,
          away_team_id,
          home_score,
          away_score,
          source_platform,
          source_match_key
        )
        SELECT
          match_date,
          home_team_id,
          away_team_id,
          home_score,
          away_score,
          source_platform,
          source_match_key
        FROM _matches_to_insert
        ORDER BY staging_id
        LIMIT ${BATCH_SIZE}
        OFFSET ${offset}
        ON CONFLICT (match_date, home_team_id, away_team_id, home_score, away_score) DO NOTHING
        RETURNING id
      `);

      const inserted = insertResult.rowCount || 0;
      totalInserted += inserted;
      batchNum++;

      const processed = Math.min(offset + BATCH_SIZE, totalMatches);
      process.stdout.write(`\r   Processed ${processed.toLocaleString()}/${totalMatches.toLocaleString()} (inserted: ${totalInserted.toLocaleString()})`);

      if (offset + BATCH_SIZE >= totalMatches) break;
    }

    console.log(`\n   Total inserted: ${totalInserted.toLocaleString()} matches`);
    console.log(`   Time: ${((Date.now() - step4Start) / 1000).toFixed(1)}s\n`);

    // Step 6: Mark staging records as processed
    console.log("🔄 Step 5: Marking staging records as processed...");
    const step5Start = Date.now();

    const markResult = await client.query(`
      UPDATE staging_games
      SET processed = true, processed_at = NOW()
      WHERE processed = false
        AND id IN (
          SELECT sg.id
          FROM staging_games sg
          LEFT JOIN _final_team_map hm ON sg.home_team_name = hm.staging_name
          LEFT JOIN _final_team_map am ON sg.away_team_name = am.staging_name
          WHERE hm.team_id IS NOT NULL
            AND am.team_id IS NOT NULL
        )
    `);
    console.log(`   Marked ${markResult.rowCount || 0} records as processed`);
    console.log(`   Time: ${((Date.now() - step5Start) / 1000).toFixed(1)}s\n`);

    // Step 7: Refresh materialized views
    console.log("🔄 Step 6: Refreshing materialized views...");
    const step6Start = Date.now();

    await client.query(`SELECT refresh_app_views()`);
    console.log(`   Views refreshed`);
    console.log(`   Time: ${((Date.now() - step6Start) / 1000).toFixed(1)}s\n`);

    // Final summary
    const totalTime = (Date.now() - startTime) / 1000;
    console.log("=".repeat(60));
    console.log("✅ BATCH PROCESSING COMPLETE");
    console.log("=".repeat(60));
    console.log(`   Matches inserted: ${totalInserted}`);
    console.log(`   Records processed: ${markResult.rowCount || 0}`);
    console.log(`   New teams created: ${newTeamsResult.rowCount || 0}`);
    console.log(`   Total time: ${totalTime.toFixed(1)}s`);
    console.log(`   Rate: ${Math.round((markResult.rowCount || 0) / totalTime)} records/second`);

    // Check remaining
    const remainingResult = await client.query(`
      SELECT COUNT(*) as cnt FROM staging_games WHERE processed = false
    `);
    console.log(`   Remaining unprocessed: ${remainingResult.rows[0].cnt}`);

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Completed: ${new Date().toISOString()}`);
}

main();
