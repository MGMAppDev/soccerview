/**
 * Deduplicate matches by source_match_key
 * =======================================
 *
 * Finds duplicate source_match_key values and removes duplicates,
 * keeping the oldest record (lowest ID).
 *
 * Usage:
 *   node scripts/migrations/deduplicateMatchKeys.js           # Dry run
 *   node scripts/migrations/deduplicateMatchKeys.js --live    # Actually delete
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const isLive = process.argv.includes("--live");

async function main() {
  console.log("🔧 DEDUPLICATE matches_v2 BY source_match_key");
  console.log("=".repeat(60));
  console.log(`Mode: ${isLive ? "🔴 LIVE (will delete duplicates)" : "🟡 DRY RUN (no changes)"}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Find all duplicate keys by scanning the table
  console.log("Step 1: Finding duplicate keys...");

  const keyOccurrences = new Map(); // key -> array of match IDs
  const batchSize = 10000;
  let offset = 0;
  let totalScanned = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from("matches_v2")
      .select("id, source_match_key")
      .order("id")
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`\n❌ Error fetching: ${error.message}`);
      break;
    }

    if (!batch || batch.length === 0) break;

    for (const m of batch) {
      if (!keyOccurrences.has(m.source_match_key)) {
        keyOccurrences.set(m.source_match_key, []);
      }
      keyOccurrences.get(m.source_match_key).push(m.id);
    }

    totalScanned += batch.length;
    offset += batch.length;
    process.stdout.write(`\r   Scanned ${totalScanned.toLocaleString()} records...`);
  }

  console.log(`\n   Total scanned: ${totalScanned.toLocaleString()}`);

  // Find keys with multiple occurrences
  const duplicateKeys = [];
  for (const [key, ids] of keyOccurrences) {
    if (ids.length > 1) {
      duplicateKeys.push({ key, ids });
    }
  }

  console.log(`   Duplicate keys found: ${duplicateKeys.length}`);

  if (duplicateKeys.length === 0) {
    console.log("\n✅ No duplicates to remove!");
    return;
  }

  // Calculate IDs to delete (keep the first/oldest, delete the rest)
  const idsToDelete = [];
  for (const { key, ids } of duplicateKeys) {
    // Sort IDs to keep the lowest (oldest)
    ids.sort();
    // Delete all except the first
    idsToDelete.push(...ids.slice(1));
  }

  console.log(`   Records to delete: ${idsToDelete.length}`);

  // Show sample
  console.log("\nStep 2: Sample duplicates to delete:");
  for (const { key, ids } of duplicateKeys.slice(0, 5)) {
    console.log(`   ${key}: keep ${ids[0]}, delete ${ids.slice(1).join(", ")}`);
  }

  // Delete duplicates
  if (!isLive) {
    console.log("\n⚠️ This was a DRY RUN. Run with --live to delete duplicates:");
    console.log("   node scripts/migrations/deduplicateMatchKeys.js --live");
    return;
  }

  console.log("\nStep 3: Deleting duplicates...");

  let deleted = 0;
  let errors = 0;

  // Delete in batches
  const deleteBatchSize = 100;
  for (let i = 0; i < idsToDelete.length; i += deleteBatchSize) {
    const batch = idsToDelete.slice(i, i + deleteBatchSize);

    const { error } = await supabase
      .from("matches_v2")
      .delete()
      .in("id", batch);

    if (error) {
      console.error(`   ❌ Delete error: ${error.message}`);
      errors++;
    } else {
      deleted += batch.length;
    }

    process.stdout.write(`\r   Deleted ${deleted}/${idsToDelete.length}...`);
  }

  console.log("\n");

  // Verify
  const { count: remainingDupes } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .in("source_match_key", duplicateKeys.slice(0, 100).map(d => d.key));

  console.log("=".repeat(60));
  console.log("📊 DEDUPLICATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`   Duplicate keys found: ${duplicateKeys.length}`);
  console.log(`   Records deleted: ${deleted}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Completed: ${new Date().toISOString()}`);
}

main().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
