/**
 * Add Source Tracking Indexes for Multi-Source Data Integration
 *
 * Creates database indexes for:
 * 1. match_results.source_match_key - UNIQUE constraint for deduplication
 * 2. match_results.source_platform - filtering by data source (gotsport, htgsports, heartland)
 *
 * Usage: node scripts/migrations/add_source_tracking_indexes.js
 *
 * Required before: HTGSports and Heartland data ingestion
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

const INDEXES = [
  {
    name: "idx_match_results_source_match_key",
    table: "match_results",
    description: "UNIQUE index for deduplication - prevents duplicate matches from same source",
    sql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_match_results_source_match_key
          ON match_results (source_match_key)
          WHERE source_match_key IS NOT NULL`,
  },
  {
    name: "idx_match_results_source_platform",
    table: "match_results",
    description: "B-tree index for filtering by data source (gotsport, htgsports, heartland)",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_results_source_platform
          ON match_results (source_platform)`,
  },
];

async function main() {
  console.log("🔗 Add Source Tracking Indexes for Multi-Source Integration");
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

    // Check current row count
    const countResult = await client.query(`SELECT COUNT(*) FROM match_results`);
    console.log(`📊 Current match_results rows: ${parseInt(countResult.rows[0].count).toLocaleString()}\n`);

    // Create each index
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const index of INDEXES) {
      console.log(`📊 Creating: ${index.name}`);
      console.log(`   Table: ${index.table}`);
      console.log(`   Purpose: ${index.description}`);

      try {
        const startTime = Date.now();
        await client.query(index.sql);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`   ✅ Created successfully (${elapsed}s)\n`);
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

    // Show source_match_key coverage
    console.log("\n📊 Source Match Key Coverage:");
    const coverageResult = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE source_match_key IS NOT NULL) as with_key,
        COUNT(*) FILTER (WHERE source_match_key IS NULL) as without_key,
        COUNT(*) as total
      FROM match_results
    `);
    const coverage = coverageResult.rows[0];
    const pct = ((coverage.with_key / coverage.total) * 100).toFixed(1);
    console.log(`   With source_match_key: ${parseInt(coverage.with_key).toLocaleString()} (${pct}%)`);
    console.log(`   Without source_match_key: ${parseInt(coverage.without_key).toLocaleString()}`);

    // Show source_platform distribution
    console.log("\n📊 Source Platform Distribution:");
    const platformResult = await client.query(`
      SELECT
        COALESCE(source_platform, 'unknown') as platform,
        COUNT(*) as count
      FROM match_results
      GROUP BY source_platform
      ORDER BY count DESC
    `);
    platformResult.rows.forEach(row => {
      console.log(`   ${row.platform}: ${parseInt(row.count).toLocaleString()}`);
    });

  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log("\n✅ Done! Ready for HTGSports and Heartland data ingestion.");
  }
}

main();
