/**
 * Add UNIQUE constraint on source_match_key
 * ==========================================
 *
 * This enables upsert operations in the validation pipeline.
 *
 * Prerequisites:
 * - All matches must have non-NULL source_match_key (run backfillSourceMatchKey.js first)
 * - No duplicate keys should exist
 *
 * Usage:
 *   node scripts/migrations/addSourceMatchKeyConstraint.js           # Check only
 *   node scripts/migrations/addSourceMatchKeyConstraint.js --apply   # Apply constraint
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DATABASE_URL = process.env.DATABASE_URL;
const shouldApply = process.argv.includes("--apply");

async function main() {
  console.log("🔧 ADD UNIQUE CONSTRAINT ON source_match_key");
  console.log("=".repeat(60));
  console.log(`Mode: ${shouldApply ? "🔴 APPLY (will modify database)" : "🟡 CHECK ONLY"}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Step 1: Check for NULL values
  console.log("Step 1: Checking for NULL values...");
  const { count: nullCount } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .is("source_match_key", null);

  if (nullCount > 0) {
    console.log(`   ❌ Found ${nullCount} NULL values - run backfillSourceMatchKey.js first`);
    process.exit(1);
  }
  console.log("   ✅ No NULL values");

  // Step 2: Check for duplicates (sample check)
  console.log("\nStep 2: Checking for duplicates (sampling 100k records)...");

  const batchSize = 10000;
  const allKeys = new Set();
  let duplicates = [];
  let offset = 0;

  while (offset < 100000) {
    const { data: batch } = await supabase
      .from("matches_v2")
      .select("id, source_match_key")
      .order("id")
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;

    for (const m of batch) {
      if (allKeys.has(m.source_match_key)) {
        duplicates.push(m.source_match_key);
      }
      allKeys.add(m.source_match_key);
    }

    offset += batch.length;
    process.stdout.write(`\r   Checked ${offset.toLocaleString()} records...`);
  }

  console.log("");

  if (duplicates.length > 0) {
    console.log(`   ❌ Found ${duplicates.length} duplicate keys in first 100k records`);
    console.log("   Sample duplicates:");
    for (const d of duplicates.slice(0, 5)) {
      console.log(`     - ${d}`);
    }
    console.log("   Fix duplicates before adding constraint");
    process.exit(1);
  }
  console.log("   ✅ No duplicates found in sample");

  // Step 3: Apply constraint
  if (!shouldApply) {
    console.log("\n⚠️ This was a CHECK ONLY run. Run with --apply to add constraint:");
    console.log("   node scripts/migrations/addSourceMatchKeyConstraint.js --apply");
    return;
  }

  console.log("\nStep 3: Adding UNIQUE constraint...");
  console.log("   SQL: ALTER TABLE matches_v2 ADD CONSTRAINT matches_v2_source_match_key_unique UNIQUE (source_match_key)");

  // We need to use direct SQL for DDL operations
  // Supabase client doesn't support DDL, so we'll need to use psql or the SQL editor
  console.log("");
  console.log("⚠️ NOTE: Supabase JS client cannot execute DDL statements.");
  console.log("");
  console.log("To add the constraint, run this SQL in the Supabase SQL Editor:");
  console.log("");
  console.log("   ALTER TABLE matches_v2");
  console.log("   ADD CONSTRAINT matches_v2_source_match_key_unique");
  console.log("   UNIQUE (source_match_key);");
  console.log("");
  console.log("Or use psql:");
  console.log(`   psql "${DATABASE_URL}" -c "ALTER TABLE matches_v2 ADD CONSTRAINT matches_v2_source_match_key_unique UNIQUE (source_match_key);"`);
  console.log("");

  // Try via RPC if available
  try {
    const { error } = await supabase.rpc("execute_ddl", {
      ddl_statement: "ALTER TABLE matches_v2 ADD CONSTRAINT matches_v2_source_match_key_unique UNIQUE (source_match_key)"
    });

    if (!error) {
      console.log("✅ Constraint added successfully via RPC!");
    } else {
      console.log(`RPC failed: ${error.message}`);
      console.log("Please run the SQL manually as shown above.");
    }
  } catch (e) {
    console.log("RPC not available. Please run the SQL manually as shown above.");
  }
}

main().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
