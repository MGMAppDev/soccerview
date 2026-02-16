require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // Check matches_v2 for MLS Next
    const { rows: matchesCount } = await pool.query(`
      SELECT 
        tournament_id, 
        league_id,
        COUNT(*) as match_count,
        COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) as active_count
      FROM matches_v2 
      WHERE source_match_key LIKE 'mlsnext%'
      GROUP BY tournament_id, league_id
    `);
    console.log('=== MLS Next Matches in matches_v2 ===');
    console.log(JSON.stringify(matchesCount, null, 2));

    // Get tournament name
    if (matchesCount.length > 0 && matchesCount[0].tournament_id) {
      const { rows: tournamentName } = await pool.query(
        `SELECT name FROM tournaments WHERE id = $1`,
        [matchesCount[0].tournament_id]
      );
      console.log('\nTournament:', tournamentName[0]?.name || 'N/A');
    }

    // Check unprocessed staging games
    const { rows: unprocessed } = await pool.query(
      `SELECT COUNT(*) FROM staging_games 
       WHERE source_platform = 'mlsnext' AND processed = false`
    );
    console.log('\nUnprocessed staging_games:', unprocessed[0].count);

    // Sample team names to check format
    const { rows: teamSample } = await pool.query(
      `SELECT DISTINCT home_team_name FROM staging_games 
       WHERE source_platform = 'mlsnext' 
       LIMIT 10`
    );
    console.log('\nSample Team Names:');
    teamSample.forEach(row => console.log('  -', row.home_team_name));

    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
