/**
 * SOCCERVIEW DATABASE RESTRUCTURE - PHASE 2
 * Bulk Matches Migration Runner
 *
 * Runs the bulk SQL migration with triggers disabled for performance
 *
 * Usage:
 *   node scripts/migrations/013_run_bulk_migration.js
 */

import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Error: Missing DATABASE_URL environment variable");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
  statement_timeout: 600000, // 10 minutes
});

async function runMigration() {
  console.log("\n" + "=".repeat(60));
  console.log("SOCCERVIEW BULK MATCHES MIGRATION");
  console.log("=".repeat(60));
  console.log(`Time: ${new Date().toISOString()}\n`);

  const client = await pool.connect();

  // Authorize writes to protected tables
  await authorizePipelineWrite(client);

  try {
    // Get initial counts
    const initialMatches = await client.query("SELECT COUNT(*) FROM matches_v2");
    const initialSchedules = await client.query("SELECT COUNT(*) FROM schedules");
    console.log(`Initial matches_v2: ${initialMatches.rows[0].count}`);
    console.log(`Initial schedules: ${initialSchedules.rows[0].count}`);

    // Count source data
    const sourceMatches = await client.query(`
      SELECT COUNT(*) FROM match_results m
      WHERE m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
        AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
        AND m.match_date IS NOT NULL AND m.match_date < CURRENT_DATE
        AND m.home_team_id != m.away_team_id
        AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = m.home_team_id)
        AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = m.away_team_id)
    `);
    const sourceSchedules = await client.query(`
      SELECT COUNT(*) FROM match_results m
      WHERE m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
        AND m.match_date IS NOT NULL AND m.match_date >= CURRENT_DATE
        AND m.home_team_id != m.away_team_id
        AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = m.home_team_id)
        AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = m.away_team_id)
    `);
    console.log(`\nSource matches to migrate: ${sourceMatches.rows[0].count}`);
    console.log(`Source schedules to migrate: ${sourceSchedules.rows[0].count}`);

    // Note: Cannot disable system triggers on Supabase
    // Data is filtered to be valid, so triggers should pass
    console.log("\n--- STARTING MIGRATION ---");
    console.log("Note: Running with triggers enabled (data is pre-filtered)");

    // Step 2: Migrate past matches
    console.log("\n--- MIGRATING PAST MATCHES ---");
    const migrateMatchesSQL = `
      INSERT INTO matches_v2 (
        id, match_date, match_time, home_team_id, away_team_id,
        home_score, away_score, league_id, tournament_id,
        source_platform, source_match_key
      )
      SELECT
        m.id, m.match_date, m.match_time, m.home_team_id, m.away_team_id,
        m.home_score, m.away_score,
        l.id as league_id,
        t.id as tournament_id,
        m.source_platform, m.source_match_key
      FROM match_results m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      LEFT JOIN leagues l ON l.source_event_id = m.event_id
      LEFT JOIN tournaments t ON t.source_event_id = m.event_id AND l.id IS NULL
      WHERE m.home_score IS NOT NULL
        AND m.away_score IS NOT NULL
        AND m.match_date IS NOT NULL
        AND m.match_date < CURRENT_DATE
        AND m.home_team_id != m.away_team_id
        AND NOT EXISTS (SELECT 1 FROM matches_v2 mv WHERE mv.id = m.id)
      ON CONFLICT DO NOTHING
    `;
    const matchResult = await client.query(migrateMatchesSQL);
    console.log(`✅ Matches migrated: ${matchResult.rowCount}`);

    // Step 3: Migrate schedules (only those with league or tournament)
    console.log("\n--- MIGRATING SCHEDULES ---");
    const migrateSchedulesSQL = `
      INSERT INTO schedules (
        match_date, match_time, home_team_id, away_team_id,
        league_id, tournament_id, source_platform, source_match_key
      )
      SELECT
        m.match_date, m.match_time, m.home_team_id, m.away_team_id,
        l.id as league_id,
        t.id as tournament_id,
        m.source_platform, m.source_match_key
      FROM match_results m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      LEFT JOIN leagues l ON l.source_event_id = m.event_id
      LEFT JOIN tournaments t ON t.source_event_id = m.event_id AND l.id IS NULL
      WHERE m.match_date IS NOT NULL
        AND m.match_date >= CURRENT_DATE
        AND m.home_team_id != m.away_team_id
        AND (l.id IS NOT NULL OR t.id IS NOT NULL)  -- Must have event association
        AND NOT EXISTS (
          SELECT 1 FROM schedules s
          WHERE s.match_date = m.match_date
            AND s.home_team_id = m.home_team_id
            AND s.away_team_id = m.away_team_id
        )
      ON CONFLICT DO NOTHING
    `;
    const scheduleResult = await client.query(migrateSchedulesSQL);
    console.log(`✅ Schedules migrated: ${scheduleResult.rowCount}`);

    // Migration complete - triggers were never disabled

    // Final counts
    const finalMatches = await client.query("SELECT COUNT(*) FROM matches_v2");
    const finalSchedules = await client.query("SELECT COUNT(*) FROM schedules");

    console.log("\n" + "=".repeat(60));
    console.log("MIGRATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`Final matches_v2: ${finalMatches.rows[0].count}`);
    console.log(`Final schedules: ${finalSchedules.rows[0].count}`);

    // Calculate skipped
    const matchesSkipped = parseInt(sourceMatches.rows[0].count) - (parseInt(finalMatches.rows[0].count) - parseInt(initialMatches.rows[0].count));
    const schedulesSkipped = parseInt(sourceSchedules.rows[0].count) - (parseInt(finalSchedules.rows[0].count) - parseInt(initialSchedules.rows[0].count));
    console.log(`\nMatches skipped (already existed): ${matchesSkipped}`);
    console.log(`Schedules skipped (already existed): ${schedulesSkipped}`);

  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    console.error(error);
    throw error;
  } finally {
    client.release();
  }

  await pool.end();
}

runMigration().catch(e => {
  console.error("Fatal error:", e);
  pool.end();
  process.exit(1);
});
