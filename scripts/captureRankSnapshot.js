/**
 * captureRankSnapshot.js - v2.2 GITHUB ACTIONS FIX
 *
 * Captures a daily snapshot of all team rankings for the "My Team's Journey" feature.
 * Called by GitHub Actions cron job daily at 6 AM UTC.
 *
 * FIX v2.2: Remove count query that times out in GitHub Actions
 * FIX v2.1: Use 1000 page size (Supabase default max) and proper pagination
 * FIX v2.0: Bypasses RPC function entirely to avoid Supabase statement timeout issues.
 *
 * @version 2.2.0
 * @date January 2026
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Create client - no custom timeout needed, we use small fast queries
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration - Supabase default max is 1000 rows per query
const CONFIG = {
  PAGE_SIZE: 1000,  // Fetch and insert 1000 teams at a time
};

async function captureRankSnapshot() {
  console.log("📸 Capturing daily rank snapshot v2.2...");
  console.log(`📅 Date: ${new Date().toISOString()}`);
  
  const today = new Date().toISOString().split("T")[0];
  let totalCaptured = 0;
  let offset = 0;
  let hasMore = true;
  let pageCount = 0;

  try {
    // Process teams in pages - no count query (it times out in GitHub Actions)
    while (hasMore) {
      pageCount++;
      
      // Fetch a page of ranked teams - fast indexed query
      const { data: teams, error: fetchError } = await supabase
        .from("team_elo")
        .select("id, national_rank, state_rank, regional_rank, elo_rating")
        .not("national_rank", "is", null)
        .order("id", { ascending: true })
        .range(offset, offset + CONFIG.PAGE_SIZE - 1);

      if (fetchError) {
        throw new Error(`Failed to fetch teams (page ${pageCount}): ${fetchError.message}`);
      }

      if (!teams || teams.length === 0) {
        hasMore = false;
        console.log(`   Page ${pageCount}: No more teams`);
        continue;
      }

      // Transform to rank_history records
      const snapshots = teams.map(team => ({
        team_id: team.id,
        snapshot_date: today,
        national_rank: team.national_rank,
        state_rank: team.state_rank,
        regional_rank: team.regional_rank,
        elo_rating: team.elo_rating,
      }));

      // Insert batch
      const { error: insertError } = await supabase
        .from("rank_history")
        .upsert(snapshots, { 
          onConflict: "team_id,snapshot_date",
          ignoreDuplicates: false 
        });

      if (insertError) {
        console.error(`   ❌ Insert error on page ${pageCount}: ${insertError.message}`);
        // Continue with next page instead of failing completely
      } else {
        totalCaptured += teams.length;
      }

      // Progress update every 10 pages
      if (pageCount % 10 === 0) {
        console.log(`   📥 Page ${pageCount}: ${totalCaptured.toLocaleString()} captured`);
      }

      // Check if we should continue - if we got a full page, there might be more
      if (teams.length < CONFIG.PAGE_SIZE) {
        hasMore = false;
        console.log(`   📥 Page ${pageCount}: ${totalCaptured.toLocaleString()} captured (final)`);
      } else {
        offset += CONFIG.PAGE_SIZE;
      }
    }

    console.log(`\n✅ Snapshot captured successfully!`);
    console.log(`   📊 Teams captured: ${totalCaptured.toLocaleString()}`);
    console.log(`   📅 Snapshot date: ${today}`);
    console.log(`   📄 Pages processed: ${pageCount}`);

    return { success: true, teams_captured: totalCaptured, snapshot_date: today };
    
  } catch (err) {
    console.error("\n❌ Error capturing snapshot:", err.message);
    process.exit(1);
  }
}

// Run
captureRankSnapshot()
  .then((result) => {
    console.log("\n🏁 Rank snapshot job complete!");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Fatal error:", err);
    process.exit(1);
  });
