/**
 * Unlink Year Mismatches - Data Cleanup Script
 * =============================================
 *
 * Finds and unlinks matches where the birth year in the match team name
 * doesn't match the birth year in the linked team's name.
 *
 * Example mismatch:
 * - Match: "SPORTING BV Pre-NAL 14" (birth year 2014)
 * - Linked to: "Sporting Blue Valley Pre-NAL 15 (U11 Boys)" (birth year 2015)
 *
 * This script sets home_team_id/away_team_id back to NULL for these cases.
 *
 * Usage: node scripts/unlinkYearMismatches.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL required");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(60));
  console.log("🔧 UNLINK YEAR MISMATCHES");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // First, let's count how many mismatches exist
    console.log("📊 Counting year mismatches...\n");

    const countResult = await client.query(`
      WITH match_years AS (
        SELECT
          mr.id,
          mr.home_team_name,
          mr.home_team_id,
          mr.away_team_name,
          mr.away_team_id,
          -- Extract birth year from match home team name
          COALESCE(
            (regexp_match(mr.home_team_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(mr.home_team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
          ) as match_home_year,
          -- Extract birth year from match away team name
          COALESCE(
            (regexp_match(mr.away_team_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(mr.away_team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
          ) as match_away_year
        FROM match_results mr
        WHERE mr.home_team_id IS NOT NULL OR mr.away_team_id IS NOT NULL
      ),
      team_years AS (
        SELECT
          my.*,
          -- Extract birth year from linked home team
          COALESCE(
            (regexp_match(th.team_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(th.team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
          ) as team_home_year,
          -- Extract birth year from linked away team
          COALESCE(
            (regexp_match(ta.team_name, '(20[0-1][0-9])'))[1],
            '20' || (regexp_match(ta.team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
          ) as team_away_year
        FROM match_years my
        LEFT JOIN team_elo th ON my.home_team_id = th.id
        LEFT JOIN team_elo ta ON my.away_team_id = ta.id
      )
      SELECT
        COUNT(*) FILTER (WHERE match_home_year IS NOT NULL AND team_home_year IS NOT NULL AND match_home_year != team_home_year) as home_mismatches,
        COUNT(*) FILTER (WHERE match_away_year IS NOT NULL AND team_away_year IS NOT NULL AND match_away_year != team_away_year) as away_mismatches
      FROM team_years
    `);

    const { home_mismatches, away_mismatches } = countResult.rows[0];
    console.log(`   Home team year mismatches: ${parseInt(home_mismatches).toLocaleString()}`);
    console.log(`   Away team year mismatches: ${parseInt(away_mismatches).toLocaleString()}`);
    console.log(`   Total to unlink: ${(parseInt(home_mismatches) + parseInt(away_mismatches)).toLocaleString()}\n`);

    if (parseInt(home_mismatches) === 0 && parseInt(away_mismatches) === 0) {
      console.log("✅ No year mismatches found. Database is clean!");
      return;
    }

    // Unlink home team mismatches
    console.log("🔗 Unlinking home team mismatches...");
    const homeUnlinkResult = await client.query(`
      UPDATE match_results mr
      SET home_team_id = NULL
      FROM team_elo te
      WHERE mr.home_team_id = te.id
        AND mr.home_team_id IS NOT NULL
        -- Match has a birth year
        AND (
          mr.home_team_name ~ '20[0-1][0-9]'
          OR mr.home_team_name ~* 'Pre-?NAL\\s*[0-9]{2}'
        )
        -- Team has a birth year
        AND (
          te.team_name ~ '20[0-1][0-9]'
          OR te.team_name ~* 'Pre-?NAL\\s*[0-9]{2}'
        )
        -- Birth years don't match
        AND COALESCE(
          (regexp_match(mr.home_team_name, '(20[0-1][0-9])'))[1],
          '20' || (regexp_match(mr.home_team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
        ) != COALESCE(
          (regexp_match(te.team_name, '(20[0-1][0-9])'))[1],
          '20' || (regexp_match(te.team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
        )
    `);
    console.log(`   ✅ Unlinked ${homeUnlinkResult.rowCount.toLocaleString()} home team links\n`);

    // Unlink away team mismatches
    console.log("🔗 Unlinking away team mismatches...");
    const awayUnlinkResult = await client.query(`
      UPDATE match_results mr
      SET away_team_id = NULL
      FROM team_elo te
      WHERE mr.away_team_id = te.id
        AND mr.away_team_id IS NOT NULL
        -- Match has a birth year
        AND (
          mr.away_team_name ~ '20[0-1][0-9]'
          OR mr.away_team_name ~* 'Pre-?NAL\\s*[0-9]{2}'
        )
        -- Team has a birth year
        AND (
          te.team_name ~ '20[0-1][0-9]'
          OR te.team_name ~* 'Pre-?NAL\\s*[0-9]{2}'
        )
        -- Birth years don't match
        AND COALESCE(
          (regexp_match(mr.away_team_name, '(20[0-1][0-9])'))[1],
          '20' || (regexp_match(mr.away_team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
        ) != COALESCE(
          (regexp_match(te.team_name, '(20[0-1][0-9])'))[1],
          '20' || (regexp_match(te.team_name, 'Pre-?NAL\\s*([0-9]{2})', 'i'))[1]
        )
    `);
    console.log(`   ✅ Unlinked ${awayUnlinkResult.rowCount.toLocaleString()} away team links\n`);

    // Final status
    const finalStatus = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL) as home_linked,
        COUNT(*) FILTER (WHERE away_team_id IS NOT NULL) as away_linked
      FROM match_results
    `);

    const final = finalStatus.rows[0];
    console.log("=".repeat(60));
    console.log("📊 FINAL STATUS:");
    console.log("=".repeat(60));
    console.log(`   Total matches: ${parseInt(final.total).toLocaleString()}`);
    console.log(`   Fully linked: ${parseInt(final.fully_linked).toLocaleString()} (${(final.fully_linked / final.total * 100).toFixed(1)}%)`);
    console.log(`   Home linked: ${parseInt(final.home_linked).toLocaleString()}`);
    console.log(`   Away linked: ${parseInt(final.away_linked).toLocaleString()}`);

    console.log("\n⚠️  Run linkTeams.js to re-link with birth year validation!");

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Completed at: ${new Date().toISOString()}`);
}

main();
