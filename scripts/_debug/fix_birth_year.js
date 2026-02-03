/**
 * Fix birth_year mismatch in teams_v2
 *
 * Problem: birth_year stored doesn't match team names
 * Example: Teams with "2013B" have birth_year=2014
 *
 * This script:
 * 1. Extracts correct birth_year from display_name patterns
 * 2. Recalculates age_group using GotSport formula (2026 - birth_year)
 * 3. Updates display_name suffix to match
 * 4. Refreshes materialized views
 *
 * Note: Processes row-by-row to handle unique constraint violations gracefully
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
  console.log("FIX BIRTH_YEAR MISMATCH");
  console.log("=".repeat(60));

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");

    // Check current state before fixes
    console.log("--- BEFORE FIX: Sample mismatched teams ---");
    const before = await client.query(`
      SELECT display_name, age_group, birth_year
      FROM teams_v2
      WHERE display_name ILIKE '%Hammers Academy%2013%'
         OR display_name ILIKE '%Kansas Rush%14B%'
         OR display_name ILIKE '%Sporting Blue Valley SCW%2014%'
      LIMIT 10
    `);
    console.table(before.rows);

    // Step 1: Fix birth_year from 4-digit year in display_name - process row by row
    console.log("\nStep 1: Fixing birth_year from 4-digit years (e.g., 2013, 2014, 2015)...");
    const candidates4digit = await client.query(`
      SELECT
        id,
        display_name,
        (regexp_match(display_name, '\\m(20[01][0-9])\\M'))[1]::int AS target_birth_year
      FROM teams_v2
      WHERE display_name ~ '\\m20[01][0-9]\\M'
        AND birth_year IS DISTINCT FROM (regexp_match(display_name, '\\m(20[01][0-9])\\M'))[1]::int
    `);
    console.log(`   Found ${candidates4digit.rows.length} candidates`);

    let updated4digit = 0;
    let skipped4digit = 0;
    for (const row of candidates4digit.rows) {
      try {
        await client.query(
          `UPDATE teams_v2 SET birth_year = $1 WHERE id = $2`,
          [row.target_birth_year, row.id]
        );
        updated4digit++;
      } catch (err) {
        if (err.code === '23505') { // Unique violation
          skipped4digit++;
        } else {
          throw err;
        }
      }
    }
    console.log(`   Updated: ${updated4digit} teams`);
    console.log(`   Skipped (unique conflict): ${skipped4digit} teams`);

    // Step 2: Fix birth_year from 2-digit codes (like 13B, 14B, 15B)
    console.log("\nStep 2: Fixing birth_year from 2-digit codes (e.g., 13B, 14B, 15B)...");
    const candidates2digit = await client.query(`
      SELECT
        id,
        display_name,
        2000 + (regexp_match(display_name, '\\m([01][0-9])[BG]\\M'))[1]::int AS target_birth_year
      FROM teams_v2
      WHERE display_name ~ '\\m[01][0-9][BG]\\M'
        AND birth_year IS DISTINCT FROM 2000 + (regexp_match(display_name, '\\m([01][0-9])[BG]\\M'))[1]::int
    `);
    console.log(`   Found ${candidates2digit.rows.length} candidates`);

    let updated2digit = 0;
    let skipped2digit = 0;
    for (const row of candidates2digit.rows) {
      try {
        await client.query(
          `UPDATE teams_v2 SET birth_year = $1 WHERE id = $2`,
          [row.target_birth_year, row.id]
        );
        updated2digit++;
      } catch (err) {
        if (err.code === '23505') { // Unique violation
          skipped2digit++;
        } else {
          throw err;
        }
      }
    }
    console.log(`   Updated: ${updated2digit} teams`);
    console.log(`   Skipped (unique conflict): ${skipped2digit} teams`);

    // Step 3: Recalculate age_group using GotSport formula (2026 - birth_year)
    console.log("\nStep 3: Recalculating age_group (2026 - birth_year)...");
    const step3 = await client.query(`
      UPDATE teams_v2
      SET age_group = 'U' || (2026 - birth_year)
      WHERE birth_year IS NOT NULL
        AND age_group IS DISTINCT FROM 'U' || (2026 - birth_year)
    `);
    console.log(`   Updated: ${step3.rowCount} teams`);

    // Step 4: Update display_name suffix to match new age_group
    console.log("\nStep 4: Updating display_name suffix to match age_group...");
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

    // Report remaining mismatches
    console.log("\n--- REMAINING MISMATCHES (due to unique conflicts) ---");
    const remaining = await client.query(`
      SELECT COUNT(*) as cnt
      FROM teams_v2
      WHERE (
        (display_name ~ '\\m20[01][0-9]\\M'
         AND birth_year IS DISTINCT FROM (regexp_match(display_name, '\\m(20[01][0-9])\\M'))[1]::int)
        OR
        (display_name ~ '\\m[01][0-9][BG]\\M'
         AND birth_year IS DISTINCT FROM 2000 + (regexp_match(display_name, '\\m([01][0-9])[BG]\\M'))[1]::int)
      )
    `);
    console.log(`   Total remaining mismatches: ${remaining.rows[0].cnt}`);

    console.log("\nFix complete!");

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
