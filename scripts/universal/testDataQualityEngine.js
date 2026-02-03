/**
 * Integration Test for Data Quality Engine
 *
 * Tests the full pipeline:
 * 1. Insert test records into staging_games
 * 2. Run the engine
 * 3. Verify records were processed
 * 4. Clean up test data
 */

import pg from 'pg';
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { authorizePipelineWrite } from './pipelineAuth.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test data
const TEST_RECORDS = [
  {
    home_team_name: 'Test FC 2015B Gold',
    away_team_name: 'Demo SC 2015B Blue',
    match_date: '2026-02-15',
    match_time: '14:00:00',
    home_score: 3,
    away_score: 1,
    event_name: 'Test Tournament 2026',
    event_id: 'test-event-001',
    source_platform: 'gotsport',
    source_match_key: `test-${Date.now()}-001`,
  },
  {
    home_team_name: 'Sample United 14G Premier',
    away_team_name: 'Example City 14G Elite',
    match_date: '2026-02-16',
    match_time: '10:00:00',
    home_score: null,
    away_score: null,
    event_name: 'Test Tournament 2026',
    event_id: 'test-event-001',
    source_platform: 'gotsport',
    source_match_key: `test-${Date.now()}-002`,
  },
  {
    home_team_name: 'KC Fusion KC Fusion 15B Gold (U11 Boys)', // Duplicate prefix test
    away_team_name: 'Sporting BV Pre-NAL 15',
    match_date: '2026-02-17',
    match_time: '15:30:00',
    home_score: 2,
    away_score: 2,
    event_name: 'Heartland Soccer League 2026', // Should resolve to canonical
    event_id: 'heartland-league-2026',
    source_platform: 'heartland',
    source_match_key: `test-${Date.now()}-003`,
  },
];

async function insertTestRecords(client) {
  console.log('\n📝 Inserting test records into staging_games...');

  const insertedIds = [];

  for (const record of TEST_RECORDS) {
    const { rows } = await client.query(`
      INSERT INTO staging_games (
        home_team_name, away_team_name, match_date, match_time,
        home_score, away_score, event_name, event_id,
        source_platform, source_match_key, processed, scraped_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, NOW())
      RETURNING id
    `, [
      record.home_team_name,
      record.away_team_name,
      record.match_date,
      record.match_time,
      record.home_score,
      record.away_score,
      record.event_name,
      record.event_id,
      record.source_platform,
      record.source_match_key,
    ]);

    insertedIds.push(rows[0].id);
    console.log(`   ✅ Inserted: ${record.home_team_name} vs ${record.away_team_name}`);
  }

  return insertedIds;
}

async function verifyProcessing(client, stagingIds) {
  console.log('\n🔍 Verifying processing...');

  // Check staging records
  const { rows: staging } = await client.query(`
    SELECT id, processed, error_message
    FROM staging_games
    WHERE id = ANY($1)
  `, [stagingIds]);

  let allProcessed = true;
  for (const record of staging) {
    const status = record.processed
      ? (record.error_message ? `❌ Failed: ${record.error_message}` : '✅ Processed')
      : '⏳ Not processed';
    console.log(`   Staging ${record.id}: ${status}`);
    if (!record.processed) allProcessed = false;
  }

  // Check if matches were created
  const matchKeys = TEST_RECORDS.map(r => r.source_match_key);
  const { rows: matches } = await client.query(`
    SELECT m.id, m.source_match_key, m.home_score, m.away_score,
           ht.display_name as home_team, at.display_name as away_team
    FROM matches_v2 m
    LEFT JOIN teams_v2 ht ON m.home_team_id = ht.id
    LEFT JOIN teams_v2 at ON m.away_team_id = at.id
    WHERE m.source_match_key = ANY($1)
  `, [matchKeys]);

  console.log(`\n   Matches created: ${matches.length}/${TEST_RECORDS.length}`);
  for (const match of matches) {
    console.log(`   ⚽ ${match.home_team} ${match.home_score}-${match.away_score} ${match.away_team}`);
  }

  return allProcessed && matches.length === TEST_RECORDS.length;
}

async function cleanup(client, stagingIds) {
  console.log('\n🧹 Cleaning up test data...');

  // Delete test matches
  const matchKeys = TEST_RECORDS.map(r => r.source_match_key);
  await client.query(`
    DELETE FROM matches_v2 WHERE source_match_key = ANY($1)
  `, [matchKeys]);
  console.log('   ✅ Deleted test matches');

  // Delete test teams (ones we created)
  await client.query(`
    DELETE FROM teams_v2 WHERE canonical_name LIKE 'test fc%' OR canonical_name LIKE 'demo sc%'
      OR canonical_name LIKE 'sample united%' OR canonical_name LIKE 'example city%'
  `);
  console.log('   ✅ Deleted test teams');

  // Delete staging records
  await client.query(`
    DELETE FROM staging_games WHERE id = ANY($1)
  `, [stagingIds]);
  console.log('   ✅ Deleted staging records');
}

async function runTest() {
  console.log('🧪 DATA QUALITY ENGINE INTEGRATION TEST');
  console.log('========================================\n');

  const client = await pool.connect();
  let stagingIds = [];

  // Authorize for cleanup operations (DELETE on teams_v2, matches_v2)
  await authorizePipelineWrite(client);

  try {
    // Step 1: Insert test records
    stagingIds = await insertTestRecords(client);

    // Step 2: Run the engine via subprocess
    console.log('\n🚀 Running Data Quality Engine...\n');

    const { execSync } = await import('child_process');
    const output = execSync(
      'node scripts/universal/dataQualityEngine.js --process-staging --limit 10',
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
      }
    );
    console.log(output);

    // Step 3: Verify processing
    const success = await verifyProcessing(client, stagingIds);

    // Step 4: Clean up
    await cleanup(client, stagingIds);

    console.log('\n' + '='.repeat(40));
    if (success) {
      console.log('✅ INTEGRATION TEST PASSED');
    } else {
      console.log('❌ INTEGRATION TEST FAILED');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test error:', error.message);

    // Cleanup on error
    if (stagingIds.length > 0) {
      try {
        await cleanup(client, stagingIds);
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError.message);
      }
    }

    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runTest();
