/**
 * Link Teams v5.0 - Multi-Strategy Matching
 * 
 * Strategies (in order):
 * 1. EXACT MATCH - match_results name = team_elo name (suffix stripped)
 * 2. SUFFIX MATCH - team_elo name ENDS WITH match_results name
 *    (handles club prefix: "Chesapeake United SC CUSC 2014G Black" ends with "CUSC 2014G Black")
 * 
 * All strategies are CHUNKED by first letter to avoid timeout.
 * 
 * Usage: node scripts/linkTeamsV5.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("🔗 Link Teams v5.0 - Multi-Strategy Matching");
  console.log("=".repeat(55));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 180000, // 3 min per chunk
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Initial status
    const initial = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked
      FROM match_results
    `);
    console.log(`📊 BEFORE: ${parseInt(initial.rows[0].fully_linked).toLocaleString()} / ${parseInt(initial.rows[0].total).toLocaleString()} fully linked (${(initial.rows[0].fully_linked / initial.rows[0].total * 100).toFixed(1)}%)\n`);

    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

    // ============================================================
    // STRATEGY 1: EXACT MATCH (suffix stripped)
    // ============================================================
    console.log("🎯 STRATEGY 1: Exact Match (suffix stripped)");
    let exactHome = 0, exactAway = 0;

    for (const letter of chunks) {
      const h = await client.query(`
        UPDATE match_results mr
        SET home_team_id = te.id
        FROM team_elo te
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(mr.home_team_name)) = LOWER(TRIM(REGEXP_REPLACE(te.team_name, '\\s*\\([^)]*\\)\\s*$', '')))
      `, [letter]);

      const a = await client.query(`
        UPDATE match_results mr
        SET away_team_id = te.id
        FROM team_elo te
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(mr.away_team_name)) = LOWER(TRIM(REGEXP_REPLACE(te.team_name, '\\s*\\([^)]*\\)\\s*$', '')))
      `, [letter]);

      exactHome += h.rowCount;
      exactAway += a.rowCount;
      if (h.rowCount > 0 || a.rowCount > 0) process.stdout.write(`${letter} `);
    }
    console.log(`\n   Linked: Home +${exactHome}, Away +${exactAway}\n`);

    // ============================================================
    // STRATEGY 2: SUFFIX MATCH (team_elo ends with match_results name)
    // Handles: "Chesapeake United SC CUSC 2014G Black" ends with "CUSC 2014G Black"
    // ============================================================
    console.log("🎯 STRATEGY 2: Suffix Match (club prefix handling)");
    let suffixHome = 0, suffixAway = 0;

    for (const letter of chunks) {
      // Home suffix match - team_elo (stripped) ENDS WITH match_results name
      const h = await client.query(`
        UPDATE match_results mr
        SET home_team_id = te.id
        FROM team_elo te
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LENGTH(mr.home_team_name) >= 10
          AND LOWER(TRIM(REGEXP_REPLACE(te.team_name, '\\s*\\([^)]*\\)\\s*$', ''))) 
              LIKE '%' || LOWER(TRIM(mr.home_team_name))
      `, [letter]);

      const a = await client.query(`
        UPDATE match_results mr
        SET away_team_id = te.id
        FROM team_elo te
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LENGTH(mr.away_team_name) >= 10
          AND LOWER(TRIM(REGEXP_REPLACE(te.team_name, '\\s*\\([^)]*\\)\\s*$', ''))) 
              LIKE '%' || LOWER(TRIM(mr.away_team_name))
      `, [letter]);

      suffixHome += h.rowCount;
      suffixAway += a.rowCount;
      if (h.rowCount > 0 || a.rowCount > 0) process.stdout.write(`${letter} `);
    }
    console.log(`\n   Linked: Home +${suffixHome}, Away +${suffixAway}\n`);

    // ============================================================
    // FINAL STATUS
    // ============================================================
    const final = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL) as home_linked,
        COUNT(*) FILTER (WHERE away_team_id IS NOT NULL) as away_linked
      FROM match_results
    `);

    const f = final.rows[0];
    const improvement = f.fully_linked - initial.rows[0].fully_linked;

    console.log("📊 FINAL STATUS:");
    console.log(`   Total matches: ${parseInt(f.total).toLocaleString()}`);
    console.log(`   Fully linked: ${parseInt(f.fully_linked).toLocaleString()} (${(f.fully_linked / f.total * 100).toFixed(1)}%)`);
    console.log(`   Home linked: ${parseInt(f.home_linked).toLocaleString()} (${(f.home_linked / f.total * 100).toFixed(1)}%)`);
    console.log(`   Away linked: ${parseInt(f.away_linked).toLocaleString()} (${(f.away_linked / f.total * 100).toFixed(1)}%)`);
    console.log(`\n   ✨ Improvement: +${improvement.toLocaleString()} fully linked matches`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Complete!");
  console.log("Next: node scripts/recalculate_elo_v2.js");
}

main();
