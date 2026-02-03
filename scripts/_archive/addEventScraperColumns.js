/**
 * Quick script to add columns to event_registry
 * Run once: node scripts/addEventScraperColumns.js
 */

import pg from "pg";
import "dotenv/config";

const { Client } = pg;

async function main() {
  console.log("🔧 Adding columns to event_registry table...\n");

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("✅ Connected to database\n");

    // Check existing columns
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'event_registry' 
      AND column_name IN ('last_scraped_at', 'match_count')
    `);

    const existingColumns = checkResult.rows.map(r => r.column_name);
    console.log(`📋 Existing columns: ${existingColumns.length > 0 ? existingColumns.join(", ") : "(none)"}`);

    // Add last_scraped_at if missing
    if (!existingColumns.includes("last_scraped_at")) {
      console.log("\n➕ Adding last_scraped_at column...");
      await client.query(`
        ALTER TABLE event_registry 
        ADD COLUMN last_scraped_at TIMESTAMPTZ
      `);
      console.log("   ✅ Added last_scraped_at");
    } else {
      console.log("\n⏭️  last_scraped_at already exists");
    }

    // Add match_count if missing
    if (!existingColumns.includes("match_count")) {
      console.log("\n➕ Adding match_count column...");
      await client.query(`
        ALTER TABLE event_registry 
        ADD COLUMN match_count INTEGER DEFAULT 0
      `);
      console.log("   ✅ Added match_count");
    } else {
      console.log("\n⏭️  match_count already exists");
    }

    // Verify
    const verifyResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'event_registry' 
      AND column_name IN ('last_scraped_at', 'match_count')
    `);

    console.log("\n📊 Verification:");
    for (const row of verifyResult.rows) {
      console.log(`   ✅ ${row.column_name}: ${row.data_type}`);
    }

    // Show current event count
    const countResult = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(last_scraped_at) as scraped
      FROM event_registry
    `);
    
    console.log("\n📊 Event Registry Status:");
    console.log(`   Total events: ${countResult.rows[0].total}`);
    console.log(`   Already scraped: ${countResult.rows[0].scraped}`);

    console.log("\n✅ DONE! Database is ready for runEventScraperBatch.js");

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
