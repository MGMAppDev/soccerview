/**
 * Cleanup Year Mismatch Aliases
 * ==============================
 *
 * Finds and removes aliases where the birth year in the alias
 * doesn't match the birth year in the team name.
 *
 * Example bad alias:
 * - Team: "Sporting Blue Valley Pre-NAL 15 (U11 Boys)" (birth year 2015)
 * - Alias: "sporting bv pre-nal 14" (birth year 2014)
 *
 * Usage: node scripts/cleanupYearMismatchAliases.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL required");
  process.exit(1);
}

async function main() {
  console.log('='.repeat(70));
  console.log('🧹 CLEANUP YEAR MISMATCH ALIASES');
  console.log('='.repeat(70));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');

    // Count mismatched aliases before cleanup
    console.log('📊 Analyzing alias-team year mismatches...\n');

    const analysisResult = await client.query(`
      WITH alias_years AS (
        SELECT
          a.id,
          a.team_id,
          a.alias_name,
          t.team_name,
          -- Extract birth year from alias
          COALESCE(
            (regexp_match(a.alias_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(a.alias_name, 'pre-?nal\\s*([0-9]{2})', 'i'))[1]
          ) as alias_year,
          -- Extract birth year from team
          COALESCE(
            (regexp_match(t.team_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(t.team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
          ) as team_year
        FROM team_name_aliases a
        JOIN teams t ON a.team_id = t.id
      )
      SELECT
        COUNT(*) as total_aliases,
        COUNT(*) FILTER (WHERE alias_year IS NOT NULL AND team_year IS NOT NULL) as aliases_with_years,
        COUNT(*) FILTER (WHERE alias_year IS NOT NULL AND team_year IS NOT NULL AND alias_year != team_year) as mismatched
      FROM alias_years
    `);

    const { total_aliases, aliases_with_years, mismatched } = analysisResult.rows[0];
    console.log(`   Total aliases: ${parseInt(total_aliases).toLocaleString()}`);
    console.log(`   Aliases with birth years: ${parseInt(aliases_with_years).toLocaleString()}`);
    console.log(`   Year mismatches: ${parseInt(mismatched).toLocaleString()}\n`);

    if (parseInt(mismatched) === 0) {
      console.log('✅ No year mismatched aliases found. Database is clean!');
      return;
    }

    // Sample some mismatches before deleting
    console.log('📋 Sample mismatched aliases (first 10):');
    const sampleResult = await client.query(`
      WITH alias_years AS (
        SELECT
          a.id,
          a.team_id,
          a.alias_name,
          t.team_name,
          COALESCE(
            (regexp_match(a.alias_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(a.alias_name, 'pre-?nal\\s*([0-9]{2})', 'i'))[1]
          ) as alias_year,
          COALESCE(
            (regexp_match(t.team_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(t.team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
          ) as team_year
        FROM team_name_aliases a
        JOIN teams t ON a.team_id = t.id
      )
      SELECT alias_name, team_name, alias_year, team_year
      FROM alias_years
      WHERE alias_year IS NOT NULL AND team_year IS NOT NULL AND alias_year != team_year
      LIMIT 10
    `);

    sampleResult.rows.forEach(r => {
      console.log(`   ❌ Alias: "${r.alias_name}" (${r.alias_year})`);
      console.log(`      Team:  "${r.team_name}" (${r.team_year})`);
      console.log('');
    });

    // Delete mismatched aliases
    console.log('🗑️  Deleting mismatched aliases...');
    const deleteResult = await client.query(`
      WITH alias_years AS (
        SELECT
          a.id,
          COALESCE(
            (regexp_match(a.alias_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(a.alias_name, 'pre-?nal\\s*([0-9]{2})', 'i'))[1]
          ) as alias_year,
          COALESCE(
            (regexp_match(t.team_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(t.team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
          ) as team_year
        FROM team_name_aliases a
        JOIN teams t ON a.team_id = t.id
      )
      DELETE FROM team_name_aliases
      WHERE id IN (
        SELECT id FROM alias_years
        WHERE alias_year IS NOT NULL
          AND team_year IS NOT NULL
          AND alias_year != team_year
      )
    `);

    console.log(`   ✅ Deleted ${deleteResult.rowCount.toLocaleString()} mismatched aliases\n`);

    // Final count
    const finalCount = await client.query(`SELECT COUNT(*) as cnt FROM team_name_aliases`);
    console.log(`📊 Remaining aliases: ${parseInt(finalCount.rows[0].cnt).toLocaleString()}`);

    console.log('\n✅ Cleanup completed!');
    console.log('⚠️  Run linkTeams.js to re-link matches with correct aliases.');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
