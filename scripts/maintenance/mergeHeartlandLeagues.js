/**
 * Merge Heartland Soccer League 2025 into Heartland Premier League 2025
 * =====================================================================
 *
 * ISSUE: Two different scrapers created two league entries for the same Heartland league:
 * - "Heartland Soccer League 2025" (scrapeHeartlandLeague.js - calendar scraper)
 * - "Heartland Premier League 2025" (scrapeHeartlandResults.js - results scraper)
 *
 * This results in the same matches appearing under two different league names in the app.
 *
 * FIX:
 * 1. Find matches in "Soccer League" that are duplicates of "Premier League" (using Heartland team IDs)
 * 2. Delete duplicate matches from Soccer League
 * 3. Migrate remaining unique Soccer League matches to Premier League
 * 4. Delete the now-empty "Heartland Soccer League 2025" entry
 *
 * Usage:
 *   node scripts/maintenance/mergeHeartlandLeagues.js --dry-run   # Preview only
 *   node scripts/maintenance/mergeHeartlandLeagues.js             # Execute merge
 */

import "dotenv/config";
import pg from "pg";
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");
    console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE EXECUTION"}\n`);

    // Authorize writes to protected tables
    await authorizePipelineWrite(client);

    // 1. Get league IDs
    console.log("=== STEP 1: Identify Leagues ===\n");

    const leagues = await client.query(`
      SELECT id, name, source_event_id
      FROM leagues
      WHERE name IN ('Heartland Premier League 2025', 'Heartland Soccer League 2025')
    `);

    const premierLeague = leagues.rows.find(l => l.name === "Heartland Premier League 2025");
    const soccerLeague = leagues.rows.find(l => l.name === "Heartland Soccer League 2025");

    if (!premierLeague || !soccerLeague) {
      console.log("One or both leagues not found. Checking what exists...\n");
      const allHeartland = await client.query(`
        SELECT id, name FROM leagues WHERE name ILIKE '%heartland%'
      `);
      allHeartland.rows.forEach(l => console.log(`  - ${l.name}`));
      return;
    }

    console.log(`Premier League: ${premierLeague.id} (${premierLeague.name})`);
    console.log(`Soccer League:  ${soccerLeague.id} (${soccerLeague.name})`);

    // Get match counts
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM matches_v2 WHERE league_id = $1) as premier_count,
        (SELECT COUNT(*) FROM matches_v2 WHERE league_id = $2) as soccer_count
    `, [premierLeague.id, soccerLeague.id]);

    console.log(`Premier League matches: ${counts.rows[0].premier_count}`);
    console.log(`Soccer League matches: ${counts.rows[0].soccer_count}`);

    // 2. Find duplicate matches using Heartland source IDs
    console.log("\n=== STEP 2: Find Duplicate Matches Using Heartland IDs ===\n");

    // The source_match_key format is:
    // Premier: heartland-premier-{homeId}-{awayId}-{date}-{gameNum}
    // Soccer:  heartland-{homeId}-{awayId}-{date}
    //
    // We can extract the {homeId}-{awayId}-{date} part and match on that

    const duplicates = await client.query(`
      WITH soccer_matches AS (
        SELECT
          id,
          match_date,
          home_score,
          away_score,
          source_match_key,
          -- Extract pattern: homeId-awayId-date from heartland-{homeId}-{awayId}-{date}
          CASE
            WHEN source_match_key LIKE 'heartland-%-%-%'
            THEN REGEXP_REPLACE(source_match_key, '^heartland-', '')
            ELSE NULL
          END as match_pattern
        FROM matches_v2
        WHERE league_id = $1
      ),
      premier_matches AS (
        SELECT
          id,
          match_date,
          home_score,
          away_score,
          source_match_key,
          -- Extract pattern: homeId-awayId-date from heartland-premier-{homeId}-{awayId}-{date}-{gameNum}
          CASE
            WHEN source_match_key LIKE 'heartland-premier-%-%-%'
            THEN REGEXP_REPLACE(
              REGEXP_REPLACE(source_match_key, '^heartland-premier-', ''),
              '-[0-9]+$', ''  -- Remove trailing gameNum
            )
            ELSE NULL
          END as match_pattern
        FROM matches_v2
        WHERE league_id = $2
      )
      SELECT
        s.id as soccer_match_id,
        p.id as premier_match_id,
        s.match_date,
        s.home_score,
        s.away_score,
        s.source_match_key as soccer_key,
        p.source_match_key as premier_key,
        s.match_pattern as soccer_pattern,
        p.match_pattern as premier_pattern
      FROM soccer_matches s
      JOIN premier_matches p ON s.match_pattern = p.match_pattern
      WHERE s.match_pattern IS NOT NULL
        AND p.match_pattern IS NOT NULL
    `, [soccerLeague.id, premierLeague.id]);

    console.log(`Found ${duplicates.rows.length} duplicate matches (same Heartland team IDs + date)`);

    if (duplicates.rows.length > 0) {
      console.log("\nSample duplicates:");
      duplicates.rows.slice(0, 5).forEach(d => {
        console.log(`  Date: ${d.match_date}, Score: ${d.home_score}-${d.away_score}`);
        console.log(`    Soccer key:  ${d.soccer_key}`);
        console.log(`    Premier key: ${d.premier_key}`);
      });
    }

    // 3. Also find duplicates by exact team ID match (same teams in both leagues)
    console.log("\n=== STEP 3: Find Exact Team Duplicates ===\n");

    const exactDuplicates = await client.query(`
      SELECT
        s.id as soccer_match_id,
        p.id as premier_match_id,
        s.match_date,
        s.home_score,
        s.away_score
      FROM matches_v2 s
      JOIN matches_v2 p ON
        s.match_date = p.match_date
        AND s.home_team_id = p.home_team_id
        AND s.away_team_id = p.away_team_id
        AND s.home_score = p.home_score
        AND s.away_score = p.away_score
        AND s.id != p.id
      WHERE s.league_id = $1
        AND p.league_id = $2
    `, [soccerLeague.id, premierLeague.id]);

    console.log(`Found ${exactDuplicates.rows.length} exact team duplicates`);

    // 4. Combine all duplicate IDs
    const duplicateIds = new Set();
    duplicates.rows.forEach(d => duplicateIds.add(d.soccer_match_id));
    exactDuplicates.rows.forEach(d => duplicateIds.add(d.soccer_match_id));

    console.log(`\nTotal unique duplicates to delete: ${duplicateIds.size}`);

    // 5. Calculate remaining matches to migrate
    const remainingCount = parseInt(counts.rows[0].soccer_count) - duplicateIds.size;
    console.log(`Matches to migrate (not duplicates): ${remainingCount}`);

    // 6. Execute the merge
    console.log("\n=== STEP 4: Execute Merge ===\n");

    const duplicateIdArray = Array.from(duplicateIds);

    // 6a. Delete duplicates from Soccer League
    console.log(`Deleting ${duplicateIdArray.length} duplicate matches from Soccer League...`);

    if (!DRY_RUN && duplicateIdArray.length > 0) {
      const deleteResult = await client.query(`
        DELETE FROM matches_v2
        WHERE id = ANY($1::uuid[])
      `, [duplicateIdArray]);
      console.log(`  Deleted ${deleteResult.rowCount} matches`);
    }

    // 6b. Migrate remaining Soccer League matches to Premier League
    const currentRemaining = await client.query(`
      SELECT COUNT(*) as count FROM matches_v2 WHERE league_id = $1
    `, [soccerLeague.id]);

    const actualRemaining = parseInt(currentRemaining.rows[0].count);
    console.log(`\nMigrating ${actualRemaining} remaining matches to Premier League...`);

    if (!DRY_RUN && actualRemaining > 0) {
      const migrateResult = await client.query(`
        UPDATE matches_v2
        SET league_id = $1
        WHERE league_id = $2
      `, [premierLeague.id, soccerLeague.id]);
      console.log(`  Migrated ${migrateResult.rowCount} matches`);
    }

    // 6c. Delete the empty Soccer League entry
    console.log(`\nDeleting empty Soccer League entry...`);

    if (!DRY_RUN) {
      // First verify it's empty
      const checkEmpty = await client.query(`
        SELECT COUNT(*) as count FROM matches_v2 WHERE league_id = $1
      `, [soccerLeague.id]);

      if (parseInt(checkEmpty.rows[0].count) === 0) {
        await client.query(`
          DELETE FROM leagues WHERE id = $1
        `, [soccerLeague.id]);
        console.log(`  Deleted league: ${soccerLeague.name}`);
      } else {
        console.log(`  ⚠️ League still has ${checkEmpty.rows[0].count} matches, not deleting`);
      }
    }

    // 7. Summary
    console.log("\n=== SUMMARY ===\n");
    console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
    console.log(`Duplicates removed: ${duplicateIdArray.length}`);
    console.log(`Matches migrated: ${DRY_RUN ? remainingCount : actualRemaining}`);
    console.log(`League deleted: ${DRY_RUN ? "(would delete)" : "Heartland Soccer League 2025"}`);

    if (DRY_RUN) {
      console.log("\n⚠️  This was a dry run. Run without --dry-run to execute.\n");
    } else {
      console.log("\n✅ Merge complete! Remember to refresh materialized views.\n");
      console.log("Run: psql $DATABASE_URL -c \"SELECT refresh_app_views();\"");
    }

  } catch (err) {
    console.error("Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
