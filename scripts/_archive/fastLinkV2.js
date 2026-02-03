/**
 * Fast Link v2 - Chunked Fuzzy
 * 
 * Usage: node scripts/fastLinkV2.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("⚡ Fast Link v2 - Chunked Fuzzy");
  console.log("═".repeat(55));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, // 5 min per chunk
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Baseline
    const baseline = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked
      FROM match_results
    `);
    const b = baseline.rows[0];
    console.log(`📊 BASELINE: ${parseInt(b.fully_linked).toLocaleString()} / ${parseInt(b.total).toLocaleString()} (${(b.fully_linked/b.total*100).toFixed(1)}%)\n`);

    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

    // ============================================================
    // Chunked Fuzzy Match (by first letter)
    // ============================================================
    console.log("🔍 Chunked fuzzy match (similarity > 0.75)...\n");
    
    let totalHome = 0, totalAway = 0;
    
    for (const letter of chunks) {
      // HOME
      const homeResult = await client.query(`
        UPDATE match_results mr
        SET home_team_id = best.team_id
        FROM (
          SELECT DISTINCT ON (mr_name) 
            mr_name,
            ta.team_id,
            similarity(LOWER(TRIM(mr_name)), ta.alias_name) as sim
          FROM (
            SELECT DISTINCT home_team_name as mr_name
            FROM match_results 
            WHERE home_team_id IS NULL 
              AND home_team_name IS NOT NULL
              AND LENGTH(home_team_name) >= 10
              AND UPPER(LEFT(home_team_name, 1)) = $1
              AND home_team_name ~ '^[A-Za-z]'
              AND home_team_name NOT ILIKE '%***%'
              AND home_team_name NOT ILIKE '%dropped%'
              AND home_team_name NOT ILIKE '%bye%'
              AND home_team_name NOT ILIKE '%tbd%'
          ) unlinked
          JOIN team_name_aliases ta ON ta.alias_name % LOWER(TRIM(unlinked.mr_name))
          WHERE similarity(LOWER(TRIM(unlinked.mr_name)), ta.alias_name) > 0.75
          ORDER BY mr_name, sim DESC
        ) best
        WHERE mr.home_team_name = best.mr_name
          AND mr.home_team_id IS NULL
      `, [letter]);
      
      // AWAY
      const awayResult = await client.query(`
        UPDATE match_results mr
        SET away_team_id = best.team_id
        FROM (
          SELECT DISTINCT ON (mr_name) 
            mr_name,
            ta.team_id,
            similarity(LOWER(TRIM(mr_name)), ta.alias_name) as sim
          FROM (
            SELECT DISTINCT away_team_name as mr_name
            FROM match_results 
            WHERE away_team_id IS NULL 
              AND away_team_name IS NOT NULL
              AND LENGTH(away_team_name) >= 10
              AND UPPER(LEFT(away_team_name, 1)) = $1
              AND away_team_name ~ '^[A-Za-z]'
              AND away_team_name NOT ILIKE '%***%'
              AND away_team_name NOT ILIKE '%dropped%'
              AND away_team_name NOT ILIKE '%bye%'
              AND away_team_name NOT ILIKE '%tbd%'
          ) unlinked
          JOIN team_name_aliases ta ON ta.alias_name % LOWER(TRIM(unlinked.mr_name))
          WHERE similarity(LOWER(TRIM(unlinked.mr_name)), ta.alias_name) > 0.75
          ORDER BY mr_name, sim DESC
        ) best
        WHERE mr.away_team_name = best.mr_name
          AND mr.away_team_id IS NULL
      `, [letter]);

      totalHome += homeResult.rowCount;
      totalAway += awayResult.rowCount;
      
      if (homeResult.rowCount > 0 || awayResult.rowCount > 0) {
        console.log(`   ${letter}: Home +${homeResult.rowCount}, Away +${awayResult.rowCount}`);
      }
    }

    console.log(`\n   TOTAL: Home +${totalHome.toLocaleString()}, Away +${totalAway.toLocaleString()}`);

    // ============================================================
    // FINAL RESULTS
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

    console.log("\n" + "═".repeat(55));
    console.log("📊 FINAL RESULTS:");
    console.log("═".repeat(55));
    console.log(`   Total:        ${parseInt(f.total).toLocaleString()}`);
    console.log(`   Fully linked: ${parseInt(f.fully_linked).toLocaleString()} (${(f.fully_linked/f.total*100).toFixed(1)}%)`);
    console.log(`   Home linked:  ${parseInt(f.home_linked).toLocaleString()} (${(f.home_linked/f.total*100).toFixed(1)}%)`);
    console.log(`   Away linked:  ${parseInt(f.away_linked).toLocaleString()} (${(f.away_linked/f.total*100).toFixed(1)}%)`);
    console.log(`\n   ✨ IMPROVEMENT: +${(f.fully_linked - b.fully_linked).toLocaleString()} fully linked`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Complete!");
}

main();
