/**
 * SoccerView — ELO Recalculation
 * Calls the calculate_elo_ratings() function in Supabase
 * Run: node scripts/recalculate_elo.js
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log("=== SoccerView ELO Recalculation ===");
  console.log(`Started at: ${new Date().toISOString()}\n`);

  try {
    const { data, error } = await supabase.rpc("calculate_elo_ratings");

    if (error) {
      console.error("Error calling calculate_elo_ratings:", error);
      process.exit(1);
    }

    console.log("ELO Recalculation Complete!");
    console.log(`Teams processed: ${data?.[0]?.teams_processed ?? "unknown"}`);
    console.log(
      `Matches processed: ${data?.[0]?.matches_processed ?? "unknown"}`,
    );

    // Get top 10 teams
    const { data: topTeams, error: topError } = await supabase
      .from("team_elo")
      .select("team_name, elo_rating, wins, losses, draws")
      .order("elo_rating", { ascending: false })
      .limit(10);

    if (!topError && topTeams) {
      console.log("\nTop 10 Teams:");
      topTeams.forEach((team, i) => {
        const record = `${team.wins}-${team.losses}-${team.draws}`;
        console.log(
          `  ${i + 1}. ${team.team_name?.substring(0, 40)} - ${Math.round(team.elo_rating)} ELO (${record})`,
        );
      });
    }
  } catch (err) {
    console.error("Script failed:", err);
    process.exit(1);
  }

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
}

main();
