/**
 * Fix display_names to match age_group column
 *
 * This script fixes display_names where the age suffix (e.g., U10, U12)
 * doesn't match the corrected age_group column.
 *
 * Usage: node scripts/fix_display_names.js
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
  console.log("FIX DISPLAY_NAMES - Match age_group column");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");

    // Step 1: Preview what the fix will do (sample 10 teams)
    console.log("STEP 1: Preview sample of teams to fix\n");
    const preview = await client.query(`
      SELECT
          canonical_name,
          display_name as old_display_name,
          birth_year,
          age_group,
          CASE
              WHEN canonical_name ~ '\\([^)]+\\)\\s*$'
              THEN regexp_replace(canonical_name, '\\s*\\([^)]+\\)\\s*$', '') || ' (' || age_group || ' ' ||
                   CASE WHEN gender = 'M' THEN 'Boys' ELSE 'Girls' END || ')'
              ELSE canonical_name || ' (' || age_group || ' ' ||
                   CASE WHEN gender = 'M' THEN 'Boys' ELSE 'Girls' END || ')'
          END as new_display_name
      FROM teams_v2
      WHERE birth_year IS NOT NULL
        AND age_group IS NOT NULL
        AND display_name ~ '\\(U\\d+'
        AND display_name !~ ('\\(' || age_group)
      LIMIT 10;
    `);

    console.log("Sample teams that need fixing:");
    preview.rows.forEach((row, i) => {
      console.log(`  ${i+1}. ${row.old_display_name}`);
      console.log(`     -> ${row.new_display_name}`);
      console.log(`     (birth_year: ${row.birth_year}, age_group: ${row.age_group})`);
    });
    console.log("");

    // Step 2: Count how many display_names need fixing
    console.log("STEP 2: Count teams needing display_name fix\n");
    const countResult = await client.query(`
      SELECT COUNT(*) as teams_to_fix
      FROM teams_v2
      WHERE birth_year IS NOT NULL
        AND age_group IS NOT NULL
        AND display_name ~ '\\(U\\d+\\s*(Boys|Girls)\\)'
        AND display_name !~ ('\\(' || age_group || '\\s*(Boys|Girls)\\)');
    `);
    console.log(`Teams to fix: ${countResult.rows[0].teams_to_fix}\n`);

    // Step 3: UPDATE all display_names
    console.log("STEP 3: Update display_names with correct age suffix\n");
    const updateDisplayName = await client.query(`
      UPDATE teams_v2
      SET
          display_name = regexp_replace(
              display_name,
              '\\(U\\d+\\s*(Boys|Girls)\\)',
              '(' || age_group || ' ' || CASE WHEN gender = 'M' THEN 'Boys' ELSE 'Girls' END || ')'
          ),
          updated_at = NOW()
      WHERE birth_year IS NOT NULL
        AND age_group IS NOT NULL
        AND display_name ~ '\\(U\\d+\\s*(Boys|Girls)\\)'
        AND display_name !~ ('\\(' || age_group || '\\s*(Boys|Girls)\\)');
    `);
    console.log(`display_name rows updated: ${updateDisplayName.rowCount}\n`);

    // Step 4: Also update canonical_name if it has the suffix
    console.log("STEP 4: Update canonical_names with correct age suffix\n");
    const updateCanonicalName = await client.query(`
      UPDATE teams_v2
      SET
          canonical_name = regexp_replace(
              canonical_name,
              '\\(U\\d+\\s*(Boys|Girls)\\)',
              '(' || age_group || ' ' || CASE WHEN gender = 'M' THEN 'Boys' ELSE 'Girls' END || ')'
          ),
          updated_at = NOW()
      WHERE birth_year IS NOT NULL
        AND age_group IS NOT NULL
        AND canonical_name ~ '\\(U\\d+\\s*(Boys|Girls)\\)'
        AND canonical_name !~ ('\\(' || age_group || '\\s*(Boys|Girls)\\)');
    `);
    console.log(`canonical_name rows updated: ${updateCanonicalName.rowCount}\n`);

    // Step 5: Verify the fix - Check Kansas U11 Boys teams
    console.log("STEP 5: Verify fix - Kansas U11 Boys teams\n");
    const verifyResult = await client.query(`
      SELECT
          canonical_name,
          display_name,
          birth_year,
          age_group
      FROM teams_v2
      WHERE state = 'KS'
        AND gender = 'M'
        AND age_group = 'U11'
        AND (display_name ILIKE '%Sporting Blue Valley%' OR display_name ILIKE '%U10%' OR display_name ILIKE '%U12%')
      LIMIT 10;
    `);

    console.log("Sample Kansas U11 Boys teams after fix:");
    if (verifyResult.rows.length === 0) {
      console.log("  No mismatched teams found (good!)");
    } else {
      verifyResult.rows.forEach((row, i) => {
        console.log(`  ${i+1}. ${row.display_name} (age_group: ${row.age_group})`);
      });
    }
    console.log("");

    // Step 6: Refresh ALL materialized views
    console.log("STEP 6: Refresh all materialized views\n");
    await client.query(`SELECT refresh_app_views();`);
    console.log("Materialized views refreshed successfully!\n");

    // Step 7: Final verification - Check app_rankings
    console.log("STEP 7: Final verification - app_rankings Kansas U11 Boys\n");
    const finalVerify = await client.query(`
      SELECT
          name,
          display_name,
          age_group
      FROM app_rankings
      WHERE state = 'KS'
        AND gender = 'M'
        AND age_group = 'U11'
      LIMIT 10;
    `);

    console.log("Sample app_rankings Kansas U11 Boys:");
    finalVerify.rows.forEach((row, i) => {
      console.log(`  ${i+1}. ${row.display_name} (age_group: ${row.age_group})`);
    });
    console.log("");

    console.log("=".repeat(60));
    console.log("FIX COMPLETE!");
    console.log("=".repeat(60));
    console.log(`Completed at: ${new Date().toISOString()}`);

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
