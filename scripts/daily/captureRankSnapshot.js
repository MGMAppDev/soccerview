/**
 * captureRankSnapshot.js - v3.1 V2 ARCHITECTURE
 *
 * Captures a daily snapshot of all team rankings for the "Ranking Journey" feature.
 * Called by GitHub Actions cron job daily at 6 AM UTC.
 *
 * UNIVERSAL: Captures rank data from ANY source - no source-specific logic.
 * All rank columns are captured if available, NULL if not.
 *
 * V3.1: Added SoccerView rank positions (elo_national_rank, elo_state_rank)
 *   - REQUIRES: Migration 050_add_elo_rank_history_columns.sql
 *   - Captures both GotSport ranks AND SoccerView ELO-based ranks
 *
 * V3.0: Updated for V2 architecture
 *   - Uses teams_v2 instead of team_elo view
 *   - Writes to rank_history_v2 instead of rank_history
 *
 * @version 3.1.0
 * @date January 2026
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing environment variables:");
  console.error(`   SUPABASE_URL: ${SUPABASE_URL ? '✅ Set' : '❌ MISSING'}`);
  console.error(`   SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_KEY ? '✅ Set' : '❌ MISSING'}`);
  console.error("\nAvailable env vars:", Object.keys(process.env).filter(k => k.includes('SUPA') || k.includes('DATABASE')));
  process.exit(1);
}

// Create client - no custom timeout needed, we use small fast queries
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration - Supabase default max is 1000 rows per query
const CONFIG = {
  PAGE_SIZE: 1000,  // Fetch and insert 1000 teams at a time
};

async function captureRankSnapshot() {
  console.log("📸 Capturing daily rank snapshot v3.0 (V2 Architecture)...");
  console.log(`📅 Date: ${new Date().toISOString()}`);
  console.log(`🔗 Supabase URL: ${SUPABASE_URL?.substring(0, 30)}...`);

  const today = new Date().toISOString().split("T")[0];
  let totalCaptured = 0;
  let offset = 0;
  let hasMore = true;
  let pageCount = 0;

  try {
    // Connectivity test - verify rank_history_v2 table exists and is writable
    console.log("🔍 Testing database connectivity (V2 tables)...");
    const { error: testError } = await supabase
      .from("rank_history_v2")
      .select("team_id")
      .limit(1);

    if (testError) {
      throw new Error(`Database connectivity test failed: ${testError.message}`);
    }
    console.log("✅ Database connected successfully\n");
    // Process teams in pages - no count query (it times out in GitHub Actions)
    while (hasMore) {
      pageCount++;

      // Fetch a page of ranked teams from teams_v2 - fast indexed query
      // Capture teams with either GotSport rank OR matches played (have ELO)
      const { data: teams, error: fetchError } = await supabase
        .from("teams_v2")
        .select("id, national_rank, state_rank, elo_rating, elo_national_rank, elo_state_rank")
        .or("national_rank.not.is.null,matches_played.gt.0")
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

      // Transform to rank_history_v2 records
      // Captures both GotSport ranks AND SoccerView ELO-based ranks
      const snapshots = teams.map(team => ({
        team_id: team.id,
        snapshot_date: today,
        national_rank: team.national_rank,           // GotSport national rank
        state_rank: team.state_rank,                 // GotSport state rank
        elo_rating: team.elo_rating,                 // SoccerView ELO rating
        elo_national_rank: team.elo_national_rank,   // SoccerView national rank
        elo_state_rank: team.elo_state_rank,         // SoccerView state rank
      }));

      // Insert batch to rank_history_v2
      const { error: insertError } = await supabase
        .from("rank_history_v2")
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
