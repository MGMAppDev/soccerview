/**
 * Migration 020 Runner: Archive V1 Tables
 * ========================================
 * Renames old V1 tables to *_deprecated for historical reference.
 * Tables are NOT deleted - they remain accessible with _deprecated suffix.
 *
 * Usage:
 *   node scripts/migrations/run_migration_020.js
 *   node scripts/migrations/run_migration_020.js --dry-run
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const isDryRun = process.argv.includes("--dry-run");

const TABLES_TO_ARCHIVE = [
  { old: "teams", new: "teams_deprecated", description: "Core team data (V1)" },
  { old: "match_results", new: "match_results_deprecated", description: "Match data (V1)" },
  { old: "event_registry", new: "event_registry_deprecated", description: "Event catalog (V1)" },
  { old: "team_name_aliases", new: "team_name_aliases_deprecated", description: "Team linking aliases (V1)" },
  { old: "rank_history", new: "rank_history_deprecated", description: "Rank snapshots (V1)" },
  { old: "predictions", new: "predictions_deprecated", description: "User predictions (V1)" },
];

const VIEWS_TO_DROP = ["team_elo"]; // Views that depend on old tables

async function tableExists(tableName) {
  const { data } = await supabase.rpc("to_regclass", { name: `public.${tableName}` });
  return data !== null;
}

async function getTableRowCount(tableName) {
  const { count, error } = await supabase.from(tableName).select("*", { count: "exact", head: true });
  if (error) return "N/A";
  return count;
}

async function main() {
  console.log("═".repeat(60));
  console.log("Migration 020: Archive V1 Tables to *_deprecated");
  console.log("═".repeat(60));
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log("");

  // Step 1: Pre-migration inventory
  console.log("📋 Pre-Migration Inventory");
  console.log("-".repeat(40));

  for (const table of TABLES_TO_ARCHIVE) {
    const exists = await tableExists(table.old);
    if (exists) {
      const count = await getTableRowCount(table.old);
      console.log(`  ✓ ${table.old}: ${count.toLocaleString()} rows`);
    } else {
      console.log(`  ○ ${table.old}: not found (skip)`);
    }
  }
  console.log("");

  if (isDryRun) {
    console.log("🔍 DRY RUN - Would perform the following:");
    console.log("-".repeat(40));
    for (const table of TABLES_TO_ARCHIVE) {
      const exists = await tableExists(table.old);
      if (exists) {
        console.log(`  • Rename ${table.old} → ${table.new}`);
      }
    }
    console.log("");
    console.log("Run without --dry-run to execute.");
    return;
  }

  // Step 2: Drop dependent views
  console.log("📋 Dropping Dependent Views");
  console.log("-".repeat(40));

  for (const view of VIEWS_TO_DROP) {
    try {
      const { error } = await supabase.rpc("exec_sql", {
        sql: `DROP VIEW IF EXISTS ${view} CASCADE;`,
      });
      if (error) {
        // Try direct query approach
        console.log(`  ⚠ Could not drop ${view} via RPC, trying alternate method...`);
      } else {
        console.log(`  ✓ Dropped view: ${view}`);
      }
    } catch (e) {
      console.log(`  ⚠ View ${view} may not exist or already dropped`);
    }
  }
  console.log("");

  // Step 3: Archive tables
  console.log("📦 Archiving V1 Tables");
  console.log("-".repeat(40));

  const archived = [];
  const skipped = [];
  const errors = [];

  for (const table of TABLES_TO_ARCHIVE) {
    const exists = await tableExists(table.old);

    if (!exists) {
      skipped.push(table.old);
      console.log(`  ○ ${table.old}: skipped (not found)`);
      continue;
    }

    try {
      // Use Supabase's SQL execution capability
      // Note: Supabase doesn't have a direct rename table function via client
      // We need to use raw SQL via the SQL editor or direct database connection

      // For now, we'll use the workaround of checking if we can access the renamed table
      // In production, this SQL should be run directly via psql or Supabase SQL Editor

      console.log(`  ⚠ ${table.old}: Requires direct SQL execution`);
      console.log(`    Run: ALTER TABLE ${table.old} RENAME TO ${table.new};`);

      // Mark for manual execution
      archived.push({ ...table, manual: true });
    } catch (e) {
      errors.push({ table: table.old, error: e.message });
      console.log(`  ✗ ${table.old}: ${e.message}`);
    }
  }
  console.log("");

  // Step 4: Summary
  console.log("═".repeat(60));
  console.log("📊 Migration Summary");
  console.log("═".repeat(60));
  console.log("");

  console.log("⚠️  IMPORTANT: Table renames require direct SQL execution.");
  console.log("   Run the following SQL commands in Supabase SQL Editor:");
  console.log("");
  console.log("   -- Archive V1 Tables");
  console.log("   DROP VIEW IF EXISTS team_elo CASCADE;");

  for (const table of TABLES_TO_ARCHIVE) {
    const exists = await tableExists(table.old);
    if (exists) {
      console.log(`   ALTER TABLE ${table.old} RENAME TO ${table.new};`);
    }
  }

  console.log("");
  console.log("   -- Add archive comments");
  console.log("   COMMENT ON TABLE teams_deprecated IS 'ARCHIVED V1 (Session 50)';");
  console.log("   COMMENT ON TABLE match_results_deprecated IS 'ARCHIVED V1 (Session 50)';");
  console.log("");

  console.log("Alternatively, run the full SQL migration:");
  console.log("   psql $DATABASE_URL -f scripts/migrations/020_archive_v1_tables.sql");
  console.log("");

  // Generate SQL file for convenience
  const sqlCommands = [
    "-- Migration 020: Archive V1 Tables",
    "-- Generated: " + new Date().toISOString(),
    "",
    "BEGIN;",
    "",
    "DROP VIEW IF EXISTS team_elo CASCADE;",
    "",
  ];

  for (const table of TABLES_TO_ARCHIVE) {
    const exists = await tableExists(table.old);
    if (exists) {
      sqlCommands.push(`-- Archive ${table.description}`);
      sqlCommands.push(`ALTER TABLE ${table.old} RENAME TO ${table.new};`);
      sqlCommands.push(`COMMENT ON TABLE ${table.new} IS 'ARCHIVED V1 Table (Session 50). Kept for historical reference.';`);
      sqlCommands.push("");
    }
  }

  sqlCommands.push("COMMIT;");
  sqlCommands.push("");
  sqlCommands.push("-- Verify archival");
  sqlCommands.push("SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%_deprecated' ORDER BY table_name;");

  console.log("Generated SQL for execution:");
  console.log("─".repeat(60));
  console.log(sqlCommands.join("\n"));
  console.log("─".repeat(60));
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
