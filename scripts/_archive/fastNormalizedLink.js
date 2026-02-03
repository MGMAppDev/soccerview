/**
 * FAST Team Linking via Normalized Matching
 * 
 * Instead of expensive fuzzy matching, normalize team names and do exact matches.
 * Much faster - processes in bulk SQL operations.
 * 
 * Usage: node scripts/fastNormalizedLink.js
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
  console.log("🚀 FAST NORMALIZED TEAM LINKING");
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
    // STRATEGY 1: Match on first N characters (club name prefix)
    // ============================================================
    console.log("🎯 STRATEGY 1: Prefix matching (first 30 chars)...");
    
    const homePrefix = await client.query(`
      UPDATE match_results mr
      SET home_team_id = te.id
      FROM (
        SELECT DISTINCT ON (LEFT(LOWER(TRIM(team_name)), 30)) 
          id, team_name, LEFT(LOWER(TRIM(team_name)), 30) as prefix
        FROM team_elo
        ORDER BY LEFT(LOWER(TRIM(team_name)), 30), elo_rating DESC
      ) te
      WHERE mr.home_team_id IS NULL
        AND mr.home_team_name IS NOT NULL
        AND LEFT(LOWER(TRIM(mr.home_team_name)), 30) = te.prefix
    `);
    console.log(`   Home prefix matches: ${homePrefix.rowCount.toLocaleString()}`);

    const awayPrefix = await client.query(`
      UPDATE match_results mr
      SET away_team_id = te.id
      FROM (
        SELECT DISTINCT ON (LEFT(LOWER(TRIM(team_name)), 30)) 
          id, team_name, LEFT(LOWER(TRIM(team_name)), 30) as prefix
        FROM team_elo
        ORDER BY LEFT(LOWER(TRIM(team_name)), 30), elo_rating DESC
      ) te
      WHERE mr.away_team_id IS NULL
        AND mr.away_team_name IS NOT NULL
        AND LEFT(LOWER(TRIM(mr.away_team_name)), 30) = te.prefix
    `);
    console.log(`   Away prefix matches: ${awayPrefix.rowCount.toLocaleString()}`);

    // ============================================================
    // STRATEGY 2: Strip common suffixes and match
    // ============================================================
    console.log("\n🎯 STRATEGY 2: Normalized name matching...");
    
    // Create normalized versions - strip parentheses content, extra spaces
    const homeNorm = await client.query(`
      UPDATE match_results mr
      SET home_team_id = te.id
      FROM (
        SELECT DISTINCT ON (REGEXP_REPLACE(LOWER(team_name), '\\s*\\([^)]*\\)\\s*', '', 'g'))
          id, 
          REGEXP_REPLACE(LOWER(team_name), '\\s*\\([^)]*\\)\\s*', '', 'g') as norm_name
        FROM team_elo
        ORDER BY REGEXP_REPLACE(LOWER(team_name), '\\s*\\([^)]*\\)\\s*', '', 'g'), elo_rating DESC
      ) te
      WHERE mr.home_team_id IS NULL
        AND mr.home_team_name IS NOT NULL
        AND REGEXP_REPLACE(LOWER(mr.home_team_name), '\\s*\\([^)]*\\)\\s*', '', 'g') = te.norm_name
    `);
    console.log(`   Home normalized matches: ${homeNorm.rowCount.toLocaleString()}`);

    const awayNorm = await client.query(`
      UPDATE match_results mr
      SET away_team_id = te.id
      FROM (
        SELECT DISTINCT ON (REGEXP_REPLACE(LOWER(team_name), '\\s*\\([^)]*\\)\\s*', '', 'g'))
          id, 
          REGEXP_REPLACE(LOWER(team_name), '\\s*\\([^)]*\\)\\s*', '', 'g') as norm_name
        FROM team_elo
        ORDER BY REGEXP_REPLACE(LOWER(team_name), '\\s*\\([^)]*\\)\\s*', '', 'g'), elo_rating DESC
      ) te
      WHERE mr.away_team_id IS NULL
        AND mr.away_team_name IS NOT NULL
        AND REGEXP_REPLACE(LOWER(mr.away_team_name), '\\s*\\([^)]*\\)\\s*', '', 'g') = te.norm_name
    `);
    console.log(`   Away normalized matches: ${awayNorm.rowCount.toLocaleString()}`);

    // ============================================================
    // STRATEGY 3: First 20 char prefix (more aggressive)
    // ============================================================
    console.log("\n🎯 STRATEGY 3: Shorter prefix matching (first 20 chars)...");
    
    const homePrefix20 = await client.query(`
      UPDATE match_results mr
      SET home_team_id = te.id
      FROM (
        SELECT DISTINCT ON (LEFT(LOWER(TRIM(team_name)), 20)) 
          id, team_name, LEFT(LOWER(TRIM(team_name)), 20) as prefix
        FROM team_elo
        ORDER BY LEFT(LOWER(TRIM(team_name)), 20), elo_rating DESC
      ) te
      WHERE mr.home_team_id IS NULL
        AND mr.home_team_name IS NOT NULL
        AND LEFT(LOWER(TRIM(mr.home_team_name)), 20) = te.prefix
    `);
    console.log(`   Home 20-char prefix: ${homePrefix20.rowCount.toLocaleString()}`);

    const awayPrefix20 = await client.query(`
      UPDATE match_results mr
      SET away_team_id = te.id
      FROM (
        SELECT DISTINCT ON (LEFT(LOWER(TRIM(team_name)), 20)) 
          id, team_name, LEFT(LOWER(TRIM(team_name)), 20) as prefix
        FROM team_elo
        ORDER BY LEFT(LOWER(TRIM(team_name)), 20), elo_rating DESC
      ) te
      WHERE mr.away_team_id IS NULL
        AND mr.away_team_name IS NOT NULL
        AND LEFT(LOWER(TRIM(mr.away_team_name)), 20) = te.prefix
    `);
    console.log(`   Away 20-char prefix: ${awayPrefix20.rowCount.toLocaleString()}`);

    // ============================================================
    // STRATEGY 4: Match on words (club name contains team name or vice versa)
    // ============================================================
    console.log("\n🎯 STRATEGY 4: Contains matching...");
    
    const homeContains = await client.query(`
      UPDATE match_results mr
      SET home_team_id = (
        SELECT te.id
        FROM team_elo te
        WHERE LOWER(mr.home_team_name) LIKE '%' || LOWER(te.team_name) || '%'
           OR LOWER(te.team_name) LIKE '%' || LOWER(mr.home_team_name) || '%'
        ORDER BY LENGTH(te.team_name) DESC
        LIMIT 1
      )
      WHERE mr.home_team_id IS NULL
        AND mr.home_team_name IS NOT NULL
        AND LENGTH(mr.home_team_name) >= 15
        AND EXISTS (
          SELECT 1 FROM team_elo te
          WHERE LOWER(mr.home_team_name) LIKE '%' || LOWER(te.team_name) || '%'
             OR LOWER(te.team_name) LIKE '%' || LOWER(mr.home_team_name) || '%'
        )
    `);
    console.log(`   Home contains matches: ${homeContains.rowCount.toLocaleString()}`);

    const awayContains = await client.query(`
      UPDATE match_results mr
      SET away_team_id = (
        SELECT te.id
        FROM team_elo te
        WHERE LOWER(mr.away_team_name) LIKE '%' || LOWER(te.team_name) || '%'
           OR LOWER(te.team_name) LIKE '%' || LOWER(mr.away_team_name) || '%'
        ORDER BY LENGTH(te.team_name) DESC
        LIMIT 1
      )
      WHERE mr.away_team_id IS NULL
        AND mr.away_team_name IS NOT NULL
        AND LENGTH(mr.away_team_name) >= 15
        AND EXISTS (
          SELECT 1 FROM team_elo te
          WHERE LOWER(mr.away_team_name) LIKE '%' || LOWER(te.team_name) || '%'
             OR LOWER(te.team_name) LIKE '%' || LOWER(mr.away_team_name) || '%'
        )
    `);
    console.log(`   Away contains matches: ${awayContains.rowCount.toLocaleString()}`);

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
    console.log("📈 SESSION IMPROVEMENT:");
    console.log(`   Fully linked: +${(parseInt(final.fully_linked) - parseInt(initial.fully_linked)).toLocaleString()}`);
    console.log(`   Home: +${(parseInt(final.home_linked) - parseInt(initial.home_linked)).toLocaleString()}`);
    console.log(`   Away: +${(parseInt(final.away_linked) - parseInt(initial.away_linked)).toLocaleString()}`);

    // Sample remaining unlinked
    const sample = await client.query(`
      SELECT DISTINCT home_team_name
      FROM match_results
      WHERE home_team_id IS NULL AND home_team_name IS NOT NULL
      LIMIT 10
    `);
    
    if (sample.rows.length > 0) {
      console.log("\n📋 Sample still unlinked (for future improvement):");
      sample.rows.forEach((r, i) => console.log(`   ${i+1}. ${r.home_team_name}`));
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
