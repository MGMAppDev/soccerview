/**
 * SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1
 * Migration Runner Script
 *
 * This script executes all Phase 1 migration SQL files in order:
 * 1. Create staging tables (Layer 1)
 * 2. Create production tables (Layer 2)
 * 3. Create indexes
 * 4. Create triggers and functions
 * 5. Create materialized views (Layer 3)
 *
 * Usage:
 *   node scripts/migrations/006_run_phase1_migration.js
 *   node scripts/migrations/006_run_phase1_migration.js --dry-run
 *   node scripts/migrations/006_run_phase1_migration.js --step 2
 *
 * Options:
 *   --dry-run    Show SQL without executing
 *   --step N     Run only step N (1-5)
 *   --from N     Start from step N
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

async function executeSql(sql, stepName) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Executing: ${stepName}`);
  console.log("=".repeat(60));

  if (isDryRun) {
    console.log("\n[DRY RUN] SQL to execute:");
    console.log(sql.substring(0, 500) + (sql.length > 500 ? "..." : ""));
    console.log(`\n[DRY RUN] Total SQL length: ${sql.length} characters`);
    return { success: true, dryRun: true };
  }

  try {
    // Split SQL into statements and execute each
    // Note: This is a simple split - complex SQL may need better parsing
    const statements = sql
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    console.log(`Found ${statements.length} SQL statements to execute`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip empty statements or pure comments
      if (!statement || statement.startsWith("--")) continue;

      // Log progress for long migrations
      if (statements.length > 10 && i % 10 === 0) {
        console.log(`  Progress: ${i}/${statements.length} statements...`);
      }

      try {
        const { error } = await supabase.rpc("exec_sql", {
          sql_query: statement,
        });

        if (error) {
          // Try direct execution via REST API for DDL statements
          const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ sql_query: statement }),
          });

          if (!response.ok) {
            // For DDL, we need to use the SQL endpoint directly
            // This requires the exec_sql function to exist, or we use pg directly
            console.warn(
              `  Warning: Statement ${i + 1} may need manual execution`
            );
            console.warn(`  First 100 chars: ${statement.substring(0, 100)}...`);
            errorCount++;
          } else {
            successCount++;
          }
        } else {
          successCount++;
        }
      } catch (stmtError) {
        console.warn(`  Warning executing statement ${i + 1}:`, stmtError.message);
        errorCount++;
      }
    }

    console.log(`\nCompleted: ${successCount} successful, ${errorCount} warnings`);

    return {
      success: errorCount === 0,
      successCount,
      errorCount,
    };
  } catch (error) {
    console.error(`Error executing ${stepName}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function runMigration() {
  console.log("\n" + "=".repeat(60));
  console.log("SOCCERVIEW DATABASE RESTRUCTURE - PHASE 1 MIGRATION");
  console.log("=".repeat(60));
  console.log(`\nMode: ${isDryRun ? "DRY RUN (no changes)" : "LIVE EXECUTION"}`);
  console.log(`Database: ${SUPABASE_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);

  if (singleStep) {
    console.log(`Running only step ${singleStep}`);
  } else {
    console.log(`Running steps ${startFrom} through ${MIGRATION_STEPS.length}`);
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
    console.log(`     ${step.description}`);
  });

  console.log("\n");

  const results = [];

  for (const step of stepsToRun) {
    const filePath = path.join(__dirname, step.file);

    if (!fs.existsSync(filePath)) {
      console.error(`Error: Migration file not found: ${filePath}`);
      results.push({ step: step.step, success: false, error: "File not found" });
      continue;
    }

    const sql = fs.readFileSync(filePath, "utf8");
    const result = await executeSql(sql, `Step ${step.step}: ${step.name}`);
    results.push({ step: step.step, name: step.name, ...result });

    if (!result.success && !isDryRun) {
      console.error(`\nStep ${step.step} failed. Stopping migration.`);
      console.error("Fix the issue and run with --from", step.step);
      break;
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("MIGRATION SUMMARY");
  console.log("=".repeat(60));

  results.forEach((r) => {
    const status = r.dryRun
      ? "DRY RUN"
      : r.success
      ? "SUCCESS"
      : "FAILED";
    console.log(`  Step ${r.step}: ${status} - ${r.name || ""}`);
    if (r.error) console.log(`    Error: ${r.error}`);
    if (r.successCount !== undefined) {
      console.log(`    Statements: ${r.successCount} ok, ${r.errorCount} warnings`);
    }
  });

  const allSuccess = results.every((r) => r.success || r.dryRun);

  if (allSuccess) {
    console.log("\n✅ Phase 1 migration completed successfully!");
    if (!isDryRun) {
      console.log("\nNext steps:");
      console.log("  1. Verify tables exist in Supabase dashboard");
      console.log("  2. Test constraints with sample data");
      console.log("  3. Proceed to Phase 2: Data Migration");
    }
  } else {
    console.log("\n❌ Migration had errors. Check output above.");
  }

  return allSuccess;
}

// Alternative: Direct PostgreSQL execution
// If Supabase RPC doesn't work, this script can be run against the database directly
async function showManualInstructions() {
  console.log("\n" + "=".repeat(60));
  console.log("MANUAL EXECUTION INSTRUCTIONS");
  console.log("=".repeat(60));
  console.log("\nIf automatic execution fails, run these SQL files manually:");
  console.log("\n1. Go to Supabase Dashboard > SQL Editor");
  console.log("2. Execute each file in order:\n");

  MIGRATION_STEPS.forEach((step) => {
    const filePath = path.join(__dirname, step.file);
    console.log(`   ${step.step}. ${step.file}`);
    console.log(`      ${step.description}`);
    console.log(`      Path: ${filePath}\n`);
  });

  console.log("3. After each file, verify no errors in the output");
  console.log("4. Proceed to Phase 2: Data Migration");
}

// Main execution
runMigration()
  .then((success) => {
    if (!success && !isDryRun) {
      showManualInstructions();
    }
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    showManualInstructions();
    process.exit(1);
  });
