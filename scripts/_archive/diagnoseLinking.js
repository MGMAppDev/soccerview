/**
 * Diagnostic script to analyze team linking failures
 *
 * This script helps identify WHY teams aren't being linked:
 * 1. Team names don't exist in team_elo at all
 * 2. Team names are too different (low similarity)
 * 3. The find_similar_team RPC function issues
 *
 * Usage: node scripts/diagnoseLinking.js
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log("=".repeat(60));
  console.log("🔍 TEAM LINKING DIAGNOSTIC");
  console.log("=".repeat(60));
  console.log("");

  // 1. Get overall stats
  const { count: totalMatches } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true });

  const { count: totalTeams } = await supabase
    .from("team_elo")
    .select("*", { count: "exact", head: true });

  const { count: homeLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("home_team_id", "is", null);

  const { count: awayLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("away_team_id", "is", null);

  console.log("📊 CURRENT STATUS:");
  console.log(`   Total matches: ${totalMatches?.toLocaleString()}`);
  console.log(`   Total teams in team_elo: ${totalTeams?.toLocaleString()}`);
  console.log(
    `   Home linked: ${homeLinked?.toLocaleString()} (${((homeLinked / totalMatches) * 100).toFixed(1)}%)`,
  );
  console.log(
    `   Away linked: ${awayLinked?.toLocaleString()} (${((awayLinked / totalMatches) * 100).toFixed(1)}%)`,
  );
  console.log("");

  // 2. Get sample of unlinked home teams
  console.log("🏠 SAMPLE UNLINKED HOME TEAMS:");
  const { data: unlinkedHome } = await supabase
    .from("match_results")
    .select("home_team_name")
    .is("home_team_id", null)
    .not("home_team_name", "is", null)
    .limit(20);

  const uniqueHomeNames = [
    ...new Set((unlinkedHome || []).map((r) => r.home_team_name)),
  ].slice(0, 10);

  for (const name of uniqueHomeNames) {
    // Check exact match
    const { data: exact } = await supabase
      .from("team_elo")
      .select("id, team_name")
      .ilike("team_name", name)
      .limit(1);

    // Check fuzzy match via RPC
    const { data: fuzzy, error: rpcError } = await supabase.rpc(
      "find_similar_team",
      {
        search_name: name.toLowerCase(),
      },
    );

    if (exact?.length) {
      console.log(`   ✅ "${name}" → EXACT: "${exact[0].team_name}"`);
    } else if (fuzzy?.length && fuzzy[0].sim >= 0.3) {
      console.log(
        `   🔶 "${name}" → FUZZY (${(fuzzy[0].sim * 100).toFixed(0)}%): "${fuzzy[0].team_name}"`,
      );
    } else if (rpcError) {
      console.log(`   ❌ "${name}" → RPC ERROR: ${rpcError.message}`);
    } else {
      // Try to find ANY similar team
      const { data: partial } = await supabase
        .from("team_elo")
        .select("team_name")
        .ilike("team_name", `%${name.split(" ")[0]}%`)
        .limit(3);

      if (partial?.length) {
        console.log(`   ❌ "${name}" → NO MATCH, but found similar:`);
        partial.forEach((t) => console.log(`      - "${t.team_name}"`));
      } else {
        console.log(
          `   ❌ "${name}" → NO MATCH (team may not exist in rankings)`,
        );
      }
    }
  }
  console.log("");

  // 3. Test the find_similar_team RPC function
  console.log("🔧 RPC FUNCTION TEST:");
  const testNames = uniqueHomeNames.slice(0, 3);
  for (const name of testNames) {
    const { data, error } = await supabase.rpc("find_similar_team", {
      search_name: name.toLowerCase(),
    });

    if (error) {
      console.log(`   ❌ RPC Error for "${name}": ${error.message}`);
    } else if (data?.length) {
      console.log(
        `   ✅ RPC returns for "${name}": ${JSON.stringify(data[0])}`,
      );
    } else {
      console.log(`   ⚠️ RPC returns empty for "${name}"`);
    }
  }
  console.log("");

  // 4. Check pg_trgm threshold
  console.log("⚙️ CONFIGURATION CHECK:");
  const { data: threshold } = await supabase
    .rpc("exec_sql", {
      query: "SHOW pg_trgm.similarity_threshold;",
    })
    .catch(() => ({ data: null }));

  if (threshold) {
    console.log(
      `   pg_trgm.similarity_threshold: ${JSON.stringify(threshold)}`,
    );
  } else {
    console.log("   (exec_sql RPC not available - can't check threshold)");
  }

  // 5. Summary and recommendations
  console.log("");
  console.log("=".repeat(60));
  console.log("💡 DIAGNOSIS SUMMARY:");
  console.log("=".repeat(60));

  const linkRate = (
    ((homeLinked + awayLinked) / (totalMatches * 2)) *
    100
  ).toFixed(1);

  if (linkRate < 20) {
    console.log("   ⚠️ LOW LINK RATE (<20%)");
    console.log("");
    console.log("   Possible causes:");
    console.log("   1. Team names in match_results don't exist in team_elo");
    console.log("      → Many scraped teams may be recreational/local clubs");
    console.log("      → Not all tournament teams have GotSport rankings");
    console.log("");
    console.log("   2. Team naming conventions differ significantly");
    console.log("      → 'FC Dallas 08B' vs 'FC Dallas 2008 Boys Academy'");
    console.log("      → Consider lowering similarity threshold to 0.3-0.4");
    console.log("");
    console.log("   3. The find_similar_team RPC may need adjustment");
    console.log("      → Check if pg_trgm extension is enabled");
    console.log("      → Verify trigram index exists on team_name");
  } else {
    console.log(`   Link rate is ${linkRate}% - working reasonably well`);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("✅ Diagnostic complete!");
}

main().catch(console.error);
