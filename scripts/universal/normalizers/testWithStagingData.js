/**
 * Test normalizers with real staging_games data
 * Performance target: <1 second per 1000 records
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { normalizeTeam, normalizeTeamsBulk } from './teamNormalizer.js';
import { normalizeEvent, normalizeEventsBulk } from './eventNormalizer.js';
import { normalizeMatch, normalizeMatchesBulk } from './matchNormalizer.js';
import { normalizeClub, normalizeClubsBulk } from './clubNormalizer.js';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('🧪 NORMALIZER INTEGRATION TEST');
  console.log('==============================\n');

  const client = await pool.connect();

  try {
    // Fetch sample of staging records
    console.log('Fetching 1000 staging_games records...');
    const { rows: games } = await client.query(`
      SELECT id, match_date, match_time, home_team_name, away_team_name,
             home_score, away_score, event_name, event_id, source_platform, source_match_key
      FROM staging_games
      WHERE processed = true
      ORDER BY RANDOM()
      LIMIT 1000
    `);

    console.log(`Fetched ${games.length} records\n`);

    if (games.length === 0) {
      console.log('No staging data available for testing');
      return;
    }

    // Test 1: Team Normalizer
    console.log('--- TEST 1: teamNormalizer ---');
    const teamInputs = games.flatMap(g => [
      { raw_name: g.home_team_name, source_platform: g.source_platform },
      { raw_name: g.away_team_name, source_platform: g.source_platform },
    ]).filter(t => t.raw_name);

    const teamStart = performance.now();
    const teamResults = normalizeTeamsBulk(teamInputs);
    const teamTime = performance.now() - teamStart;

    console.log(`  Processed: ${teamInputs.length} team names`);
    console.log(`  Time: ${teamTime.toFixed(2)}ms (${(teamTime / teamInputs.length * 1000).toFixed(2)}ms per 1000)`);
    console.log(`  Normalized: ${teamResults.filter(r => r.normalized).length}`);
    console.log(`  With birth_year: ${teamResults.filter(r => r.birth_year).length}`);
    console.log(`  With gender: ${teamResults.filter(r => r.gender).length}`);

    // Sample output
    console.log('  Sample:', JSON.stringify(teamResults[0], null, 2).substring(0, 200) + '...\n');

    // Test 2: Event Normalizer
    console.log('--- TEST 2: eventNormalizer ---');
    const eventInputs = [...new Set(games.map(g => JSON.stringify({
      raw_name: g.event_name,
      source_platform: g.source_platform,
      source_event_id: g.event_id,
    })))].map(s => JSON.parse(s)).filter(e => e.raw_name);

    const eventStart = performance.now();
    const eventResults = normalizeEventsBulk(eventInputs);
    const eventTime = performance.now() - eventStart;

    console.log(`  Processed: ${eventInputs.length} unique events`);
    console.log(`  Time: ${eventTime.toFixed(2)}ms`);
    console.log(`  Leagues: ${eventResults.filter(r => r.event_type === 'league').length}`);
    console.log(`  Tournaments: ${eventResults.filter(r => r.event_type === 'tournament').length}`);
    console.log(`  With year: ${eventResults.filter(r => r.year).length}`);
    console.log(`  Sample:`, eventResults[0]?.canonical_name || 'N/A', '\n');

    // Test 3: Match Normalizer
    console.log('--- TEST 3: matchNormalizer ---');
    const matchInputs = games.map(g => ({
      match_date: g.match_date,
      match_time: g.match_time,
      home_score: g.home_score,
      away_score: g.away_score,
      home_team_name: g.home_team_name,
      away_team_name: g.away_team_name,
      source_match_key: g.source_match_key,
      event_id: g.event_id,
      source_platform: g.source_platform,
    }));

    const matchStart = performance.now();
    const matchResults = normalizeMatchesBulk(matchInputs);
    const matchTime = performance.now() - matchStart;

    console.log(`  Processed: ${matchInputs.length} matches`);
    console.log(`  Time: ${matchTime.toFixed(2)}ms (${(matchTime / matchInputs.length * 1000).toFixed(2)}ms per 1000)`);
    console.log(`  Valid: ${matchResults.filter(r => r.is_valid).length}`);
    console.log(`  Invalid: ${matchResults.filter(r => !r.is_valid).length}`);
    console.log(`  Scheduled: ${matchResults.filter(r => r.is_scheduled).length}\n`);

    // Test 4: Club Normalizer
    console.log('--- TEST 4: clubNormalizer ---');
    const clubInputs = teamInputs.slice(0, 500).map(t => ({
      team_name: t.raw_name,
      state: 'XX',
    }));

    const clubStart = performance.now();
    const clubResults = normalizeClubsBulk(clubInputs);
    const clubTime = performance.now() - clubStart;

    console.log(`  Processed: ${clubInputs.length} team names`);
    console.log(`  Time: ${clubTime.toFixed(2)}ms`);
    console.log(`  Extracted clubs: ${clubResults.filter(r => r.club_name).length}`);

    // Unique clubs
    const uniqueClubs = [...new Set(clubResults.map(r => r.club_name).filter(Boolean))];
    console.log(`  Unique clubs: ${uniqueClubs.length}`);
    console.log(`  Sample clubs:`, uniqueClubs.slice(0, 5).join(', '), '\n');

    // Summary
    const totalTime = teamTime + eventTime + matchTime + clubTime;
    const totalRecords = teamInputs.length + eventInputs.length + matchInputs.length + clubInputs.length;

    console.log('='.repeat(50));
    console.log('📊 PERFORMANCE SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total records processed: ${totalRecords}`);
    console.log(`Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`Average: ${(totalTime / totalRecords * 1000).toFixed(2)}ms per 1000 records`);

    const target = 1000; // 1 second per 1000 records
    const actual = totalTime / totalRecords * 1000;
    if (actual < target) {
      console.log(`\n✅ PASSED: ${actual.toFixed(2)}ms < ${target}ms target`);
    } else {
      console.log(`\n❌ FAILED: ${actual.toFixed(2)}ms > ${target}ms target`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
