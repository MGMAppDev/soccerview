/**
 * Verify Integration Test Results
 * ================================
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log("🔍 INTEGRATION TEST VERIFICATION");
  console.log("=".repeat(60));

  // 1. Check staging status
  const { count: totalStaging } = await supabase
    .from("staging_games")
    .select("*", { count: "exact", head: true });

  const { count: unprocessedStaging } = await supabase
    .from("staging_games")
    .select("*", { count: "exact", head: true })
    .eq("processed", false);

  console.log("\n📊 STAGING STATUS");
  console.log(`   Total: ${totalStaging}`);
  console.log(`   Unprocessed: ${unprocessedStaging}`);
  console.log(`   Processed: ${totalStaging - unprocessedStaging}`);

  // 2. Check matches from event 39064 in matches_v2
  const { data: mtOliveMatches, error } = await supabase
    .from("matches_v2")
    .select("id, match_date, home_team_id, away_team_id, home_score, away_score, tournament_id, league_id, source_match_key")
    .like("source_match_key", "gotsport-39064%")
    .limit(20);

  if (error) {
    console.log(`\n❌ Error querying matches_v2: ${error.message}`);
  } else {
    console.log(`\n📋 MT OLIVE CUP MATCHES IN PRODUCTION (matches_v2)`);
    console.log(`   Found: ${mtOliveMatches?.length || 0} matches with source_match_key 'gotsport-39064%'`);

    if (mtOliveMatches && mtOliveMatches.length > 0) {
      // Check linkage
      const linked = mtOliveMatches.filter(m => m.tournament_id || m.league_id);
      const unlinked = mtOliveMatches.filter(m => !m.tournament_id && !m.league_id);

      console.log(`   Linked: ${linked.length}`);
      console.log(`   Unlinked: ${unlinked.length}`);

      console.log("\n   Sample matches:");
      for (const m of mtOliveMatches.slice(0, 5)) {
        const linkStatus = m.tournament_id ? `tournament:${m.tournament_id}` :
                          m.league_id ? `league:${m.league_id}` : "UNLINKED";
        console.log(`   - ${m.match_date} | ${m.home_score}-${m.away_score} | ${linkStatus}`);
        console.log(`     Key: ${m.source_match_key}`);
      }
    }
  }

  // 3. Check teams created/linked
  const { data: recentTeams } = await supabase
    .from("teams_v2")
    .select("id, name, club_id, birth_year")
    .order("id", { ascending: false })
    .limit(10);

  console.log("\n📋 RECENTLY CREATED TEAMS");
  for (const t of recentTeams || []) {
    const clubStatus = t.club_id ? `✅ linked to club ${t.club_id}` : "⚠️ no club";
    console.log(`   - [${t.id}] ${t.name} (${t.birth_year || "no year"}) - ${clubStatus}`);
  }

  // 4. Overall metrics
  const { count: totalMatches } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true });

  const { count: totalTeams } = await supabase
    .from("teams_v2")
    .select("*", { count: "exact", head: true });

  const { count: unlinkedMatches } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .is("league_id", null)
    .is("tournament_id", null);

  console.log("\n📊 FINAL METRICS");
  console.log(`   Total matches_v2: ${totalMatches}`);
  console.log(`   Total teams_v2: ${totalTeams}`);
  console.log(`   Unlinked matches: ${unlinkedMatches}`);
  console.log(`   Link rate: ${((totalMatches - unlinkedMatches) / totalMatches * 100).toFixed(2)}%`);

  // 5. Compare to baseline
  console.log("\n📊 COMPARISON TO BASELINE");
  console.log("   Before → After");
  console.log(`   staging_games: 8581 → ${totalStaging} (+${totalStaging - 8581})`);
  console.log(`   matches_v2: 300511 → ${totalMatches} (+${totalMatches - 300511})`);
  console.log(`   teams_v2: 142541 → ${totalTeams} (+${totalTeams - 142541})`);
  console.log(`   unlinked: 5789 → ${unlinkedMatches} (${unlinkedMatches - 5789 >= 0 ? '+' : ''}${unlinkedMatches - 5789})`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ INTEGRATION TEST VERIFICATION COMPLETE");
  console.log("=".repeat(60));
}

main().catch(error => {
  console.error("❌ Error:", error);
  process.exit(1);
});
