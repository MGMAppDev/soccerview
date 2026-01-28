/**
 * Diagnose Team Stats - Investigate matches/wins/losses data discrepancy
 *
 * Usage: node scripts/diagnoseTeamStats.js "Sporting Blue Valley"
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const searchTerm = process.argv[2] || "Sporting Blue Valley";

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(70));
  console.log("🔍 TEAM STATS DIAGNOSTIC");
  console.log("=".repeat(70));
  console.log(`Search term: "${searchTerm}"\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Find the team
    const teamResult = await client.query(`
      SELECT id, team_name, matches_played, wins, losses, draws,
             elo_rating, state, age_group, gender, source_name
      FROM teams
      WHERE team_name ILIKE $1
      ORDER BY matches_played DESC NULLS LAST
      LIMIT 5
    `, [`%${searchTerm}%`]);

    if (teamResult.rows.length === 0) {
      console.log("❌ No teams found matching that search term");
      return;
    }

    for (const team of teamResult.rows) {
      console.log("=".repeat(70));
      console.log(`📋 TEAM: ${team.team_name}`);
      console.log("=".repeat(70));
      console.log(`   ID: ${team.id}`);
      console.log(`   State: ${team.state} | Age: ${team.age_group} | Gender: ${team.gender}`);
      console.log(`   Source: ${team.source_name || 'NULL (legacy)'}`);
      console.log(`   ELO: ${team.elo_rating ? Math.round(team.elo_rating) : 'N/A'}`);
      console.log("");
      console.log("📊 STORED STATS (from teams table):");
      console.log(`   matches_played: ${team.matches_played}`);
      console.log(`   wins: ${team.wins}`);
      console.log(`   losses: ${team.losses}`);
      console.log(`   draws: ${team.draws}`);
      console.log(`   SUM (W+L+D): ${(team.wins || 0) + (team.losses || 0) + (team.draws || 0)}`);
      console.log("");

      // Get ALL linked matches
      const allMatches = await client.query(`
        SELECT id, match_date, home_team_name, away_team_name,
               home_score, away_score, status, event_name, source_platform,
               CASE WHEN home_team_id = $1 THEN 'home' ELSE 'away' END as team_side
        FROM match_results
        WHERE home_team_id = $1 OR away_team_id = $1
        ORDER BY match_date DESC NULLS LAST
      `, [team.id]);

      console.log(`🔢 ACTUAL LINKED MATCHES: ${allMatches.rows.length}`);

      // Categorize matches
      let withScores = 0;
      let withoutScores = 0;
      let currentSeason = 0;
      let currentSeasonWithScores = 0;
      let calculatedWins = 0, calculatedLosses = 0, calculatedDraws = 0;

      const seasonStart = new Date('2025-08-01');

      for (const m of allMatches.rows) {
        const hasScore = m.home_score !== null && m.away_score !== null;
        const matchDate = m.match_date ? new Date(m.match_date) : null;
        const isCurrentSeason = matchDate && matchDate >= seasonStart;

        if (hasScore) {
          withScores++;
          const teamScore = m.team_side === 'home' ? m.home_score : m.away_score;
          const oppScore = m.team_side === 'home' ? m.away_score : m.home_score;

          if (isCurrentSeason) {
            currentSeasonWithScores++;
            if (teamScore > oppScore) calculatedWins++;
            else if (teamScore < oppScore) calculatedLosses++;
            else calculatedDraws++;
          }
        } else {
          withoutScores++;
        }

        if (isCurrentSeason) currentSeason++;
      }

      console.log("");
      console.log("📅 MATCH BREAKDOWN:");
      console.log(`   Total linked: ${allMatches.rows.length}`);
      console.log(`   With scores: ${withScores}`);
      console.log(`   Without scores: ${withoutScores} ⚠️`);
      console.log(`   Current season (Aug 2025+): ${currentSeason}`);
      console.log(`   Current season WITH scores: ${currentSeasonWithScores}`);
      console.log("");
      console.log("📈 RECALCULATED (current season only, with scores):");
      console.log(`   Wins: ${calculatedWins}`);
      console.log(`   Losses: ${calculatedLosses}`);
      console.log(`   Draws: ${calculatedDraws}`);
      console.log(`   Total: ${calculatedWins + calculatedLosses + calculatedDraws}`);

      // Show discrepancy
      const storedTotal = (team.wins || 0) + (team.losses || 0) + (team.draws || 0);
      if (team.matches_played !== storedTotal) {
        console.log("");
        console.log("⚠️  DISCREPANCY DETECTED:");
        console.log(`   matches_played (${team.matches_played}) ≠ W+L+D (${storedTotal})`);
        console.log(`   Missing: ${team.matches_played - storedTotal} matches not counted in wins/losses`);
        console.log("");
        console.log("📝 ROOT CAUSE:");
        console.log("   - matches_played = ALL linked matches (from syncMatchCounts.js)");
        console.log("   - wins/losses = CURRENT SEASON matches WITH SCORES (from recalculate_elo_v2.js)");
      }

      // Show recent matches with score status
      console.log("");
      console.log("📋 RECENT 10 MATCHES (score status):");
      const recentMatches = allMatches.rows.slice(0, 10);
      for (const m of recentMatches) {
        const hasScore = m.home_score !== null && m.away_score !== null;
        const dateStr = m.match_date ? new Date(m.match_date).toLocaleDateString() : 'No date';
        const scoreStr = hasScore ? `${m.home_score}-${m.away_score}` : '❌ NO SCORE';
        const platform = m.source_platform || 'unknown';
        console.log(`   ${dateStr} | ${scoreStr} | ${platform} | ${m.event_name?.substring(0, 30) || 'No event'}`);
      }

      // Count by source platform
      const byPlatform = await client.query(`
        SELECT
          COALESCE(source_platform, 'NULL') as platform,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE home_score IS NOT NULL AND away_score IS NOT NULL) as with_scores
        FROM match_results
        WHERE home_team_id = $1 OR away_team_id = $1
        GROUP BY source_platform
        ORDER BY total DESC
      `, [team.id]);

      console.log("");
      console.log("📊 MATCHES BY SOURCE PLATFORM:");
      for (const p of byPlatform.rows) {
        const pct = p.total > 0 ? Math.round((p.with_scores / p.total) * 100) : 0;
        console.log(`   ${p.platform}: ${p.total} total, ${p.with_scores} with scores (${pct}%)`);
      }
    }

  } catch (err) {
    console.error("\n❌ Error:", err.message);
  } finally {
    await client.end();
  }
}

main();
