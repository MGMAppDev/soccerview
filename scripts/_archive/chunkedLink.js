/**
 * CHUNKED Team Linking - Process by first letter
 * 
 * Breaks the massive update into 26 smaller operations (A-Z).
 * Each chunk is small enough to complete without timeout.
 * 
 * Usage: node scripts/chunkedLink.js
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
  console.log("🚀 CHUNKED TEAM LINKING (by first letter)");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 180000, // 3 minutes per chunk
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

    // Letters to process (including numbers and special)
    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    
    let totalHomeLinked = 0;
    let totalAwayLinked = 0;

    // ============================================================
    // EXACT MATCHES BY CHUNK
    // ============================================================
    console.log("🎯 PHASE 1: Exact matches (case-insensitive) by chunk...\n");
    
    for (const letter of chunks) {
      // Home exact match for this letter
      const homeResult = await client.query(`
        UPDATE match_results mr
        SET home_team_id = te.id
        FROM team_elo te
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(mr.home_team_name)) = LOWER(TRIM(te.team_name))
      `, [letter]);
      
      // Away exact match for this letter
      const awayResult = await client.query(`
        UPDATE match_results mr
        SET away_team_id = te.id
        FROM team_elo te
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(mr.away_team_name)) = LOWER(TRIM(te.team_name))
      `, [letter]);
      
      totalHomeLinked += homeResult.rowCount;
      totalAwayLinked += awayResult.rowCount;
      
      if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
        process.stdout.write(`   ${letter}: Home +${homeResult.rowCount}, Away +${awayResult.rowCount}\n`);
      }
    }
    
    console.log(`\n   ✅ Exact matches complete: Home +${totalHomeLinked.toLocaleString()}, Away +${totalAwayLinked.toLocaleString()}\n`);

    // ============================================================
    // PREFIX MATCHES (30 char) BY CHUNK
    // ============================================================
    console.log("🎯 PHASE 2: Prefix matches (30 chars) by chunk...\n");
    
    let prefixHome = 0;
    let prefixAway = 0;
    
    for (const letter of chunks) {
      // Build lookup of prefixes for teams starting with this letter
      const homeResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(team_name)), 30))
            id, LEFT(LOWER(TRIM(team_name)), 30) as prefix
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(team_name)), 30), elo_rating DESC
        )
        UPDATE match_results mr
        SET home_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.home_team_name)), 30) = tp.prefix
      `, [letter]);
      
      const awayResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(team_name)), 30))
            id, LEFT(LOWER(TRIM(team_name)), 30) as prefix
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(team_name)), 30), elo_rating DESC
        )
        UPDATE match_results mr
        SET away_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.away_team_name)), 30) = tp.prefix
      `, [letter]);
      
      prefixHome += homeResult.rowCount;
      prefixAway += awayResult.rowCount;
      
      if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
        process.stdout.write(`   ${letter}: Home +${homeResult.rowCount}, Away +${awayResult.rowCount}\n`);
      }
    }
    
    console.log(`\n   ✅ Prefix matches complete: Home +${prefixHome.toLocaleString()}, Away +${prefixAway.toLocaleString()}\n`);

    // ============================================================
    // SHORTER PREFIX (20 char) BY CHUNK
    // ============================================================
    console.log("🎯 PHASE 3: Shorter prefix matches (20 chars) by chunk...\n");
    
    let prefix20Home = 0;
    let prefix20Away = 0;
    
    for (const letter of chunks) {
      const homeResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(team_name)), 20))
            id, LEFT(LOWER(TRIM(team_name)), 20) as prefix
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(team_name)), 20), elo_rating DESC
        )
        UPDATE match_results mr
        SET home_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.home_team_name)), 20) = tp.prefix
      `, [letter]);
      
      const awayResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(team_name)), 20))
            id, LEFT(LOWER(TRIM(team_name)), 20) as prefix
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(team_name)), 20), elo_rating DESC
        )
        UPDATE match_results mr
        SET away_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.away_team_name)), 20) = tp.prefix
      `, [letter]);
      
      prefix20Home += homeResult.rowCount;
      prefix20Away += awayResult.rowCount;
      
      if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
        process.stdout.write(`   ${letter}: Home +${homeResult.rowCount}, Away +${awayResult.rowCount}\n`);
      }
    }
    
    console.log(`\n   ✅ 20-char prefix complete: Home +${prefix20Home.toLocaleString()}, Away +${prefix20Away.toLocaleString()}\n`);

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
    
    console.log("=".repeat(60));
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
      console.log("\n📋 Sample still unlinked:");
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
