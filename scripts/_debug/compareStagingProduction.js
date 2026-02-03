/**
 * Compare staging records to production to find duplicates
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Get one staging record
  const { data: staging } = await supabase
    .from("staging_games")
    .select("*")
    .eq("event_id", "39064")
    .eq("processed", false)
    .limit(1);

  if (!staging || staging.length === 0) {
    console.log("No staging records");
    return;
  }

  const s = staging[0];
  console.log("STAGING RECORD:");
  console.log("  Home:", s.home_team_name);
  console.log("  Away:", s.away_team_name);
  console.log("  Date:", s.match_date);
  console.log("  Score:", s.home_score + "-" + s.away_score);
  console.log("  Key:", s.source_match_key);

  // Search for potential team matches
  const homeWords = s.home_team_name.split(" ").filter(w => w.length > 3).slice(0, 2);
  const awayWords = s.away_team_name.split(" ").filter(w => w.length > 3).slice(0, 2);

  console.log("\nSEARCHING FOR TEAMS:");
  console.log("  Home search words:", homeWords);
  console.log("  Away search words:", awayWords);

  for (const word of homeWords) {
    const { data: teams } = await supabase
      .from("teams_v2")
      .select("id, name")
      .ilike("name", "%" + word + "%")
      .limit(5);

    if (teams && teams.length > 0) {
      console.log("\n  Found for '" + word + "':");
      for (const t of teams) {
        console.log("    " + t.id.substring(0,8) + " | " + t.name.substring(0,50));
      }
    }
  }

  // Check matches for these teams on this date
  console.log("\nCHECKING EXISTING MATCHES:");
  const { data: dateMatches } = await supabase
    .from("matches_v2")
    .select("id, home_score, away_score, source_match_key, home_team:home_team_id(name), away_team:away_team_id(name)")
    .eq("match_date", s.match_date)
    .eq("home_score", s.home_score)
    .eq("away_score", s.away_score)
    .limit(10);

  console.log("  Matches on " + s.match_date + " with score " + s.home_score + "-" + s.away_score + ":");
  for (const m of dateMatches || []) {
    console.log("    " + (m.home_team?.name?.substring(0,25) || "?") + " vs " + (m.away_team?.name?.substring(0,25) || "?"));
    console.log("    Key: " + m.source_match_key);
  }
}

main().catch(console.error);
