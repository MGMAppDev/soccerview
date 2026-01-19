/**
 * Automated team linking script
 * Usage: node scripts/linkTeams.js
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function linkBatch(field) {
  const column = field === "home" ? "home_team_id" : "away_team_id";
  const nameCol = field === "home" ? "home_team_name" : "away_team_name";

  const { data: unlinked } = await supabase
    .from("match_results")
    .select(`id, ${nameCol}`)
    .is(column, null)
    .limit(10);

  if (!unlinked?.length) return 0;

  let linked = 0;
  for (const match of unlinked) {
    const { data: teams } = await supabase.rpc("find_similar_team", {
      search_name: match[nameCol].toLowerCase(),
    });

    if (teams?.[0]) {
      await supabase
        .from("match_results")
        .update({ [column]: teams[0].id })
        .eq("id", match.id);
      linked++;
      process.stdout.write(".");
    }
  }
  return linked;
}

async function getProgress() {
  const { count: total } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true });

  const { count: homeLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("home_team_id", "is", null);

  const { count: awayLinked } = await supabase
    .from("match_results")
    .select("*", { count: "exact", head: true })
    .not("away_team_id", "is", null);

  return { total, homeLinked, awayLinked };
}

async function main() {
  console.log("🔗 Starting automated team linking...\n");

  let rounds = 0;

  while (rounds < 1000) {
    await linkBatch("home");
    await linkBatch("away");
    rounds++;

    if (rounds % 25 === 0) {
      const { total, homeLinked, awayLinked } = await getProgress();
      console.log(
        `\nRound ${rounds}: ${homeLinked}/${total} home, ${awayLinked}/${total} away`,
      );
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n✅ Done!");
}

main();
