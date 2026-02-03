/**
 * Find staging matches that already exist in production with legacy keys
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Get all pending staging records for Event 39064
  const { data: staging } = await supabase
    .from("staging_games")
    .select("*")
    .eq("event_id", "39064")
    .eq("processed", false);

  console.log("📋 CHECKING", staging?.length, "STAGING RECORDS FOR DUPLICATES");
  console.log("=".repeat(60));

  let duplicates = 0;
  let newMatches = 0;
  const sampleDuplicates = [];
  const sampleNew = [];

  for (const s of staging || []) {
    // We need to find the team IDs first
    // Search for teams by name similarity
    const { data: homeTeams } = await supabase
      .from("teams_v2")
      .select("id, name")
      .ilike("name", `%${s.home_team_name.split(" ").slice(0, 2).join(" ")}%`)
      .limit(5);

    const { data: awayTeams } = await supabase
      .from("teams_v2")
      .select("id, name")
      .ilike("name", `%${s.away_team_name.split(" ").slice(0, 2).join(" ")}%`)
      .limit(5);

    if (!homeTeams?.length || !awayTeams?.length) {
      newMatches++;
      if (sampleNew.length < 5) {
        sampleNew.push({ staging: s, reason: "teams not found" });
      }
      continue;
    }

    // Check if any combination matches existing data
    let foundDupe = false;
    for (const home of homeTeams) {
      for (const away of awayTeams) {
        const { data: existing } = await supabase
          .from("matches_v2")
          .select("id, source_match_key")
          .eq("match_date", s.match_date)
          .eq("home_team_id", home.id)
          .eq("away_team_id", away.id)
          .eq("home_score", s.home_score)
          .eq("away_score", s.away_score)
          .limit(1);

        if (existing?.length > 0) {
          duplicates++;
          foundDupe = true;
          if (sampleDuplicates.length < 10) {
            sampleDuplicates.push({
              staging: s,
              existing: existing[0],
              homeTeam: home.name,
              awayTeam: away.name,
            });
          }
          break;
        }
      }
      if (foundDupe) break;
    }

    if (!foundDupe) {
      newMatches++;
      if (sampleNew.length < 5) {
        sampleNew.push({ staging: s, reason: "no match found" });
      }
    }
  }

  console.log("\n📊 RESULTS:");
  console.log("  Duplicates (already exist):", duplicates);
  console.log("  New matches:", newMatches);

  if (sampleDuplicates.length > 0) {
    console.log("\n📋 SAMPLE DUPLICATES:");
    for (const d of sampleDuplicates) {
      console.log(`  Staging: ${d.staging.home_team_name} vs ${d.staging.away_team_name}`);
      console.log(`  Matched: ${d.homeTeam} vs ${d.awayTeam}`);
      console.log(`  Legacy key: ${d.existing.source_match_key}`);
      console.log("  ---");
    }
  }

  if (sampleNew.length > 0) {
    console.log("\n📋 SAMPLE NEW MATCHES:");
    for (const n of sampleNew) {
      console.log(`  ${n.staging.home_team_name} vs ${n.staging.away_team_name}`);
      console.log(`  Reason: ${n.reason}`);
      console.log("  ---");
    }
  }
}

main().catch(console.error);
