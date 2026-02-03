/**
 * Fix Age Groups - Tiered Approach
 * Run: node scripts/_debug/fix_age_groups.js
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runSQL(sql, description) {
  console.log(`\n🔄 ${description}...`);
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) {
    // Try direct query for SELECT statements
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      const { data: selectData, error: selectError } = await supabase.from('teams_v2').select('*').limit(1);
      console.log(`   ⚠️ RPC not available, trying alternative...`);
    }
    console.error(`   ❌ Error: ${error.message}`);
    return null;
  }
  console.log(`   ✅ Success`);
  if (data) console.log(`   Result:`, data);
  return data;
}

async function main() {
  console.log("=".repeat(60));
  console.log("FIX AGE GROUPS - TIERED APPROACH");
  console.log("=".repeat(60));

  // Step 1: Drop trigger
  console.log("\n" + "=".repeat(60));
  console.log("STEP 1: Drop trigger that overwrites age_group");
  console.log("=".repeat(60));

  const { error: triggerError } = await supabase.rpc('exec_sql', {
    sql_query: `DROP TRIGGER IF EXISTS trg_teams_v2_age_group ON teams_v2;`
  });

  if (triggerError) {
    console.log("⚠️  Cannot use exec_sql RPC. Will use raw SQL via psql or alternative method.");
    console.log("   Error:", triggerError.message);
    console.log("\n📋 Please run these SQL commands manually in Supabase SQL Editor:\n");

    const sqlCommands = [
      {
        name: "1. Drop trigger",
        sql: `DROP TRIGGER IF EXISTS trg_teams_v2_age_group ON teams_v2;`
      },
      {
        name: "2. Tier 1: Extract from display_name (U## pattern)",
        sql: `UPDATE teams_v2
SET age_group = 'U' || (regexp_match(display_name, '\\(U(\\d+)'))[1]
WHERE display_name ~ '\\(U\\d+'
  AND (age_group IS NULL OR age_group != 'U' || (regexp_match(display_name, '\\(U(\\d+)'))[1]);`
      },
      {
        name: "3. Tier 2: Use birth_year where display_name doesn't have age",
        sql: `UPDATE teams_v2
SET age_group = 'U' || (2026 - birth_year)
WHERE display_name !~ '\\(U\\d+'
  AND birth_year IS NOT NULL
  AND age_group IS NULL;`
      },
      {
        name: "4. Tier 3a: Parse B2015/G2016 patterns",
        sql: `UPDATE teams_v2
SET
    birth_year = (regexp_match(team_name, '[BG](20[01]\\d)'))[1]::int,
    age_group = 'U' || (2026 - (regexp_match(team_name, '[BG](20[01]\\d)'))[1]::int)
WHERE display_name !~ '\\(U\\d+'
  AND birth_year IS NULL
  AND team_name ~ '[BG]20[01]\\d';`
      },
      {
        name: "4. Tier 3b: Parse B14/G12 patterns",
        sql: `UPDATE teams_v2
SET age_group = 'U' || (regexp_match(team_name, '[BG](\\d{1,2})'))[1]
WHERE display_name !~ '\\(U\\d+'
  AND age_group IS NULL
  AND team_name ~ '[BG]\\d{1,2}[^0-9]';`
      },
      {
        name: "5. Verify coverage",
        sql: `SELECT
    COUNT(*) as total,
    SUM(CASE WHEN age_group IS NOT NULL THEN 1 ELSE 0 END) as has_age_group,
    SUM(CASE WHEN age_group IS NULL THEN 1 ELSE 0 END) as missing_age_group,
    ROUND(100.0 * SUM(CASE WHEN age_group IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as coverage_pct
FROM teams_v2;`
      },
      {
        name: "6. Refresh all views",
        sql: `SELECT refresh_app_views();`
      },
      {
        name: "7. Verify KS U12 teams",
        sql: `SELECT display_name, age_group, birth_year
FROM app_rankings
WHERE state = 'KS' AND gender = 'M' AND age_group = 'U12'
LIMIT 10;`
      }
    ];

    for (const cmd of sqlCommands) {
      console.log(`\n-- ${cmd.name}`);
      console.log(cmd.sql);
    }

    return;
  }

  console.log("✅ Trigger dropped successfully");

  // Step 2: Tier 1 - Extract from display_name
  console.log("\n" + "=".repeat(60));
  console.log("STEP 2: Tier 1 - Extract from display_name (U## pattern)");
  console.log("=".repeat(60));

  await runSQL(`
    UPDATE teams_v2
    SET age_group = 'U' || (regexp_match(display_name, '\\(U(\\d+)'))[1]
    WHERE display_name ~ '\\(U\\d+'
      AND (age_group IS NULL OR age_group != 'U' || (regexp_match(display_name, '\\(U(\\d+)'))[1]);
  `, "Updating teams with U## in display_name");

  // Continue with other tiers...
  console.log("\n✅ Script completed. Check output above for results.");
}

main().catch(console.error);
