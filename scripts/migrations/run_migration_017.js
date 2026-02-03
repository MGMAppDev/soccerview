/**
 * Run Migration 017: Add Quality Columns to teams_v2
 *
 * This adds data quality metadata columns for the inclusive migration strategy.
 */

import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
});

async function runMigration() {
  console.log("\n" + "=".repeat(60));
  console.log("MIGRATION 017: ADD QUALITY COLUMNS");
  console.log("=".repeat(60));
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Test connection
  console.log("Testing database connection...");
  const client = await pool.connect();

  try {
    const versionResult = await client.query("SELECT version()");
    console.log(`✅ Connected to PostgreSQL\n`);

    // Check current state of teams_v2
    const beforeCount = await client.query(`SELECT COUNT(*) as total FROM teams_v2`);
    console.log(`Before migration:`);
    console.log(`  Total teams_v2: ${beforeCount.rows[0].total}\n`);

    // Read and execute SQL file
    const sqlPath = path.join(__dirname, "017_add_quality_columns.sql");
    console.log(`Reading SQL file: ${sqlPath}`);

    const sql = fs.readFileSync(sqlPath, "utf8");
    console.log(`SQL file size: ${sql.length} characters\n`);

    console.log("Executing migration (this may take a minute)...\n");
    const startTime = Date.now();

    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Migration completed in ${duration}s\n`);

    // Verify new columns exist
    console.log("Verifying new columns...");
    const columns = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'teams_v2'
        AND column_name IN ('data_quality_score', 'birth_year_source', 'gender_source', 'data_flags')
      ORDER BY column_name
    `);

    console.log(`\n  New columns added:`);
    columns.rows.forEach(col => {
      console.log(`    - ${col.column_name}: ${col.data_type} (default: ${col.column_default || 'none'})`);
    });

    // Check quality score distribution
    const distribution = await client.query(`
      SELECT
        CASE
          WHEN data_quality_score >= 80 THEN 'A: Complete (80-100)'
          WHEN data_quality_score >= 60 THEN 'B: Good (60-79)'
          WHEN data_quality_score >= 40 THEN 'C: Partial (40-59)'
          WHEN data_quality_score >= 20 THEN 'D: Minimal (20-39)'
          ELSE 'F: Incomplete (0-19)'
        END as quality_grade,
        COUNT(*) as team_count
      FROM teams_v2
      GROUP BY 1
      ORDER BY 1
    `);

    console.log(`\n  Quality Score Distribution:`);
    distribution.rows.forEach(row => {
      console.log(`    ${row.quality_grade}: ${Number(row.team_count).toLocaleString()} teams`);
    });

    // Check matches_v2 link_status column
    const matchLinkStatus = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(link_status) as with_link_status
      FROM matches_v2
    `);
    console.log(`\n  matches_v2 link_status column:`);
    console.log(`    Total matches: ${Number(matchLinkStatus.rows[0].total).toLocaleString()}`);
    console.log(`    With link_status: ${Number(matchLinkStatus.rows[0].with_link_status).toLocaleString()}`);

    console.log("\n" + "=".repeat(60));
    console.log("✅ MIGRATION 017 COMPLETE");
    console.log("=".repeat(60));
    console.log("\nNext: Run Migration 018 (inclusive remigration)");

  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`\n❌ Migration failed: ${error.message}`);

    if (error.position) {
      const sql = fs.readFileSync(path.join(__dirname, "017_add_quality_columns.sql"), "utf8");
      const position = parseInt(error.position);
      const context = sql.substring(
        Math.max(0, position - 100),
        Math.min(sql.length, position + 100)
      );
      console.error(`\nNear: ...${context}...`);
    }

    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
