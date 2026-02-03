/**
 * SOCCERVIEW DATABASE RESTRUCTURE - PHASE 2
 * Matches Migration Script (Standalone)
 *
 * Migrates matches from old schema with better connection handling:
 * - match_results → matches_v2 (linked, past, with scores)
 * - match_results → schedules (future games)
 *
 * Usage:
 *   node scripts/migrations/011_migrate_matches.js
 *   node scripts/migrations/011_migrate_matches.js --schedules-only
 */

import "dotenv/config";
import pg from "pg";
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Error: Missing DATABASE_URL environment variable");
  process.exit(1);
}

// Create pool with connection timeout settings
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const args = process.argv.slice(2);
const schedulesOnly = args.includes("--schedules-only");

const BATCH_SIZE = 500; // Smaller batches for reliability

async function migrateMatchesBatch(client, offset, limit) {
  const batch = await client.query(
    `SELECT m.id, m.match_date, m.match_time, m.home_team_id, m.away_team_id,
            m.home_score, m.away_score, m.event_id, m.source_platform, m.source_match_key
     FROM match_results m
     WHERE m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
       AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
       AND m.match_date IS NOT NULL AND m.match_date < CURRENT_DATE
       AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = m.home_team_id)
       AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = m.away_team_id)
       AND NOT EXISTS (SELECT 1 FROM matches_v2 WHERE id = m.id)
     ORDER BY m.match_date DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  let migrated = 0;
  for (const match of batch.rows) {
    // Look up league or tournament
    let leagueId = null;
    let tournamentId = null;

    if (match.event_id) {
      const league = await client.query(
        `SELECT id FROM leagues WHERE source_event_id = $1 LIMIT 1`,
        [match.event_id]
      );
      if (league.rows.length > 0) {
        leagueId = league.rows[0].id;
      } else {
        const tournament = await client.query(
          `SELECT id FROM tournaments WHERE source_event_id = $1 LIMIT 1`,
          [match.event_id]
        );
        if (tournament.rows.length > 0) {
          tournamentId = tournament.rows[0].id;
        }
      }
    }

    try {
      await client.query(
        `INSERT INTO matches_v2 (
          id, match_date, match_time, home_team_id, away_team_id,
          home_score, away_score, league_id, tournament_id,
          source_platform, source_match_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT DO NOTHING`,
        [
          match.id,
          match.match_date,
          match.match_time,
          match.home_team_id,
          match.away_team_id,
          match.home_score,
          match.away_score,
          leagueId,
          tournamentId,
          match.source_platform,
          match.source_match_key,
        ]
      );
      migrated++;
    } catch (e) {
      // Skip errors
    }
  }

  return { processed: batch.rows.length, migrated };
}

async function migrateSchedulesBatch(client, offset, limit) {
  const batch = await client.query(
    `SELECT m.id, m.match_date, m.match_time, m.home_team_id, m.away_team_id,
            m.event_id, m.source_platform, m.source_match_key
     FROM match_results m
     WHERE m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
       AND m.match_date IS NOT NULL AND m.match_date >= CURRENT_DATE
       AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = m.home_team_id)
       AND EXISTS (SELECT 1 FROM teams_v2 WHERE id = m.away_team_id)
       AND NOT EXISTS (SELECT 1 FROM schedules WHERE match_date = m.match_date
                       AND home_team_id = m.home_team_id AND away_team_id = m.away_team_id)
     ORDER BY m.match_date ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  let migrated = 0;
  for (const game of batch.rows) {
    let leagueId = null;
    let tournamentId = null;

    if (game.event_id) {
      const league = await client.query(
        `SELECT id FROM leagues WHERE source_event_id = $1 LIMIT 1`,
        [game.event_id]
      );
      if (league.rows.length > 0) {
        leagueId = league.rows[0].id;
      } else {
        const tournament = await client.query(
          `SELECT id FROM tournaments WHERE source_event_id = $1 LIMIT 1`,
          [game.event_id]
        );
        if (tournament.rows.length > 0) {
          tournamentId = tournament.rows[0].id;
        }
      }
    }

    try {
      await client.query(
        `INSERT INTO schedules (
          match_date, match_time, home_team_id, away_team_id,
          league_id, tournament_id, source_platform, source_match_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING`,
        [
          game.match_date,
          game.match_time,
          game.home_team_id,
          game.away_team_id,
          leagueId,
          tournamentId,
          game.source_platform,
          game.source_match_key,
        ]
      );
      migrated++;
    } catch (e) {
      // Skip
    }
  }

  return { processed: batch.rows.length, migrated };
}

async function runMigration() {
  console.log("\n" + "=".repeat(60));
  console.log("SOCCERVIEW MATCHES MIGRATION");
  console.log("=".repeat(60));
  console.log(`Time: ${new Date().toISOString()}`);

  let totalMatchesMigrated = 0;
  let totalSchedulesMigrated = 0;

  // Get current counts and authorize writes
  let client = await pool.connect();
  await authorizePipelineWrite(client);
  try {
    const currentMatches = await client.query("SELECT COUNT(*) FROM matches_v2");
    const currentSchedules = await client.query("SELECT COUNT(*) FROM schedules");
    console.log(`\nCurrent matches_v2: ${currentMatches.rows[0].count}`);
    console.log(`Current schedules: ${currentSchedules.rows[0].count}`);
  } finally {
    client.release();
  }

  if (!schedulesOnly) {
    // Migrate past matches
    console.log("\n--- MIGRATING PAST MATCHES ---");

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      client = await pool.connect();
      await authorizePipelineWrite(client);
      try {
        const result = await migrateMatchesBatch(client, offset, BATCH_SIZE);
        totalMatchesMigrated += result.migrated;

        if (result.processed === 0) {
          hasMore = false;
        } else {
          offset += BATCH_SIZE;
          if (offset % 10000 === 0) {
            console.log(`  Progress: ${offset} processed, ${totalMatchesMigrated} migrated`);
          }
        }
      } catch (e) {
        console.error(`  Error at offset ${offset}: ${e.message}`);
        // Wait and retry
        await new Promise(r => setTimeout(r, 5000));
      } finally {
        client.release();
      }

      // Brief pause between batches to avoid overwhelming the connection
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n✅ Matches migrated: ${totalMatchesMigrated}`);
  }

  // Migrate future schedules
  console.log("\n--- MIGRATING FUTURE SCHEDULES ---");

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    client = await pool.connect();
    await authorizePipelineWrite(client);
    try {
      const result = await migrateSchedulesBatch(client, offset, BATCH_SIZE);
      totalSchedulesMigrated += result.migrated;

      if (result.processed === 0) {
        hasMore = false;
      } else {
        offset += BATCH_SIZE;
        if (offset % 5000 === 0) {
          console.log(`  Progress: ${offset} processed, ${totalSchedulesMigrated} migrated`);
        }
      }
    } catch (e) {
      console.error(`  Error at offset ${offset}: ${e.message}`);
      await new Promise(r => setTimeout(r, 5000));
    } finally {
      client.release();
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n✅ Schedules migrated: ${totalSchedulesMigrated}`);

  // Final counts
  client = await pool.connect();
  try {
    const finalMatches = await client.query("SELECT COUNT(*) FROM matches_v2");
    const finalSchedules = await client.query("SELECT COUNT(*) FROM schedules");
    console.log("\n" + "=".repeat(60));
    console.log("MIGRATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`Final matches_v2: ${finalMatches.rows[0].count}`);
    console.log(`Final schedules: ${finalSchedules.rows[0].count}`);
  } finally {
    client.release();
  }

  await pool.end();
}

runMigration().catch(e => {
  console.error("Migration failed:", e);
  pool.end();
  process.exit(1);
});
