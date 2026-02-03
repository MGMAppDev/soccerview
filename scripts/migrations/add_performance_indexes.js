/**
 * Add Performance Indexes for Fast App Loading
 *
 * Creates database indexes for:
 * 1. team_elo table - fast filtering by state, gender, age_group
 * 2. team_elo table - fast search by team_name with trigrams
 * 3. team_elo table - fast filtering for teams with matches
 * 4. match_results table - fast queries by date, teams, events
 *
 * Usage: node scripts/migrations/add_performance_indexes.js
 *
 * Industry best practice: Indexes are created CONCURRENTLY to avoid
 * blocking writes during index creation.
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

const INDEXES = [
  // ================================================================
  // team_elo / teams TABLE INDEXES
  // ================================================================
  {
    name: "idx_team_elo_matches_played_positive",
    table: "teams",
    description: "Partial index for teams with match history (most common filter)",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_elo_matches_played_positive
          ON teams (id, team_name)
          WHERE matches_played > 0`,
  },
  {
    name: "idx_teams_state",
    table: "teams",
    description: "B-tree index for state filtering",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_state
          ON teams (state)`,
  },
  {
    name: "idx_teams_gender",
    table: "teams",
    description: "B-tree index for gender filtering",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_gender
          ON teams (gender)`,
  },
  {
    name: "idx_teams_age_group",
    table: "teams",
    description: "B-tree index for age_group filtering",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_age_group
          ON teams (age_group)`,
  },
  {
    name: "idx_teams_team_name_trgm",
    table: "teams",
    description: "GIN trigram index for fast ILIKE search on team_name",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_team_name_trgm
          ON teams USING gin (team_name gin_trgm_ops)`,
  },
  {
    name: "idx_teams_elo_rating",
    table: "teams",
    description: "B-tree index for ELO-based sorting (Rankings tab)",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_elo_rating
          ON teams (elo_rating DESC NULLS LAST)`,
  },
  {
    name: "idx_teams_national_rank",
    table: "teams",
    description: "B-tree index for national rank sorting (Official Rankings)",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_national_rank
          ON teams (national_rank ASC NULLS LAST)`,
  },
  {
    name: "idx_teams_composite_filters",
    table: "teams",
    description: "Composite index for common filter combinations",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_composite_filters
          ON teams (state, gender, age_group)
          WHERE matches_played > 0`,
  },

  // ================================================================
  // match_results TABLE INDEXES
  // ================================================================
  {
    name: "idx_match_results_date",
    table: "match_results",
    description: "B-tree index for date filtering and sorting",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_results_date
          ON match_results (match_date DESC NULLS LAST)`,
  },
  {
    name: "idx_match_results_home_team",
    table: "match_results",
    description: "B-tree index for home team lookups",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_results_home_team
          ON match_results (home_team_id)
          WHERE home_team_id IS NOT NULL`,
  },
  {
    name: "idx_match_results_away_team",
    table: "match_results",
    description: "B-tree index for away team lookups",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_results_away_team
          ON match_results (away_team_id)
          WHERE away_team_id IS NOT NULL`,
  },
  {
    name: "idx_match_results_event",
    table: "match_results",
    description: "B-tree index for event/league filtering",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_results_event
          ON match_results (event_id)`,
  },
  {
    name: "idx_match_results_recent_with_scores",
    table: "match_results",
    description: "Partial index for recent matches with scores (Home tab carousel)",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_results_recent_with_scores
          ON match_results (match_date DESC)
          WHERE home_score IS NOT NULL AND match_date IS NOT NULL`,
  },
];

async function main() {
  console.log("🚀 Add Performance Indexes for Fast App Loading");
  console.log("═".repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 1800000, // 30 minutes for large index creation
  });

  try {
    await client.connect();
    console.log("✅ Connected to database\n");

    // Ensure pg_trgm extension is enabled (required for trigram index)
    console.log("📦 Ensuring pg_trgm extension is enabled...");
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    console.log("✅ pg_trgm extension ready\n");

    // Create each index
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const index of INDEXES) {
      console.log(`📊 Creating: ${index.name}`);
      console.log(`   Table: ${index.table}`);
      console.log(`   Purpose: ${index.description}`);

      try {
        await client.query(index.sql);
        console.log(`   ✅ Created successfully\n`);
        successCount++;
      } catch (err) {
        if (err.message.includes("already exists")) {
          console.log(`   ⏭️  Already exists, skipping\n`);
          skipCount++;
        } else {
          console.error(`   ❌ Error: ${err.message}\n`);
          errorCount++;
        }
      }
    }

    // Summary
    console.log("═".repeat(60));
    console.log("📈 INDEX CREATION SUMMARY");
    console.log("═".repeat(60));
    console.log(`✅ Created: ${successCount}`);
    console.log(`⏭️  Skipped (already exist): ${skipCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`\nTotal indexes: ${INDEXES.length}`);

    // Show existing indexes on key tables
    console.log("\n📋 Current indexes on teams table:");
    const teamsIndexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'teams'
      ORDER BY indexname
    `);
    teamsIndexes.rows.forEach((row) => {
      console.log(`   • ${row.indexname}`);
    });

    console.log("\n📋 Current indexes on match_results table:");
    const matchIndexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'match_results'
      ORDER BY indexname
    `);
    matchIndexes.rows.forEach((row) => {
      console.log(`   • ${row.indexname}`);
    });

  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log("\n✅ Done!");
  }
}

main();
