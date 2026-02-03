/**
 * Create Alias Index - Fast Lookup Index
 * 
 * Creates a B-tree index on alias_name for O(log n) lookups
 * instead of O(n) table scans.
 * 
 * Usage: node scripts/createAliasIndex.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("🔧 Create Alias Index");
  console.log("=".repeat(55));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 300000, // 5 minutes
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Check if index already exists
    const existingIndex = await client.query(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = 'team_name_aliases' 
        AND indexname = 'idx_alias_name_lookup'
    `);

    if (existingIndex.rows.length > 0) {
      console.log("⚠️  Index already exists, dropping and recreating...");
      await client.query(`DROP INDEX IF EXISTS idx_alias_name_lookup`);
    }

    // Create the primary lookup index
    console.log("Creating index idx_alias_name_lookup...");
    const startTime = Date.now();
    
    await client.query(`
      CREATE INDEX idx_alias_name_lookup 
      ON team_name_aliases (alias_name)
    `);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Index created in ${duration}s\n`);

    // Also create index on team_id for reverse lookups
    console.log("Creating index idx_alias_team_id...");
    await client.query(`DROP INDEX IF EXISTS idx_alias_team_id`);
    await client.query(`
      CREATE INDEX idx_alias_team_id 
      ON team_name_aliases (team_id)
    `);
    console.log(`   ✅ Index created\n`);

    // Analyze the table to update statistics
    console.log("Analyzing table for query optimization...");
    await client.query(`ANALYZE team_name_aliases`);
    console.log(`   ✅ Statistics updated\n`);

    // Verify indexes
    const indexes = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'team_name_aliases'
    `);
    
    console.log("📊 INDEXES ON team_name_aliases:");
    for (const idx of indexes.rows) {
      console.log(`   ${idx.indexname}`);
    }

    // Test lookup speed
    console.log("\n🚀 Testing lookup speed...");
    const testStart = Date.now();
    const testResult = await client.query(`
      SELECT team_id, alias_name, source
      FROM team_name_aliases
      WHERE alias_name = 'inter miami cf imcfa 2013'
      LIMIT 1
    `);
    const testDuration = Date.now() - testStart;
    
    if (testResult.rows.length > 0) {
      console.log(`   Found: ${testResult.rows[0].alias_name}`);
      console.log(`   Team ID: ${testResult.rows[0].team_id}`);
      console.log(`   Lookup time: ${testDuration}ms`);
    } else {
      console.log(`   Test lookup returned no results (${testDuration}ms)`);
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Step 2 Complete!");
  console.log("Next: node scripts/linkViaAliases.js");
}

main();
