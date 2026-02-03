/**
 * Integration Test: Universal Scraper → Full Pipeline
 * ====================================================
 *
 * Tests the complete data flow:
 * 1. Universal scraper writes to staging_games
 * 2. Validation pipeline processes staging → production
 * 3. Inference linkage heals orphan matches
 *
 * Usage: node scripts/_debug/integrationTest.js
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getMetrics() {
  const metrics = {};

  // Staging counts
  const { count: stagingCount } = await supabase
    .from("staging_games")
    .select("*", { count: "exact", head: true });
  metrics.stagingGames = stagingCount;

  const { count: unprocessedStaging } = await supabase
    .from("staging_games")
    .select("*", { count: "exact", head: true })
    .eq("processed", false);
  metrics.unprocessedStaging = unprocessedStaging;

  // Production counts
  const { count: matchesV2 } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true });
  metrics.matchesV2 = matchesV2;

  const { count: teamsV2 } = await supabase
    .from("teams_v2")
    .select("*", { count: "exact", head: true });
  metrics.teamsV2 = teamsV2;

  // Unlinked matches
  const { count: unlinked } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .is("league_id", null)
    .is("tournament_id", null);
  metrics.unlinkedMatches = unlinked;

  // Link rate
  metrics.linkRate = matchesV2 > 0 ? ((matchesV2 - unlinked) / matchesV2 * 100).toFixed(2) : 0;

  return metrics;
}

async function main() {
  console.log("🔬 INTEGRATION TEST: Universal Scraper → Full Pipeline");
  console.log("=".repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Step 1: Capture baseline metrics
  console.log("📊 BASELINE METRICS");
  console.log("-".repeat(40));
  const before = await getMetrics();
  console.log(`   staging_games: ${before.stagingGames} (${before.unprocessedStaging} unprocessed)`);
  console.log(`   matches_v2: ${before.matchesV2}`);
  console.log(`   teams_v2: ${before.teamsV2}`);
  console.log(`   unlinked matches: ${before.unlinkedMatches}`);
  console.log(`   link rate: ${before.linkRate}%`);

  // Step 2: Find test data - staging_games written by universal scraper
  console.log("\n📋 CHECKING FOR TEST DATA");
  console.log("-".repeat(40));

  // Look for recently added staging records
  const { data: recentStaging, error } = await supabase
    .from("staging_games")
    .select("id, source_platform, source_match_key, home_team_name, away_team_name, match_date, processed, created_at")
    .eq("processed", false)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("   ❌ Error querying staging:", error.message);
    return;
  }

  if (!recentStaging || recentStaging.length === 0) {
    console.log("   ⚠️ No unprocessed staging data found");
    console.log("   Run the universal scraper first (without --dry-run)");
    console.log("\n   Example:");
    console.log("   node scripts/universal/coreScraper.js --adapter gotsport --event 39064");
    return;
  }

  console.log(`   Found ${recentStaging.length} unprocessed staging records`);
  console.log("\n   Sample records:");
  for (const r of recentStaging.slice(0, 5)) {
    console.log(`   - ${r.source_platform}: ${r.home_team_name} vs ${r.away_team_name} (${r.match_date})`);
  }

  // Step 3: Output instructions
  console.log("\n" + "=".repeat(60));
  console.log("📋 NEXT STEPS");
  console.log("=".repeat(60));
  console.log(`
1. RUN UNIVERSAL SCRAPER (if not already done):
   node scripts/universal/coreScraper.js --adapter gotsport --event 39064

2. RUN VALIDATION PIPELINE:
   node scripts/daily/validationPipeline.js --refresh-views

3. RUN INFERENCE LINKAGE:
   node scripts/maintenance/inferEventLinkage.js

4. RUN THIS SCRIPT AGAIN to see the AFTER metrics
`);

  // Save baseline for comparison
  const baselineFile = "C:/Users/mathi/AppData/Local/Temp/claude/integration_test_baseline.json";
  const fs = await import("fs");
  fs.writeFileSync(baselineFile, JSON.stringify({ timestamp: new Date().toISOString(), metrics: before }, null, 2));
  console.log(`   Baseline saved to: ${baselineFile}`);
}

main().catch(error => {
  console.error("❌ Error:", error);
  process.exit(1);
});
