/**
 * Check which staging matches would get same home/away team after fuzzy matching
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Copy of extractTeamKeyParts from validation pipeline
function extractTeamKeyParts(canonicalName) {
  const canonical = (canonicalName || "").toLowerCase();
  const parts = canonical.split(/[\s\-_]+/).filter(part => {
    // Keep parts that are meaningful for identification
    // Skip very short parts, common prefixes/suffixes
    if (part.length < 2) return false;
    if (["fc", "sc", "sa", "united", "city", "club", "academy", "soccer", "youth"].includes(part)) return false;
    return true;
  });
  return parts.slice(0, 4); // Keep up to 4 key parts
}

async function fuzzyMatch(teamName) {
  const keyParts = extractTeamKeyParts(teamName);
  if (keyParts.length === 0) return null;

  const fuzzyPattern = `%${keyParts.join('%')}%`;

  const { data: candidates } = await supabase
    .from("teams_v2")
    .select("id, canonical_name, display_name")
    .ilike("canonical_name", fuzzyPattern)
    .limit(5);

  if (candidates && candidates.length > 0) {
    return candidates[0];
  }
  return null;
}

async function main() {
  const { data: staging } = await supabase
    .from("staging_games")
    .select("*")
    .eq("event_id", "39064")
    .eq("processed", false);

  console.log("📋 CHECKING TEAM MATCHING FOR", staging?.length, "RECORDS");
  console.log("=".repeat(60));

  let sameTeamCount = 0;
  const sameTeamExamples = [];

  for (const s of staging || []) {  // Check all
    const homeMatch = await fuzzyMatch(s.home_team_name);
    const awayMatch = await fuzzyMatch(s.away_team_name);

    if (homeMatch && awayMatch && homeMatch.id === awayMatch.id) {
      sameTeamCount++;
      if (sameTeamExamples.length < 5) {
        sameTeamExamples.push({
          home: s.home_team_name,
          away: s.away_team_name,
          matched: homeMatch.display_name || homeMatch.canonical_name,
        });
      }
    }
  }

  console.log("\nSAME TEAM MATCHES:", sameTeamCount, "out of first 50");

  if (sameTeamExamples.length > 0) {
    console.log("\nEXAMPLES:");
    for (const ex of sameTeamExamples) {
      console.log("  Home staging:", ex.home);
      console.log("  Away staging:", ex.away);
      console.log("  Both matched to:", ex.matched);
      console.log("  ---");
    }
  }
}

main().catch(console.error);
