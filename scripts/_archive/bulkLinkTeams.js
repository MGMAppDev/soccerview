/**
 * BULK Team Linking via Direct PostgreSQL
 * 
 * Uses direct database connection to run efficient SQL-based linking.
 * Much faster than API-based approach - processes millions of rows in minutes.
 * 
 * Usage: node scripts/bulkLinkTeams.js
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
  console.log("🔗 BULK TEAM LINKING - Direct PostgreSQL");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // Get initial status
    const initialStatus = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL) as home_linked,
        COUNT(*) FILTER (WHERE away_team_id IS NOT NULL) as away_linked
      FROM match_results
    `);
    
    const initial = initialStatus.rows[0];
    console.log("📊 INITIAL STATUS:");
    console.log(`   Total matches: ${parseInt(initial.total).toLocaleString()}`);
    console.log(`   Fully linked: ${parseInt(initial.fully_linked).toLocaleString()} (${(initial.fully_linked / initial.total * 100).toFixed(1)}%)`);
    console.log(`   Home linked: ${parseInt(initial.home_linked).toLocaleString()}`);
    console.log(`   Away linked: ${parseInt(initial.away_linked).toLocaleString()}`);
    console.log("");

    // ============================================================
    // STEP 1: EXACT MATCHES (case-insensitive)
    // ============================================================
    console.log("🎯 STEP 1: Exact matching (case-insensitive)...");
    
    // Home teams - exact match
    const homeExact = await client.query(`
      UPDATE match_results mr
      SET home_team_id = te.id
      FROM team_elo te
      WHERE mr.home_team_id IS NULL
        AND mr.home_team_name IS NOT NULL
        AND LOWER(TRIM(mr.home_team_name)) = LOWER(TRIM(te.team_name))
    `);
    console.log(`   Home exact matches: ${homeExact.rowCount.toLocaleString()} rows updated`);

    // Away teams - exact match
    const awayExact = await client.query(`
      UPDATE match_results mr
      SET away_team_id = te.id
      FROM team_elo te
      WHERE mr.away_team_id IS NULL
        AND mr.away_team_name IS NOT NULL
        AND LOWER(TRIM(mr.away_team_name)) = LOWER(TRIM(te.team_name))
    `);
    console.log(`   Away exact matches: ${awayExact.rowCount.toLocaleString()} rows updated`);

    // ============================================================
    // STEP 2: FUZZY MATCHES using pg_trgm (similarity >= 0.6)
    // ============================================================
    console.log("\n🔍 STEP 2: Fuzzy matching (similarity >= 0.6)...");
    console.log("   This may take several minutes...");

    // Home teams - fuzzy match
    // Use a subquery to find best match per unique name
    const homeFuzzy = await client.query(`
      WITH unlinked_home AS (
        SELECT DISTINCT home_team_name
        FROM match_results
        WHERE home_team_id IS NULL
          AND home_team_name IS NOT NULL
      ),
      best_matches AS (
        SELECT DISTINCT ON (uh.home_team_name)
          uh.home_team_name,
          te.id as team_id,
          similarity(LOWER(uh.home_team_name), LOWER(te.team_name)) as sim
        FROM unlinked_home uh
        CROSS JOIN LATERAL (
          SELECT id, team_name
          FROM team_elo
          WHERE similarity(LOWER(uh.home_team_name), LOWER(team_elo.team_name)) >= 0.6
          ORDER BY similarity(LOWER(uh.home_team_name), LOWER(team_elo.team_name)) DESC
          LIMIT 1
        ) te
        ORDER BY uh.home_team_name, sim DESC
      )
      UPDATE match_results mr
      SET home_team_id = bm.team_id
      FROM best_matches bm
      WHERE mr.home_team_name = bm.home_team_name
        AND mr.home_team_id IS NULL
    `);
    console.log(`   Home fuzzy matches: ${homeFuzzy.rowCount.toLocaleString()} rows updated`);

    // Away teams - fuzzy match
    const awayFuzzy = await client.query(`
      WITH unlinked_away AS (
        SELECT DISTINCT away_team_name
        FROM match_results
        WHERE away_team_id IS NULL
          AND away_team_name IS NOT NULL
      ),
      best_matches AS (
        SELECT DISTINCT ON (ua.away_team_name)
          ua.away_team_name,
          te.id as team_id,
          similarity(LOWER(ua.away_team_name), LOWER(te.team_name)) as sim
        FROM unlinked_away ua
        CROSS JOIN LATERAL (
          SELECT id, team_name
          FROM team_elo
          WHERE similarity(LOWER(ua.away_team_name), LOWER(team_elo.team_name)) >= 0.6
          ORDER BY similarity(LOWER(ua.away_team_name), LOWER(team_elo.team_name)) DESC
          LIMIT 1
        ) te
        ORDER BY ua.away_team_name, sim DESC
      )
      UPDATE match_results mr
      SET away_team_id = bm.team_id
      FROM best_matches bm
      WHERE mr.away_team_name = bm.away_team_name
        AND mr.away_team_id IS NULL
    `);
    console.log(`   Away fuzzy matches: ${awayFuzzy.rowCount.toLocaleString()} rows updated`);

    // ============================================================
    // STEP 3: Lower threshold fuzzy (similarity >= 0.5)
    // ============================================================
    console.log("\n🔍 STEP 3: Lower threshold fuzzy matching (similarity >= 0.5)...");

    const homeFuzzy2 = await client.query(`
      WITH unlinked_home AS (
        SELECT DISTINCT home_team_name
        FROM match_results
        WHERE home_team_id IS NULL
          AND home_team_name IS NOT NULL
      ),
      best_matches AS (
        SELECT DISTINCT ON (uh.home_team_name)
          uh.home_team_name,
          te.id as team_id,
          similarity(LOWER(uh.home_team_name), LOWER(te.team_name)) as sim
        FROM unlinked_home uh
        CROSS JOIN LATERAL (
          SELECT id, team_name
          FROM team_elo
          WHERE similarity(LOWER(uh.home_team_name), LOWER(team_elo.team_name)) >= 0.5
          ORDER BY similarity(LOWER(uh.home_team_name), LOWER(team_elo.team_name)) DESC
          LIMIT 1
        ) te
        ORDER BY uh.home_team_name, sim DESC
      )
      UPDATE match_results mr
      SET home_team_id = bm.team_id
      FROM best_matches bm
      WHERE mr.home_team_name = bm.home_team_name
        AND mr.home_team_id IS NULL
    `);
    console.log(`   Home fuzzy (0.5): ${homeFuzzy2.rowCount.toLocaleString()} rows updated`);

    const awayFuzzy2 = await client.query(`
      WITH unlinked_away AS (
        SELECT DISTINCT away_team_name
        FROM match_results
        WHERE away_team_id IS NULL
          AND away_team_name IS NOT NULL
      ),
      best_matches AS (
        SELECT DISTINCT ON (ua.away_team_name)
          ua.away_team_name,
          te.id as team_id,
          similarity(LOWER(ua.away_team_name), LOWER(te.team_name)) as sim
        FROM unlinked_away ua
        CROSS JOIN LATERAL (
          SELECT id, team_name
          FROM team_elo
          WHERE similarity(LOWER(ua.away_team_name), LOWER(team_elo.team_name)) >= 0.5
          ORDER BY similarity(LOWER(ua.away_team_name), LOWER(team_elo.team_name)) DESC
          LIMIT 1
        ) te
        ORDER BY ua.away_team_name, sim DESC
      )
      UPDATE match_results mr
      SET away_team_id = bm.team_id
      FROM best_matches bm
      WHERE mr.away_team_name = bm.away_team_name
        AND mr.away_team_id IS NULL
    `);
    console.log(`   Away fuzzy (0.5): ${awayFuzzy2.rowCount.toLocaleString()} rows updated`);

    // ============================================================
    // FINAL STATUS
    // ============================================================
    const finalStatus = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL) as home_linked,
        COUNT(*) FILTER (WHERE away_team_id IS NOT NULL) as away_linked
      FROM match_results
    `);
    
    const final = finalStatus.rows[0];
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 FINAL STATUS:");
    console.log("=".repeat(60));
    console.log(`   Total matches: ${parseInt(final.total).toLocaleString()}`);
    console.log(`   Fully linked: ${parseInt(final.fully_linked).toLocaleString()} (${(final.fully_linked / final.total * 100).toFixed(1)}%)`);
    console.log(`   Home linked: ${parseInt(final.home_linked).toLocaleString()} (${(final.home_linked / final.total * 100).toFixed(1)}%)`);
    console.log(`   Away linked: ${parseInt(final.away_linked).toLocaleString()} (${(final.away_linked / final.total * 100).toFixed(1)}%)`);
    console.log("");
    console.log("📈 IMPROVEMENT:");
    console.log(`   Fully linked: +${(parseInt(final.fully_linked) - parseInt(initial.fully_linked)).toLocaleString()}`);
    console.log(`   Home: +${(parseInt(final.home_linked) - parseInt(initial.home_linked)).toLocaleString()}`);
    console.log(`   Away: +${(parseInt(final.away_linked) - parseInt(initial.away_linked)).toLocaleString()}`);

    // Show sample unlinked names
    const unlinkedSample = await client.query(`
      SELECT DISTINCT home_team_name
      FROM match_results
      WHERE home_team_id IS NULL
        AND home_team_name IS NOT NULL
      LIMIT 10
    `);
    
    if (unlinkedSample.rows.length > 0) {
      console.log("\n📋 Sample unlinked team names (for review):");
      unlinkedSample.rows.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.home_team_name}`);
      });
    }

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Completed at: ${new Date().toISOString()}`);
}

main();
