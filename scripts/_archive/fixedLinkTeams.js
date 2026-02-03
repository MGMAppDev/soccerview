/**
 * FIXED Team Linking - Strips (Uxx Boys/Girls) suffix before matching
 * 
 * ROOT CAUSE: team_elo has names like "Club Name 2013 (U13 Boys)"
 *             match_results has names like "Club Name 2013" (no suffix)
 * 
 * This script strips the suffix before matching, resulting in MUCH better linking.
 * 
 * Usage: node scripts/fixedLinkTeams.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(60));
  console.log("🔧 FIXED TEAM LINKING - Strips age/gender suffix");
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
    console.log("");

    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    
    // ============================================================
    // STRATEGY 1: Exact match after stripping suffix from team_elo
    // ============================================================
    console.log("🎯 STRATEGY 1: Match after stripping (Uxx Boys/Girls) suffix...\n");
    
    let s1Home = 0, s1Away = 0;
    
    for (const letter of chunks) {
      // Home - strip suffix from team_elo name, then match
      const homeResult = await client.query(`
        UPDATE match_results mr
        SET home_team_id = te.id
        FROM team_elo te
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(mr.home_team_name)) = LOWER(TRIM(REGEXP_REPLACE(te.team_name, '\\s*\\([^)]*\\)\\s*$', '')))
      `, [letter]);
      
      const awayResult = await client.query(`
        UPDATE match_results mr
        SET away_team_id = te.id
        FROM team_elo te
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(mr.away_team_name)) = LOWER(TRIM(REGEXP_REPLACE(te.team_name, '\\s*\\([^)]*\\)\\s*$', '')))
      `, [letter]);
      
      s1Home += homeResult.rowCount;
      s1Away += awayResult.rowCount;
      
      if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
        process.stdout.write(`   ${letter}: Home +${homeResult.rowCount}, Away +${awayResult.rowCount}\n`);
      }
    }
    
    console.log(`\n   ✅ Strategy 1 complete: Home +${s1Home.toLocaleString()}, Away +${s1Away.toLocaleString()}\n`);

    // ============================================================
    // STRATEGY 2: Prefix match (30 chars) after stripping suffix
    // ============================================================
    console.log("🎯 STRATEGY 2: Prefix match (30 chars) after stripping suffix...\n");
    
    let s2Home = 0, s2Away = 0;
    
    for (const letter of chunks) {
      const homeResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30))
            id, 
            LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30) as prefix
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30), elo_rating DESC
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
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30))
            id, 
            LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30) as prefix
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 30), elo_rating DESC
        )
        UPDATE match_results mr
        SET away_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.away_team_name)), 30) = tp.prefix
      `, [letter]);
      
      s2Home += homeResult.rowCount;
      s2Away += awayResult.rowCount;
      
      if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
        process.stdout.write(`   ${letter}: Home +${homeResult.rowCount}, Away +${awayResult.rowCount}\n`);
      }
    }
    
    console.log(`\n   ✅ Strategy 2 complete: Home +${s2Home.toLocaleString()}, Away +${s2Away.toLocaleString()}\n`);

    // ============================================================
    // STRATEGY 3: Shorter prefix (20 chars) after stripping suffix
    // ============================================================
    console.log("🎯 STRATEGY 3: Shorter prefix (20 chars) after stripping suffix...\n");
    
    let s3Home = 0, s3Away = 0;
    
    for (const letter of chunks) {
      const homeResult = await client.query(`
        WITH team_prefixes AS (
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20))
            id, 
            LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20) as prefix
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20), elo_rating DESC
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
          SELECT DISTINCT ON (LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20))
            id, 
            LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20) as prefix
          FROM team_elo
          WHERE UPPER(LEFT(team_name, 1)) = $1
          ORDER BY LEFT(LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', ''))), 20), elo_rating DESC
        )
        UPDATE match_results mr
        SET away_team_id = tp.id
        FROM team_prefixes tp
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LEFT(LOWER(TRIM(mr.away_team_name)), 20) = tp.prefix
      `, [letter]);
      
      s3Home += homeResult.rowCount;
      s3Away += awayResult.rowCount;
      
      if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
        process.stdout.write(`   ${letter}: Home +${homeResult.rowCount}, Away +${awayResult.rowCount}\n`);
      }
    }
    
    console.log(`\n   ✅ Strategy 3 complete: Home +${s3Home.toLocaleString()}, Away +${s3Away.toLocaleString()}\n`);

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

    // Verify Inter Miami now links
    const interMiamiCheck = await client.query(`
      SELECT COUNT(*) as cnt
      FROM match_results
      WHERE (home_team_id IS NOT NULL OR away_team_id IS NOT NULL)
        AND (home_team_name ILIKE '%inter miami%' OR away_team_name ILIKE '%inter miami%')
    `);
    console.log(`\n🔍 Inter Miami CF linked matches: ${interMiamiCheck.rows[0].cnt}`);

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`\n✅ Completed at: ${new Date().toISOString()}`);
}

main();
