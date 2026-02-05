/**
 * ELO Recalculation v2.1 - Uses matches_v2 table with team IDs
 *
 * IMPORTANT: Only uses CURRENT SEASON data to align with GotSport rankings.
 * GotSport resets rankings each season, so we must do the same for
 * meaningful comparison between Official Rankings and SoccerView Power Rating.
 *
 * Youth soccer season typically runs Aug 1 - Jul 31.
 *
 * Updated: January 28, 2026 (Session 53)
 * - Now reads season boundaries from `seasons` table (single source of truth)
 * - No more hardcoded dates - season rollover is one DB update
 *
 * Usage: node scripts/recalculate_elo_v2.js
 */

import "dotenv/config";
import pg from "pg";
import { authorizePipelineWrite } from "../universal/pipelineAuth.js";

// ============================================================
// SEASON CONFIGURATION - NOW DYNAMIC FROM DATABASE
// ============================================================

/**
 * Get current season boundaries from the seasons table
 * Fallback to calculated dates if table is empty
 *
 * @param {pg.Client} client - PostgreSQL client
 * @returns {Object} { start_date, end_date, year }
 */
async function getSeasonBoundaries(client) {
  try {
    const result = await client.query(`
      SELECT
        start_date::text as start_date,
        end_date::text as end_date,
        year
      FROM seasons
      WHERE is_current = true
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      return result.rows[0];
    }
  } catch (e) {
    console.warn('⚠️ Failed to query seasons table:', e.message);
  }

  // Fallback calculation if seasons table is empty
  const now = new Date();
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  console.log('⚠️ No current season in DB, using fallback calculation');

  return {
    start_date: `${startYear}-08-01`,
    end_date: `${startYear + 1}-07-31`,
    year: startYear + 1
  };
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(60));
  console.log("🔢 ELO RECALCULATION v2.1 - Dynamic Season from DB");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 1800000, // 30 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
    await authorizePipelineWrite(client);

    // Get current season from database (single source of truth)
    const season = await getSeasonBoundaries(client);
    const CURRENT_SEASON_START = season.start_date;

    console.log(`📅 Season: ${season.year} (${season.start_date} to ${season.end_date})`);
    console.log(`   Season start filter: matches from ${CURRENT_SEASON_START} onwards\n`);

    // Count eligible matches (CURRENT SEASON ONLY)
    const matchCount = await client.query(`
      SELECT COUNT(*) as cnt
      FROM matches_v2
      WHERE home_team_id IS NOT NULL
        AND away_team_id IS NOT NULL
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND match_date >= '${CURRENT_SEASON_START}'
        AND deleted_at IS NULL
    `);
    const totalMatches = parseInt(matchCount.rows[0].cnt);
    console.log(`📋 Eligible matches to process: ${totalMatches.toLocaleString()}`);
    console.log(`⏱️  Estimated time: ${Math.round(totalMatches / 5000)} - ${Math.round(totalMatches / 2000)} minutes\n`);

    // ============================================================
    // STEP 1: Reset ELO stats for all teams
    // ============================================================
    console.log("🔄 Step 1: Resetting team stats...");
    await client.query(`
      UPDATE teams_v2 SET
        elo_rating = 1500,
        matches_played = 0,
        wins = 0,
        losses = 0,
        draws = 0
    `);
    console.log("   ✅ All teams reset to 1500 ELO\n");

    // ============================================================
    // STEP 2: Get all match IDs in chronological order (CURRENT SEASON ONLY)
    // ============================================================
    console.log("🔢 Step 2: Fetching current season matches...");
    const allMatches = await client.query(`
      SELECT
        id,
        home_team_id,
        away_team_id,
        home_score,
        away_score,
        match_date
      FROM matches_v2
      WHERE home_team_id IS NOT NULL
        AND away_team_id IS NOT NULL
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND match_date >= '${CURRENT_SEASON_START}'
        AND deleted_at IS NULL
      ORDER BY match_date ASC NULLS LAST, id ASC
    `);
    console.log(`   ✅ Loaded ${allMatches.rows.length.toLocaleString()} matches\n`);

    // ============================================================
    // STEP 3: Process matches sequentially
    // ============================================================
    console.log("🔢 Step 3: Processing matches...\n");

    const K_FACTOR = 32;
    let processed = 0;
    const startTime = Date.now();

    // Robust date formatter - handles all variations
    const formatDateForSQL = (dateValue) => {
      if (!dateValue) return null;
      try {
        // If it's already a Date object or can be parsed as one
        const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
        if (isNaN(d.getTime())) return null; // Invalid date
        // Return YYYY-MM-DD format
        return d.toISOString().split('T')[0];
      } catch {
        return null;
      }
    };

    // Build in-memory ELO cache for speed
    const eloCache = new Map();
    const statsCache = new Map(); // {wins, losses, draws, matches_played, last_match_date}

    // Initialize cache from database
    const teams = await client.query(`SELECT id, elo_rating FROM teams_v2`);
    for (const team of teams.rows) {
      eloCache.set(team.id, 1500); // Reset to 1500
      statsCache.set(team.id, { wins: 0, losses: 0, draws: 0, matches_played: 0, last_match_date: null });
    }

    for (const match of allMatches.rows) {
      const homeId = match.home_team_id;
      const awayId = match.away_team_id;
      const homeScore = parseInt(match.home_score);
      const awayScore = parseInt(match.away_score);

      // Get current ELOs from cache
      let homeElo = eloCache.get(homeId) || 1500;
      let awayElo = eloCache.get(awayId) || 1500;

      // Calculate expected scores
      const expHome = 1.0 / (1.0 + Math.pow(10, (awayElo - homeElo) / 400.0));

      // Actual results
      let actHome, actAway;
      let homeWin = 0, homeLoss = 0, homeDraw = 0;
      let awayWin = 0, awayLoss = 0, awayDraw = 0;
      
      if (homeScore > awayScore) {
        actHome = 1.0; actAway = 0.0;
        homeWin = 1; awayLoss = 1;
      } else if (homeScore < awayScore) {
        actHome = 0.0; actAway = 1.0;
        homeLoss = 1; awayWin = 1;
      } else {
        actHome = 0.5; actAway = 0.5;
        homeDraw = 1; awayDraw = 1;
      }

      // Calculate new ELOs
      const newHomeElo = homeElo + K_FACTOR * (actHome - expHome);
      const newAwayElo = awayElo + K_FACTOR * (actAway - (1.0 - expHome));

      // Update cache
      eloCache.set(homeId, newHomeElo);
      eloCache.set(awayId, newAwayElo);

      // Update stats cache
      const homeStats = statsCache.get(homeId) || { wins: 0, losses: 0, draws: 0, matches_played: 0, last_match_date: null };
      homeStats.wins += homeWin;
      homeStats.losses += homeLoss;
      homeStats.draws += homeDraw;
      homeStats.matches_played += 1;
      homeStats.last_match_date = match.match_date || homeStats.last_match_date;
      statsCache.set(homeId, homeStats);

      const awayStats = statsCache.get(awayId) || { wins: 0, losses: 0, draws: 0, matches_played: 0, last_match_date: null };
      awayStats.wins += awayWin;
      awayStats.losses += awayLoss;
      awayStats.draws += awayDraw;
      awayStats.matches_played += 1;
      awayStats.last_match_date = match.match_date || awayStats.last_match_date;
      statsCache.set(awayId, awayStats);

      processed++;

      // Progress update every 10000 matches
      if (processed % 10000 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = (totalMatches - processed) / rate;
        const pct = ((processed / totalMatches) * 100).toFixed(1);
        process.stdout.write(`   Processed: ${processed.toLocaleString()}/${totalMatches.toLocaleString()} (${pct}%) | ETA: ${Math.round(remaining)}s\r`);
      }
    }

    console.log(`\n   ✅ Calculated ELO for ${processed.toLocaleString()} matches\n`);

    // ============================================================
    // STEP 4: Write results back to database in BATCHES
    // ============================================================
    console.log("💾 Step 4: Saving results to database (batched)...");
    
    // Collect all updates
    const updates = [];
    for (const [teamId, elo] of eloCache) {
      const stats = statsCache.get(teamId);
      if (stats && stats.matches_played > 0) {
        updates.push({ teamId, elo, ...stats });
      }
    }
    
    console.log(`   Teams to update: ${updates.length.toLocaleString()}`);
    
    // Batch update - 500 teams per query
    const BATCH_SIZE = 500;
    let saved = 0;
    
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      // Build bulk UPDATE query using CASE statements
      const ids = batch.map(u => `'${u.teamId}'`).join(',');

      let eloCase = 'CASE id ';
      let mpCase = 'CASE id ';
      let winsCase = 'CASE id ';
      let lossesCase = 'CASE id ';
      let drawsCase = 'CASE id ';

      for (const u of batch) {
        eloCase += `WHEN '${u.teamId}' THEN ${u.elo} `;
        mpCase += `WHEN '${u.teamId}' THEN ${u.matches_played} `;
        winsCase += `WHEN '${u.teamId}' THEN ${u.wins} `;
        lossesCase += `WHEN '${u.teamId}' THEN ${u.losses} `;
        drawsCase += `WHEN '${u.teamId}' THEN ${u.draws} `;
      }

      eloCase += 'END';
      mpCase += 'END';
      winsCase += 'END';
      lossesCase += 'END';
      drawsCase += 'END';
      
      await client.query(`
        UPDATE teams_v2 SET
          elo_rating = ${eloCase},
          matches_played = ${mpCase},
          wins = ${winsCase},
          losses = ${lossesCase},
          draws = ${drawsCase}
        WHERE id IN (${ids})
      `);
      
      saved += batch.length;
      process.stdout.write(`   Saved: ${saved.toLocaleString()}/${updates.length.toLocaleString()} teams\r`);
    }
    
    console.log(`\n   ✅ Saved ${saved.toLocaleString()} teams\n`);

    // ============================================================
    // STEP 5: Update ELO-based National & State Ranks
    // ============================================================
    console.log("🏆 Step 5: Calculating ELO-based ranks...");

    // National ranks by birth_year + gender
    await client.query(`
      WITH ranked AS (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY birth_year, gender
            ORDER BY elo_rating DESC NULLS LAST
          ) as nat_rank
        FROM teams_v2
        WHERE matches_played > 0
      )
      UPDATE teams_v2 t
      SET elo_national_rank = r.nat_rank
      FROM ranked r
      WHERE t.id = r.id
    `);
    console.log("   ✅ National ranks updated");

    // State ranks by state + birth_year + gender
    await client.query(`
      WITH ranked AS (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY state, birth_year, gender
            ORDER BY elo_rating DESC NULLS LAST
          ) as st_rank
        FROM teams_v2
        WHERE matches_played > 0 AND state IS NOT NULL
      )
      UPDATE teams_v2 t
      SET elo_state_rank = r.st_rank
      FROM ranked r
      WHERE t.id = r.id
    `);
    console.log("   ✅ State ranks updated\n");

    // ============================================================
    // STEP 6: Get final stats and top teams
    // ============================================================
    const afterStats = await client.query(`
      SELECT
        COUNT(*) as total_teams,
        ROUND(AVG(elo_rating)::numeric, 1) as avg_elo,
        ROUND(MIN(elo_rating)::numeric, 0) as min_elo,
        ROUND(MAX(elo_rating)::numeric, 0) as max_elo,
        COUNT(*) FILTER (WHERE matches_played > 0) as teams_with_matches
      FROM teams_v2
    `);

    console.log("=".repeat(60));
    console.log("📊 FINAL RESULTS:");
    console.log("=".repeat(60));
    console.log(`   Total teams: ${parseInt(afterStats.rows[0].total_teams).toLocaleString()}`);
    console.log(`   Teams with matches: ${parseInt(afterStats.rows[0].teams_with_matches).toLocaleString()}`);
    console.log(`   Matches processed: ${processed.toLocaleString()}`);
    console.log(`   Avg ELO: ${afterStats.rows[0].avg_elo}`);
    console.log(`   ELO Range: ${afterStats.rows[0].min_elo} - ${afterStats.rows[0].max_elo}`);
    console.log("");

    // Top 15 teams
    const topTeams = await client.query(`
      SELECT display_name as team_name, elo_rating, wins, losses, draws, matches_played
      FROM teams_v2
      WHERE matches_played >= 5
      ORDER BY elo_rating DESC
      LIMIT 15
    `);

    console.log("🏆 TOP 15 TEAMS (min 5 matches):");
    topTeams.rows.forEach((team, i) => {
      const record = `${team.wins}-${team.losses}-${team.draws}`;
      const name = team.team_name.substring(0, 42);
      console.log(`   ${(i+1).toString().padStart(2)}. ${name.padEnd(44)} ${Math.round(team.elo_rating)} ELO (${record})`);
    });

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Completed at: ${new Date().toISOString()}`);
}

main();
