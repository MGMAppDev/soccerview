#!/usr/bin/env node
/**
 * fastBulkProcess.js - Bulk process staging_games using direct SQL
 *
 * Optimized for speed: processes thousands per minute, not dozens.
 * Uses bulk INSERT/UPDATE with ON CONFLICT, no row-by-row loops.
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function bulkProcess() {
  const startTime = Date.now();
  console.log('=== FAST BULK PROCESSOR ===\n');

  // Step 1: Count unprocessed
  const { rows: [{ count: initial }] } = await pool.query(
    "SELECT COUNT(*) as count FROM staging_games WHERE processed = false OR processed IS NULL"
  );
  console.log('Unprocessed records:', initial);

  if (initial === '0') {
    console.log('Nothing to process!');
    await pool.end();
    return;
  }

  // Step 2: Create missing teams in BULK
  console.log('\n📦 Step 1: Creating missing teams (bulk INSERT)...');
  const teamStart = Date.now();

  // Extract unique team names from staging
  const { rowCount: teamsCreated } = await pool.query(`
    INSERT INTO teams_v2 (canonical_name, display_name, source_platform, birth_year, gender, state)
    SELECT DISTINCT
      sg.home_team_name,
      sg.home_team_name,
      sg.source_platform,
      -- Extract birth year from team name (e.g., "Team 2012" -> 2012)
      CASE
        WHEN sg.home_team_name ~ '20(0[5-9]|1[0-9]|2[0-5])'
        THEN (regexp_match(sg.home_team_name, '(20(?:0[5-9]|1[0-9]|2[0-5]))'))[1]::int
        ELSE NULL
      END,
      -- Extract gender (B/G or Boys/Girls)
      CASE
        WHEN sg.home_team_name ~* '\\b(girls?|G20|GU?\\d)' THEN 'F'::gender_type
        WHEN sg.home_team_name ~* '\\b(boys?|B20|BU?\\d)' THEN 'M'::gender_type
        ELSE NULL
      END,
      'unknown'  -- Default state
    FROM staging_games sg
    WHERE (sg.processed = false OR sg.processed IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM teams_v2 t
        WHERE t.canonical_name = sg.home_team_name
          AND t.source_platform = sg.source_platform
      )
    ON CONFLICT DO NOTHING
  `);

  const { rowCount: awayTeamsCreated } = await pool.query(`
    INSERT INTO teams_v2 (canonical_name, display_name, source_platform, birth_year, gender, state)
    SELECT DISTINCT
      sg.away_team_name,
      sg.away_team_name,
      sg.source_platform,
      CASE
        WHEN sg.away_team_name ~ '20(0[5-9]|1[0-9]|2[0-5])'
        THEN (regexp_match(sg.away_team_name, '(20(?:0[5-9]|1[0-9]|2[0-5]))'))[1]::int
        ELSE NULL
      END,
      CASE
        WHEN sg.away_team_name ~* '\\b(girls?|G20|GU?\\d)' THEN 'F'::gender_type
        WHEN sg.away_team_name ~* '\\b(boys?|B20|BU?\\d)' THEN 'M'::gender_type
        ELSE NULL
      END,
      'unknown'  -- Default state
    FROM staging_games sg
    WHERE (sg.processed = false OR sg.processed IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM teams_v2 t
        WHERE t.canonical_name = sg.away_team_name
          AND t.source_platform = sg.source_platform
      )
    ON CONFLICT DO NOTHING
  `);

  console.log(`   ✅ Created ${teamsCreated + awayTeamsCreated} new teams in ${Date.now() - teamStart}ms`);

  // Step 3: Insert matches in BULK
  console.log('\n📦 Step 2: Inserting matches (bulk INSERT)...');
  const matchStart = Date.now();

  const { rowCount: matchesInserted } = await pool.query(`
    INSERT INTO matches_v2 (
      match_date, match_time,
      home_team_id, away_team_id,
      home_score, away_score,
      source_match_key, source_platform
    )
    SELECT DISTINCT ON (sg.source_match_key)
      sg.match_date::date,
      sg.match_time,
      ht.id as home_team_id,
      at.id as away_team_id,
      COALESCE(sg.home_score, 0),  -- 0 for scheduled matches
      COALESCE(sg.away_score, 0),
      sg.source_match_key,
      sg.source_platform
    FROM staging_games sg
    JOIN teams_v2 ht ON ht.canonical_name = sg.home_team_name AND ht.source_platform = sg.source_platform
    JOIN teams_v2 at ON at.canonical_name = sg.away_team_name AND at.source_platform = sg.source_platform
    WHERE (sg.processed = false OR sg.processed IS NULL)
      AND sg.source_match_key IS NOT NULL
      AND sg.match_date IS NOT NULL  -- Exclude records with no date
      AND ht.id != at.id  -- Exclude same-team matches
    ORDER BY sg.source_match_key, sg.scraped_at DESC  -- Keep most recent if duplicates
    ON CONFLICT (source_match_key) DO UPDATE SET
      home_score = EXCLUDED.home_score,
      away_score = EXCLUDED.away_score
  `);

  console.log(`   ✅ Inserted/updated ${matchesInserted} matches in ${Date.now() - matchStart}ms`);

  // Step 4: Mark all as processed in BULK
  console.log('\n📦 Step 3: Marking staging as processed (bulk UPDATE)...');
  const markStart = Date.now();

  const { rowCount: marked } = await pool.query(`
    UPDATE staging_games
    SET processed = true, processed_at = NOW()
    WHERE (processed = false OR processed IS NULL)
  `);

  console.log(`   ✅ Marked ${marked} records as processed in ${Date.now() - markStart}ms`);

  // Final stats
  const { rows: [{ count: remaining }] } = await pool.query(
    "SELECT COUNT(*) as count FROM staging_games WHERE processed = false OR processed IS NULL"
  );
  const { rows: [{ count: totalMatches }] } = await pool.query(
    "SELECT COUNT(*) as count FROM matches_v2"
  );
  const { rows: [{ count: totalTeams }] } = await pool.query(
    "SELECT COUNT(*) as count FROM teams_v2"
  );

  console.log('\n=== RESULTS ===');
  console.log('Teams created:', teamsCreated + awayTeamsCreated);
  console.log('Matches inserted/updated:', matchesInserted);
  console.log('Staging marked processed:', marked);
  console.log('Remaining unprocessed:', remaining);
  console.log('Total matches_v2:', totalMatches);
  console.log('Total teams_v2:', totalTeams);
  console.log('\nTotal time:', Math.round((Date.now() - startTime) / 1000), 'seconds');

  await pool.end();
}

bulkProcess().catch(console.error);
