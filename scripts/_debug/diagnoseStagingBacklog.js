/**
 * Diagnose the staging_games backlog
 * Reports on unprocessed records: source, date range, event distribution
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function diagnoseBacklog() {
  console.log('=== STAGING_GAMES BACKLOG DIAGNOSIS ===\n');

  // 1. Total counts
  const totals = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE processed = false) as unprocessed,
      COUNT(*) FILTER (WHERE processed = true) as processed
    FROM staging_games
  `);
  console.log('Total records:', totals.rows[0].total);
  console.log('Unprocessed:', totals.rows[0].unprocessed);
  console.log('Processed:', totals.rows[0].processed);

  // 2. By source platform
  const bySrc = await pool.query(`
    SELECT source_platform, COUNT(*) as count
    FROM staging_games
    WHERE processed = false
    GROUP BY source_platform
    ORDER BY count DESC
  `);
  console.log('\nBy source platform:');
  bySrc.rows.forEach(r => console.log('  ', r.source_platform || 'NULL', ':', r.count));

  // 3. Date range
  const dates = await pool.query(`
    SELECT MIN(match_date::date) as earliest, MAX(match_date::date) as latest
    FROM staging_games
    WHERE processed = false AND match_date IS NOT NULL
  `);
  console.log('\nMatch date range:');
  console.log('  Earliest:', dates.rows[0].earliest);
  console.log('  Latest:', dates.rows[0].latest);

  // 4. Scraped at range (when were they scraped?)
  const scraped = await pool.query(`
    SELECT
      MIN(scraped_at)::date as earliest,
      MAX(scraped_at)::date as latest
    FROM staging_games
    WHERE processed = false
  `);
  console.log('\nScraped range:');
  console.log('  Earliest:', scraped.rows[0].earliest);
  console.log('  Latest:', scraped.rows[0].latest);

  // 5. By event name (top 10)
  const byEvent = await pool.query(`
    SELECT event_name, COUNT(*) as count
    FROM staging_games
    WHERE processed = false
    GROUP BY event_name
    ORDER BY count DESC
    LIMIT 15
  `);
  console.log('\nTop 15 events by match count:');
  byEvent.rows.forEach(r => {
    const name = r.event_name ? r.event_name.substring(0, 60) : 'NULL';
    console.log('  ', name.padEnd(62), ':', r.count);
  });

  // 6. Processed flag distribution
  const proc = await pool.query(`
    SELECT processed, COUNT(*) as count
    FROM staging_games
    GROUP BY processed
  `);
  console.log('\nProcessed flag distribution:');
  proc.rows.forEach(r => console.log('  ', r.processed ? 'true' : 'false', ':', r.count));

  // 7. Check for any error messages or validation issues
  const withErrors = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE raw_data->>'error' IS NOT NULL) as with_errors,
      COUNT(*) FILTER (WHERE raw_data->>'validation_error' IS NOT NULL) as with_validation_errors
    FROM staging_games
    WHERE processed = false
  `);
  console.log('\nRecords with errors:');
  console.log('  With error field:', withErrors.rows[0].with_errors);
  console.log('  With validation_error:', withErrors.rows[0].with_validation_errors);

  // 8. Sample of unprocessed records
  const sample = await pool.query(`
    SELECT
      id,
      source_platform,
      event_name,
      match_date,
      home_team_name,
      away_team_name,
      scraped_at::date as scraped
    FROM staging_games
    WHERE processed = false
    ORDER BY scraped_at DESC
    LIMIT 5
  `);
  console.log('\nSample of recent unprocessed records:');
  sample.rows.forEach((r, i) => {
    console.log(`  ${i+1}. [${r.source_platform}] ${r.event_name?.substring(0,40)} | ${r.home_team_name?.substring(0,20)} vs ${r.away_team_name?.substring(0,20)} | ${r.match_date} | scraped: ${r.scraped}`);
  });

  // 9. Check validationPipeline status
  console.log('\n=== VALIDATION PIPELINE ANALYSIS ===');

  // Check if there's a processed_at or similar tracking field
  const schema = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'staging_games'
    ORDER BY ordinal_position
  `);
  console.log('\nstaging_games columns:');
  schema.rows.forEach(r => console.log('  ', r.column_name, ':', r.data_type));

  await pool.end();
}

diagnoseBacklog().catch(err => {
  console.error('Error:', err);
  pool.end();
});
