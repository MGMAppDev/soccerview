/**
 * Database Migration: Add normalized_name column to team_elo
 * 
 * This creates a pre-computed column without the (Uxx Boys/Girls) suffix
 * for faster matching during daily sync.
 * 
 * RUN ONCE: node scripts/migrations/add_normalized_name.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("🔧 Migration: Add normalized_name column to team_elo");
  console.log("=".repeat(50));

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Step 1: Add column if not exists
    console.log("Step 1: Adding normalized_name column...");
    await client.query(`
      ALTER TABLE team_elo 
      ADD COLUMN IF NOT EXISTS normalized_name TEXT;
    `);
    console.log("   ✅ Column added\n");

    // Step 2: Populate with stripped names
    console.log("Step 2: Populating normalized_name...");
    const result = await client.query(`
      UPDATE team_elo 
      SET normalized_name = LOWER(TRIM(REGEXP_REPLACE(team_name, '\\s*\\([^)]*\\)\\s*$', '')))
      WHERE normalized_name IS NULL OR normalized_name = '';
    `);
    console.log(`   ✅ Updated ${result.rowCount.toLocaleString()} rows\n`);

    // Step 3: Create index for fast lookups
    console.log("Step 3: Creating index on normalized_name...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_team_elo_normalized_name 
      ON team_elo(normalized_name);
    `);
    console.log("   ✅ Index created\n");

    // Step 4: Create trigger to auto-populate on insert/update
    console.log("Step 4: Creating trigger for auto-population...");
    await client.query(`
      CREATE OR REPLACE FUNCTION update_normalized_name()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.normalized_name := LOWER(TRIM(REGEXP_REPLACE(NEW.team_name, '\\s*\\([^)]*\\)\\s*$', '')));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    await client.query(`
      DROP TRIGGER IF EXISTS trg_update_normalized_name ON team_elo;
    `);
    
    await client.query(`
      CREATE TRIGGER trg_update_normalized_name
      BEFORE INSERT OR UPDATE OF team_name ON team_elo
      FOR EACH ROW
      EXECUTE FUNCTION update_normalized_name();
    `);
    console.log("   ✅ Trigger created\n");

    // Verify
    const verify = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(normalized_name) as with_normalized
      FROM team_elo;
    `);
    console.log("📊 Verification:");
    console.log(`   Total teams: ${parseInt(verify.rows[0].total).toLocaleString()}`);
    console.log(`   With normalized_name: ${parseInt(verify.rows[0].with_normalized).toLocaleString()}`);

    console.log("\n✅ Migration complete!");

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
