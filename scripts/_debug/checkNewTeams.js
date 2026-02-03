// Check newest teams created by integration test
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Get the newest 40 teams
  const { data: newTeams } = await supabase
    .from("teams_v2")
    .select("id, name, club_id, birth_year")
    .order("id", { ascending: false })
    .limit(40);

  console.log("📋 NEWEST TEAMS (should include test data):");
  console.log("-".repeat(60));

  // Mt Olive Cup team patterns
  const mtOlivePatterns = [
    "Cedar Stars",
    "Red Bulls",
    "TSF Academy",
    "Stamford FC",
    "Bethesda",
    "FC Westchester",
    "FC United",
    "Manhattan SC",
  ];

  let mtOliveCount = 0;
  let linkedCount = 0;

  for (const t of newTeams || []) {
    const isMtOlive = mtOlivePatterns.some(p => t.name.includes(p));
    if (isMtOlive) mtOliveCount++;
    if (t.club_id) linkedCount++;

    const clubIcon = t.club_id ? "✅" : "⚠️";
    const year = t.birth_year || "----";
    const name = t.name.length > 50 ? t.name.substring(0, 50) + "..." : t.name;
    console.log(`  ${clubIcon} [${year}] ${name}`);
  }

  console.log("-".repeat(60));
  console.log(`Total shown: ${newTeams?.length || 0}`);
  console.log(`Linked to clubs: ${linkedCount}`);
  console.log(`Match Mt Olive patterns: ${mtOliveCount}`);
}

main();
