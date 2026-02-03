/**
 * Fix Age Groups - Using pg library directly
 * Run: node scripts/_debug/fix_age_groups_pg.js
 */

import pg from "pg";
import "dotenv/config";

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runSQL(sql, description) {
  console.log(`\n🔄 ${description}...`);
  console.log(`   SQL: ${sql.substring(0, 100)}...`);
  try {
    const result = await client.query(sql);
    console.log(`   ✅ Success - ${result.rowCount !== null ? result.rowCount + ' rows affected' : 'completed'}`);
    if (result.rows && result.rows.length > 0) {
      console.log(`   Result:`, JSON.stringify(result.rows, null, 2));
    }
    return result;
  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("FIX AGE GROUPS - TIERED APPROACH (using pg)");
  console.log("=".repeat(60));

  await client.connect();
  console.log("✅ Connected to database");

  try {
    // Step 1: Drop trigger
    console.log("\n" + "=".repeat(60));
    console.log("STEP 1: Drop trigger that overwrites age_group");
    console.log("=".repeat(60));
    await runSQL(
      `DROP TRIGGER IF EXISTS trg_teams_v2_age_group ON teams_v2;`,
      "Dropping trigger"
    );

    // Step 2: Tier 1 - Extract from display_name
    console.log("\n" + "=".repeat(60));
    console.log("STEP 2: Tier 1 - Extract from display_name (U## pattern) - ~91.8% of teams");
    console.log("=".repeat(60));
    await runSQL(`
      UPDATE teams_v2
      SET age_group = 'U' || (regexp_match(display_name, '\\(U(\\d+)'))[1]
      WHERE display_name ~ '\\(U\\d+'
        AND (age_group IS NULL OR age_group != 'U' || (regexp_match(display_name, '\\(U(\\d+)'))[1]);
    `, "Updating teams with U## in display_name");

    // Step 3: Tier 2 - Use birth_year
    console.log("\n" + "=".repeat(60));
    console.log("STEP 3: Tier 2 - Use birth_year where display_name doesn't have age - ~2.5% of teams");
    console.log("=".repeat(60));
    await runSQL(`
      UPDATE teams_v2
      SET age_group = 'U' || (2026 - birth_year)
      WHERE display_name !~ '\\(U\\d+'
        AND birth_year IS NOT NULL
        AND age_group IS NULL;
    `, "Updating teams using birth_year");

    // Step 4: Tier 3a - Parse B2015/G2016 patterns
    console.log("\n" + "=".repeat(60));
    console.log("STEP 4: Tier 3a - Parse B2015/G2016 patterns from team_name");
    console.log("=".repeat(60));
    await runSQL(`
      UPDATE teams_v2
      SET
          birth_year = (regexp_match(team_name, '[BG](20[01]\\d)'))[1]::int,
          age_group = 'U' || (2026 - (regexp_match(team_name, '[BG](20[01]\\d)'))[1]::int)
      WHERE display_name !~ '\\(U\\d+'
        AND birth_year IS NULL
        AND team_name ~ '[BG]20[01]\\d';
    `, "Updating teams with B2015/G2016 patterns");

    // Step 5: Tier 3b - Parse B14/G12 patterns
    console.log("\n" + "=".repeat(60));
    console.log("STEP 5: Tier 3b - Parse B14/G12 patterns from team_name");
    console.log("=".repeat(60));
    await runSQL(`
      UPDATE teams_v2
      SET age_group = 'U' || (regexp_match(team_name, '[BG](\\d{1,2})'))[1]
      WHERE display_name !~ '\\(U\\d+'
        AND age_group IS NULL
        AND team_name ~ '[BG]\\d{1,2}[^0-9]';
    `, "Updating teams with B14/G12 patterns");

    // Step 6: Verify coverage
    console.log("\n" + "=".repeat(60));
    console.log("STEP 6: Verify coverage");
    console.log("=".repeat(60));
    await runSQL(`
      SELECT
          COUNT(*) as total,
          SUM(CASE WHEN age_group IS NOT NULL THEN 1 ELSE 0 END) as has_age_group,
          SUM(CASE WHEN age_group IS NULL THEN 1 ELSE 0 END) as missing_age_group,
          ROUND(100.0 * SUM(CASE WHEN age_group IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as coverage_pct
      FROM teams_v2;
    `, "Checking coverage");

    // Step 7: Refresh all views
    console.log("\n" + "=".repeat(60));
    console.log("STEP 7: Refresh all views");
    console.log("=".repeat(60));
    await runSQL(`SELECT refresh_app_views();`, "Refreshing app views");

    // Step 8: Verify KS U12 teams
    console.log("\n" + "=".repeat(60));
    console.log("STEP 8: Final verification - KS U12 boys teams");
    console.log("=".repeat(60));
    await runSQL(`
      SELECT display_name, age_group, birth_year
      FROM app_rankings
      WHERE state = 'KS' AND gender = 'M' AND age_group = 'U12'
      LIMIT 10;
    `, "Checking KS U12 boys");

    console.log("\n" + "=".repeat(60));
    console.log("✅ ALL STEPS COMPLETED");
    console.log("=".repeat(60));

  } finally {
    await client.end();
    console.log("\n✅ Database connection closed");
  }
}

main().catch(console.error);
