/**
 * SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1
 * Schema Test Script
 *
 * Tests that all constraints, triggers, and validations work correctly
 * using sample data.
 *
 * Usage:
 *   node scripts/migrations/008_test_schema.js
 *   node scripts/migrations/008_test_schema.js --cleanup   # Remove test data after
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

const args = process.argv.slice(2);
const shouldCleanup = args.includes("--cleanup");

// Test data
const TEST_DATA = {
  season: {
    name: "2025-26 Test Season",
    start_date: "2025-08-01",
    end_date: "2026-07-31",
    is_current: true,
  },
  club: {
    name: "Test Soccer Club",
    short_name: "TSC",
    state: "KS",
    city: "Overland Park",
  },
  venue: {
    name: "Test Soccer Complex",
    city: "Overland Park",
    state: "KS",
  },
  teams: [
    {
      canonical_name: "Test FC Blue 2015",
      display_name: "Test FC Blue 2015 (U11 Boys)",
      birth_year: 2015,
      gender: "M",
      state: "KS",
    },
    {
      canonical_name: "Test FC Red 2015",
      display_name: "Test FC Red 2015 (U11 Boys)",
      birth_year: 2015,
      gender: "M",
      state: "KS",
    },
    {
      canonical_name: "Test FC White 2014",
      display_name: "Test FC White 2014 (U12 Boys)",
      birth_year: 2014,
      gender: "M",
      state: "KS",
    },
    {
      canonical_name: "Test FC Girls 2015",
      display_name: "Test FC Girls 2015 (U11 Girls)",
      birth_year: 2015,
      gender: "F",
      state: "KS",
    },
  ],
};

// Test IDs (will be populated during tests)
const ids = {
  season: null,
  club: null,
  venue: null,
  league: null,
  teams: [],
};

async function runTest(name, testFn) {
  process.stdout.write(`  ${name}... `);
  try {
    const result = await testFn();
    console.log(`✅ ${result || "PASS"}`);
    return { name, success: true, result };
  } catch (error) {
    console.log(`❌ FAIL`);
    console.log(`     Error: ${error.message}`);
    return { name, success: false, error: error.message };
  }
}

async function runTests() {
  console.log("\n" + "=".repeat(60));
  console.log("SOCCERVIEW SCHEMA TEST SUITE");
  console.log("=".repeat(60));
  console.log(`\nDatabase: ${DATABASE_URL.split("@")[1]?.split("/")[0] || "***"}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  const client = await pool.connect();

  // Authorize writes to protected tables for testing
  await authorizePipelineWrite(client);

  const results = [];

  try {
    // ========================================
    // SECTION 1: Basic Table Operations
    // ========================================
    console.log("Section 1: Basic Table Operations");
    console.log("-".repeat(40));

    // Test 1.1: Insert season
    results.push(
      await runTest("Insert season", async () => {
        const result = await client.query(
          `INSERT INTO seasons (name, start_date, end_date, is_current)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [
            TEST_DATA.season.name,
            TEST_DATA.season.start_date,
            TEST_DATA.season.end_date,
            TEST_DATA.season.is_current,
          ]
        );
        ids.season = result.rows[0].id;
        return `ID: ${ids.season.substring(0, 8)}...`;
      })
    );

    // Test 1.2: Insert club
    results.push(
      await runTest("Insert club", async () => {
        const result = await client.query(
          `INSERT INTO clubs (name, short_name, state, city)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [
            TEST_DATA.club.name,
            TEST_DATA.club.short_name,
            TEST_DATA.club.state,
            TEST_DATA.club.city,
          ]
        );
        ids.club = result.rows[0].id;
        return `ID: ${ids.club.substring(0, 8)}...`;
      })
    );

    // Test 1.3: Insert venue
    results.push(
      await runTest("Insert venue", async () => {
        const result = await client.query(
          `INSERT INTO venues (name, city, state)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [TEST_DATA.venue.name, TEST_DATA.venue.city, TEST_DATA.venue.state]
        );
        ids.venue = result.rows[0].id;
        return `ID: ${ids.venue.substring(0, 8)}...`;
      })
    );

    // Test 1.4: Insert league
    results.push(
      await runTest("Insert league", async () => {
        const result = await client.query(
          `INSERT INTO leagues (name, season_id, state)
           VALUES ($1, $2, $3)
           RETURNING id`,
          ["Test Premier League", ids.season, "KS"]
        );
        ids.league = result.rows[0].id;
        return `ID: ${ids.league.substring(0, 8)}...`;
      })
    );

    // Test 1.5: Insert teams
    results.push(
      await runTest("Insert teams (4 teams)", async () => {
        for (const team of TEST_DATA.teams) {
          const result = await client.query(
            `INSERT INTO teams_v2 (club_id, canonical_name, display_name, birth_year, gender, state)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, age_group`,
            [
              ids.club,
              team.canonical_name,
              team.display_name,
              team.birth_year,
              team.gender,
              team.state,
            ]
          );
          ids.teams.push({
            id: result.rows[0].id,
            ...team,
            age_group: result.rows[0].age_group,
          });
        }
        return `Created ${ids.teams.length} teams`;
      })
    );

    // ========================================
    // SECTION 2: Trigger Tests
    // ========================================
    console.log("\nSection 2: Trigger Tests");
    console.log("-".repeat(40));

    // Test 2.1: Age group auto-calculation
    results.push(
      await runTest("Age group auto-calculated", async () => {
        const team = ids.teams[0];
        if (!team.age_group) throw new Error("age_group not set");
        // Birth year 2015, current year 2026 = U11
        if (team.age_group !== "U11") {
          throw new Error(`Expected U11, got ${team.age_group}`);
        }
        return `2015 → ${team.age_group}`;
      })
    );

    // Test 2.2: Insert valid match (same gender, compatible birth years)
    results.push(
      await runTest("Insert valid match (same gender, birth year)", async () => {
        const result = await client.query(
          `INSERT INTO matches_v2 (
            match_date, home_team_id, away_team_id,
            home_score, away_score, league_id
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id`,
          [
            "2026-01-15",
            ids.teams[0].id, // Blue 2015 Boys
            ids.teams[1].id, // Red 2015 Boys
            2,
            1,
            ids.league,
          ]
        );
        ids.match1 = result.rows[0].id;
        return `Match ID: ${ids.match1.substring(0, 8)}...`;
      })
    );

    // Test 2.3: Team stats updated by trigger
    results.push(
      await runTest("Team stats updated after match insert", async () => {
        const result = await client.query(
          `SELECT wins, losses, matches_played, goals_for, goals_against
           FROM teams_v2 WHERE id = $1`,
          [ids.teams[0].id]
        );
        const stats = result.rows[0];
        if (stats.wins !== 1) throw new Error(`Expected 1 win, got ${stats.wins}`);
        if (stats.matches_played !== 1)
          throw new Error(`Expected 1 match, got ${stats.matches_played}`);
        return `W:${stats.wins} L:${stats.losses} GF:${stats.goals_for}`;
      })
    );

    // ========================================
    // SECTION 3: Constraint Tests
    // ========================================
    console.log("\nSection 3: Constraint Validation");
    console.log("-".repeat(40));

    // Test 3.1: Reject match with incompatible birth years (>1 year diff)
    results.push(
      await runTest("REJECT match with birth year mismatch (2015 vs 2013)", async () => {
        // Create a team with 2013 birth year
        const result = await client.query(
          `INSERT INTO teams_v2 (club_id, canonical_name, display_name, birth_year, gender, state)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [ids.club, "Test FC Old 2013", "Test FC Old 2013 (U13 Boys)", 2013, "M", "KS"]
        );
        const oldTeamId = result.rows[0].id;
        ids.teams.push({ id: oldTeamId, birth_year: 2013 });

        try {
          await client.query(
            `INSERT INTO matches_v2 (
              match_date, home_team_id, away_team_id,
              home_score, away_score, league_id
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            ["2026-01-16", ids.teams[0].id, oldTeamId, 1, 1, ids.league]
          );
          throw new Error("Should have rejected birth year mismatch");
        } catch (error) {
          if (error.message.includes("incompatible birth years")) {
            return "Correctly rejected";
          }
          if (error.message.includes("Should have rejected")) {
            throw error;
          }
          throw new Error(`Wrong error: ${error.message}`);
        }
      })
    );

    // Test 3.2: Reject match with gender mismatch
    results.push(
      await runTest("REJECT match with gender mismatch (Boys vs Girls)", async () => {
        const girlsTeam = ids.teams.find((t) => t.gender === "F");
        const boysTeam = ids.teams.find((t) => t.gender === "M" && t.birth_year === 2015);

        try {
          await client.query(
            `INSERT INTO matches_v2 (
              match_date, home_team_id, away_team_id,
              home_score, away_score, league_id
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            ["2026-01-17", boysTeam.id, girlsTeam.id, 2, 2, ids.league]
          );
          throw new Error("Should have rejected gender mismatch");
        } catch (error) {
          if (error.message.includes("different genders")) {
            return "Correctly rejected";
          }
          if (error.message.includes("Should have rejected")) {
            throw error;
          }
          throw new Error(`Wrong error: ${error.message}`);
        }
      })
    );

    // Test 3.3: Reject same team playing itself
    results.push(
      await runTest("REJECT team playing against itself", async () => {
        try {
          await client.query(
            `INSERT INTO matches_v2 (
              match_date, home_team_id, away_team_id,
              home_score, away_score, league_id
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            ["2026-01-18", ids.teams[0].id, ids.teams[0].id, 0, 0, ids.league]
          );
          throw new Error("Should have rejected same team");
        } catch (error) {
          if (
            error.message.includes("different_teams") ||
            error.message.includes("violates check constraint")
          ) {
            return "Correctly rejected";
          }
          if (error.message.includes("Should have rejected")) {
            throw error;
          }
          throw new Error(`Wrong error: ${error.message}`);
        }
      })
    );

    // Test 3.4: Reject negative scores
    results.push(
      await runTest("REJECT negative scores", async () => {
        try {
          await client.query(
            `INSERT INTO matches_v2 (
              match_date, home_team_id, away_team_id,
              home_score, away_score, league_id
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            ["2026-01-19", ids.teams[0].id, ids.teams[1].id, -1, 0, ids.league]
          );
          throw new Error("Should have rejected negative score");
        } catch (error) {
          if (
            error.message.includes("valid_scores") ||
            error.message.includes("violates check constraint")
          ) {
            return "Correctly rejected";
          }
          if (error.message.includes("Should have rejected")) {
            throw error;
          }
          throw new Error(`Wrong error: ${error.message}`);
        }
      })
    );

    // ========================================
    // SECTION 4: Staging Tables
    // ========================================
    console.log("\nSection 4: Staging Tables (No Constraints)");
    console.log("-".repeat(40));

    // Test 4.1: Staging accepts any data
    results.push(
      await runTest("Staging accepts messy data (no validation)", async () => {
        await client.query(
          `INSERT INTO staging_games (
            match_date, home_team_name, away_team_name,
            home_score, away_score, source_platform
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "2026-01-20",
            "Some Random Team Name With Typos",
            "Another Team - Maybe Wrong",
            null, // No score yet
            null,
            "test",
          ]
        );
        return "Accepted without validation";
      })
    );

    // ========================================
    // SECTION 5: Schedule Tests
    // ========================================
    console.log("\nSection 5: Schedule Tests");
    console.log("-".repeat(40));

    // Test 5.1: Insert schedule (future game)
    results.push(
      await runTest("Insert schedule (future game)", async () => {
        const result = await client.query(
          `INSERT INTO schedules (
            match_date, home_team_id, away_team_id, league_id
          ) VALUES ($1, $2, $3, $4)
          RETURNING id`,
          ["2026-02-15", ids.teams[0].id, ids.teams[1].id, ids.league]
        );
        ids.schedule1 = result.rows[0].id;
        return `Schedule ID: ${ids.schedule1.substring(0, 8)}...`;
      })
    );

    // Test 5.2: Convert schedule to match
    results.push(
      await runTest("Convert schedule to match (using function)", async () => {
        const result = await client.query(
          `SELECT convert_schedule_to_match($1, $2, $3) as match_id`,
          [ids.schedule1, 3, 2]
        );
        const matchId = result.rows[0].match_id;

        // Verify schedule was deleted
        const scheduleCheck = await client.query(
          `SELECT id FROM schedules WHERE id = $1`,
          [ids.schedule1]
        );
        if (scheduleCheck.rows.length > 0) {
          throw new Error("Schedule should have been deleted");
        }

        // Verify match was created
        const matchCheck = await client.query(
          `SELECT home_score, away_score FROM matches_v2 WHERE id = $1`,
          [matchId]
        );
        if (matchCheck.rows.length === 0) {
          throw new Error("Match should have been created");
        }

        return `Match ID: ${matchId.substring(0, 8)}...`;
      })
    );

    // ========================================
    // SECTION 6: Audit Log
    // ========================================
    console.log("\nSection 6: Audit Log");
    console.log("-".repeat(40));

    // Test 6.1: Audit log captures inserts
    results.push(
      await runTest("Audit log captures team inserts", async () => {
        const result = await client.query(
          `SELECT COUNT(*) as count FROM audit_log
           WHERE table_name = 'teams_v2' AND action = 'INSERT'`
        );
        const count = parseInt(result.rows[0].count);
        if (count < 1) throw new Error(`Expected audit entries, got ${count}`);
        return `${count} INSERT entries logged`;
      })
    );

    // ========================================
    // SUMMARY
    // ========================================
    console.log("\n" + "=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));

    const passed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`\n  Total: ${results.length}`);
    console.log(`  ✅ Passed: ${passed}`);
    console.log(`  ❌ Failed: ${failed}`);

    if (failed > 0) {
      console.log("\nFailed tests:");
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          console.log(`  - ${r.name}: ${r.error}`);
        });
    }

    // Cleanup if requested
    if (shouldCleanup) {
      console.log("\nCleaning up test data...");
      await cleanupTestData(client);
      console.log("  ✅ Test data removed");
    } else {
      console.log("\nTest data retained. Run with --cleanup to remove.");
    }

    console.log("\n" + "=".repeat(60));

    return failed === 0;
  } finally {
    client.release();
    await pool.end();
  }
}

async function cleanupTestData(client) {
  // Delete in reverse order of dependencies
  await client.query(`DELETE FROM audit_log WHERE table_name IN ('teams_v2', 'matches_v2')`);
  await client.query(`DELETE FROM staging_games WHERE source_platform = 'test'`);
  await client.query(`DELETE FROM matches_v2 WHERE league_id = $1`, [ids.league]);
  await client.query(`DELETE FROM schedules WHERE league_id = $1`, [ids.league]);
  await client.query(`DELETE FROM leagues WHERE id = $1`, [ids.league]);
  await client.query(`DELETE FROM teams_v2 WHERE club_id = $1`, [ids.club]);
  await client.query(`DELETE FROM clubs WHERE id = $1`, [ids.club]);
  await client.query(`DELETE FROM venues WHERE id = $1`, [ids.venue]);
  await client.query(`DELETE FROM seasons WHERE id = $1`, [ids.season]);
}

// Main execution
runTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Test suite failed:", error);
    pool.end();
    process.exit(1);
  });
