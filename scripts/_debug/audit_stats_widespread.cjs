/**
 * Check how widespread the stats discrepancy is
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function audit() {
  const client = await pool.connect();

  try {
    // Get season boundaries
    const seasonResult = await client.query(`
      SELECT start_date FROM seasons WHERE is_current = true
    `);
    const seasonStart = seasonResult.rows[0].start_date;

    console.log("Checking for stats discrepancies across all teams...\n");
    console.log("(This compares teams_v2.matches_played vs actual match count in matches_v2)\n");

    // Find teams where stored matches_played doesn't match actual count
    const discrepancies = await client.query(`
      WITH actual_stats AS (
        SELECT
          t.id,
          t.display_name,
          t.matches_played as stored_matches,
          t.wins as stored_wins,
          t.losses as stored_losses,
          t.draws as stored_draws,
          COUNT(m.id) as actual_matches,
          SUM(CASE
            WHEN (m.home_team_id = t.id AND m.home_score > m.away_score)
              OR (m.away_team_id = t.id AND m.away_score > m.home_score) THEN 1 ELSE 0 END) as actual_wins,
          SUM(CASE
            WHEN (m.home_team_id = t.id AND m.home_score < m.away_score)
              OR (m.away_team_id = t.id AND m.away_score < m.home_score) THEN 1 ELSE 0 END) as actual_losses,
          SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END) as actual_draws
        FROM teams_v2 t
        JOIN matches_v2 m ON (m.home_team_id = t.id OR m.away_team_id = t.id)
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND m.match_date >= $1
        GROUP BY t.id, t.display_name, t.matches_played, t.wins, t.losses, t.draws
      )
      SELECT *,
        actual_matches - stored_matches as match_diff,
        actual_wins - stored_wins as wins_diff,
        actual_losses - stored_losses as losses_diff,
        actual_draws - stored_draws as draws_diff
      FROM actual_stats
      WHERE actual_matches != stored_matches
        OR actual_wins != stored_wins
        OR actual_losses != stored_losses
        OR actual_draws != stored_draws
      ORDER BY ABS(actual_matches - stored_matches) DESC
      LIMIT 100
    `, [seasonStart]);

    console.log(`Found ${discrepancies.rows.length} teams with stats discrepancies:\n`);

    if (discrepancies.rows.length === 0) {
      console.log("✅ No discrepancies found! All team stats are accurate.");
      return;
    }

    // Summary stats
    let totalMatchDiff = 0;
    let totalWinDiff = 0;

    console.log("Team Name                                        | Stored     | Actual     | Diff");
    console.log("-".repeat(100));

    discrepancies.rows.slice(0, 30).forEach(d => {
      const name = d.display_name.substring(0, 45).padEnd(48);
      const stored = `${d.stored_matches}mp ${d.stored_wins}W-${d.stored_losses}L-${d.stored_draws}D`.padEnd(12);
      const actual = `${d.actual_matches}mp ${d.actual_wins}W-${d.actual_losses}L-${d.actual_draws}D`.padEnd(12);
      const diff = `${d.match_diff > 0 ? '+' : ''}${d.match_diff}mp, ${d.wins_diff > 0 ? '+' : ''}${d.wins_diff}W`;

      console.log(`${name} | ${stored} | ${actual} | ${diff}`);

      totalMatchDiff += Math.abs(parseInt(d.match_diff));
      totalWinDiff += Math.abs(parseInt(d.wins_diff));
    });

    console.log("\n" + "=".repeat(100));
    console.log(`TOTAL TEAMS WITH DISCREPANCY: ${discrepancies.rows.length}`);
    console.log(`Average match difference: ${(totalMatchDiff / Math.min(30, discrepancies.rows.length)).toFixed(1)}`);

    // Check when the last ELO run was
    console.log("\n\nChecking last ELO calculation date...");

    // Look at the most recently updated team's timestamps
    const recentUpdate = await client.query(`
      SELECT MAX(updated_at) as last_update
      FROM teams_v2
      WHERE matches_played > 0
    `);

    if (recentUpdate.rows[0].last_update) {
      console.log(`Last teams_v2 update: ${recentUpdate.rows[0].last_update}`);
    }

    // Check latest match date
    const latestMatch = await client.query(`
      SELECT MAX(match_date) as latest_match, COUNT(*) as total_matches
      FROM matches_v2
      WHERE home_score IS NOT NULL AND away_score IS NOT NULL
    `);

    console.log(`Latest match with scores: ${latestMatch.rows[0].latest_match}`);
    console.log(`Total scored matches: ${latestMatch.rows[0].total_matches}`);

    // Check matches added after a certain date
    const recentMatches = await client.query(`
      SELECT COUNT(*) as cnt
      FROM matches_v2
      WHERE home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND created_at > NOW() - INTERVAL '7 days'
    `);

    console.log(`Matches added in last 7 days: ${recentMatches.rows[0].cnt}`);

  } finally {
    client.release();
    await pool.end();
  }
}

audit().catch(console.error);
