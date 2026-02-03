/**
 * Fix birth_year mismatch in teams_v2 - V2 Batch Processing
 *
 * Problem: birth_year stored doesn't match team names
 * Example: Teams with "2013B" have birth_year=2014
 *
 * This version uses batch updates with proper conflict detection via PostgreSQL.
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
  console.log("FIX BIRTH_YEAR MISMATCH - V2 Batch Processing");
  console.log("=".repeat(60));

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 900000, // 15 minutes
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

    // Step 1: Fix birth_year from 4-digit year using proper CTE with conflict check
    console.log("\nStep 1: Fixing birth_year from 4-digit years...");
    const step1 = await client.query(`
      WITH candidates AS (
        SELECT
          t.id,
          (regexp_match(t.display_name, '\\m(20[01][0-9])\\M'))[1]::int AS target_birth_year,
          t.canonical_name,
          t.gender,
          t.state
        FROM teams_v2 t
        WHERE t.display_name ~ '\\m20[01][0-9]\\M'
          AND t.birth_year IS DISTINCT FROM (regexp_match(t.display_name, '\\m(20[01][0-9])\\M'))[1]::int
      ),
      conflicts AS (
        -- Find all candidates that would conflict with an existing team
        SELECT DISTINCT c.id
        FROM candidates c
        JOIN teams_v2 existing ON
          existing.canonical_name = c.canonical_name
          AND existing.birth_year = c.target_birth_year
          AND existing.gender = c.gender
          AND COALESCE(existing.state, '') = COALESCE(c.state, '')
          AND existing.id != c.id
      ),
      safe_updates AS (
        SELECT c.id, c.target_birth_year
        FROM candidates c
        WHERE c.id NOT IN (SELECT id FROM conflicts)
      )
      UPDATE teams_v2 t
      SET birth_year = su.target_birth_year
      FROM safe_updates su
      WHERE t.id = su.id
    `);
    console.log(`   Updated: ${step1.rowCount} teams`);

    // Step 2: Fix birth_year from 2-digit codes (like 13B, 14G)
    console.log("\nStep 2: Fixing birth_year from 2-digit codes...");
    const step2 = await client.query(`
      WITH candidates AS (
        SELECT
          t.id,
          2000 + (regexp_match(t.display_name, '\\m([01][0-9])[BG]\\M'))[1]::int AS target_birth_year,
          t.canonical_name,
          t.gender,
          t.state
        FROM teams_v2 t
        WHERE t.display_name ~ '\\m[01][0-9][BG]\\M'
          AND t.birth_year IS DISTINCT FROM 2000 + (regexp_match(t.display_name, '\\m([01][0-9])[BG]\\M'))[1]::int
      ),
      conflicts AS (
        SELECT DISTINCT c.id
        FROM candidates c
        JOIN teams_v2 existing ON
          existing.canonical_name = c.canonical_name
          AND existing.birth_year = c.target_birth_year
          AND existing.gender = c.gender
          AND COALESCE(existing.state, '') = COALESCE(c.state, '')
          AND existing.id != c.id
      ),
      safe_updates AS (
        SELECT c.id, c.target_birth_year
        FROM candidates c
        WHERE c.id NOT IN (SELECT id FROM conflicts)
      )
      UPDATE teams_v2 t
      SET birth_year = su.target_birth_year
      FROM safe_updates su
      WHERE t.id = su.id
    `);
    console.log(`   Updated: ${step2.rowCount} teams`);

    // Check remaining conflicts
    console.log("\nChecking remaining mismatched teams...");
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
    console.log(`   Remaining mismatches (due to conflicts): ${remaining.rows[0].cnt}`);

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

    console.log("\nFix complete!");

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
