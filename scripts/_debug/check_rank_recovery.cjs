require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  // Check 1: What snapshot dates exist in rank_history_v2?
  const dates = await pool.query(`
    SELECT snapshot_date, COUNT(*) as entries
    FROM rank_history_v2
    WHERE state_rank IS NOT NULL
    GROUP BY snapshot_date
    ORDER BY snapshot_date DESC
    LIMIT 5
  `);
  console.log('=== Recent rank_history_v2 snapshots ===');
  dates.rows.forEach(r => console.log('  ' + r.snapshot_date + ': ' + r.entries + ' entries with state_rank'));

  // Check 2: For KS U11 Boys specifically — what does rank_history show?
  const ksHist = await pool.query(`
    SELECT rh.snapshot_date, rh.state_rank, rh.national_rank, t.display_name
    FROM rank_history_v2 rh
    JOIN teams_v2 t ON t.id = rh.team_id
    WHERE t.state = 'KS' AND t.birth_year = 2015 AND t.gender = 'M'
      AND rh.state_rank IS NOT NULL
    ORDER BY rh.snapshot_date DESC, rh.state_rank ASC
    LIMIT 20
  `);
  console.log('\n=== KS U11 Boys rank_history (latest) ===');
  ksHist.rows.forEach(r => console.log('  ' + r.snapshot_date + ' state#' + r.state_rank + ' nat#' + r.national_rank + ' | ' + r.display_name));

  // Check 3: Do the DELETED (merged) teams still have rank_history entries?
  const orphanHist = await pool.query(`
    SELECT COUNT(*) as orphan_entries
    FROM rank_history_v2 rh
    WHERE NOT EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = rh.team_id)
  `);
  console.log('\n=== Orphaned rank_history entries (team deleted but history remains) ===');
  console.log('  Count: ' + orphanHist.rows[0].orphan_entries);

  // Check 4: If orphaned entries exist, find ones with state_rank
  if (parseInt(orphanHist.rows[0].orphan_entries) > 0) {
    const orphanSample = await pool.query(`
      SELECT rh.team_id, rh.state_rank, rh.national_rank, rh.snapshot_date
      FROM rank_history_v2 rh
      WHERE NOT EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = rh.team_id)
        AND rh.state_rank IS NOT NULL
        AND rh.snapshot_date = (SELECT MAX(snapshot_date) FROM rank_history_v2)
      ORDER BY rh.state_rank ASC
      LIMIT 20
    `);
    console.log('\n  Sample orphaned entries from latest snapshot:');
    orphanSample.rows.forEach(r => console.log('    state#' + r.state_rank + ' nat#' + r.national_rank + ' team=' + r.team_id));

    // Check: how many of these orphans have state_rank in the LATEST snapshot?
    const orphanStateCount = await pool.query(`
      SELECT COUNT(*) as cnt
      FROM rank_history_v2 rh
      WHERE NOT EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = rh.team_id)
        AND rh.state_rank IS NOT NULL
        AND rh.snapshot_date = (SELECT MAX(snapshot_date) FROM rank_history_v2)
    `);
    console.log('  Total orphaned entries with state_rank in latest snapshot: ' + orphanStateCount.rows[0].cnt);
  }

  // Check 5: Current KS U11 Boys gaps
  const ksNow = await pool.query(`
    SELECT state_rank, national_rank, display_name
    FROM teams_v2
    WHERE state = 'KS' AND birth_year = 2015 AND gender = 'M'
      AND national_rank IS NOT NULL
    ORDER BY state_rank ASC NULLS LAST
    LIMIT 15
  `);
  console.log('\n=== Current KS U11 Boys (live teams_v2) ===');
  ksNow.rows.forEach(r => console.log('  state#' + r.state_rank + ' nat#' + r.national_rank + ' | ' + r.display_name));

  // Check 6: System summary
  const totalRanked = await pool.query(`SELECT COUNT(*) FROM teams_v2 WHERE national_rank IS NOT NULL`);
  console.log('\n=== System summary ===');
  console.log('  Total teams with national_rank: ' + totalRanked.rows[0].count);

  // Check 7: What does the nightly workflow capture? Check captureRankSnapshot
  const latestSnapshot = await pool.query(`
    SELECT MAX(snapshot_date) as latest FROM rank_history_v2
  `);
  console.log('  Latest snapshot date: ' + latestSnapshot.rows[0].latest);

  await pool.end();
})();
