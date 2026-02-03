/**
 * Analyze source_match_key data in matches_v2
 * ============================================
 *
 * Determines the best strategy for backfilling NULL keys
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log("🔍 ANALYZING source_match_key IN matches_v2");
  console.log("=".repeat(60));

  // 1. Count total matches
  const { count: totalMatches } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true });

  console.log(`\nTotal matches: ${totalMatches}`);

  // 2. Count NULL source_match_key
  const { count: nullKeys } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .is("source_match_key", null);

  console.log(`NULL source_match_key: ${nullKeys} (${(nullKeys/totalMatches*100).toFixed(1)}%)`);

  // 3. Count non-NULL source_match_key
  const nonNullKeys = totalMatches - nullKeys;
  console.log(`Non-NULL source_match_key: ${nonNullKeys} (${(nonNullKeys/totalMatches*100).toFixed(1)}%)`);

  // 4. Sample existing key formats
  const { data: sampleKeys } = await supabase
    .from("matches_v2")
    .select("source_match_key")
    .not("source_match_key", "is", null)
    .limit(20);

  console.log("\n📋 EXISTING KEY FORMATS:");
  const formats = new Map();
  for (const s of sampleKeys || []) {
    const key = s.source_match_key;
    const prefix = key.split("-").slice(0, 2).join("-");
    formats.set(prefix, (formats.get(prefix) || 0) + 1);
  }
  for (const [prefix, count] of formats) {
    console.log(`   ${prefix}-*: ${count} samples`);
  }

  // 5. Check what data is available for NULL key matches
  const { data: nullSamples } = await supabase
    .from("matches_v2")
    .select("id, match_date, home_team_id, away_team_id, tournament_id, league_id, home_score, away_score")
    .is("source_match_key", null)
    .limit(10);

  console.log("\n📋 SAMPLE MATCHES WITH NULL KEYS:");
  for (const m of nullSamples || []) {
    const eventType = m.tournament_id ? "T" : m.league_id ? "L" : "?";
    const eventId = m.tournament_id || m.league_id || "none";
    console.log(`   ${m.match_date} | ${m.home_score}-${m.away_score} | ${eventType}:${eventId.substring(0,8)}... | home:${m.home_team_id?.substring(0,8)}...`);
  }

  // 6. Check for potential duplicates (same date, teams)
  console.log("\n📋 CHECKING FOR DUPLICATES (same date + teams):");

  const { data: dupCheck } = await supabase.rpc("check_match_duplicates");

  // If RPC doesn't exist, do a simple check
  if (!dupCheck) {
    const { data: sample } = await supabase
      .from("matches_v2")
      .select("match_date, home_team_id, away_team_id")
      .is("source_match_key", null)
      .limit(100);

    const seen = new Set();
    let dupes = 0;
    for (const m of sample || []) {
      const key = `${m.match_date}-${m.home_team_id}-${m.away_team_id}`;
      if (seen.has(key)) dupes++;
      seen.add(key);
    }
    console.log(`   Sample of 100 NULL-key matches: ${dupes} potential duplicates`);
  }

  // 7. Breakdown by source
  console.log("\n📋 NULL KEYS BY EVENT TYPE:");

  const { count: nullWithTournament } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .is("source_match_key", null)
    .not("tournament_id", "is", null);

  const { count: nullWithLeague } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .is("source_match_key", null)
    .not("league_id", "is", null);

  const { count: nullNoEvent } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .is("source_match_key", null)
    .is("tournament_id", null)
    .is("league_id", null);

  console.log(`   With tournament_id: ${nullWithTournament}`);
  console.log(`   With league_id: ${nullWithLeague}`);
  console.log(`   No event (unlinked): ${nullNoEvent}`);

  // 8. Recommendation
  console.log("\n" + "=".repeat(60));
  console.log("📋 RECOMMENDED BACKFILL STRATEGY:");
  console.log("=".repeat(60));
  console.log(`
Key format: {source}-{eventId}-{homeTeamId}-{awayTeamId}-{date}

Where:
  - source: Inferred from event source or 'legacy'
  - eventId: tournament_id or league_id (first 8 chars of UUID)
  - homeTeamId: home_team_id (first 8 chars of UUID)
  - awayTeamId: away_team_id (first 8 chars of UUID)
  - date: match_date (YYYY-MM-DD)

This ensures uniqueness even for same-day rematches by including team IDs.
`);

  console.log("\n📋 NEXT STEPS:");
  console.log("   1. Run backfill script to populate NULL keys");
  console.log("   2. Verify no duplicates exist");
  console.log("   3. Add UNIQUE constraint on source_match_key");
}

main().catch(console.error);
