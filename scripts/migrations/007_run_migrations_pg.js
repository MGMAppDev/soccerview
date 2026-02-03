/**
 * SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1
 * Migration Runner using direct PostgreSQL connection
 *
 * This script uses the pg package to execute SQL migrations directly.
 * More reliable than RPC-based approach.
 *
 * Usage:
 *   node scripts/migrations/007_run_migrations_pg.js
 *   node scripts/migrations/007_run_migrations_pg.js --dry-run
 *   node scripts/migrations/007_run_migrations_pg.js --step 2
 *
 * Prerequisites:
 *   - DATABASE_URL environment variable set
 *   - npm install pg (if not already installed)
 */

import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Error: Missing DATABASE_URL environment variable");
  console.error("Set it in .env file or environment");
  console.error("\nExample: DATABASE_URL=postgresql://postgres:password@host:5432/postgres");
  process.exit(1);
}

// Create connection pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Supabase
});

// Migration steps
const MIGRATION_STEPS = [
  {
    step: 1,
    name: "Create Staging Tables (Layer 1)",
    file: "001_create_staging_tables.sql",
    description: "Raw data landing zone for scrapers - no constraints",
  },
  {
    step: 2,
    name: "Create Production Tables (Layer 2)",
    file: "002_create_production_tables.sql",
    description: "Clean, validated, normalized tables with strict constraints",
  },
  {
    step: 3,
    name: "Create Indexes",
    file: "003_create_indexes.sql",
    description: "Performance indexes for queries",
  },
  {
    step: 4,
    name: "Create Triggers & Functions",
    file: "004_create_triggers.sql",
    description: "Data integrity enforcement and automation",
  },
  {
    step: 5,
    name: "Create Materialized Views (Layer 3)",
    file: "005_create_materialized_views.sql",
    description: "Denormalized views for app reads",
  },
];

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const stepIndex = args.indexOf("--step");
const fromIndex = args.indexOf("--from");
const singleStep = stepIndex !== -1 ? parseInt(args[stepIndex + 1]) : null;
const startFrom = fromIndex !== -1 ? parseInt(args[fromIndex + 1]) : 1;

async function executeSqlFile(filePath, stepName) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Executing: ${stepName}`);
  console.log(`File: ${filePath}`);
  console.log("=".repeat(60));

  const sql = fs.readFileSync(filePath, "utf8");

  if (isDryRun) {
    console.log("\n[DRY RUN] SQL to execute:");
    console.log("-".repeat(40));
    // Show first 1000 chars
    console.log(sql.substring(0, 1000));
    if (sql.length > 1000) {
      console.log(`\n... (${sql.length - 1000} more characters)`);
    }
    console.log("-".repeat(40));
    console.log(`[DRY RUN] Total SQL length: ${sql.length} characters`);
    return { success: true, dryRun: true };
  }

  const client = await pool.connect();

  try {
    const startTime = Date.now();

    // Execute the entire SQL file as a single transaction
    await client.query("BEGIN");

    // Execute the SQL
    await client.query(sql);

    await client.query("COMMIT");

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Completed in ${duration}s`);

    return { success: true, duration };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`\n❌ Error executing ${stepName}:`);
    console.error(`   ${error.message}`);

    // Show more context for the error
    if (error.position) {
      const position = parseInt(error.position);
      const context = sql.substring(
        Math.max(0, position - 100),
        Math.min(sql.length, position + 100)
      );
      console.error(`\n   Near: ...${context}...`);
    }

    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

async function testConnection() {
  console.log("Testing database connection...");

  try {
    const client = await pool.connect();
    const result = await client.query("SELECT version()");
    console.log(`✅ Connected to PostgreSQL`);
    console.log(`   Version: ${result.rows[0].version.split(" ").slice(0, 2).join(" ")}`);
    client.release();
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    return false;
  }
}

async function checkExistingTables() {
  console.log("\nChecking for existing tables...");

  const tablesToCheck = [
    "staging_teams",
    "staging_games",
    "staging_events",
    "seasons",
    "clubs",
    "teams_v2",
    "venues",
    "leagues",
    "tournaments",
    "schedules",
    "matches_v2",
  ];

  try {
    const client = await pool.connect();

    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
    `, [tablesToCheck]);

    client.release();

    if (result.rows.length > 0) {
      console.log(`\n⚠️  Found ${result.rows.length} existing new schema tables:`);
      result.rows.forEach((row) => console.log(`   - ${row.table_name}`));
      console.log("\n   These will be recreated (IF NOT EXISTS used).");
    } else {
      console.log("   No existing new schema tables found. Fresh migration.");
    }

    return result.rows.map((r) => r.table_name);
  } catch (error) {
    console.error("Error checking tables:", error.message);
    return [];
  }
}

async function runMigration() {
  console.log("\n" + "=".repeat(60));
  console.log("SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1 MIGRATION");
  console.log("=".repeat(60));
  console.log(`\nMode: ${isDryRun ? "DRY RUN (no changes)" : "LIVE EXECUTION"}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // Test connection
  const connected = await testConnection();
  if (!connected) {
    console.error("\nCannot proceed without database connection.");
    process.exit(1);
  }

  // Check existing tables
  if (!isDryRun) {
    await checkExistingTables();
  }

  // Determine which steps to run
  if (singleStep) {
    console.log(`\nRunning only step ${singleStep}`);
  } else {
    console.log(`\nRunning steps ${startFrom} through ${MIGRATION_STEPS.length}`);
  }

  const stepsToRun = MIGRATION_STEPS.filter((step) => {
    if (singleStep) return step.step === singleStep;
    return step.step >= startFrom;
  });

  if (stepsToRun.length === 0) {
    console.error("\nNo steps to run. Check --step or --from argument.");
    process.exit(1);
  }

  console.log("\nSteps to execute:");
  stepsToRun.forEach((step) => {
    console.log(`  ${step.step}. ${step.name}`);
  });

  // Confirm if not dry run
  if (!isDryRun) {
    console.log("\n⚠️  This will modify the database. Press Ctrl+C to cancel.");
    console.log("   Continuing in 3 seconds...\n");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  const results = [];

  for (const step of stepsToRun) {
    const filePath = path.join(__dirname, step.file);

    if (!fs.existsSync(filePath)) {
      console.error(`\nError: Migration file not found: ${filePath}`);
      results.push({
        step: step.step,
        name: step.name,
        success: false,
        error: "File not found",
      });
      continue;
    }

    const result = await executeSqlFile(filePath, `Step ${step.step}: ${step.name}`);
    results.push({ step: step.step, name: step.name, ...result });

    if (!result.success && !isDryRun) {
      console.error(`\n❌ Step ${step.step} failed. Stopping migration.`);
      console.error("   Fix the issue and run with --from", step.step);
      break;
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("MIGRATION SUMMARY");
  console.log("=".repeat(60));

  results.forEach((r) => {
    const status = r.dryRun ? "DRY RUN" : r.success ? "✅ SUCCESS" : "❌ FAILED";
    console.log(`  Step ${r.step}: ${status}`);
    console.log(`         ${r.name}`);
    if (r.error) console.log(`         Error: ${r.error}`);
    if (r.duration) console.log(`         Duration: ${r.duration}s`);
  });

  const allSuccess = results.every((r) => r.success || r.dryRun);

  if (allSuccess) {
    console.log("\n✅ Phase 1 migration completed successfully!");

    if (!isDryRun) {
      // Verify tables created
      console.log("\nVerifying created objects...");
      await verifyMigration();

      console.log("\nNext steps:");
      console.log("  1. Review tables in Supabase dashboard");
      console.log("  2. Test with sample data (run 008_test_schema.js)");
      console.log("  3. Proceed to Phase 2: Data Migration");
    }
  } else {
    console.log("\n❌ Migration had errors. Check output above.");
  }

  await pool.end();
  return allSuccess;
}

async function verifyMigration() {
  const client = await pool.connect();

  try {
    // Check tables
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN (
          'staging_teams', 'staging_games', 'staging_events',
          'seasons', 'clubs', 'teams_v2', 'venues',
          'leagues', 'tournaments', 'schedules', 'matches_v2',
          'rank_history_v2', 'favorites', 'predictions_v2', 'audit_log'
        )
      ORDER BY table_name
    `);
    console.log(`  Tables created: ${tables.rows.length}`);
    tables.rows.forEach((r) => console.log(`    - ${r.table_name}`));

    // Check materialized views
    const views = await client.query(`
      SELECT matviewname
      FROM pg_matviews
      WHERE schemaname = 'public'
        AND matviewname LIKE 'app_%'
      ORDER BY matviewname
    `);
    console.log(`  Materialized views created: ${views.rows.length}`);
    views.rows.forEach((r) => console.log(`    - ${r.matviewname}`));

    // Check triggers
    const triggers = await client.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
        AND trigger_name LIKE 'trg_%'
      ORDER BY trigger_name
    `);
    console.log(`  Triggers created: ${triggers.rows.length}`);

    // Check functions
    const functions = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_type = 'FUNCTION'
        AND routine_name IN (
          'calculate_age_group', 'trg_calculate_age_group',
          'trg_validate_match_insert', 'trg_update_team_stats_after_match',
          'convert_schedule_to_match', 'refresh_app_views',
          'cleanup_audit_log', 'cleanup_staging_tables'
        )
      ORDER BY routine_name
    `);
    console.log(`  Functions created: ${functions.rows.length}`);
  } catch (error) {
    console.error("  Error verifying migration:", error.message);
  } finally {
    client.release();
  }
}

// Main execution
runMigration()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    pool.end();
    process.exit(1);
  });
