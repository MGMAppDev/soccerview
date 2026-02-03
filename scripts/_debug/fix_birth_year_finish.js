/**
 * Finish birth_year fix - Steps 4-5 only
 *
 * Previous run completed steps 1-3:
 * - Step 1: Fixed 541 teams with 4-digit years
 * - Step 2: Fixed 4855 teams with 2-digit codes
 * - Step 3: Recalculated 120,862 age_groups
 *
 * This script finishes steps 4-5 (display_name suffix and view refresh)
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(60));
  console.log("FINISH BIRTH_YEAR FIX - Steps 4-5");
  console.log("=".repeat(60));

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 900000, // 15 minutes
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");

    // Step 4: Update display_name suffix to match new age_group
    console.log("Step 4: Updating display_name suffix to match age_group...");
    const step4 = await client.query(`
      UPDATE teams_v2
      SET display_name = regexp_replace(
          display_name,
          '\\(U\\d+\\s*(Boys|Girls)\\)',
          '(' || age_group || ' ' || CASE WHEN gender = 'M' THEN 'Boys' ELSE 'Girls' END || ')'
      )
      WHERE display_name ~ '\\(U\\d+\\s*(Boys|Girls)\\)'
        AND birth_year IS NOT NULL
    `);
    console.log(`   Updated: ${step4.rowCount} teams`);

    // Step 5: Refresh materialized views
    console.log("\nStep 5: Refreshing materialized views...");

    console.log("   Refreshing app_rankings...");
    await client.query("REFRESH MATERIALIZED VIEW app_rankings");

    console.log("   Refreshing app_team_profile...");
    await client.query("REFRESH MATERIALIZED VIEW app_team_profile");

    console.log("   Refreshing app_matches_feed...");
    await client.query("REFRESH MATERIALIZED VIEW app_matches_feed");

    console.log("   Done!");

    // Verify the fix
    console.log("\n--- AFTER FIX: Sample teams ---");
    const after = await client.query(`
      SELECT display_name, age_group, birth_year
      FROM teams_v2
      WHERE display_name ILIKE '%Hammers Academy%2013%'
         OR display_name ILIKE '%Kansas Rush%14B%'
         OR display_name ILIKE '%Sporting Blue Valley SCW%2014%'
      LIMIT 10
    `);
    console.table(after.rows);

    // Summary stats
    console.log("\n--- SUMMARY: Age group distribution ---");
    const stats = await client.query(`
      SELECT age_group, COUNT(*) as count
      FROM teams_v2
      WHERE birth_year IS NOT NULL
      GROUP BY age_group
      ORDER BY age_group
    `);
    console.table(stats.rows);

    console.log("\nFix complete!");

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
