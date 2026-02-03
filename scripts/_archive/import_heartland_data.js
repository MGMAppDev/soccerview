import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: Missing Supabase credentials in .env file");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BATCH_SIZE = 100;

function findLatestTeamsFile() {
  const dataDir = path.join(process.cwd(), "scrapers", "heartland_data");
  if (!fs.existsSync(dataDir)) {
    console.error("ERROR: Directory not found:", dataDir);
    process.exit(1);
  }
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.startsWith("supabase_teams_") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.error("ERROR: No supabase_teams_*.json files found");
    process.exit(1);
  }
  return path.join(dataDir, files[0]);
}

function normalizeAgeGroup(age) {
  if (!age) return null;
  const match = age.trim().match(/^U0*(\d+)$/i);
  if (match) return `U${parseInt(match[1], 10)}`;
  return age.trim();
}

function normalizeGender(gender) {
  if (!gender) return null;
  const g = gender.trim().toLowerCase();
  if (g.includes("boy") || g === "male") return "Boys";
  if (g.includes("girl") || g === "female") return "Girls";
  return gender.trim();
}

function transformTeamRecord(team) {
  return {
    team_name: team.team_name?.trim(),
    elo_rating: team.elo_rating || 1500,
    matches_played: team.matches_played || 0,
    wins: team.wins || 0,
    losses: team.losses || 0,
    draws: team.draws || 0,
    state: "KS",
    gender: normalizeGender(team.gender),
    age_group: normalizeAgeGroup(team.age_group),
    updated_at: new Date().toISOString(),
  };
}

async function upsertTeams(teams) {
  let inserted = 0;
  let errors = 0;
  for (let i = 0; i < teams.length; i += BATCH_SIZE) {
    const batch = teams.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("team_elo")
      .upsert(batch, { onConflict: "team_name", ignoreDuplicates: false })
      .select();
    if (error) {
      console.error("Batch error:", error.message);
      errors += batch.length;
    } else {
      inserted += data?.length || batch.length;
      process.stdout.write(`\r  Processed: ${inserted} teams...`);
    }
  }
  console.log("");
  return { inserted, errors };
}

async function main() {
  console.log("=".repeat(60));
  console.log("HEARTLAND SOCCER DATA IMPORT");
  console.log("=".repeat(60));

  const args = process.argv.slice(2);
  let inputFile;
  const fileArgIndex = args.indexOf("--file");
  if (fileArgIndex !== -1 && args[fileArgIndex + 1]) {
    inputFile = args[fileArgIndex + 1];
  } else {
    inputFile = findLatestTeamsFile();
  }

  console.log("\nInput file:", inputFile);

  let rawData;
  try {
    rawData = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  } catch (err) {
    console.error("ERROR reading file:", err.message);
    process.exit(1);
  }

  console.log("Teams in file:", rawData.length);

  const teams = rawData.map(transformTeamRecord).filter((t) => t.team_name);
  console.log("Valid teams to import:", teams.length);

  if (teams.length > 0) {
    console.log("\nSample record:");
    console.log(JSON.stringify(teams[0], null, 2));
  }

  console.log("\nImporting to Supabase...");
  const result = await upsertTeams(teams);

  console.log("\n" + "=".repeat(60));
  console.log("IMPORT COMPLETE");
  console.log("  Teams processed:", result.inserted);
  console.log("  Errors:", result.errors);

  const { count } = await supabase
    .from("team_elo")
    .select("*", { count: "exact", head: true });
  console.log("  Total teams in database:", count);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
