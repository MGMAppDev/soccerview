/**
 * Cleanup Birth Year Data - Legacy Data Fix
 * ==========================================
 *
 * Fixes NULL and mismatched birth_year values in teams_v2.
 * Uses the new get_current_season_year() function from migrations.
 *
 * Prerequisites: Run migrations 021, 022, 023 first
 *
 * Created: January 28, 2026 (Session 53)
 * Usage: node scripts/maintenance/cleanupBirthYearData.js
 */

import "dotenv/config";
import pg from "pg";
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

const stats = {
  step1_seasonYear: null,
  step2_nullFixed4Digit: 0,
  step3_nullFixed2Digit: 0,
  step4_nullFixedAgeGroup: 0,
  step5_mismatchesFixed: 0,
  step6_conflictsFlagged: 0,
  step7_invalidRangeFlagged: 0,
  initialState: {},
  finalState: {},
};

async function main() {
  console.log("=".repeat(70));
  console.log("🧹 BIRTH YEAR DATA CLEANUP");
  console.log("=".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // Authorize writes to protected tables
    await authorizePipelineWrite(client);

    // ============================================================
    // STEP 1: Verify migrations ran
    // ============================================================
    console.log("=".repeat(70));
    console.log("STEP 1: Verify migrations ran");
    console.log("=".repeat(70));

    try {
      const seasonResult = await client.query(`SELECT get_current_season_year() as year`);
      stats.step1_seasonYear = seasonResult.rows[0].year;
      console.log(`✅ get_current_season_year() = ${stats.step1_seasonYear}`);
    } catch (e) {
      console.error("❌ Migration 021 not applied! Run:");
      console.error("   psql $DATABASE_URL -f scripts/migrations/021_add_season_year_column.sql");
      process.exit(1);
    }

    // Get initial state
    const initialAudit = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE birth_year IS NULL) AS null_birth_year,
        COUNT(*) FILTER (WHERE display_name ~ '20[01][0-9]' AND birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int) AS mismatched,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL) AS has_birth_year
      FROM teams_v2
    `);
    stats.initialState = initialAudit.rows[0];
    console.log(`\n📊 Initial State:`);
    console.log(`   Total teams: ${parseInt(stats.initialState.total).toLocaleString()}`);
    console.log(`   NULL birth_year: ${parseInt(stats.initialState.null_birth_year).toLocaleString()}`);
    console.log(`   Mismatched (name vs column): ${parseInt(stats.initialState.mismatched).toLocaleString()}`);
    console.log(`   Has birth_year: ${parseInt(stats.initialState.has_birth_year).toLocaleString()}`);

    // ============================================================
    // STEP 2: Fix NULL birth_years from 4-digit year in name
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("STEP 2: Fix NULL birth_years from 4-digit year in name");
    console.log("=".repeat(70));

    const step2Result = await client.query(`
      UPDATE teams_v2
      SET birth_year = (regexp_match(display_name, '(20[01][0-9])'))[1]::int,
          birth_year_source = 'extracted_from_name',
          updated_at = NOW()
      WHERE birth_year IS NULL
        AND display_name ~ '20[01][0-9]'
    `);
    stats.step2_nullFixed4Digit = step2Result.rowCount;
    console.log(`✅ Fixed ${stats.step2_nullFixed4Digit.toLocaleString()} teams with 4-digit year in name`);

    // ============================================================
    // STEP 3: Fix NULL birth_years from 2-digit codes (14B, 15G, B14, G15)
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("STEP 3: Fix NULL birth_years from 2-digit codes");
    console.log("=".repeat(70));

    // Pattern 1: 14B, 15G (number before letter)
    const step3aResult = await client.query(`
      UPDATE teams_v2
      SET birth_year = 2000 + (regexp_match(display_name, '([01][0-9])[BG]'))[1]::int,
          birth_year_source = 'extracted_from_name',
          updated_at = NOW()
      WHERE birth_year IS NULL
        AND display_name ~ '[01][0-9][BG]'
    `);

    // Pattern 2: B14, G15 (letter before number)
    const step3bResult = await client.query(`
      UPDATE teams_v2
      SET birth_year = 2000 + (regexp_match(display_name, '[BG]([01][0-9])'))[1]::int,
          birth_year_source = 'extracted_from_name',
          updated_at = NOW()
      WHERE birth_year IS NULL
        AND display_name ~ '[BG][01][0-9]'
    `);

    stats.step3_nullFixed2Digit = step3aResult.rowCount + step3bResult.rowCount;
    console.log(`✅ Fixed ${stats.step3_nullFixed2Digit.toLocaleString()} teams with 2-digit codes`);
    console.log(`   Pattern [01][0-9][BG]: ${step3aResult.rowCount}`);
    console.log(`   Pattern [BG][01][0-9]: ${step3bResult.rowCount}`);

    // ============================================================
    // STEP 4: Back-calculate NULL birth_years from age group in name
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("STEP 4: Back-calculate NULL birth_years from age group (U##)");
    console.log("=".repeat(70));

    const step4Result = await client.query(`
      UPDATE teams_v2
      SET birth_year = get_current_season_year() - (regexp_match(display_name, 'U(\\d+)'))[1]::int,
          birth_year_source = 'inferred_from_age_group',
          updated_at = NOW()
      WHERE birth_year IS NULL
        AND display_name ~ 'U\\d+'
    `);
    stats.step4_nullFixedAgeGroup = step4Result.rowCount;
    console.log(`✅ Fixed ${stats.step4_nullFixedAgeGroup.toLocaleString()} teams from age group in name`);

    // ============================================================
    // STEP 5: Fix non-conflicting mismatches
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("STEP 5: Fix non-conflicting mismatches (name says different year)");
    console.log("=".repeat(70));

    const step5Result = await client.query(`
      UPDATE teams_v2 t1
      SET birth_year = (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int,
          birth_year_source = 'extracted_from_name',
          updated_at = NOW()
      WHERE t1.display_name ~ '20[01][0-9]'
        AND t1.birth_year != (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int
        AND NOT EXISTS (
          SELECT 1 FROM teams_v2 t2
          WHERE t2.canonical_name = t1.canonical_name
            AND t2.birth_year = (regexp_match(t1.display_name, '(20[01][0-9])'))[1]::int
            AND t2.gender = t1.gender
            AND t2.state = t1.state
            AND t2.id != t1.id
        )
    `);
    stats.step5_mismatchesFixed = step5Result.rowCount;
    console.log(`✅ Fixed ${stats.step5_mismatchesFixed.toLocaleString()} non-conflicting mismatches`);

    // ============================================================
    // STEP 6: Flag remaining conflicts for manual review
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("STEP 6: Flag remaining conflicts for manual review");
    console.log("=".repeat(70));

    const step6Result = await client.query(`
      UPDATE teams_v2
      SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"birth_year_conflict": true}'::jsonb,
          updated_at = NOW()
      WHERE display_name ~ '20[01][0-9]'
        AND birth_year != (regexp_match(display_name, '(20[01][0-9])'))[1]::int
        AND (data_flags IS NULL OR NOT (data_flags ? 'birth_year_conflict'))
    `);
    stats.step6_conflictsFlagged = step6Result.rowCount;
    console.log(`⚠️  Flagged ${stats.step6_conflictsFlagged.toLocaleString()} teams with birth_year conflicts`);

    // ============================================================
    // STEP 7: Flag invalid birth_year range
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("STEP 7: Flag teams with invalid birth_year range");
    console.log("=".repeat(70));

    const step7Result = await client.query(`
      UPDATE teams_v2
      SET data_flags = COALESCE(data_flags, '{}'::jsonb) || '{"invalid_birth_year": true}'::jsonb,
          updated_at = NOW()
      WHERE birth_year IS NOT NULL
        AND (birth_year < get_current_season_year() - 19
             OR birth_year > get_current_season_year() - 7)
        AND (data_flags IS NULL OR NOT (data_flags ? 'invalid_birth_year'))
    `);
    stats.step7_invalidRangeFlagged = step7Result.rowCount;
    console.log(`⚠️  Flagged ${stats.step7_invalidRangeFlagged.toLocaleString()} teams with invalid birth_year range`);
    console.log(`   Valid range: ${stats.step1_seasonYear - 19} to ${stats.step1_seasonYear - 7} (U7 to U19)`);

    // ============================================================
    // STEP 8: Refresh materialized views
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("STEP 8: Refresh materialized views");
    console.log("=".repeat(70));

    await client.query(`SELECT refresh_app_views()`);
    console.log(`✅ All materialized views refreshed`);

    // ============================================================
    // STEP 9: Final audit
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("STEP 9: Final audit");
    console.log("=".repeat(70));

    const finalAudit = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE birth_year IS NULL) AS null_birth_year,
        COUNT(*) FILTER (WHERE data_flags->>'birth_year_conflict' = 'true') AS flagged_conflicts,
        COUNT(*) FILTER (WHERE data_flags->>'invalid_birth_year' = 'true') AS invalid_range,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (data_flags IS NULL OR data_flags = '{}'::jsonb)) AS clean_teams,
        COUNT(*) AS total
      FROM teams_v2
    `);
    stats.finalState = finalAudit.rows[0];

    console.log(`\n📊 Final State:`);
    console.log(`   Total teams: ${parseInt(stats.finalState.total).toLocaleString()}`);
    console.log(`   NULL birth_year: ${parseInt(stats.finalState.null_birth_year).toLocaleString()}`);
    console.log(`   Flagged conflicts: ${parseInt(stats.finalState.flagged_conflicts).toLocaleString()}`);
    console.log(`   Invalid range: ${parseInt(stats.finalState.invalid_range).toLocaleString()}`);
    console.log(`   Clean teams: ${parseInt(stats.finalState.clean_teams).toLocaleString()}`);

    // ============================================================
    // Sample flagged teams
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("SAMPLE: Teams with birth_year conflicts");
    console.log("=".repeat(70));

    const conflictSamples = await client.query(`
      SELECT
        id,
        display_name,
        birth_year as stored_birth_year,
        (regexp_match(display_name, '(20[01][0-9])'))[1]::int as name_birth_year,
        gender,
        state
      FROM teams_v2
      WHERE data_flags->>'birth_year_conflict' = 'true'
      LIMIT 10
    `);

    if (conflictSamples.rows.length > 0) {
      console.log("\n| Display Name | Stored | In Name | Gender | State |");
      console.log("|" + "-".repeat(50) + "|--------|---------|--------|-------|");
      for (const row of conflictSamples.rows) {
        const name = row.display_name.substring(0, 48).padEnd(50);
        console.log(`| ${name} | ${row.stored_birth_year}   | ${row.name_birth_year}    | ${row.gender}      | ${row.state}    |`);
      }
    } else {
      console.log("No conflict samples found.");
    }

    // Check for duplicates
    console.log("\n" + "=".repeat(70));
    console.log("ANALYSIS: Are conflicts actually duplicates?");
    console.log("=".repeat(70));

    const duplicateCheck = await client.query(`
      WITH conflict_teams AS (
        SELECT
          canonical_name,
          (regexp_match(display_name, '(20[01][0-9])'))[1]::int as target_birth_year,
          gender,
          state
        FROM teams_v2
        WHERE data_flags->>'birth_year_conflict' = 'true'
      )
      SELECT
        ct.canonical_name,
        ct.target_birth_year,
        ct.gender,
        ct.state,
        COUNT(*) as existing_count
      FROM conflict_teams ct
      JOIN teams_v2 t ON
        t.canonical_name = ct.canonical_name
        AND t.birth_year = ct.target_birth_year
        AND t.gender = ct.gender
        AND t.state = ct.state
      GROUP BY ct.canonical_name, ct.target_birth_year, ct.gender, ct.state
      LIMIT 10
    `);

    if (duplicateCheck.rows.length > 0) {
      console.log(`\n⚠️  Found ${duplicateCheck.rows.length} conflict teams that would create duplicates:`);
      for (const row of duplicateCheck.rows) {
        console.log(`   - "${row.canonical_name}" (${row.target_birth_year}, ${row.gender}, ${row.state}) - ${row.existing_count} existing`);
      }
      console.log("\nThese need manual merge (delete duplicate, keep one with better data).");
    } else {
      console.log("✅ No duplicate conflicts found.");
    }

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log("\n" + "=".repeat(70));
    console.log("📋 CLEANUP SUMMARY");
    console.log("=".repeat(70));
    console.log(`
Season Year: ${stats.step1_seasonYear}

Teams Fixed:
  - Step 2 (4-digit year): ${stats.step2_nullFixed4Digit.toLocaleString()}
  - Step 3 (2-digit code): ${stats.step3_nullFixed2Digit.toLocaleString()}
  - Step 4 (age group):    ${stats.step4_nullFixedAgeGroup.toLocaleString()}
  - Step 5 (mismatches):   ${stats.step5_mismatchesFixed.toLocaleString()}
  ────────────────────────
  Total Fixed:             ${(stats.step2_nullFixed4Digit + stats.step3_nullFixed2Digit + stats.step4_nullFixedAgeGroup + stats.step5_mismatchesFixed).toLocaleString()}

Teams Flagged:
  - Conflicts:             ${stats.step6_conflictsFlagged.toLocaleString()}
  - Invalid range:         ${stats.step7_invalidRangeFlagged.toLocaleString()}

Before → After:
  - NULL birth_year:       ${parseInt(stats.initialState.null_birth_year).toLocaleString()} → ${parseInt(stats.finalState.null_birth_year).toLocaleString()}
  - Clean teams:           N/A → ${parseInt(stats.finalState.clean_teams).toLocaleString()}
`);

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Completed at: ${new Date().toISOString()}`);
}

main();
