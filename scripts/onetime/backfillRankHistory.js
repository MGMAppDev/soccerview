/**
 * backfillRankHistory.js - Calculate historical rank positions from ELO history
 *
 * UNIVERSAL: Works for ANY team - calculates rank by comparing ELO to all teams
 * in the same age_group + gender + (state for state rank).
 *
 * This script:
 * 1. Gets all unique snapshot dates from rank_history_v2
 * 2. For each date, fetches all teams' ELO ratings
 * 3. Calculates national and state rank for each team
 * 4. Updates rank_history_v2 with elo_national_rank and elo_state_rank
 *
 * REQUIRES: Migration 050_add_elo_rank_history_columns.sql must be run first
 *
 * @version 1.0.0
 * @date January 2026
 */

import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function backfillRankHistory() {
  console.log("📊 Backfilling historical rank positions from ELO data...\n");

  const client = await pool.connect();

  try {
    // Get all unique snapshot dates that have ELO data
    console.log("1️⃣ Finding snapshot dates with ELO data...");
    const datesResult = await client.query(`
      SELECT DISTINCT snapshot_date
      FROM rank_history_v2
      WHERE elo_rating IS NOT NULL
      ORDER BY snapshot_date
    `);

    const dates = datesResult.rows.map(r => r.snapshot_date);
    console.log(`   Found ${dates.length} dates to process\n`);

    if (dates.length === 0) {
      console.log("❌ No ELO history found. Run captureRankSnapshot.js first.");
      return;
    }

    let totalUpdated = 0;

    // Process each date
    for (let i = 0; i < dates.length; i++) {
      const snapshotDate = dates[i];
      const dateStr = new Date(snapshotDate).toISOString().split('T')[0];

      // Progress update every 10 days or on first/last
      if (i === 0 || i === dates.length - 1 || i % 10 === 0) {
        console.log(`2️⃣ Processing ${dateStr} (${i + 1}/${dates.length})...`);
      }

      // Calculate national ranks for this date
      // Rank teams by ELO within each (age_group, gender) combination
      const nationalRankResult = await client.query(`
        WITH ranked AS (
          SELECT
            rh.team_id,
            rh.elo_rating,
            t.age_group,
            t.gender,
            ROW_NUMBER() OVER (
              PARTITION BY t.age_group, t.gender
              ORDER BY rh.elo_rating DESC
            ) as national_rank
          FROM rank_history_v2 rh
          JOIN teams_v2 t ON t.id = rh.team_id
          WHERE rh.snapshot_date = $1
            AND rh.elo_rating IS NOT NULL
            AND t.age_group IS NOT NULL
            AND t.gender IS NOT NULL
        )
        UPDATE rank_history_v2 rh
        SET elo_national_rank = ranked.national_rank
        FROM ranked
        WHERE rh.team_id = ranked.team_id
          AND rh.snapshot_date = $1
      `, [snapshotDate]);

      // Calculate state ranks for this date
      // Rank teams by ELO within each (age_group, gender, state) combination
      const stateRankResult = await client.query(`
        WITH ranked AS (
          SELECT
            rh.team_id,
            rh.elo_rating,
            t.age_group,
            t.gender,
            t.state,
            ROW_NUMBER() OVER (
              PARTITION BY t.age_group, t.gender, t.state
              ORDER BY rh.elo_rating DESC
            ) as state_rank
          FROM rank_history_v2 rh
          JOIN teams_v2 t ON t.id = rh.team_id
          WHERE rh.snapshot_date = $1
            AND rh.elo_rating IS NOT NULL
            AND t.age_group IS NOT NULL
            AND t.gender IS NOT NULL
            AND t.state IS NOT NULL
        )
        UPDATE rank_history_v2 rh
        SET elo_state_rank = ranked.state_rank
        FROM ranked
        WHERE rh.team_id = ranked.team_id
          AND rh.snapshot_date = $1
      `, [snapshotDate]);

      totalUpdated += nationalRankResult.rowCount || 0;
    }

    console.log(`\n✅ Backfill complete!`);
    console.log(`   📊 Total rank updates: ${totalUpdated.toLocaleString()}`);
    console.log(`   📅 Dates processed: ${dates.length}`);

    // Verify the data
    const verifyResult = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(elo_national_rank) as with_national,
        COUNT(elo_state_rank) as with_state
      FROM rank_history_v2
      WHERE elo_rating IS NOT NULL
    `);

    const v = verifyResult.rows[0];
    console.log(`\n📈 Verification:`);
    console.log(`   Total ELO records: ${parseInt(v.total).toLocaleString()}`);
    console.log(`   With national rank: ${parseInt(v.with_national).toLocaleString()}`);
    console.log(`   With state rank: ${parseInt(v.with_state).toLocaleString()}`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run
backfillRankHistory()
  .then(() => {
    console.log("\n🏁 Backfill job complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Fatal error:", err);
    process.exit(1);
  });
