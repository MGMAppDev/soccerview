/**
 * Analyze all staging records for Event 39064
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Get all staging records
  const { data: staging } = await supabase
    .from("staging_games")
    .select("*")
    .eq("event_id", "39064")
    .eq("processed", false);

  console.log("📋 ANALYZING", staging?.length, "STAGING RECORDS");
  console.log("=".repeat(60));

  // Analyze dates and scores
  const dates = {};
  const scores = {};
  for (const s of staging || []) {
    dates[s.match_date] = (dates[s.match_date] || 0) + 1;
    const scoreKey = `${s.home_score}-${s.away_score}`;
    scores[scoreKey] = (scores[scoreKey] || 0) + 1;
  }

  console.log("\nBY DATE:");
  for (const [date, count] of Object.entries(dates)) {
    console.log("  " + date + ":", count);
  }

  console.log("\nBY SCORE (top 10):");
  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [score, count] of sortedScores) {
    console.log("  " + score + ":", count);
  }

  // Check for internal duplicates in staging (same date/teams/score)
  console.log("\nCHECKING FOR DUPLICATES WITHIN STAGING BATCH:");
  const seen = new Map();
  let internalDupes = 0;
  for (const s of staging || []) {
    const key = `${s.match_date}|${s.home_team_name}|${s.away_team_name}|${s.home_score}|${s.away_score}`;
    if (seen.has(key)) {
      internalDupes++;
      if (internalDupes <= 5) {
        console.log("  DUPE:", s.home_team_name.substring(0, 30), "vs", s.away_team_name.substring(0, 30));
        console.log("    Key1:", seen.get(key));
        console.log("    Key2:", s.source_match_key);
      }
    } else {
      seen.set(key, s.source_match_key);
    }
  }
  console.log("  Internal duplicates:", internalDupes);

  // For each unique date/score combo, check if any exist in production
  console.log("\nCHECKING AGAINST PRODUCTION:");
  const uniqueDates = Object.keys(dates);
  const { count: productionCount } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .in("match_date", uniqueDates);

  console.log("  Production matches on same dates:", productionCount);

  // Check 0-0 matches specifically (scheduled games)
  const scheduled = (staging || []).filter(s => s.home_score === 0 && s.away_score === 0);
  console.log("\nSCHEDULED GAMES (0-0):", scheduled.length);

  // Check if there are 0-0 matches in production on these dates
  const { count: scheduled00 } = await supabase
    .from("matches_v2")
    .select("*", { count: "exact", head: true })
    .in("match_date", uniqueDates)
    .eq("home_score", 0)
    .eq("away_score", 0);

  console.log("  Production 0-0 matches on same dates:", scheduled00);
}

main().catch(console.error);
