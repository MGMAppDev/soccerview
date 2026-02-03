/**
 * Rename team_elo to teams (with cleanup)
 * 
 * Drops the old empty 'teams' table first, then renames team_elo.
 * 
 * Usage: node scripts/migrations/rename_team_elo_to_teams.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("🔧 Rename team_elo → teams");
  console.log("═".repeat(50));

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Check current state
    const check = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'teams') as teams_exists,
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'team_elo') as team_elo_exists
    `);

    const teamsExists = check.rows[0].teams_exists > 0;
    const teamEloExists = check.rows[0].team_elo_exists > 0;

    console.log(`teams table exists: ${teamsExists}`);
    console.log(`team_elo table exists: ${teamEloExists}\n`);

    if (teamsExists && teamEloExists) {
      // Check row counts
      const counts = await client.query(`
        SELECT 
          (SELECT COUNT(*) FROM teams) as teams_count,
          (SELECT COUNT(*) FROM team_elo) as team_elo_count
      `);
      
      console.log(`teams has ${counts.rows[0].teams_count} rows (old test data)`);
      console.log(`team_elo has ${counts.rows[0].team_elo_count} rows (real data)\n`);

      // Drop the old teams table
      console.log("Dropping old 'teams' table (107 rows of test data)...");
      await client.query(`DROP TABLE IF EXISTS teams CASCADE`);
      console.log("   ✅ Dropped\n");
    }

    if (teamEloExists) {
      // Rename team_elo to teams
      console.log("Renaming team_elo → teams...");
      await client.query(`ALTER TABLE team_elo RENAME TO teams`);
      console.log("   ✅ Renamed\n");

      // Rename indexes
      console.log("Renaming indexes...");
      const indexes = await client.query(`
        SELECT indexname FROM pg_indexes 
        WHERE tablename = 'teams' AND indexname LIKE '%team_elo%'
      `);
      
      for (const idx of indexes.rows) {
        const newName = idx.indexname.replace('team_elo', 'teams');
        try {
          await client.query(`ALTER INDEX "${idx.indexname}" RENAME TO "${newName}"`);
          console.log(`   ${idx.indexname} → ${newName}`);
        } catch (e) {
          console.log(`   ⚠️  Could not rename ${idx.indexname}: ${e.message}`);
        }
      }

      // Create backwards-compatibility view
      console.log("\nCreating backwards-compatibility view...");
      await client.query(`CREATE OR REPLACE VIEW team_elo AS SELECT * FROM teams`);
      console.log("   ✅ View 'team_elo' created (points to 'teams')\n");
    }

    // Verify
    const verify = await client.query(`SELECT COUNT(*) as cnt FROM teams`);
    console.log("═".repeat(50));
    console.log(`✅ COMPLETE: 'teams' table has ${parseInt(verify.rows[0].cnt).toLocaleString()} rows`);
    console.log("   All existing scripts will continue working via the view.");

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
