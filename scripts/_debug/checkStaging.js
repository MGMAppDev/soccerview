// Quick check of staging_games status
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Count total and unprocessed
  const { count: total } = await supabase
    .from("staging_games")
    .select("*", { count: "exact", head: true });

  const { count: unprocessed } = await supabase
    .from("staging_games")
    .select("*", { count: "exact", head: true })
    .eq("processed", false);

  console.log("📊 STAGING STATUS");
  console.log(`   Total staging_games: ${total}`);
  console.log(`   Unprocessed: ${unprocessed}`);
  console.log(`   Processed: ${total - unprocessed}`);

  // Sample unprocessed records
  if (unprocessed > 0) {
    const { data: samples } = await supabase
      .from("staging_games")
      .select("id, source_platform, source_match_key, home_team_name, away_team_name, match_date, event_name")
      .eq("processed", false)
      .limit(5);

    console.log("\n📋 Sample unprocessed records:");
    for (const r of samples || []) {
      console.log(`   - [${r.source_platform}] ${r.home_team_name} vs ${r.away_team_name} (${r.match_date})`);
      console.log(`     Event: ${r.event_name}`);
      console.log(`     Key: ${r.source_match_key}`);
    }
  }
}

main();
