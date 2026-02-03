#!/usr/bin/env node
/**
 * investigateStagingBacklog.js - Diagnose unprocessed staging_games
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function investigate() {
  console.log('=== STAGING BACKLOG INVESTIGATION ===\n');

  // 1. Get column names
  console.log('=== STAGING_GAMES COLUMNS ===');
  const { rows: cols } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'staging_games' ORDER BY ordinal_position
  `);
  console.log(cols.map(c => c.column_name).join(', '));

  // 2. Overall counts
  const { rows: [counts] } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE processed = true) as processed,
      COUNT(*) FILTER (WHERE processed = false OR processed IS NULL) as unprocessed
    FROM staging_games
  `);
  console.log('\n=== COUNTS ===');
  console.log('Total:', counts.total);
  console.log('Processed:', counts.processed);
  console.log('Unprocessed:', counts.unprocessed);

  // 3. By source
  console.log('\n=== UNPROCESSED BY SOURCE ===');
  const { rows: bySource } = await pool.query(`
    SELECT source_platform, COUNT(*) as count
    FROM staging_games
    WHERE processed = false OR processed IS NULL
    GROUP BY source_platform ORDER BY count DESC
  `);
  bySource.forEach(r => console.log('  ' + (r.source_platform || 'NULL') + ':', r.count));

  // 4. By date
  console.log('\n=== UNPROCESSED BY MATCH DATE ===');
  const { rows: byDate } = await pool.query(`
    SELECT
      CASE
        WHEN match_date::date < '2025-08-01' THEN 'Before current season'
        WHEN match_date::date BETWEEN '2025-08-01' AND '2026-07-31' THEN 'Current season'
        WHEN match_date::date > '2026-07-31' THEN 'Future season'
        ELSE 'Invalid/NULL'
      END as period,
      COUNT(*) as count
    FROM staging_games
    WHERE processed = false OR processed IS NULL
    GROUP BY 1 ORDER BY 2 DESC
  `);
  byDate.forEach(r => console.log('  ' + r.period + ':', r.count));

  // 5. By scraped date
  console.log('\n=== UNPROCESSED BY SCRAPED DATE (recent) ===');
  const { rows: byCreated } = await pool.query(`
    SELECT DATE(scraped_at) as scraped_date, COUNT(*) as count
    FROM staging_games
    WHERE processed = false OR processed IS NULL
    GROUP BY 1 ORDER BY 1 DESC LIMIT 10
  `);
  byCreated.forEach(r => console.log('  ' + r.scraped_date?.toISOString().split('T')[0] + ':', r.count));

  // 6. Sample records
  console.log('\n=== SAMPLE UNPROCESSED (5 records) ===');
  const { rows: samples } = await pool.query(`
    SELECT id, source_platform, match_date, home_team_name, away_team_name, event_id, event_name, error_message
    FROM staging_games
    WHERE processed = false OR processed IS NULL
    ORDER BY scraped_at DESC LIMIT 5
  `);
  samples.forEach(r => {
    console.log('  Source:', r.source_platform);
    console.log('  Date:', r.match_date);
    console.log('  Home:', r.home_team_name?.substring(0, 50));
    console.log('  Away:', r.away_team_name?.substring(0, 50));
    console.log('  Event:', r.event_id, '-', r.event_name?.substring(0, 40));
    console.log('  Error:', r.error_message || '(none)');
    console.log('  ---');
  });

  // 7. Check if validation pipeline processed recently
  console.log('\n=== RECENT PROCESSING ACTIVITY ===');
  const { rows: recentProcessed } = await pool.query(`
    SELECT DATE(processed_at) as process_date, COUNT(*) as count
    FROM staging_games
    WHERE processed = true AND processed_at IS NOT NULL
    GROUP BY 1 ORDER BY 1 DESC LIMIT 5
  `);
  if (recentProcessed.length === 0) {
    console.log('  No processed_at timestamps found');
  } else {
    recentProcessed.forEach(r => console.log('  ' + r.process_date?.toISOString().split('T')[0] + ':', r.count, 'processed'));
  }

  // 8. Check for error messages
  console.log('\n=== ERROR MESSAGES (if any) ===');
  const { rows: errors } = await pool.query(`
    SELECT error_message, COUNT(*) as count
    FROM staging_games
    WHERE (processed = false OR processed IS NULL) AND error_message IS NOT NULL
    GROUP BY error_message ORDER BY count DESC LIMIT 10
  `);
  if (errors.length === 0) {
    console.log('  No error messages recorded');
  } else {
    errors.forEach(r => console.log('  ' + r.error_message?.substring(0, 60) + ':', r.count));
  }

  await pool.end();
}

investigate().catch(console.error);
