/**
 * SoccerView — ELO Recalculation
 * Calls the calculate_elo_ratings() function via direct PostgreSQL connection
 * This bypasses Supabase PostgREST timeout limits
 * Run: node scripts/recalculate_elo.js
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DATABASE_URL) {
  console.error("Missing env var: DATABASE_URL required");
  process.exit(1);
}

async function main() {
  console.log("=== SoccerView ELO Recalculation ===");
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Use direct PostgreSQL connection to bypass PostgREST timeout
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, // 5 minutes in milliseconds
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL directly");

    // Set statement timeout for this session
    await client.query("SET statement_timeout = '300s'");

    // Call the ELO calculation function
    const result = await client.query("SELECT * FROM calculate_elo_ratings()");

    const row = result.rows[0];
    console.log("\nELO Recalculation Complete!");
    console.log(
      `Teams processed: ${row?.teams_processed ?? row?.calculate_elo_ratings ?? "unknown"}`,
    );
    console.log(`Matches processed: ${row?.matches_processed ?? "unknown"}`);

    // Get top 10 teams using Supabase client (this is a fast query)
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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
    }
  } catch (err) {
    console.error("Error calling calculate_elo_ratings:", err);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
}

main();
