/**
 * Check age_group mismatches in teams_v2
 * Investigates whether mismatches use 2025 or 2026 formula
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log("Checking age_group mismatches...\n");

  // Paginate through all teams
  let allData = [];
  let offset = 0;
  const batchSize = 1000;

  console.log("Fetching all teams with birth_year and age_group...");

  while (true) {
    const { data, error } = await supabase
      .from("teams_v2")
      .select("display_name, birth_year, age_group, source_platform, created_at, updated_at")
      .not("birth_year", "is", null)
      .not("age_group", "is", null)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.log("Error at offset", offset, ":", error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allData = allData.concat(data);
    offset += batchSize;

    if (offset % 10000 === 0) {
      console.log(`  Fetched ${offset} teams so far...`);
    }
  }

  console.log(`Total teams fetched: ${allData.length}\n`);

  // Find all mismatches (not matching 2026 formula)
  const mismatches = allData.filter(t => t.age_group !== "U" + (2026 - t.birth_year));

  console.log(`Total mismatches (not matching 2026 formula): ${mismatches.length}`);
  console.log(`Percentage mismatched: ${((mismatches.length / allData.length) * 100).toFixed(2)}%\n`);

  if (mismatches.length > 0) {
    // Check which formula they match
    const using2025 = mismatches.filter(t => t.age_group === "U" + (2025 - t.birth_year));
    const using2024 = mismatches.filter(t => t.age_group === "U" + (2024 - t.birth_year));
    const unknown = mismatches.filter(t =>
      t.age_group !== "U" + (2025 - t.birth_year) &&
      t.age_group !== "U" + (2024 - t.birth_year)
    );

    console.log(`Mismatches using 2025 formula: ${using2025.length} / ${mismatches.length}`);
    console.log(`Mismatches using 2024 formula: ${using2024.length} / ${mismatches.length}`);
    console.log(`Unknown formula: ${unknown.length} / ${mismatches.length}\n`);

    // Group by birth_year and age_group
    const grouped = {};
    mismatches.forEach(t => {
      const key = `${t.birth_year}|${t.age_group}`;
      if (!grouped[key]) {
        grouped[key] = {
          birth_year: t.birth_year,
          stored_age_group: t.age_group,
          expected_2026: "U" + (2026 - t.birth_year),
          expected_2025: "U" + (2025 - t.birth_year),
          count: 0,
          matches_2025: t.age_group === "U" + (2025 - t.birth_year)
        };
      }
      grouped[key].count++;
    });

    const sorted = Object.values(grouped).sort((a, b) => b.count - a.count);

    console.log("Distribution by birth_year and age_group (top 20):");
    console.log("birth_year | stored | expected_2026 | expected_2025 | count | matches_2025?");
    console.log("-".repeat(80));
    sorted.slice(0, 20).forEach(row => {
      console.log(
        `${row.birth_year}       | ${row.stored_age_group.padEnd(6)} | ${row.expected_2026.padEnd(13)} | ${row.expected_2025.padEnd(13)} | ${String(row.count).padEnd(5)} | ${row.matches_2025}`
      );
    });

    // Sample mismatches with details
    console.log("\n\nSample mismatches:");
    mismatches.slice(0, 15).forEach(t => {
      const exp2026 = "U" + (2026 - t.birth_year);
      const exp2025 = "U" + (2025 - t.birth_year);
      const matches2025 = t.age_group === exp2025 ? "YES" : "NO";
      console.log(
        `  ${(t.display_name || "").substring(0, 35).padEnd(35)} | birth=${t.birth_year} | stored=${t.age_group.padEnd(4)} | exp2026=${exp2026.padEnd(4)} | matches2025? ${matches2025} | created=${t.created_at ? t.created_at.split("T")[0] : "null"}`
      );
    });

    // Check if any teams created AFTER 2026-01-28 have mismatches
    const recentMismatches = mismatches.filter(t =>
      t.created_at && t.created_at >= "2026-01-28T00:00:00Z"
    );
    console.log(`\n\nTeams created on/after 2026-01-28 with mismatches: ${recentMismatches.length}`);
    if (recentMismatches.length > 0) {
      console.log("These are NEW teams that were created with the wrong age_group!");
      recentMismatches.slice(0, 10).forEach(t => {
        console.log(`  ${t.display_name}: birth=${t.birth_year}, stored=${t.age_group}, expected=U${2026 - t.birth_year}`);
      });
    }
  }
}

main().catch(console.error);
