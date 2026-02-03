/**
 * Check if staging records are new or duplicates
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Get all pending staging records
  const { data: staging } = await supabase
    .from("staging_games")
    .select("id, source_match_key, home_team_name, away_team_name, match_date, home_score, away_score")
    .eq("processed", false);

  console.log("📋 PENDING STAGING RECORDS:", staging?.length || 0);

  if (!staging || staging.length === 0) {
    console.log("No pending records to check.");
    return;
  }

  // Get unique source_match_keys
  const stagingKeys = staging.map(s => s.source_match_key).filter(k => k);
  console.log("Staging keys with values:", stagingKeys.length);

  if (stagingKeys.length === 0) {
    console.log("No staging records have source_match_key values.");
    return;
  }

  // Check which already exist in matches_v2
  const { data: existing } = await supabase
    .from("matches_v2")
    .select("source_match_key")
    .in("source_match_key", stagingKeys);

  const existingKeys = new Set((existing || []).map(e => e.source_match_key));
  console.log("Already in matches_v2:", existingKeys.size);

  // Find new matches (not in production)
  const newMatches = staging.filter(s => s.source_match_key && !existingKeys.has(s.source_match_key));
  const duplicates = staging.filter(s => s.source_match_key && existingKeys.has(s.source_match_key));
  const noKey = staging.filter(s => !s.source_match_key);

  console.log("\n📊 ANALYSIS:");
  console.log("  NEW matches (not in production):", newMatches.length);
  console.log("  DUPLICATE matches (already exist):", duplicates.length);
  console.log("  Missing source_match_key:", noKey.length);

  if (newMatches.length > 0) {
    console.log("\n📋 SAMPLE NEW MATCHES (should be processed):");
    for (const m of newMatches.slice(0, 10)) {
      const score = m.home_score !== null ? `${m.home_score}-${m.away_score}` : "scheduled";
      console.log(`  ${m.match_date} | ${m.home_team_name} vs ${m.away_team_name} | ${score}`);
    }
  }

  if (duplicates.length > 0) {
    console.log("\n📋 SAMPLE DUPLICATES (safe to mark processed):");
    for (const m of duplicates.slice(0, 5)) {
      console.log(`  ${m.match_date} | ${m.home_team_name} vs ${m.away_team_name}`);
    }
  }

  console.log("\n📊 RECOMMENDATION:");
  if (newMatches.length > 0) {
    console.log(`  ⚠️ ${newMatches.length} NEW matches should be processed through validation pipeline first!`);
  } else {
    console.log("  ✅ All staging records are duplicates - safe to mark as processed.");
  }
}

main().catch(console.error);
