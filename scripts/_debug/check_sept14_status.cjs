/**
 * Check if the Sept 14 match has been processed
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const TEAM_ID = 'cc329f08-1f57-4a7b-923a-768b2138fa92';

async function run() {
  const client = await pool.connect();
  try {
    // Refresh views
    console.log('Refreshing views...');
    await client.query('REFRESH MATERIALIZED VIEW app_team_profile');
    await client.query('REFRESH MATERIALIZED VIEW app_league_standings');
    console.log('Done!\n');

    // Check the staging record
    const { rows: staging } = await client.query(`
      SELECT processed
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND match_date::text LIKE '2025-09-14%'
        AND home_team_name = 'Union KC Jr Elite B15'
        AND away_team_name ILIKE '%pre-nal%15%'
    `);

    console.log('Sept 14 staging record processed:', staging[0]?.processed);

    // Check matches_v2
    const { rows: matches } = await client.query(`
      SELECT COUNT(*) as count
      FROM matches_v2 m
      WHERE (m.home_team_id = $1 OR m.away_team_id = $1)
        AND m.league_id IS NOT NULL
    `, [TEAM_ID]);

    console.log('League matches in matches_v2:', matches[0].count);

    // Check app_team_profile
    const { rows: profile } = await client.query(`
      SELECT leagues
      FROM app_team_profile
      WHERE id = $1
    `, [TEAM_ID]);

    const leagues = profile[0]?.leagues || [];
    console.log('Leagues in profile:', leagues.map(l => `${l.name} (${l.match_count})`).join(', '));

    // Check app_league_standings
    const { rows: standings } = await client.query(`
      SELECT played, wins, draws, losses, points
      FROM app_league_standings
      WHERE team_id = $1
    `, [TEAM_ID]);

    if (standings.length > 0) {
      const s = standings[0];
      console.log(`League standings: ${s.played} played, ${s.wins}W-${s.draws}D-${s.losses}L, ${s.points} pts`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
