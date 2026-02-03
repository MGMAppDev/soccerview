/**
 * backfillEloHistory.js - One-time backfill of historical ELO data
 *
 * PROBLEM: The Ranking Journey chart only shows daily snapshots, which means
 * new teams or teams in a newly deployed system have no historical data.
 *
 * SOLUTION: Replay ELO calculations chronologically and record ELO at each
 * match date. This gives instant historical data based on actual match performance.
 *
 * This script:
 * 1. Fetches all matches for the current season, ordered by date
 * 2. Replays ELO calculation match by match
 * 3. Records each team's ELO into rank_history_v2 at each match date
 * 4. Result: Rich historical data for charts showing ELO progression
 *
 * Usage: node scripts/onetime/backfillEloHistory.js [--dry-run]
 *
 * @version 1.0.0
 * @date January 2026
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes("--dry-run");

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

// ELO Configuration (must match recalculate_elo_v2.js)
const K_FACTOR = 32;
const STARTING_ELO = 1500;

/**
 * Calculate expected score based on ELO difference
 */
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate new ELO ratings after a match
 */
function calculateNewElo(homeElo, awayElo, homeScore, awayScore) {
  // Determine actual scores (1 = win, 0.5 = draw, 0 = loss)
  let homeActual, awayActual;
  if (homeScore > awayScore) {
    homeActual = 1;
    awayActual = 0;
  } else if (homeScore < awayScore) {
    homeActual = 0;
    awayActual = 1;
  } else {
    homeActual = 0.5;
    awayActual = 0.5;
  }

  const homeExpected = expectedScore(homeElo, awayElo);
  const awayExpected = expectedScore(awayElo, homeElo);

  const newHomeElo = Math.round(homeElo + K_FACTOR * (homeActual - homeExpected));
  const newAwayElo = Math.round(awayElo + K_FACTOR * (awayActual - awayExpected));

  return { newHomeElo, newAwayElo };
}

async function main() {
  console.log("=".repeat(60));
  console.log("📊 ELO HISTORY BACKFILL - Populate Ranking Journey Charts");
  console.log("=".repeat(60));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 1800000, // 30 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // Get current season
    const seasonResult = await client.query(`
      SELECT start_date::text as start_date, end_date::text as end_date, year
      FROM seasons WHERE is_current = true LIMIT 1
    `);

    if (seasonResult.rows.length === 0) {
      throw new Error("No current season found in database");
    }

    const season = seasonResult.rows[0];
    console.log(`📅 Season: ${season.year} (${season.start_date} to ${season.end_date})\n`);

    // Fetch all completed matches for the season, ordered chronologically
    console.log("📥 Fetching matches...");
    const matchesResult = await client.query(`
      SELECT
        id, match_date, home_team_id, away_team_id, home_score, away_score
      FROM matches_v2
      WHERE home_team_id IS NOT NULL
        AND away_team_id IS NOT NULL
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND match_date >= $1
        AND match_date <= CURRENT_DATE
      ORDER BY match_date ASC, id ASC
    `, [season.start_date]);

    const matches = matchesResult.rows;
    console.log(`   Found ${matches.length.toLocaleString()} completed matches\n`);

    if (matches.length === 0) {
      console.log("⚠️ No matches to process");
      return;
    }

    // Track ELO for each team
    const teamElo = new Map(); // team_id -> current ELO

    // Track ELO snapshots per date per team (to avoid duplicates)
    // Map<date_string, Map<team_id, elo>>
    const dailySnapshots = new Map();

    console.log("🔄 Processing matches chronologically...");
    let processedCount = 0;

    for (const match of matches) {
      const homeId = match.home_team_id;
      const awayId = match.away_team_id;
      const matchDate = match.match_date.toISOString().split('T')[0];

      // Get current ELO or start at 1500
      const homeElo = teamElo.get(homeId) || STARTING_ELO;
      const awayElo = teamElo.get(awayId) || STARTING_ELO;

      // Calculate new ELO
      const { newHomeElo, newAwayElo } = calculateNewElo(
        homeElo, awayElo, match.home_score, match.away_score
      );

      // Update team ELO
      teamElo.set(homeId, newHomeElo);
      teamElo.set(awayId, newAwayElo);

      // Record snapshot for this date (latest ELO for each team on each date)
      if (!dailySnapshots.has(matchDate)) {
        dailySnapshots.set(matchDate, new Map());
      }
      dailySnapshots.get(matchDate).set(homeId, newHomeElo);
      dailySnapshots.get(matchDate).set(awayId, newAwayElo);

      processedCount++;
      if (processedCount % 10000 === 0) {
        console.log(`   Processed ${processedCount.toLocaleString()} matches...`);
      }
    }

    console.log(`\n✅ Processed ${processedCount.toLocaleString()} matches`);
    console.log(`   Unique teams: ${teamElo.size.toLocaleString()}`);
    console.log(`   Unique dates: ${dailySnapshots.size.toLocaleString()}\n`);

    // Convert to insert records
    const records = [];
    for (const [snapshotDate, teamMap] of dailySnapshots) {
      for (const [teamId, eloRating] of teamMap) {
        records.push({
          team_id: teamId,
          snapshot_date: snapshotDate,
          elo_rating: eloRating,
        });
      }
    }

    console.log(`📤 Inserting ${records.length.toLocaleString()} ELO history records...`);

    if (DRY_RUN) {
      console.log("   [DRY RUN] Would insert records. Sample:");
      console.log(JSON.stringify(records.slice(0, 5), null, 2));
    } else {
      // Batch insert in chunks of 1000
      const BATCH_SIZE = 1000;
      let inserted = 0;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);

        // Build VALUES clause
        const values = [];
        const params = [];
        let paramIndex = 1;

        for (const rec of batch) {
          values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
          params.push(rec.team_id, rec.snapshot_date, rec.elo_rating);
          paramIndex += 3;
        }

        // Upsert - update ELO if record exists, insert if not
        const sql = `
          INSERT INTO rank_history_v2 (team_id, snapshot_date, elo_rating)
          VALUES ${values.join(', ')}
          ON CONFLICT (team_id, snapshot_date)
          DO UPDATE SET elo_rating = EXCLUDED.elo_rating
        `;

        await client.query(sql, params);
        inserted += batch.length;

        if (inserted % 10000 === 0 || inserted === records.length) {
          console.log(`   Inserted ${inserted.toLocaleString()} / ${records.length.toLocaleString()}`);
        }
      }

      console.log(`\n✅ Backfill complete!`);
      console.log(`   Records inserted/updated: ${records.length.toLocaleString()}`);
    }

    // Refresh the materialized view to pick up new data
    if (!DRY_RUN) {
      console.log("\n🔄 Refreshing app_team_profile view...");
      await client.query("REFRESH MATERIALIZED VIEW CONCURRENTLY app_team_profile");
      console.log("✅ View refreshed");
    }

    console.log("\n🏁 Done!");
    console.log("   Charts will now show ELO progression based on match history.");

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
