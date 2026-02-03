/**
 * Fix Mislinked Matches
 * =====================
 *
 * Unlinks matches that are incorrectly linked to a team.
 * A match is mislinked if the team's name pattern doesn't appear
 * in the corresponding home_team_name or away_team_name.
 *
 * Usage: node scripts/fixMislinkedMatches.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL required");
  process.exit(1);
}

// Team to fix
const TEAM_ID = 'cc329f08-1f57-4a7b-923a-768b2138fa92';
const TEAM_NAME_PATTERNS = ['SPORTING BV', 'Sporting Blue Valley'];

async function main() {
  console.log('='.repeat(70));
  console.log('FIX MISLINKED MATCHES');
  console.log('='.repeat(70));
  console.log(`Team ID: ${TEAM_ID}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');

    // Build pattern match for SQL
    const patternSQL = TEAM_NAME_PATTERNS
      .map(p => `'%${p}%'`)
      .join(' AND home_team_name NOT ILIKE ');

    // Unlink HOME matches where team name doesn't match
    console.log('📋 Unlinking mislinked HOME matches...');
    const homeResult = await client.query(`
      UPDATE match_results
      SET home_team_id = NULL
      WHERE home_team_id = $1
        AND home_team_name NOT ILIKE '%SPORTING BV%'
        AND home_team_name NOT ILIKE '%Sporting Blue Valley%'
      RETURNING id, match_date, home_team_name, away_team_name
    `, [TEAM_ID]);

    console.log(`   Unlinked ${homeResult.rowCount} HOME matches`);
    homeResult.rows.forEach(m => {
      console.log(`   - ${m.match_date}: ${m.home_team_name} vs ${m.away_team_name}`);
    });

    // Unlink AWAY matches where team name doesn't match
    console.log('\n📋 Unlinking mislinked AWAY matches...');
    const awayResult = await client.query(`
      UPDATE match_results
      SET away_team_id = NULL
      WHERE away_team_id = $1
        AND away_team_name NOT ILIKE '%SPORTING BV%'
        AND away_team_name NOT ILIKE '%Sporting Blue Valley%'
      RETURNING id, match_date, home_team_name, away_team_name
    `, [TEAM_ID]);

    console.log(`   Unlinked ${awayResult.rowCount} AWAY matches`);
    awayResult.rows.forEach(m => {
      console.log(`   - ${m.match_date}: ${m.home_team_name} vs ${m.away_team_name}`);
    });

    // Verify final state
    console.log('\n' + '='.repeat(70));
    console.log('VERIFICATION');
    console.log('='.repeat(70));

    const finalCount = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM match_results WHERE home_team_id = $1) as home_count,
        (SELECT COUNT(*) FROM match_results WHERE away_team_id = $1) as away_count
    `, [TEAM_ID]);

    const counts = finalCount.rows[0];
    console.log(`\nMatches linked to team:`);
    console.log(`   HOME: ${counts.home_count}`);
    console.log(`   AWAY: ${counts.away_count}`);
    console.log(`   TOTAL: ${parseInt(counts.home_count) + parseInt(counts.away_count)}`);

    // Recalculate and update team stats
    console.log('\n📋 Recalculating team stats...');
    const matchStats = await client.query(`
      SELECT
        COUNT(*) as matches_played,
        COUNT(*) FILTER (
          WHERE (home_team_id = $1 AND home_score > away_score)
             OR (away_team_id = $1 AND away_score > home_score)
        ) as wins,
        COUNT(*) FILTER (
          WHERE (home_team_id = $1 AND home_score < away_score)
             OR (away_team_id = $1 AND away_score < home_score)
        ) as losses,
        COUNT(*) FILTER (
          WHERE home_score = away_score AND home_score IS NOT NULL
        ) as draws
      FROM match_results
      WHERE (home_team_id = $1 OR away_team_id = $1)
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
    `, [TEAM_ID]);

    const stats = matchStats.rows[0];
    console.log(`   Stats: ${stats.matches_played} matches, ${stats.wins}W-${stats.losses}L-${stats.draws}D`);

    // Update the team record
    await client.query(`
      UPDATE teams
      SET matches_played = $2,
          wins = $3,
          losses = $4,
          draws = $5
      WHERE id = $1
    `, [TEAM_ID, stats.matches_played, stats.wins, stats.losses, stats.draws]);

    console.log('   ✅ Team stats updated');

    console.log('\n✅ Fix completed successfully!');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
