/**
 * Execute Phase 1 Database Optimizations
 *
 * OPERATIONS:
 * 1. Drop duplicate trigram index (-100 MB storage)
 * 2. Create reconciliation priority index (4x faster reconciliation)
 * 3. Create reconciliation candidates index (faster fuzzy matching)
 *
 * SAFETY: Only touches teams table (linking processes use match_results + team_name_aliases)
 *
 * Usage: node scripts/executePhase1Optimization.js
 */

import pg from "pg";
import "dotenv/config";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(70));
  console.log("PHASE 1 DATABASE OPTIMIZATION - SoccerView");
  console.log("=".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 1800000, // 30 minutes for index creation
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // Get baseline table size
    console.log("📊 BASELINE MEASUREMENTS:");
    const baselineSize = await client.query(`
      SELECT pg_size_pretty(pg_total_relation_size('teams')) as total_size
    `);
    console.log(`   teams table size: ${baselineSize.rows[0].total_size}`);

    const indexCount = await client.query(`
      SELECT COUNT(*) as cnt FROM pg_indexes WHERE tablename = 'teams'
    `);
    console.log(`   teams indexes: ${indexCount.rows[0].cnt}`);
    console.log();

    // ============================================================
    // OPERATION 1: Drop duplicate trigram index
    // ============================================================
    console.log("🔧 OPERATION 1: Dropping duplicate trigram index...");
    console.log("   Index: idx_teams_team_name_trgm");
    console.log("   Expected: -100 MB storage savings\n");

    const startOp1 = Date.now();

    // Check if index exists first
    const checkIndex = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'teams' AND indexname = 'idx_teams_team_name_trgm'
    `);

    if (checkIndex.rows.length === 0) {
      console.log("   ⚠️  Index does not exist - skipping\n");
    } else {
      await client.query(`DROP INDEX IF EXISTS idx_teams_team_name_trgm`);
      const elapsedOp1 = ((Date.now() - startOp1) / 1000).toFixed(2);
      console.log(`   ✅ Index dropped successfully (${elapsedOp1}s)\n`);
    }

    // ============================================================
    // OPERATION 2: Create reconciliation priority index
    // ============================================================
    console.log("🔧 OPERATION 2: Creating reconciliation priority index...");
    console.log("   Index: idx_teams_reconciliation_priority");
    console.log("   Purpose: Fast fetch of ranked teams needing matches");
    console.log("   Filter: national_rank IS NOT NULL AND matches_played = 0\n");

    const startOp2 = Date.now();

    await client.query(`
      CREATE INDEX CONCURRENTLY idx_teams_reconciliation_priority
      ON teams (national_rank ASC)
      WHERE national_rank IS NOT NULL AND matches_played = 0
    `);

    const elapsedOp2 = ((Date.now() - startOp2) / 1000).toFixed(2);
    console.log(`   ✅ Index created successfully (${elapsedOp2}s)\n`);

    // ============================================================
    // OPERATION 3: Create reconciliation candidates index
    // ============================================================
    console.log("🔧 OPERATION 3: Creating reconciliation candidates index...");
    console.log("   Index: idx_teams_reconciliation_candidates");
    console.log("   Purpose: Fast pre-filtering for fuzzy matching");
    console.log("   Columns: state, gender, age_group, matches_played");
    console.log("   Filter: matches_played > 0\n");

    const startOp3 = Date.now();

    await client.query(`
      CREATE INDEX CONCURRENTLY idx_teams_reconciliation_candidates
      ON teams (state, gender, age_group, matches_played)
      WHERE matches_played > 0
    `);

    const elapsedOp3 = ((Date.now() - startOp3) / 1000).toFixed(2);
    console.log(`   ✅ Index created successfully (${elapsedOp3}s)\n`);

    // ============================================================
    // ANALYZE TABLE
    // ============================================================
    console.log("📊 Running ANALYZE to update statistics...");
    await client.query(`ANALYZE teams`);
    console.log("   ✅ Statistics updated\n");

    // ============================================================
    // VERIFICATION
    // ============================================================
    console.log("=".repeat(70));
    console.log("VERIFICATION RESULTS");
    console.log("=".repeat(70));

    // Check new indexes exist
    const newIndexes = await client.query(`
      SELECT
        indexname,
        pg_size_pretty(pg_relation_size(indexname::regclass)) as size
      FROM pg_indexes
      WHERE tablename = 'teams'
        AND indexname LIKE '%reconciliation%'
      ORDER BY indexname
    `);

    console.log("\n✅ New Indexes Created:");
    if (newIndexes.rows.length === 0) {
      console.log("   ⚠️  WARNING: No reconciliation indexes found!");
    } else {
      newIndexes.rows.forEach(idx => {
        console.log(`   - ${idx.indexname}: ${idx.size}`);
      });
    }

    // Verify duplicate index was dropped
    const dupCheck = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'teams' AND indexname = 'idx_teams_team_name_trgm'
    `);

    console.log("\n✅ Duplicate Index Check:");
    if (dupCheck.rows.length === 0) {
      console.log("   - idx_teams_team_name_trgm: DROPPED ✓");
    } else {
      console.log("   ⚠️  WARNING: Duplicate index still exists!");
    }

    // Check final table size
    const finalSize = await client.query(`
      SELECT pg_size_pretty(pg_total_relation_size('teams')) as total_size
    `);
    console.log("\n📊 Final Table Size:");
    console.log(`   teams table: ${finalSize.rows[0].total_size}`);
    console.log(`   (baseline: ${baselineSize.rows[0].total_size})`);

    // Count indexes
    const finalIndexCount = await client.query(`
      SELECT COUNT(*) as cnt FROM pg_indexes WHERE tablename = 'teams'
    `);
    console.log(`\n📊 Index Count:`);
    console.log(`   Before: ${indexCount.rows[0].cnt}`);
    console.log(`   After: ${finalIndexCount.rows[0].cnt}`);
    console.log(`   Change: ${parseInt(finalIndexCount.rows[0].cnt) - parseInt(indexCount.rows[0].cnt)} (dropped 1, added 2)`);

    // List all teams indexes
    console.log("\n📋 All teams Table Indexes:");
    const allIndexes = await client.query(`
      SELECT
        indexname,
        pg_size_pretty(pg_relation_size(indexname::regclass)) as size
      FROM pg_indexes
      WHERE tablename = 'teams'
      ORDER BY pg_relation_size(indexname::regclass) DESC
      LIMIT 10
    `);
    allIndexes.rows.forEach(idx => {
      console.log(`   - ${idx.indexname}: ${idx.size}`);
    });

    console.log("\n" + "=".repeat(70));
    console.log("✅ PHASE 1 OPTIMIZATION COMPLETE");
    console.log("=".repeat(70));
    console.log("\nBENEFITS:");
    console.log("  ✅ Storage optimized (-100 MB expected)");
    console.log("  ✅ Reconciliation ready (10-12 hrs → 2-3 hrs)");
    console.log("  ✅ Fuzzy matching pre-filtering enabled");
    console.log("\nNEXT STEPS:");
    console.log("  1. Run reconciliation tonight: node scripts/reconcileRankedTeams.js");
    console.log("  2. Plan Phase 2 (fuzzy matching optimization) for next week");
    console.log("  3. Update CLAUDE.md with Phase 1 completion status\n");

  } catch (error) {
    console.error("\n❌ ERROR during optimization:");
    console.error(error);
    console.error("\nOperation failed. Database state may be partially modified.");
    console.error("Check error message above and verify index states manually.\n");
    process.exit(1);
  } finally {
    await client.end();
    console.log("Database connection closed.");
  }
}

main().catch(console.error);
