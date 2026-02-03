/**
 * Fix Mislinked Teams - Reset bad prefix matches (v2 CHUNKED)
 * 
 * Problem: Prefix matching linked "Team 2013" to "Team 2015" because 
 * they share the same first 20-30 characters.
 * 
 * Solution: Reset links where the YEAR in the team name doesn't match,
 * then re-run exact matching which will link correctly.
 * 
 * v2: CHUNKED by first letter to avoid statement timeout on 456K rows
 * 
 * Usage: node scripts/fixMislinkedTeams.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("🔧 Fix Mislinked Teams v2 - CHUNKED Processing");
  console.log("=".repeat(50));

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 180000, // 3 minutes per chunk
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

    // Step 1: Find and reset HOME team mismatches (CHUNKED)
    console.log("Step 1: Finding HOME team year mismatches (chunked)...");
    let homeResetTotal = 0;
    
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET home_team_id = NULL
        FROM team_elo te
        WHERE mr.home_team_id = te.id
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND mr.home_team_name ~ '\\d{4}'
          AND te.team_name ~ '\\d{4}'
          AND (
            (regexp_match(mr.home_team_name, '(20\\d{2})'))[1] 
            != 
            (regexp_match(te.team_name, '(20\\d{2})'))[1]
          )
      `, [letter]);
      homeResetTotal += result.rowCount;
      if (result.rowCount > 0) {
        process.stdout.write(`${letter}:${result.rowCount} `);
      }
    }
    console.log(`\n   Reset ${homeResetTotal} home team links\n`);

    // Step 2: Find and reset AWAY team mismatches (CHUNKED)
    console.log("Step 2: Finding AWAY team year mismatches (chunked)...");
    let awayResetTotal = 0;
    
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET away_team_id = NULL
        FROM team_elo te
        WHERE mr.away_team_id = te.id
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND mr.away_team_name ~ '\\d{4}'
          AND te.team_name ~ '\\d{4}'
          AND (
            (regexp_match(mr.away_team_name, '(20\\d{2})'))[1] 
            != 
            (regexp_match(te.team_name, '(20\\d{2})'))[1]
          )
      `, [letter]);
      awayResetTotal += result.rowCount;
      if (result.rowCount > 0) {
        process.stdout.write(`${letter}:${result.rowCount} `);
      }
    }
    console.log(`\n   Reset ${awayResetTotal} away team links\n`);

    // Step 3: Re-run exact matching for the reset records (already chunked)
    console.log("Step 3: Re-linking with exact match (suffix stripped)...");
    let homeLinked = 0, awayLinked = 0;
    
    for (const letter of chunks) {
      // Home exact match (suffix stripped)
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
      
      homeLinked += h.rowCount;
      awayLinked += a.rowCount;
      
      if (h.rowCount > 0 || a.rowCount > 0) {
        process.stdout.write(`${letter} `);
      }
    }
    
    console.log(`\n   Relinked: Home +${homeLinked}, Away +${awayLinked}\n`);

    // Verify Inter Miami fix
    const verify = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM match_results 
         WHERE (home_team_name ILIKE '%imcfa 2013%' OR away_team_name ILIKE '%imcfa 2013%')
           AND (home_team_id = 'f5398038-6fef-4d05-affa-18a21b73c853' 
             OR away_team_id = 'f5398038-6fef-4d05-affa-18a21b73c853')) as inter_miami_2013_matches
    `);
    console.log(`🔍 Inter Miami CF IMCFA 2013 linked matches: ${verify.rows[0].inter_miami_2013_matches}`);

    // Final status
    const status = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked
      FROM match_results
    `);
    console.log(`\n📊 Final Status:`);
    console.log(`   Total matches: ${parseInt(status.rows[0].total).toLocaleString()}`);
    console.log(`   Fully linked: ${parseInt(status.rows[0].fully_linked).toLocaleString()} (${(status.rows[0].fully_linked / status.rows[0].total * 100).toFixed(1)}%)`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Complete! Now re-run ELO recalculation:");
  console.log("   node scripts/recalculate_elo_v2.js");
}

main();
