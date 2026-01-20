/**
 * captureRankSnapshot.js
 *
 * Captures a daily snapshot of all team rankings for the "My Team's Journey" feature.
 * Called by GitHub Actions cron job daily at 6 AM UTC.
 *
 * @version 1.0.0
 * @date January 2026
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function captureRankSnapshot() {
  console.log("📸 Capturing daily rank snapshot...");
  console.log(`📅 Date: ${new Date().toISOString()}`);

  try {
    // Call the database function to capture snapshot
    const { data, error } = await supabase.rpc("capture_rank_snapshot");

    if (error) {
      throw error;
    }

    if (data && data.length > 0) {
      const result = data[0];
      console.log(`✅ Snapshot captured successfully!`);
      console.log(
        `   📊 Teams captured: ${result.teams_captured.toLocaleString()}`,
      );
      console.log(`   📅 Snapshot date: ${result.snapshot_date_out}`);
    } else {
      console.log("⚠️ No data returned from snapshot function");
    }

    // Verify the snapshot was saved
    const { count, error: countError } = await supabase
      .from("rank_history")
      .select("*", { count: "exact", head: true })
      .eq("snapshot_date", new Date().toISOString().split("T")[0]);

    if (!countError) {
      console.log(`   🔍 Verified: ${count} records for today's date`);
    }

    return true;
  } catch (err) {
    console.error("❌ Error capturing snapshot:", err.message);
    process.exit(1);
  }
}

// Run
captureRankSnapshot()
  .then(() => {
    console.log("\n🏁 Rank snapshot job complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Fatal error:", err);
    process.exit(1);
  });
