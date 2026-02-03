/**
 * Verify Stats Fix - Simulates the new app logic
 *
 * This script verifies that the new Season Stats query (direct from matches_v2)
 * produces results that match the Match History aggregation.
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function verify() {
  const client = await pool.connect();

  try {
    const teamId = 'cc329f08-1f57-4a7b-923a-768b2138fa92'; // Sporting BV Pre-NAL 15

    // Calculate season boundaries (same logic as app)
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const seasonStartYear = currentMonth < 7 ? currentDate.getFullYear() - 1 : currentDate.getFullYear();
    const seasonStart = `${seasonStartYear}-08-01`;

    console.log("=".repeat(70));
    console.log("VERIFYING UNIVERSAL STATS FIX");
    console.log("Team: Sporting BV Pre-NAL 15");
    console.log("Season Start:", seasonStart);
    console.log("=".repeat(70));

    // NEW FIX: Direct query to matches_v2 (what the app now does)
    const homeStats = await client.query(`
      SELECT home_score, away_score
      FROM matches_v2
      WHERE home_team_id = $1
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND match_date >= $2
    `, [teamId, seasonStart]);

    const awayStats = await client.query(`
      SELECT home_score, away_score
      FROM matches_v2
      WHERE away_team_id = $1
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND match_date >= $2
    `, [teamId, seasonStart]);

    let statsWins = 0, statsLosses = 0, statsDraws = 0;

    // Process home matches
    homeStats.rows.forEach(m => {
      if (m.home_score > m.away_score) statsWins++;
      else if (m.home_score < m.away_score) statsLosses++;
      else statsDraws++;
    });

    // Process away matches
    awayStats.rows.forEach(m => {
      if (m.away_score > m.home_score) statsWins++;
      else if (m.away_score < m.home_score) statsLosses++;
      else statsDraws++;
    });

    const totalMatches = homeStats.rows.length + awayStats.rows.length;

    console.log("\n📊 NEW SEASON STATS (from direct matches_v2 query):");
    console.log(`   Matches: ${totalMatches}`);
    console.log(`   Wins: ${statsWins}`);
    console.log(`   Losses: ${statsLosses}`);
    console.log(`   Draws: ${statsDraws}`);
    console.log(`   Record: ${statsWins}W-${statsLosses}L-${statsDraws}D`);

    // MATCH HISTORY: What the UI shows (grouped by event)
    const matchHistory = await client.query(`
      SELECT
        COALESCE(l.name, t.name, 'Unlinked') as event_name,
        COUNT(*) as match_count,
        SUM(CASE
          WHEN (m.home_team_id = $1 AND m.home_score > m.away_score)
            OR (m.away_team_id = $1 AND m.away_score > m.home_score) THEN 1 ELSE 0 END) as wins,
        SUM(CASE
          WHEN (m.home_team_id = $1 AND m.home_score < m.away_score)
            OR (m.away_team_id = $1 AND m.away_score < m.home_score) THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END) as draws
      FROM matches_v2 m
      LEFT JOIN leagues l ON m.league_id = l.id
      LEFT JOIN tournaments t ON m.tournament_id = t.id
      WHERE (m.home_team_id = $1 OR m.away_team_id = $1)
        AND m.home_score IS NOT NULL
        AND m.away_score IS NOT NULL
        AND m.match_date >= $2
      GROUP BY COALESCE(l.name, t.name, 'Unlinked')
      ORDER BY MAX(m.match_date) DESC
    `, [teamId, seasonStart]);

    let mhTotal = 0, mhWins = 0, mhLosses = 0, mhDraws = 0;

    console.log("\n📋 MATCH HISTORY (what UI displays):");
    matchHistory.rows.forEach(e => {
      console.log(`   ${e.event_name}: ${e.match_count} matches (${e.wins}W-${e.losses}L-${e.draws}D)`);
      mhTotal += parseInt(e.match_count);
      mhWins += parseInt(e.wins);
      mhLosses += parseInt(e.losses);
      mhDraws += parseInt(e.draws);
    });

    console.log(`   ---------`);
    console.log(`   TOTAL: ${mhTotal} matches (${mhWins}W-${mhLosses}L-${mhDraws}D)`);

    // OLD (STALE) VALUES
    const oldStats = await client.query(`
      SELECT matches_played, wins, losses, draws
      FROM teams_v2
      WHERE id = $1
    `, [teamId]);

    const old = oldStats.rows[0];

    console.log("\n⚠️  OLD STALE VALUES (from teams_v2):");
    console.log(`   Matches: ${old.matches_played}`);
    console.log(`   Record: ${old.wins}W-${old.losses}L-${old.draws}D`);

    // VERIFICATION
    console.log("\n" + "=".repeat(70));
    console.log("VERIFICATION:");
    console.log("=".repeat(70));

    if (totalMatches === mhTotal && statsWins === mhWins && statsLosses === mhLosses && statsDraws === mhDraws) {
      console.log("✅ SUCCESS: Season Stats now matches Match History!");
      console.log(`   Both show: ${totalMatches} matches, ${statsWins}W-${statsLosses}L-${statsDraws}D`);
    } else {
      console.log("❌ MISMATCH:");
      console.log(`   Season Stats: ${totalMatches} matches, ${statsWins}W-${statsLosses}L-${statsDraws}D`);
      console.log(`   Match History: ${mhTotal} matches, ${mhWins}W-${mhLosses}L-${mhDraws}D`);
    }

    if (totalMatches !== old.matches_played || statsWins !== old.wins) {
      console.log(`\n📈 IMPROVEMENT: Fixed ${totalMatches - old.matches_played} missing matches`);
      console.log(`   Old: ${old.matches_played} matches, ${old.wins}W-${old.losses}L-${old.draws}D (stale)`);
      console.log(`   New: ${totalMatches} matches, ${statsWins}W-${statsLosses}L-${statsDraws}D (real-time)`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

verify().catch(console.error);
