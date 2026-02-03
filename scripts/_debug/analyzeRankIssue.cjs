require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function analyze() {
  // Check team pool size at each snapshot date
  const poolSizes = await pool.query(`
    SELECT
      snapshot_date,
      COUNT(*) as total_teams,
      COUNT(*) FILTER (WHERE elo_rating IS NOT NULL) as with_elo
    FROM rank_history_v2 rh
    JOIN teams_v2 t ON rh.team_id = t.id
    WHERE t.birth_year = 2015 AND t.gender = 'M' AND t.matches_played > 0
    GROUP BY snapshot_date
    ORDER BY snapshot_date
  `);

  console.log('B2015 Boys pool size per snapshot date:');
  console.log('Date       | Teams in snapshot');
  console.log('-'.repeat(35));
  poolSizes.rows.forEach(r => {
    const date = new Date(r.snapshot_date).toISOString().split('T')[0];
    console.log(`${date} | ${r.total_teams}`);
  });

  // What should the rank be if we compare against CURRENT full pool?
  const currentPool = await pool.query(`
    SELECT COUNT(*) as count
    FROM teams_v2
    WHERE birth_year = 2015 AND gender = 'M' AND matches_played > 0
  `);
  console.log('\n\nCurrent B2015 Boys pool size:', currentPool.rows[0].count);

  // Get Sporting BV's ELO values and calculate what rank SHOULD be against full pool
  const sportingData = await pool.query(`
    SELECT
      rh.snapshot_date,
      rh.elo_rating,
      (
        SELECT COUNT(*) + 1
        FROM teams_v2 t2
        WHERE t2.birth_year = 2015
          AND t2.gender = 'M'
          AND t2.matches_played > 0
          AND t2.elo_rating > rh.elo_rating
      ) as should_be_rank
    FROM rank_history_v2 rh
    JOIN teams_v2 t ON rh.team_id = t.id
    WHERE rh.team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    ORDER BY rh.snapshot_date
  `);

  console.log('\nSporting BV: What rank SHOULD be (vs current full pool):');
  console.log('Date       | ELO  | Calculated Rank | Current Stored Rank');
  console.log('-'.repeat(60));

  // Get stored ranks
  const storedRanks = await pool.query(`
    SELECT snapshot_date, elo_national_rank
    FROM rank_history_v2
    WHERE team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    ORDER BY snapshot_date
  `);
  const storedMap = new Map(storedRanks.rows.map(r => [
    new Date(r.snapshot_date).toISOString().split('T')[0],
    r.elo_national_rank
  ]));

  sportingData.rows.forEach(r => {
    const date = new Date(r.snapshot_date).toISOString().split('T')[0];
    const stored = storedMap.get(date) || '-';
    console.log(`${date} | ${Number(r.elo_rating).toFixed(0)} | ${String(r.should_be_rank).padStart(5)} | ${String(stored).padStart(5)}`);
  });

  await pool.end();
}

analyze().catch(err => {
  console.error(err);
  pool.end();
});
