/**
 * Apply UNIQUE constraint on source_match_key via pg client
 * ==========================================================
 *
 * Uses the pg package to execute DDL since Supabase JS can't do it.
 */

import pg from "pg";
import "dotenv/config";

const { Client } = pg;

async function main() {
  console.log("🔧 APPLYING UNIQUE CONSTRAINT ON source_match_key");
  console.log("=".repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("✅ Connected to database\n");

    // Check if constraint already exists
    const checkResult = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'matches_v2'
      AND constraint_name = 'matches_v2_source_match_key_unique'
    `);

    if (checkResult.rows.length > 0) {
      console.log("✅ Constraint already exists!");
      return;
    }

    console.log("Adding UNIQUE constraint...");
    console.log("SQL: ALTER TABLE matches_v2 ADD CONSTRAINT matches_v2_source_match_key_unique UNIQUE (source_match_key)\n");

    await client.query(`
      ALTER TABLE matches_v2
      ADD CONSTRAINT matches_v2_source_match_key_unique
      UNIQUE (source_match_key)
    `);

    console.log("✅ UNIQUE constraint added successfully!");

    // Verify
    const verifyResult = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'matches_v2'
      AND constraint_name = 'matches_v2_source_match_key_unique'
    `);

    if (verifyResult.rows.length > 0) {
      console.log("✅ Verified: Constraint exists in database");
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\nCompleted: ${new Date().toISOString()}`);
}

main();
