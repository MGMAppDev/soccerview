/**
 * Sync Match Counts - Updates teams.matches_played from actual linked matches
 *
 * Problem: ELO recalculation only counts CURRENT SEASON matches, leaving
 * teams with historical match data showing 0 matches_played.
 *
 * Solution: Count ALL linked matches (home + away) for each team and
 * update the matches_played field accordingly.
 *
 * Usage: node scripts/syncMatchCounts.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(60));
  console.log("🔄 SYNC MATCH COUNTS - All-Time Match History");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 1800000, // 30 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // Get current state
    const beforeStats = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE matches_played > 0) as teams_with_mp,
        COUNT(*) FILTER (WHERE matches_played = 0) as teams_without_mp,
        COUNT(*) FILTER (WHERE national_rank > 0 AND matches_played = 0) as ranked_without_mp
      FROM teams
    `);

    console.log("📊 BEFORE:");
    console.log(`   Teams with matches_played > 0: ${parseInt(beforeStats.rows[0].teams_with_mp).toLocaleString()}`);
    console.log(`   Teams with matches_played = 0: ${parseInt(beforeStats.rows[0].teams_without_mp).toLocaleString()}`);
    console.log(`   RANKED teams with 0 matches: ${parseInt(beforeStats.rows[0].ranked_without_mp).toLocaleString()}`);
    console.log("");

    // Count actual linked matches for ALL teams - BATCHED APPROACH
    console.log("🔢 Step 1: Counting home matches...");

    // Create temp table for counts
    await client.query(`DROP TABLE IF EXISTS temp_match_counts`);
    await client.query(`
      CREATE TEMP TABLE temp_match_counts AS
      SELECT
        home_team_id as team_id,
        COUNT(*) as home_count,
        MAX(match_date) as last_home
      FROM match_results
      WHERE home_team_id IS NOT NULL
      GROUP BY home_team_id
    `);

    const { rows: [{ count: homeTeams }] } = await client.query(`SELECT COUNT(*) FROM temp_match_counts`);
    console.log(`   ✅ Counted home matches for ${parseInt(homeTeams).toLocaleString()} teams`);

    console.log("🔢 Step 2: Counting away matches...");
    await client.query(`
      CREATE TEMP TABLE temp_away_counts AS
      SELECT
        away_team_id as team_id,
        COUNT(*) as away_count,
        MAX(match_date) as last_away
      FROM match_results
      WHERE away_team_id IS NOT NULL
      GROUP BY away_team_id
    `);

    const { rows: [{ count: awayTeams }] } = await client.query(`SELECT COUNT(*) FROM temp_away_counts`);
    console.log(`   ✅ Counted away matches for ${parseInt(awayTeams).toLocaleString()} teams`);

    console.log("🔢 Step 3: Merging counts...");
    await client.query(`
      CREATE TEMP TABLE temp_final_counts AS
      SELECT
        COALESCE(h.team_id, a.team_id) as team_id,
        COALESCE(h.home_count, 0) + COALESCE(a.away_count, 0) as total_matches,
        GREATEST(h.last_home, a.last_away) as last_match
      FROM temp_match_counts h
      FULL OUTER JOIN temp_away_counts a ON h.team_id = a.team_id
    `);

    const { rows: [{ count: totalTeams }] } = await client.query(`SELECT COUNT(*) FROM temp_final_counts`);
    console.log(`   ✅ Merged counts for ${parseInt(totalTeams).toLocaleString()} teams`);

    console.log("🔢 Step 4: Updating teams table (batched)...");

    // Get all team IDs to update in batches
    const { rows: toUpdate } = await client.query(`
      SELECT fc.team_id, fc.total_matches, fc.last_match
      FROM temp_final_counts fc
      JOIN teams t ON t.id = fc.team_id
      WHERE t.matches_played IS NULL OR t.matches_played <> fc.total_matches
    `);

    console.log(`   Found ${toUpdate.length.toLocaleString()} teams needing update`);

    const BATCH_SIZE = 1000;
    let updated = 0;

    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      const ids = batch.map(r => `'${r.team_id}'`).join(',');

      let mpCase = 'CASE id ';
      let dateCase = 'CASE id ';

      for (const r of batch) {
        mpCase += `WHEN '${r.team_id}' THEN ${r.total_matches} `;
        const dateVal = r.last_match ? `'${r.last_match.toISOString().split('T')[0]}'` : 'NULL';
        dateCase += `WHEN '${r.team_id}' THEN ${dateVal} `;
      }
      mpCase += 'END';
      dateCase += 'END';

      await client.query(`
        UPDATE teams
        SET
          matches_played = ${mpCase},
          last_match_date = COALESCE(last_match_date, (${dateCase})::date)
        WHERE id IN (${ids})
      `);

      updated += batch.length;
      process.stdout.write(`   Updated: ${updated.toLocaleString()}/${toUpdate.length.toLocaleString()} teams\r`);
    }

    console.log(`\n   ✅ Updated ${updated.toLocaleString()} teams with actual match counts\n`);

    // Cleanup
    await client.query(`DROP TABLE IF EXISTS temp_match_counts, temp_away_counts, temp_final_counts`);

    // Get final state
    const afterStats = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE matches_played > 0) as teams_with_mp,
        COUNT(*) FILTER (WHERE matches_played = 0) as teams_without_mp,
        COUNT(*) FILTER (WHERE national_rank > 0 AND matches_played = 0) as ranked_without_mp,
        COUNT(*) FILTER (WHERE national_rank > 0 AND matches_played > 0) as ranked_with_mp
      FROM teams
    `);

    console.log("📊 AFTER:");
    console.log(`   Teams with matches_played > 0: ${parseInt(afterStats.rows[0].teams_with_mp).toLocaleString()}`);
    console.log(`   Teams with matches_played = 0: ${parseInt(afterStats.rows[0].teams_without_mp).toLocaleString()}`);
    console.log(`   RANKED teams with matches: ${parseInt(afterStats.rows[0].ranked_with_mp).toLocaleString()}`);
    console.log(`   RANKED teams with 0 matches: ${parseInt(afterStats.rows[0].ranked_without_mp).toLocaleString()}`);

    // Calculate improvement
    const beforeRankedNoMatch = parseInt(beforeStats.rows[0].ranked_without_mp);
    const afterRankedNoMatch = parseInt(afterStats.rows[0].ranked_without_mp);
    const fixed = beforeRankedNoMatch - afterRankedNoMatch;

    console.log("");
    console.log("=".repeat(60));
    console.log(`🎯 FIXED: ${fixed.toLocaleString()} ranked teams now show match history`);
    console.log("=".repeat(60));

    // Show sample of newly fixed ranked teams
    if (fixed > 0) {
      const sample = await client.query(`
        SELECT team_name, national_rank, matches_played, state
        FROM teams
        WHERE national_rank > 0 AND matches_played > 0
        ORDER BY national_rank
        LIMIT 10
      `);

      console.log("\n🏆 TOP 10 RANKED TEAMS (now with match data):");
      sample.rows.forEach((t, i) => {
        console.log(`   #${t.national_rank}: ${t.team_name.substring(0, 45)} | ${t.matches_played} matches`);
      });
    }

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
