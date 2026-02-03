/**
 * SOCCERVIEW DATABASE RESTRUCTURE - PHASE 2
 * Data Migration Script
 *
 * Migrates data from old schema to new schema:
 * - teams → teams_v2 (with extracted birth_year, gender)
 * - match_results → matches_v2 (linked, past, with scores)
 * - match_results → schedules (future games)
 * - event_registry → leagues + tournaments
 *
 * Usage:
 *   node scripts/migrations/010_migrate_data.js
 *   node scripts/migrations/010_migrate_data.js --dry-run
 *   node scripts/migrations/010_migrate_data.js --step teams
 *   node scripts/migrations/010_migrate_data.js --step matches
 *   node scripts/migrations/010_migrate_data.js --step events
 *   node scripts/migrations/010_migrate_data.js --step views
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

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const stepIndex = args.indexOf("--step");
const singleStep = stepIndex !== -1 ? args[stepIndex + 1] : null;

// Batch size for processing
const BATCH_SIZE = 1000;

// ============================================================
// PARSING UTILITIES
// ============================================================

/**
 * Extract birth year from team name
 * Examples:
 *   "FC Blue 2015 Boys" → 2015
 *   "Academy (U11 Boys)" → null (no explicit year)
 */
function extractBirthYear(teamName) {
  if (!teamName) return null;

  // Look for 4-digit year pattern (2000-2020 range for youth soccer)
  const match = teamName.match(/\b(20[0-2][0-9])\b/);
  if (match) {
    const year = parseInt(match[1]);
    if (year >= 2000 && year <= 2025) {
      return year;
    }
  }

  // Try to infer from age group (U11 = born ~2015 for 2025-26 season)
  const ageMatch = teamName.match(/\bU-?(\d{1,2})\b/i);
  if (ageMatch) {
    const age = parseInt(ageMatch[1]);
    if (age >= 6 && age <= 19) {
      // Current season start year
      const seasonYear = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;
      return seasonYear - age;
    }
  }

  return null;
}

/**
 * Extract gender from team name
 * Returns 'M' for boys/male, 'F' for girls/female
 */
function extractGender(teamName) {
  if (!teamName) return null;

  const name = teamName.toLowerCase();

  // Check for explicit gender indicators
  if (/\b(girls?|female|women|womens|woman)\b/i.test(name) || /\(.*g.*\)/i.test(name) && !/\(.*b.*\)/i.test(name)) {
    return "F";
  }
  if (/\b(boys?|male|men|mens|man)\b/i.test(name) || /\(.*b.*\)/i.test(name) && !/\(.*g.*\)/i.test(name)) {
    return "M";
  }

  // Check for G or B suffix patterns
  if (/\d{4}\s*G\b/i.test(teamName) || /\bG\d{2,4}\b/i.test(teamName)) {
    return "F";
  }
  if (/\d{4}\s*B\b/i.test(teamName) || /\bB\d{2,4}\b/i.test(teamName)) {
    return "M";
  }

  return null;
}

/**
 * Extract club name from full team name
 * Examples:
 *   "Sporting Blue Valley Elite 2015 Boys" → "Sporting Blue Valley"
 *   "FC Dallas Academy 2014G" → "FC Dallas"
 */
function extractClubName(teamName) {
  if (!teamName) return null;

  // Remove common suffixes
  let name = teamName
    .replace(/\s*\(U\d+\s*(Boys?|Girls?)\)\s*$/i, "") // Remove (U11 Boys)
    .replace(/\s+\d{4}\s*(B|G|Boys?|Girls?)?\s*$/i, "") // Remove 2015 B
    .replace(/\s+(Elite|Academy|Premier|Select|Pre-?NAL|Development|Competitive)\s*$/i, "")
    .replace(/\s+(White|Blue|Red|Black|Gold|Silver|Gray|Navy|Green)\s*$/i, "")
    .replace(/\s+[A-Z]{1,3}\d*\s*$/i, "") // Remove team designators like "B1", "G2"
    .trim();

  // Take first 2-4 words as club name (heuristic)
  const words = name.split(/\s+/);
  if (words.length <= 4) {
    return name;
  }

  // For longer names, try to find natural break points
  const breakWords = ["FC", "SC", "United", "Soccer", "Club", "Academy"];
  for (let i = 2; i < Math.min(words.length, 5); i++) {
    if (breakWords.includes(words[i])) {
      return words.slice(0, i + 1).join(" ");
    }
  }

  return words.slice(0, 3).join(" ");
}

/**
 * Create canonical name from team name (for matching)
 */
function createCanonicalName(teamName) {
  if (!teamName) return null;

  return teamName
    .toLowerCase()
    .replace(/\s*\(.*\)\s*/g, "") // Remove parenthetical content
    .replace(/[^\w\s]/g, "") // Remove special chars
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();
}

// ============================================================
// MIGRATION FUNCTIONS
// ============================================================

async function getCurrentSeason(client) {
  // Check if we have a current season, if not create one
  let result = await client.query(`
    SELECT id FROM seasons WHERE is_current = TRUE LIMIT 1
  `);

  if (result.rows.length === 0) {
    // Create current season
    const now = new Date();
    const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    const endYear = startYear + 1;

    result = await client.query(
      `INSERT INTO seasons (name, start_date, end_date, is_current)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id`,
      [`${startYear}-${endYear.toString().slice(2)} Season`, `${startYear}-08-01`, `${endYear}-07-31`]
    );
  }

  return result.rows[0].id;
}

async function migrateTeams(client, isDryRun) {
  console.log("\n" + "=".repeat(60));
  console.log("MIGRATING TEAMS");
  console.log("=".repeat(60));

  // Get count
  const countResult = await client.query("SELECT COUNT(*) FROM teams");
  const totalTeams = parseInt(countResult.rows[0].count);
  console.log(`Total teams to migrate: ${totalTeams}`);

  if (isDryRun) {
    // Sample analysis
    const sample = await client.query(`
      SELECT team_name, state FROM teams LIMIT 20
    `);
    console.log("\n[DRY RUN] Sample extractions:");
    sample.rows.forEach((r) => {
      const birthYear = extractBirthYear(r.team_name);
      const gender = extractGender(r.team_name);
      const club = extractClubName(r.team_name);
      console.log(`  ${r.team_name?.substring(0, 50)}`);
      console.log(`    → birth_year: ${birthYear}, gender: ${gender}, club: ${club?.substring(0, 30)}`);
    });
    return { migrated: 0, skipped: 0, dryRun: true };
  }

  let migrated = 0;
  let skipped = 0;
  let offset = 0;

  // Create a map to track clubs we've created
  const clubMap = new Map();

  while (offset < totalTeams) {
    const batch = await client.query(
      `SELECT id, team_name, state, elo_rating, national_rank, state_rank,
              wins, losses, draws, matches_played, source_name
       FROM teams
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    for (const team of batch.rows) {
      const birthYear = extractBirthYear(team.team_name);
      const gender = extractGender(team.team_name);
      const state = team.state || "XX";

      // Skip if we can't determine birth year (required field)
      if (!birthYear) {
        skipped++;
        continue;
      }

      // Skip if we can't determine gender (required field)
      if (!gender) {
        skipped++;
        continue;
      }

      // Get or create club
      const clubName = extractClubName(team.team_name);
      const clubKey = `${clubName}-${state}`;
      let clubId = clubMap.get(clubKey);

      if (!clubId && clubName) {
        // Try to find existing club
        const existing = await client.query(
          `SELECT id FROM clubs WHERE name = $1 AND state = $2`,
          [clubName, state]
        );

        if (existing.rows.length > 0) {
          clubId = existing.rows[0].id;
        } else {
          // Create new club
          const newClub = await client.query(
            `INSERT INTO clubs (name, state) VALUES ($1, $2)
             ON CONFLICT (name, state) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [clubName, state]
          );
          clubId = newClub.rows[0].id;
        }
        clubMap.set(clubKey, clubId);
      }

      // Insert into teams_v2
      try {
        await client.query(
          `INSERT INTO teams_v2 (
            id, club_id, canonical_name, display_name, birth_year, gender, state,
            elo_rating, national_rank, state_rank, wins, losses, draws, matches_played,
            source_platform
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (canonical_name, birth_year, gender, state) DO NOTHING`,
          [
            team.id,
            clubId,
            createCanonicalName(team.team_name) || team.team_name,
            team.team_name,
            birthYear,
            gender,
            state,
            team.elo_rating || 1500,
            team.national_rank,
            team.state_rank,
            team.wins || 0,
            team.losses || 0,
            team.draws || 0,
            team.matches_played || 0,
            team.source_name,
          ]
        );
        migrated++;
      } catch (e) {
        // Duplicate or constraint violation - skip
        skipped++;
      }
    }

    offset += BATCH_SIZE;
    if (offset % 10000 === 0 || offset >= totalTeams) {
      console.log(`  Progress: ${Math.min(offset, totalTeams)}/${totalTeams} (${migrated} migrated, ${skipped} skipped)`);
    }
  }

  console.log(`\n✅ Teams migration complete: ${migrated} migrated, ${skipped} skipped`);
  console.log(`   Clubs created: ${clubMap.size}`);

  return { migrated, skipped, clubs: clubMap.size };
}

async function migrateMatches(client, isDryRun) {
  console.log("\n" + "=".repeat(60));
  console.log("MIGRATING MATCHES");
  console.log("=".repeat(60));

  // Get counts
  const countResult = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
                       AND home_score IS NOT NULL AND away_score IS NOT NULL
                       AND match_date < CURRENT_DATE) as past_with_scores,
      COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
                       AND match_date >= CURRENT_DATE) as future_games
    FROM match_results
  `);
  const pastMatches = parseInt(countResult.rows[0].past_with_scores);
  const futureGames = parseInt(countResult.rows[0].future_games);

  console.log(`Past matches with scores (→ matches_v2): ${pastMatches}`);
  console.log(`Future games (→ schedules): ${futureGames}`);

  if (isDryRun) {
    console.log("\n[DRY RUN] Would migrate the above counts");
    return { matches: 0, schedules: 0, dryRun: true };
  }

  let matchesMigrated = 0;
  let schedulesMigrated = 0;
  let offset = 0;

  // First, get the current season
  const seasonId = await getCurrentSeason(client);

  // Migrate past matches with scores
  console.log("\nMigrating past matches...");
  while (true) {
    const batch = await client.query(
      `SELECT id, match_date, match_time, home_team_id, away_team_id,
              home_score, away_score, event_id, source_platform, source_match_key
       FROM match_results
       WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
         AND home_score IS NOT NULL AND away_score IS NOT NULL
         AND match_date IS NOT NULL AND match_date < CURRENT_DATE
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    if (batch.rows.length === 0) break;

    for (const match of batch.rows) {
      // Check if both teams exist in teams_v2
      const teamsExist = await client.query(
        `SELECT COUNT(*) FROM teams_v2 WHERE id IN ($1, $2)`,
        [match.home_team_id, match.away_team_id]
      );

      if (parseInt(teamsExist.rows[0].count) !== 2) {
        continue; // Skip if teams don't exist in new schema
      }

      // Look up league or tournament
      let leagueId = null;
      let tournamentId = null;

      if (match.event_id) {
        // Check leagues first
        const league = await client.query(
          `SELECT id FROM leagues WHERE source_event_id = $1`,
          [match.event_id]
        );
        if (league.rows.length > 0) {
          leagueId = league.rows[0].id;
        } else {
          // Check tournaments
          const tournament = await client.query(
            `SELECT id FROM tournaments WHERE source_event_id = $1`,
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
          ON CONFLICT (match_date, home_team_id, away_team_id, home_score, away_score) DO NOTHING`,
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
        matchesMigrated++;
      } catch (e) {
        // Skip duplicates
      }
    }

    offset += BATCH_SIZE;
    if (offset % 50000 === 0) {
      console.log(`  Matches progress: ${offset}...`);
    }
  }

  console.log(`  Matches migrated: ${matchesMigrated}`);

  // Migrate future games to schedules
  console.log("\nMigrating future games to schedules...");
  offset = 0;

  while (true) {
    const batch = await client.query(
      `SELECT id, match_date, match_time, home_team_id, away_team_id,
              event_id, source_platform, source_match_key
       FROM match_results
       WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
         AND match_date IS NOT NULL AND match_date >= CURRENT_DATE
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    if (batch.rows.length === 0) break;

    for (const game of batch.rows) {
      // Check if both teams exist in teams_v2
      const teamsExist = await client.query(
        `SELECT COUNT(*) FROM teams_v2 WHERE id IN ($1, $2)`,
        [game.home_team_id, game.away_team_id]
      );

      if (parseInt(teamsExist.rows[0].count) !== 2) {
        continue;
      }

      // Look up league or tournament
      let leagueId = null;
      let tournamentId = null;

      if (game.event_id) {
        const league = await client.query(
          `SELECT id FROM leagues WHERE source_event_id = $1`,
          [game.event_id]
        );
        if (league.rows.length > 0) {
          leagueId = league.rows[0].id;
        } else {
          const tournament = await client.query(
            `SELECT id FROM tournaments WHERE source_event_id = $1`,
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
          ON CONFLICT (match_date, home_team_id, away_team_id) DO NOTHING`,
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
        schedulesMigrated++;
      } catch (e) {
        // Skip
      }
    }

    offset += BATCH_SIZE;
  }

  console.log(`  Schedules migrated: ${schedulesMigrated}`);
  console.log(`\n✅ Matches migration complete`);

  return { matches: matchesMigrated, schedules: schedulesMigrated };
}

async function migrateEvents(client, isDryRun) {
  console.log("\n" + "=".repeat(60));
  console.log("MIGRATING EVENTS");
  console.log("=".repeat(60));

  const countResult = await client.query(`
    SELECT source_type, COUNT(*) FROM event_registry GROUP BY source_type
  `);
  console.log("Event counts by type:");
  countResult.rows.forEach((r) => console.log(`  ${r.source_type}: ${r.count}`));

  if (isDryRun) {
    console.log("\n[DRY RUN] Would migrate the above events");
    return { leagues: 0, tournaments: 0, dryRun: true };
  }

  // Get current season
  const seasonId = await getCurrentSeason(client);

  // Migrate leagues
  const leaguesResult = await client.query(`
    SELECT event_id, event_name, state, region, source_platform
    FROM event_registry
    WHERE source_type = 'league'
  `);

  let leaguesMigrated = 0;
  for (const event of leaguesResult.rows) {
    try {
      await client.query(
        `INSERT INTO leagues (name, season_id, state, region, source_platform, source_event_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name, season_id) DO NOTHING`,
        [event.event_name, seasonId, event.state, event.region, event.source_platform, event.event_id]
      );
      leaguesMigrated++;
    } catch (e) {
      // Skip duplicates
    }
  }
  console.log(`  Leagues migrated: ${leaguesMigrated}`);

  // Migrate tournaments
  const tournamentsResult = await client.query(`
    SELECT event_id, event_name, state, source_platform
    FROM event_registry
    WHERE source_type = 'tournament'
  `);

  let tournamentsMigrated = 0;
  for (const event of tournamentsResult.rows) {
    // Default dates since event_registry doesn't have them
    const startDate = "2025-01-01";
    const endDate = "2025-01-03";

    try {
      await client.query(
        `INSERT INTO tournaments (name, start_date, end_date, state, source_platform, source_event_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [event.event_name, startDate, endDate, event.state, event.source_platform, event.event_id]
      );
      tournamentsMigrated++;
    } catch (e) {
      // Skip
    }
  }
  console.log(`  Tournaments migrated: ${tournamentsMigrated}`);
  console.log(`\n✅ Events migration complete`);

  return { leagues: leaguesMigrated, tournaments: tournamentsMigrated };
}

async function refreshViews(client, isDryRun) {
  console.log("\n" + "=".repeat(60));
  console.log("REFRESHING MATERIALIZED VIEWS");
  console.log("=".repeat(60));

  if (isDryRun) {
    console.log("[DRY RUN] Would refresh all materialized views");
    return { refreshed: false, dryRun: true };
  }

  const views = [
    "app_rankings",
    "app_team_profile",
    "app_matches_feed",
    "app_league_standings",
    "app_upcoming_schedule",
  ];

  for (const view of views) {
    console.log(`  Refreshing ${view}...`);
    try {
      await client.query(`REFRESH MATERIALIZED VIEW ${view}`);
      console.log(`    ✅ Done`);
    } catch (e) {
      console.log(`    ⚠️ Error: ${e.message}`);
    }
  }

  console.log(`\n✅ Views refresh complete`);
  return { refreshed: true };
}

// ============================================================
// MAIN EXECUTION
// ============================================================

async function runMigration() {
  console.log("\n" + "=".repeat(60));
  console.log("SOCCERVIEW DATA MIGRATION - PHASE 2");
  console.log("=".repeat(60));
  console.log(`Mode: ${isDryRun ? "DRY RUN" : "LIVE EXECUTION"}`);
  console.log(`Time: ${new Date().toISOString()}`);

  if (singleStep) {
    console.log(`Running single step: ${singleStep}`);
  }

  const client = await pool.connect();

  // Authorize writes to protected tables
  await authorizePipelineWrite(client);

  const results = {};

  try {
    if (!isDryRun) {
      console.log("\n⚠️ Starting migration in 3 seconds...");
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Step 1: Migrate events first (so we have league/tournament IDs for matches)
    if (!singleStep || singleStep === "events") {
      results.events = await migrateEvents(client, isDryRun);
    }

    // Step 2: Migrate teams
    if (!singleStep || singleStep === "teams") {
      results.teams = await migrateTeams(client, isDryRun);
    }

    // Step 3: Migrate matches (after teams exist)
    if (!singleStep || singleStep === "matches") {
      results.matches = await migrateMatches(client, isDryRun);
    }

    // Step 4: Refresh views
    if (!singleStep || singleStep === "views") {
      results.views = await refreshViews(client, isDryRun);
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("MIGRATION SUMMARY");
    console.log("=".repeat(60));

    if (results.events) {
      console.log(`  Events: ${results.events.leagues || 0} leagues, ${results.events.tournaments || 0} tournaments`);
    }
    if (results.teams) {
      console.log(`  Teams: ${results.teams.migrated || 0} migrated, ${results.teams.skipped || 0} skipped`);
      if (results.teams.clubs) console.log(`  Clubs: ${results.teams.clubs} created`);
    }
    if (results.matches) {
      console.log(`  Matches: ${results.matches.matches || 0} migrated`);
      console.log(`  Schedules: ${results.matches.schedules || 0} migrated`);
    }

    if (!isDryRun) {
      // Verify final counts
      console.log("\nVerifying new tables:");
      const verify = await client.query(`
        SELECT
          (SELECT COUNT(*) FROM teams_v2) as teams,
          (SELECT COUNT(*) FROM matches_v2) as matches,
          (SELECT COUNT(*) FROM schedules) as schedules,
          (SELECT COUNT(*) FROM leagues) as leagues,
          (SELECT COUNT(*) FROM tournaments) as tournaments,
          (SELECT COUNT(*) FROM clubs) as clubs
      `);
      const v = verify.rows[0];
      console.log(`  teams_v2: ${v.teams}`);
      console.log(`  matches_v2: ${v.matches}`);
      console.log(`  schedules: ${v.schedules}`);
      console.log(`  leagues: ${v.leagues}`);
      console.log(`  tournaments: ${v.tournaments}`);
      console.log(`  clubs: ${v.clubs}`);
    }

    console.log("\n✅ Phase 2 migration complete!");
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((e) => {
  console.error(e);
  process.exit(1);
});
