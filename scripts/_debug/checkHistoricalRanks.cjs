/**
 * Check historical rank data sources for backfill
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  console.log('='.repeat(70));
  console.log('CHECKING HISTORICAL RANK DATA SOURCES');
  console.log('='.repeat(70));

  // 1. Check rank_history_deprecated structure and data
  console.log('\n1. rank_history_deprecated STRUCTURE:');
  const deprecatedCols = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'rank_history_deprecated'
    ORDER BY ordinal_position
  `);
  console.log('Columns:', deprecatedCols.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));

  // Sample data
  console.log('\nSample data from rank_history_deprecated:');
  const deprecatedSample = await pool.query(`
    SELECT *
    FROM rank_history_deprecated
    LIMIT 3
  `);
  console.log(deprecatedSample.rows);

  // Date range
  const deprecatedRange = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT snapshot_date) as unique_dates,
      MIN(snapshot_date) as earliest,
      MAX(snapshot_date) as latest,
      COUNT(DISTINCT team_id) as unique_teams
    FROM rank_history_deprecated
  `);
  console.log('\nDate range:', deprecatedRange.rows[0]);

  // 2. Check team_ranks_daily
  console.log('\n2. team_ranks_daily STRUCTURE:');
  const dailyCols = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'team_ranks_daily'
    ORDER BY ordinal_position
  `);
  console.log('Columns:', dailyCols.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));

  // Sample and stats
  const dailyStats = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT rank_date) as unique_dates,
      MIN(rank_date) as earliest,
      MAX(rank_date) as latest
    FROM team_ranks_daily
  `);
  console.log('Stats:', dailyStats.rows[0]);

  if (parseInt(dailyStats.rows[0].total) > 0) {
    const dailySample = await pool.query(`
      SELECT * FROM team_ranks_daily LIMIT 3
    `);
    console.log('Sample:', dailySample.rows);
  }

  // 3. Check for test team in rank_history_deprecated
  console.log('\n3. TEST TEAM in rank_history_deprecated:');
  const testTeam = await pool.query(`
    SELECT snapshot_date::text, national_rank, state_rank
    FROM rank_history_deprecated
    WHERE team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    ORDER BY snapshot_date
  `);
  console.log('Sporting BV Pre-NAL 15 history in deprecated table:');
  for (const row of testTeam.rows) {
    console.log(`  ${row.snapshot_date}: National #${row.national_rank}, State #${row.state_rank}`);
  }

  // 4. Check teams_deprecated for historical data
  console.log('\n4. teams_deprecated CHECK:');
  try {
    const teamsDeprecated = await pool.query(`
      SELECT COUNT(*) as total, COUNT(national_rank) as with_rank
      FROM teams_deprecated
    `);
    console.log('teams_deprecated:', teamsDeprecated.rows[0]);
  } catch (e) {
    console.log('Error:', e.message);
  }

  await pool.end();
}

check().catch(err => {
  console.error('Error:', err.message);
  pool.end();
  process.exit(1);
});
