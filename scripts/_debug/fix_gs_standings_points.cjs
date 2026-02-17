/**
 * Fix GotSport standings points for 10-column layout leagues.
 *
 * Problem: Some GotSport events have 10 columns (no PTS column).
 * The scraper read PPG (e.g., "2.2") as PTS → parseInt("2.2") = 2.
 * Fix: points = 3 * wins + draws for affected rows.
 *
 * Detection: points < wins is impossible in 3-pts-for-win system.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Find affected rows: points < wins is impossible with 3-pts-for-win
  const { rows: affected } = await pool.query(`
    SELECT league_source_id, COUNT(*) as cnt,
           MIN(points) as min_pts, MAX(points) as max_pts,
           MIN(wins) as min_wins, MAX(wins) as max_wins
    FROM staging_standings
    WHERE league_source_id LIKE 'gotsport-%'
      AND wins > 0
      AND points < wins
    GROUP BY league_source_id
    ORDER BY cnt DESC
  `);

  if (affected.length === 0) {
    console.log('No affected rows found. All points values look correct.');
    await pool.end();
    return;
  }

  console.log(`Found ${affected.length} affected league(s):`);
  for (const row of affected) {
    console.log(`  ${row.league_source_id}: ${row.cnt} rows (pts: ${row.min_pts}-${row.max_pts}, wins: ${row.min_wins}-${row.max_wins})`);
  }

  // Also check for rows where points=0 but they have wins (another symptom)
  const { rows: zeroCheck } = await pool.query(`
    SELECT league_source_id, COUNT(*) as cnt
    FROM staging_standings
    WHERE league_source_id LIKE 'gotsport-%'
      AND wins > 0
      AND points = 0
    GROUP BY league_source_id
    ORDER BY cnt DESC
  `);

  if (zeroCheck.length > 0) {
    console.log(`\nAlso found ${zeroCheck.length} league(s) with points=0 but wins>0:`);
    for (const row of zeroCheck) {
      console.log(`  ${row.league_source_id}: ${row.cnt} rows`);
    }
  }

  // Fix: set points = 3 * wins + draws for all affected rows
  const affectedIds = affected.map(r => r.league_source_id);

  // Include zero-point leagues too
  for (const row of zeroCheck) {
    if (!affectedIds.includes(row.league_source_id)) {
      affectedIds.push(row.league_source_id);
    }
  }

  console.log(`\nFixing ${affectedIds.length} league(s)...`);

  const { rowCount } = await pool.query(`
    UPDATE staging_standings
    SET points = (3 * wins) + draws
    WHERE league_source_id = ANY($1)
      AND (points < wins OR (wins > 0 AND points = 0))
  `, [affectedIds]);

  console.log(`Updated ${rowCount} rows.`);

  // Verify fix
  const { rows: verify } = await pool.query(`
    SELECT league_source_id, team_name, wins, losses, draws, points
    FROM staging_standings
    WHERE league_source_id = ANY($1)
    ORDER BY league_source_id, position
    LIMIT 10
  `, [affectedIds]);

  console.log('\nSample after fix:');
  for (const row of verify) {
    const expected = 3 * row.wins + row.draws;
    const ok = row.points === expected ? 'OK' : 'WRONG';
    console.log(`  ${row.team_name}: ${row.wins}W-${row.losses}L-${row.draws}D → pts=${row.points} (expected ${expected}) ${ok}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
