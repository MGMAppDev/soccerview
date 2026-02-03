/**
 * Execute V1 Table Archival
 * Renames V1 tables to *_deprecated
 */

import "dotenv/config";
import pg from "pg";

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  console.log("═".repeat(60));
  console.log("Archiving V1 Tables to *_deprecated");
  console.log("═".repeat(60));
  console.log("");

  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log("Connected to database");

    // Start transaction
    await client.query("BEGIN");

    // 1. Drop dependent view
    console.log("\n1. Dropping dependent views...");
    try {
      await client.query("DROP VIEW IF EXISTS team_elo CASCADE");
      console.log("   ✓ Dropped team_elo view");
    } catch (e) {
      console.log("   ⚠ View may not exist:", e.message);
    }

    // 2. Rename tables
    console.log("\n2. Renaming V1 tables...");

    const renames = [
      ["teams", "teams_deprecated"],
      ["match_results", "match_results_deprecated"],
      ["event_registry", "event_registry_deprecated"],
      ["team_name_aliases", "team_name_aliases_deprecated"],
      ["rank_history", "rank_history_deprecated"],
      ["predictions", "predictions_deprecated"],
    ];

    for (const [oldName, newName] of renames) {
      try {
        // Check if table exists
        const check = await client.query(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public')`,
          [oldName]
        );

        if (check.rows[0].exists) {
          await client.query(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
          console.log(`   ✓ ${oldName} → ${newName}`);
        } else {
          console.log(`   ○ ${oldName} not found (skip)`);
        }
      } catch (e) {
        console.log(`   ✗ ${oldName}: ${e.message}`);
      }
    }

    // 3. Add comments
    console.log("\n3. Adding archive comments...");
    try {
      await client.query(`COMMENT ON TABLE teams_deprecated IS 'ARCHIVED V1 (Session 50). Use teams_v2.'`);
      await client.query(`COMMENT ON TABLE match_results_deprecated IS 'ARCHIVED V1 (Session 50). Use matches_v2.'`);
      await client.query(`COMMENT ON TABLE event_registry_deprecated IS 'ARCHIVED V1 (Session 50). Use leagues/tournaments.'`);
      console.log("   ✓ Comments added");
    } catch (e) {
      console.log("   ⚠ Comment error:", e.message);
    }

    // Commit
    await client.query("COMMIT");
    console.log("\n✅ Transaction committed");

    // 4. Verify
    console.log("\n4. Verification...");
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE '%_deprecated'
      ORDER BY table_name
    `);

    console.log("   Archived tables:");
    for (const row of result.rows) {
      console.log(`   - ${row.table_name}`);
    }

    console.log("\n" + "═".repeat(60));
    console.log("V1 TABLE ARCHIVAL COMPLETE");
    console.log("═".repeat(60));
    console.log("\nV1 tables are now *_deprecated (NOT deleted).");
    console.log("V2 tables (teams_v2, matches_v2, etc.) are the active schema.");

  } catch (e) {
    console.error("Error:", e.message);
    await client.query("ROLLBACK");
    console.log("Transaction rolled back");
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
