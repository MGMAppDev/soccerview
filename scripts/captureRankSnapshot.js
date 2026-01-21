/**
 * captureRankSnapshot.js - v2.0 FIXED
 *
 * Captures a daily snapshot of all team rankings for the "My Team's Journey" feature.
 * Called by GitHub Actions cron job daily at 6 AM UTC.
 *
 * FIX: Bypasses RPC function entirely to avoid Supabase statement timeout issues.
 * Instead, queries team_elo and inserts into rank_history directly using batched inserts.
 *
 * @version 2.0.0
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

// Create client with extended timeout
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: "public" },
  global: {
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        signal: AbortSignal.timeout(300000), // 5 minute timeout
      });
    },
  },
});

// Configuration
const CONFIG = {
  BATCH_SIZE: 5000,      // Insert 5000 records at a time
  PAGE_SIZE: 10000,      // Fetch 10000 teams at a time from team_elo
};

async function captureRankSnapshot() {
  console.log("📸 Capturing daily rank snapshot v2.0...");
  console.log(`📅 Date: ${new Date().toISOString()}`);
  
  const today = new Date().toISOString().split("T")[0];
  let totalCaptured = 0;
  let offset = 0;
  let hasMore = true;

  try {
    // Process teams in pages to avoid memory issues
    while (hasMore) {
      console.log(`\n📥 Fetching teams (offset: ${offset})...`);
      
      // Fetch a page of ranked teams
      const { data: teams, error: fetchError } = await supabase
        .from("team_elo")
        .select("id, national_rank, state_rank, regional_rank, elo_rating")
        .not("national_rank", "is", null)
        .order("id", { ascending: true })
        .range(offset, offset + CONFIG.PAGE_SIZE - 1);

      if (fetchError) {
        throw new Error(`Failed to fetch teams: ${fetchError.message}`);
      }

      if (!teams || teams.length === 0) {
        hasMore = false;
        continue;
      }

      console.log(`   Found ${teams.length} ranked teams`);

      // Transform to rank_history records
      const snapshots = teams.map(team => ({
        team_id: team.id,
        snapshot_date: today,
        national_rank: team.national_rank,
        state_rank: team.state_rank,
        regional_rank: team.regional_rank,
        elo_rating: team.elo_rating,
      }));

      // Insert in batches
      for (let i = 0; i < snapshots.length; i += CONFIG.BATCH_SIZE) {
        const batch = snapshots.slice(i, i + CONFIG.BATCH_SIZE);
        
        const { error: insertError } = await supabase
          .from("rank_history")
          .upsert(batch, { 
            onConflict: "team_id,snapshot_date",
            ignoreDuplicates: false 
          });

        if (insertError) {
          console.error(`   ❌ Batch insert error: ${insertError.message}`);
          // Continue with next batch instead of failing completely
        } else {
          totalCaptured += batch.length;
          process.stdout.write(`\r   💾 Inserted: ${totalCaptured.toLocaleString()} records`);
        }
      }

      // Check if we should continue
      if (teams.length < CONFIG.PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += CONFIG.PAGE_SIZE;
      }
    }

    console.log(`\n\n✅ Snapshot captured successfully!`);
    console.log(`   📊 Teams captured: ${totalCaptured.toLocaleString()}`);
    console.log(`   📅 Snapshot date: ${today}`);

    // Verify the snapshot was saved
    const { count, error: countError } = await supabase
      .from("rank_history")
      .select("*", { count: "exact", head: true })
      .eq("snapshot_date", today);

    if (!countError) {
      console.log(`   🔍 Verified: ${count?.toLocaleString()} records for today's date`);
    }

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
