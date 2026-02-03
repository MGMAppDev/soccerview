/**
 * Backfill source_match_key for matches_v2
 * =========================================
 *
 * Generates unique keys for all matches with NULL source_match_key.
 *
 * Key format for legacy data:
 *   legacy-{eventId8}-{homeId8}-{awayId8}-{date}
 *
 * Uses efficient batch updates for performance.
 *
 * Usage:
 *   node scripts/migrations/backfillSourceMatchKey.js           # Dry run
 *   node scripts/migrations/backfillSourceMatchKey.js --live    # Actually update
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 500;
const isLive = process.argv.includes("--live");

function generateLegacyKey(match) {
  const eventId = (match.tournament_id || match.league_id || "noevt000").substring(0, 8);
  const homeId = (match.home_team_id || "nohome00").substring(0, 8);
  const awayId = (match.away_team_id || "noaway00").substring(0, 8);
  const date = match.match_date || "nodate";

  return `legacy-${eventId}-${homeId}-${awayId}-${date}`.toLowerCase();
}

async function main() {
  console.log("🔧 BACKFILL source_match_key FOR matches_v2");
  console.log("=".repeat(60));
  console.log(`Mode: ${isLive ? "🔴 LIVE (will update database)" : "🟡 DRY RUN (no changes)"}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Count matches needing backfill
  const { count: totalNull } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .is("source_match_key", null);

  console.log(`Matches with NULL source_match_key: ${totalNull}\n`);

  if (totalNull === 0) {
    console.log("✅ No matches need backfill!");
    return;
  }

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  const allKeys = new Map(); // Track all keys to handle duplicates

  const startTime = Date.now();

  // Process in batches
  while (totalProcessed < totalNull) {
    // Fetch batch of NULL key matches
    const { data: batch, error: fetchError } = await supabase
      .from("matches_v2")
      .select("id, match_date, home_team_id, away_team_id, tournament_id, league_id")
      .is("source_match_key", null)
      .order("id")
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error(`\n❌ Fetch error: ${fetchError.message}`);
      totalErrors++;
      break;
    }

    if (!batch || batch.length === 0) {
      break;
    }

    // Generate keys and prepare updates
    const updates = [];
    for (const match of batch) {
      let key = generateLegacyKey(match);

      // Handle duplicates by appending match ID suffix
      if (allKeys.has(key)) {
        key = `${key}-${match.id.substring(0, 8)}`;
      }
      allKeys.set(key, match.id);

      updates.push({ id: match.id, key: key });
    }

    // Apply updates
    if (isLive) {
      let batchUpdated = 0;

      // Use Promise.all for parallel updates within batch
      const updatePromises = updates.map(async (upd) => {
        const { error } = await supabase
          .from("matches_v2")
          .update({ source_match_key: upd.key })
          .eq("id", upd.id);

        if (error) {
          totalErrors++;
          return false;
        }
        return true;
      });

      const results = await Promise.all(updatePromises);
      batchUpdated = results.filter(r => r).length;
      totalUpdated += batchUpdated;
    } else {
      totalUpdated += updates.length;
    }

    totalProcessed += batch.length;

    // Progress
    const pct = ((totalProcessed / totalNull) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (totalProcessed / elapsed).toFixed(0);
    process.stdout.write(`\r   Processed ${totalProcessed.toLocaleString()}/${totalNull.toLocaleString()} (${pct}%) - ${rate}/sec - Errors: ${totalErrors}    `);
  }

  console.log("\n");

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("=".repeat(60));
  console.log("📊 BACKFILL SUMMARY");
  console.log("=".repeat(60));
  console.log(`   Matches processed: ${totalProcessed.toLocaleString()}`);
  console.log(`   Keys generated: ${totalUpdated.toLocaleString()}`);
  console.log(`   Errors: ${totalErrors}`);
  console.log(`   Runtime: ${totalTime}s`);
  console.log(`   Mode: ${isLive ? "LIVE" : "DRY RUN"}`);
  console.log(`   Completed: ${new Date().toISOString()}`);

  if (isLive && totalUpdated > 0) {
    // Verify remaining NULLs
    const { count: remaining } = await supabase
      .from("matches_v2")
      .select("*", { count: "exact", head: true })
      .is("source_match_key", null);

    console.log(`\n🔍 Verification:`);
    console.log(`   Remaining NULL keys: ${remaining}`);
  }

  if (!isLive) {
    console.log("\n⚠️ This was a DRY RUN. Run with --live to apply changes:");
    console.log("   node scripts/migrations/backfillSourceMatchKey.js --live");
  }
}

main().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
