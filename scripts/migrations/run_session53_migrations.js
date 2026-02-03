/**
 * Run Session 53 Migrations
 * ==========================
 *
 * Applies migrations 021, 022, 023 for the foolproof age_group architecture.
 *
 * Usage: node scripts/migrations/run_session53_migrations.js
 */

import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

const migrations = [
  "021_add_season_year_column.sql",
  "022_create_teams_v2_live_view.sql",
  "023_update_materialized_views_dynamic_age.sql",
];

async function main() {
  console.log("=".repeat(70));
  console.log("🚀 RUNNING SESSION 53 MIGRATIONS");
  console.log("=".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    for (const migrationFile of migrations) {
      console.log("=".repeat(70));
      console.log(`Running: ${migrationFile}`);
      console.log("=".repeat(70));

      const filePath = path.join(__dirname, migrationFile);

      if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        continue;
      }

      const sql = fs.readFileSync(filePath, "utf8");

      try {
        await client.query(sql);
        console.log(`✅ ${migrationFile} completed successfully\n`);
      } catch (e) {
        console.error(`❌ Error in ${migrationFile}:`, e.message);
        // Continue with next migration instead of failing completely
      }
    }

    // Verify migrations
    console.log("=".repeat(70));
    console.log("VERIFICATION");
    console.log("=".repeat(70));

    // Check get_current_season_year function
    try {
      const result = await client.query("SELECT get_current_season_year() as year");
      console.log(`✅ get_current_season_year() = ${result.rows[0].year}`);
    } catch (e) {
      console.log(`❌ get_current_season_year() not available: ${e.message}`);
    }

    // Check teams_v2_live view
    try {
      const result = await client.query("SELECT COUNT(*) as cnt FROM teams_v2_live LIMIT 1");
      console.log(`✅ teams_v2_live view exists`);
    } catch (e) {
      console.log(`❌ teams_v2_live view not available: ${e.message}`);
    }

    // Check seasons table has year column
    try {
      const result = await client.query("SELECT year, is_current FROM seasons WHERE is_current = true");
      if (result.rows.length > 0) {
        console.log(`✅ Current season: year=${result.rows[0].year}, is_current=${result.rows[0].is_current}`);
      } else {
        console.log(`⚠️ No current season found in seasons table`);
      }
    } catch (e) {
      console.log(`❌ seasons.year column check failed: ${e.message}`);
    }

  } catch (err) {
    console.error("\n❌ Connection error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Migrations completed at: ${new Date().toISOString()}`);
}

main();
