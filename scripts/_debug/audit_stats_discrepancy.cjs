/**
 * Audit Stats Discrepancy
 *
 * Investigates why Season Stats don't match Match History
 *
 * Root cause analysis:
 * 1. teams_v2.matches_played/wins/losses/draws - calculated by ELO script (current season, non-NULL scores)
 * 2. UI Match History - shows all matches with limit(50), no season filter
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function audit() {
  const client = await pool.connect();

  try {
    // Find the team from the screenshot
    const teamResult = await client.query(`
      SELECT id, display_name, matches_played, wins, losses, draws
      FROM teams_v2
      WHERE display_name ILIKE '%Sporting%BV%Pre-NAL%15%'
      OR display_name ILIKE '%Sporting Blue Valley%Pre-NAL%15%'
      LIMIT 5
    `);

    if (teamResult.rows.length === 0) {
      console.log("Team not found");
      return;
    }

    const team = teamResult.rows[0];
    console.log("=".repeat(70));
    console.log("TEAM:", team.display_name);
    console.log("Team ID:", team.id);
    console.log("=".repeat(70));

    console.log("\n📊 STORED STATS (teams_v2 - used by Season Stats):");
    console.log(`   matches_played: ${team.matches_played}`);
    console.log(`   wins: ${team.wins}`);
    console.log(`   losses: ${team.losses}`);
    console.log(`   draws: ${team.draws}`);
    console.log(`   W-L-D total: ${team.wins + team.losses + team.draws}`);

    // Get season boundaries
    const seasonResult = await client.query(`
      SELECT start_date, end_date FROM seasons WHERE is_current = true
    `);
    const season = seasonResult.rows[0];
    console.log(`\n📅 Current Season: ${season.start_date} to ${season.end_date}`);

    // Query 1: All matches (what UI fetches)
    const allMatches = await client.query(`
      SELECT
        id, match_date, home_score, away_score,
        home_team_id, away_team_id,
        league_id, tournament_id,
        CASE
          WHEN home_team_id = $1 AND home_score > away_score THEN 'W'
          WHEN away_team_id = $1 AND away_score > home_score THEN 'W'
          WHEN home_score = away_score THEN 'D'
          ELSE 'L'
        END as result
      FROM matches_v2
      WHERE home_team_id = $1 OR away_team_id = $1
      ORDER BY match_date DESC
      LIMIT 50
    `, [team.id]);

    console.log(`\n📋 ALL MATCHES (UI Query - limit 50): ${allMatches.rows.length} matches`);

    // Break down by type
    let hasScores = 0;
    let nullScores = 0;
    let inSeason = 0;
    let outOfSeason = 0;
    let wins = 0, losses = 0, draws = 0;

    allMatches.rows.forEach(m => {
      const hasScore = m.home_score !== null && m.away_score !== null;
      const matchDate = new Date(m.match_date);
      const seasonStart = new Date(season.start_date);
      const inCurrentSeason = matchDate >= seasonStart;

      if (hasScore) {
        hasScores++;
        if (m.result === 'W') wins++;
        else if (m.result === 'L') losses++;
        else draws++;
      } else {
        nullScores++;
      }

      if (inCurrentSeason) inSeason++;
      else outOfSeason++;
    });

    console.log(`   With scores: ${hasScores}`);
    console.log(`   NULL scores (scheduled): ${nullScores}`);
    console.log(`   In current season: ${inSeason}`);
    console.log(`   Before current season: ${outOfSeason}`);
    console.log(`\n   Calculated W-L-D from all scored matches: ${wins}-${losses}-${draws}`);

    // Query 2: Current season matches with scores (what ELO script uses)
    const eloMatches = await client.query(`
      SELECT
        id, match_date, home_score, away_score,
        home_team_id, away_team_id,
        CASE
          WHEN home_team_id = $1 AND home_score > away_score THEN 'W'
          WHEN away_team_id = $1 AND away_score > home_score THEN 'W'
          WHEN home_score = away_score THEN 'D'
          ELSE 'L'
        END as result
      FROM matches_v2
      WHERE (home_team_id = $1 OR away_team_id = $1)
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND match_date >= $2
      ORDER BY match_date ASC
    `, [team.id, season.start_date]);

    console.log(`\n📊 ELO-ELIGIBLE MATCHES (current season + non-NULL scores): ${eloMatches.rows.length} matches`);

    let eloWins = 0, eloLosses = 0, eloDraws = 0;
    eloMatches.rows.forEach(m => {
      if (m.result === 'W') eloWins++;
      else if (m.result === 'L') eloLosses++;
      else eloDraws++;
    });

    console.log(`   W-L-D: ${eloWins}-${eloLosses}-${eloDraws}`);
    console.log(`   Total: ${eloWins + eloLosses + eloDraws}`);

    console.log("\n" + "=".repeat(70));
    console.log("DIAGNOSIS:");
    console.log("=".repeat(70));

    if (team.matches_played !== eloMatches.rows.length) {
      console.log(`❌ teams_v2.matches_played (${team.matches_played}) != ELO-eligible (${eloMatches.rows.length})`);
      console.log("   -> ELO script may not have run recently or there's a bug");
    } else {
      console.log(`✅ teams_v2.matches_played (${team.matches_played}) == ELO-eligible (${eloMatches.rows.length})`);
    }

    if (team.wins !== eloWins || team.losses !== eloLosses || team.draws !== eloDraws) {
      console.log(`❌ Stored W-L-D (${team.wins}-${team.losses}-${team.draws}) != Calculated (${eloWins}-${eloLosses}-${eloDraws})`);
    } else {
      console.log(`✅ Stored W-L-D matches calculated W-L-D`);
    }

    if (allMatches.rows.length !== eloMatches.rows.length) {
      console.log(`\n⚠️  MISMATCH: UI shows ${allMatches.rows.length} matches, Season Stats based on ${eloMatches.rows.length} matches`);
      console.log(`   Difference: ${allMatches.rows.length - eloMatches.rows.length} matches`);
      console.log("\n   Causes:");
      if (outOfSeason > 0) console.log(`   - ${outOfSeason} matches from previous season`);
      if (nullScores > 0) console.log(`   - ${nullScores} scheduled matches (NULL scores)`);
    }

    // Show all matches with details
    console.log("\n" + "=".repeat(70));
    console.log("ALL MATCHES DETAIL:");
    console.log("=".repeat(70));

    const matchDetails = await client.query(`
      SELECT
        m.match_date,
        m.home_score, m.away_score,
        COALESCE(l.name, t.name, 'Unlinked') as event_name,
        CASE WHEN l.id IS NOT NULL THEN 'League' ELSE 'Tournament' END as event_type
      FROM matches_v2 m
      LEFT JOIN leagues l ON m.league_id = l.id
      LEFT JOIN tournaments t ON m.tournament_id = t.id
      WHERE m.home_team_id = $1 OR m.away_team_id = $1
      ORDER BY m.match_date DESC
      LIMIT 50
    `, [team.id]);

    console.log("\nDate        | Score | Event");
    console.log("-".repeat(70));

    matchDetails.rows.forEach(m => {
      const date = m.match_date ? new Date(m.match_date).toISOString().split('T')[0] : 'NULL';
      const score = m.home_score !== null ? `${m.home_score}-${m.away_score}` : 'NULL';
      const seasonStart = new Date(season.start_date);
      const matchDate = new Date(m.match_date);
      const inSeason = matchDate >= seasonStart ? '✓' : '✗';
      console.log(`${date} | ${score.padStart(5)} | ${inSeason} ${m.event_name.substring(0, 45)}`);
    });

    // Get event-level aggregation (what Match History shows)
    console.log("\n" + "=".repeat(70));
    console.log("EVENT AGGREGATION (how UI groups matches):");
    console.log("=".repeat(70));

    const eventAgg = await client.query(`
      SELECT
        COALESCE(m.league_id::text, m.tournament_id::text, 'unlinked') as event_id,
        COALESCE(l.name, t.name, 'Unlinked') as event_name,
        CASE WHEN m.league_id IS NOT NULL THEN 'league' ELSE 'tournament' END as event_type,
        COUNT(*) as match_count,
        SUM(CASE
          WHEN (m.home_team_id = $1 AND m.home_score > m.away_score)
            OR (m.away_team_id = $1 AND m.away_score > m.home_score)
          THEN 1 ELSE 0
        END) as wins,
        SUM(CASE
          WHEN (m.home_team_id = $1 AND m.home_score < m.away_score)
            OR (m.away_team_id = $1 AND m.away_score < m.home_score)
          THEN 1 ELSE 0
        END) as losses,
        SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END) as draws,
        MIN(m.match_date) as first_match,
        MAX(m.match_date) as last_match
      FROM matches_v2 m
      LEFT JOIN leagues l ON m.league_id = l.id
      LEFT JOIN tournaments t ON m.tournament_id = t.id
      WHERE m.home_team_id = $1 OR m.away_team_id = $1
      GROUP BY COALESCE(m.league_id::text, m.tournament_id::text, 'unlinked'),
               COALESCE(l.name, t.name, 'Unlinked'),
               CASE WHEN m.league_id IS NOT NULL THEN 'league' ELSE 'tournament' END
      ORDER BY last_match DESC
    `, [team.id]);

    let totalEventMatches = 0;
    let totalEventWins = 0;
    let totalEventLosses = 0;
    let totalEventDraws = 0;

    eventAgg.rows.forEach(e => {
      console.log(`\n${e.event_type.toUpperCase()}: ${e.event_name}`);
      console.log(`   Matches: ${e.match_count}, W-L-D: ${e.wins}-${e.losses}-${e.draws}`);
      console.log(`   Period: ${e.first_match?.toISOString().split('T')[0]} to ${e.last_match?.toISOString().split('T')[0]}`);

      totalEventMatches += parseInt(e.match_count);
      totalEventWins += parseInt(e.wins);
      totalEventLosses += parseInt(e.losses);
      totalEventDraws += parseInt(e.draws);
    });

    console.log("\n" + "-".repeat(70));
    console.log(`TOTAL from event aggregation: ${totalEventMatches} matches, ${totalEventWins}W-${totalEventLosses}L-${totalEventDraws}D`);
    console.log(`Season Stats shows: ${team.matches_played} matches, ${team.wins}W-${team.losses}L-${team.draws}D`);

  } finally {
    client.release();
    await pool.end();
  }
}

audit().catch(console.error);
