/**
 * Check NULL score issue in staging_games
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  // Check matches_v2 column constraints
  const cols = await pool.query(`
    SELECT column_name, is_nullable, column_default, data_type
    FROM information_schema.columns
    WHERE table_name = 'matches_v2' AND column_name IN ('home_score', 'away_score')
  `);
  console.log('matches_v2 score columns:');
  console.table(cols.rows);

  // Check staging_games with NULL scores
  const nullScores = await pool.query(`
    SELECT COUNT(*) as null_scores
    FROM staging_games
    WHERE processed = false AND (home_score IS NULL OR away_score IS NULL)
  `);
  console.log('\nStaging games with NULL scores:', nullScores.rows[0].null_scores);

  // Sample of NULL score records
  const sample = await pool.query(`
    SELECT event_name, match_date, home_team_name, away_team_name, home_score, away_score
    FROM staging_games
    WHERE processed = false AND (home_score IS NULL OR away_score IS NULL)
    LIMIT 5
  `);
  console.log('\nSample records with NULL scores:');
  sample.rows.forEach(r => {
    console.log(`  ${r.match_date} | ${r.home_team_name?.substring(0,20)} vs ${r.away_team_name?.substring(0,20)} | ${r.home_score}-${r.away_score} | ${r.event_name?.substring(0,30)}`);
  });

  // Check if these are future matches
  const futureDates = await pool.query(`
    SELECT COUNT(*) as future_null_scores
    FROM staging_games
    WHERE processed = false
      AND (home_score IS NULL OR away_score IS NULL)
      AND match_date > CURRENT_DATE
  `);
  console.log('\nFuture matches with NULL scores:', futureDates.rows[0].future_null_scores);

  await pool.end();
}

check().catch(err => {
  console.error('Error:', err);
  pool.end();
});
