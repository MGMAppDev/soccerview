/**
 * Deep dive into all possible GotSport rank data sources
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function deepDive() {
  console.log('='.repeat(70));
  console.log('DEEP DIVE: Finding Historical GotSport Rank Data');
  console.log('='.repeat(70));

  // 1. List ALL tables in the database
  console.log('\n1. ALL TABLES IN DATABASE:');
  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log(tables.rows.map(r => r.table_name).join(', '));

  // 2. Check rank_history (V1 - might have historical data)
  console.log('\n2. CHECK V1 rank_history TABLE:');
  try {
    const v1History = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(national_rank) as with_national,
             MIN(snapshot_date) as earliest,
             MAX(snapshot_date) as latest
      FROM rank_history
    `);
    console.log('V1 rank_history:', v1History.rows[0]);
  } catch (e) {
    console.log('V1 rank_history does not exist or error:', e.message);
  }

  // 3. Check rank_history_deprecated
  console.log('\n3. CHECK rank_history_deprecated:');
  try {
    const deprecated = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(national_rank) as with_national,
             MIN(snapshot_date) as earliest,
             MAX(snapshot_date) as latest
      FROM rank_history_deprecated
    `);
    console.log('rank_history_deprecated:', deprecated.rows[0]);
  } catch (e) {
    console.log('rank_history_deprecated does not exist or error:', e.message);
  }

  // 4. Check team_elo_deprecated for historical ranks
  console.log('\n4. CHECK team_elo_deprecated:');
  try {
    const teamElo = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(national_rank) as with_national
      FROM team_elo_deprecated
      LIMIT 1
    `);
    console.log('team_elo_deprecated has national_rank column');

    // Get sample
    const sample = await pool.query(`
      SELECT team_name, national_rank, state_rank, elo_rating
      FROM team_elo_deprecated
      WHERE national_rank IS NOT NULL
      LIMIT 5
    `);
    console.log('Sample:', sample.rows);
  } catch (e) {
    console.log('team_elo_deprecated issue:', e.message);
  }

  // 5. Check if there's a gotsport_rankings table
  console.log('\n5. CHECK FOR gotsport_rankings OR SIMILAR:');
  const gsTables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND (table_name LIKE '%rank%' OR table_name LIKE '%gotsport%' OR table_name LIKE '%official%')
  `);
  console.log('Related tables:', gsTables.rows.map(r => r.table_name));

  // 6. Check rank_history_v2 more carefully - maybe data IS there
  console.log('\n6. DETAILED rank_history_v2 ANALYSIS:');
  const v2Analysis = await pool.query(`
    SELECT
      snapshot_date::text,
      COUNT(*) as total,
      COUNT(national_rank) as gs_national,
      COUNT(state_rank) as gs_state,
      COUNT(elo_rating) as has_elo
    FROM rank_history_v2
    GROUP BY snapshot_date
    ORDER BY snapshot_date
  `);
  console.log('ALL snapshot dates in rank_history_v2:');
  console.log('Date        | Total   | GS Nat | GS St  | ELO');
  console.log('-'.repeat(55));
  for (const row of v2Analysis.rows) {
    console.log(`${row.snapshot_date} | ${row.total.toString().padStart(7)} | ${row.gs_national.toString().padStart(6)} | ${row.gs_state.toString().padStart(6)} | ${row.has_elo.toString().padStart(6)}`);
  }

  // 7. Check staging_games for any rank data
  console.log('\n7. CHECK staging_games FOR RANK DATA:');
  try {
    const stagingCols = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'staging_games'
    `);
    console.log('staging_games columns:', stagingCols.rows.map(r => r.column_name).join(', '));
  } catch (e) {
    console.log('Error:', e.message);
  }

  // 8. Check if there's ANY table with historical rank snapshots
  console.log('\n8. SEARCH ALL COLUMNS FOR rank/national_rank:');
  const rankCols = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND (column_name LIKE '%national_rank%' OR column_name LIKE '%state_rank%')
    ORDER BY table_name
  `);
  console.log('Tables with rank columns:');
  for (const row of rankCols.rows) {
    console.log(`  ${row.table_name}.${row.column_name}`);
  }

  await pool.end();
}

deepDive().catch(err => {
  console.error('Error:', err.message);
  pool.end();
  process.exit(1);
});
