/**
 * Link Via Aliases - Fast Indexed Team Linking
 * 
 * Uses the pre-built alias table for O(log n) lookups instead of
 * expensive regex operations across 456K rows.
 * 
 * CHUNKED by first letter to avoid timeouts.
 * 
 * Usage: node scripts/linkViaAliases.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("🔗 Link Via Aliases - Fast Indexed Linking");
  console.log("=".repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, // 5 minutes per operation
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Get baseline
    const baseline = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NULL) as home_null,
        COUNT(*) FILTER (WHERE away_team_id IS NULL) as away_null
      FROM match_results
    `);
    const b = baseline.rows[0];
    console.log("📊 BASELINE:");
    console.log(`   Total matches:  ${parseInt(b.total).toLocaleString()}`);
    console.log(`   Fully linked:   ${parseInt(b.fully_linked).toLocaleString()} (${(b.fully_linked / b.total * 100).toFixed(1)}%)`);
    console.log(`   Home unlinked:  ${parseInt(b.home_null).toLocaleString()}`);
    console.log(`   Away unlinked:  ${parseInt(b.away_null).toLocaleString()}\n`);

    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

    // ================================================================
    // STRATEGY 1: Direct alias lookup (exact match on normalized name)
    // ================================================================
    console.log("🎯 STRATEGY 1: Direct Alias Lookup");
    console.log("   Matching: LOWER(TRIM(match_name)) = alias_name\n");
    
    let strategy1Home = 0, strategy1Away = 0;

    console.log("   Linking HOME teams...");
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(mr.home_team_name)) = ta.alias_name
      `, [letter]);
      strategy1Home += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Home linked: +${strategy1Home.toLocaleString()}\n`);

    console.log("   Linking AWAY teams...");
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(mr.away_team_name)) = ta.alias_name
      `, [letter]);
      strategy1Away += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Away linked: +${strategy1Away.toLocaleString()}\n`);

    // ================================================================
    // STRATEGY 2: Punctuation-normalized lookup
    // ================================================================
    console.log("🎯 STRATEGY 2: Punctuation-Normalized Lookup");
    console.log("   Matching with dots/dashes removed\n");
    
    let strategy2Home = 0, strategy2Away = 0;

    console.log("   Linking HOME teams...");
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(mr.home_team_name, '[.''\"]', '', 'g'),
                '[-]', ' ', 'g'
              ))) = ta.alias_name
      `, [letter]);
      strategy2Home += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Home linked: +${strategy2Home.toLocaleString()}\n`);

    console.log("   Linking AWAY teams...");
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(mr.away_team_name, '[.''\"]', '', 'g'),
                '[-]', ' ', 'g'
              ))) = ta.alias_name
      `, [letter]);
      strategy2Away += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Away linked: +${strategy2Away.toLocaleString()}\n`);

    // ================================================================
    // STRATEGY 3: Whitespace-collapsed lookup
    // ================================================================
    console.log("🎯 STRATEGY 3: Whitespace-Collapsed Lookup");
    console.log("   Matching with multiple spaces collapsed\n");
    
    let strategy3Home = 0, strategy3Away = 0;

    console.log("   Linking HOME teams...");
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL
          AND mr.home_team_name IS NOT NULL
          AND UPPER(LEFT(mr.home_team_name, 1)) = $1
          AND LOWER(REGEXP_REPLACE(TRIM(mr.home_team_name), '\\s+', ' ', 'g')) = ta.alias_name
      `, [letter]);
      strategy3Home += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Home linked: +${strategy3Home.toLocaleString()}\n`);

    console.log("   Linking AWAY teams...");
    for (const letter of chunks) {
      const result = await client.query(`
        UPDATE match_results mr
        SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL
          AND mr.away_team_name IS NOT NULL
          AND UPPER(LEFT(mr.away_team_name, 1)) = $1
          AND LOWER(REGEXP_REPLACE(TRIM(mr.away_team_name), '\\s+', ' ', 'g')) = ta.alias_name
      `, [letter]);
      strategy3Away += result.rowCount;
      if (result.rowCount > 0) process.stdout.write(`${letter}:${result.rowCount} `);
    }
    console.log(`\n   Away linked: +${strategy3Away.toLocaleString()}\n`);

    // ================================================================
    // FINAL RESULTS
    // ================================================================
    const final = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL) as home_linked,
        COUNT(*) FILTER (WHERE away_team_id IS NOT NULL) as away_linked
      FROM match_results
    `);
    const f = final.rows[0];
    
    const improvement = f.fully_linked - b.fully_linked;

    console.log("═".repeat(60));
    console.log("📊 FINAL RESULTS:");
    console.log("═".repeat(60));
    console.log(`   Total matches:     ${parseInt(f.total).toLocaleString()}`);
    console.log(`   Fully linked:      ${parseInt(f.fully_linked).toLocaleString()} (${(f.fully_linked / f.total * 100).toFixed(1)}%)`);
    console.log(`   Home linked:       ${parseInt(f.home_linked).toLocaleString()} (${(f.home_linked / f.total * 100).toFixed(1)}%)`);
    console.log(`   Away linked:       ${parseInt(f.away_linked).toLocaleString()} (${(f.away_linked / f.total * 100).toFixed(1)}%)`);
    console.log("");
    console.log(`   ✨ IMPROVEMENT:    +${improvement.toLocaleString()} fully linked matches`);
    console.log("");
    console.log("   By Strategy:");
    console.log(`     1. Direct:       Home +${strategy1Home.toLocaleString()}, Away +${strategy1Away.toLocaleString()}`);
    console.log(`     2. Punct Norm:   Home +${strategy2Home.toLocaleString()}, Away +${strategy2Away.toLocaleString()}`);
    console.log(`     3. Whitespace:   Home +${strategy3Home.toLocaleString()}, Away +${strategy3Away.toLocaleString()}`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Step 3 Complete!");
  console.log("Next: node scripts/analyzeUnlinked.js");
}

main();
