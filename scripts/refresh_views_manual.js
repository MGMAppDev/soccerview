/**
 * Manually refresh all materialized views
 * Works around the app_league_standings CONCURRENTLY issue
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  console.log("=".repeat(60));
  console.log("MANUAL VIEW REFRESH");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");

    const views = [
      'app_rankings',
      'app_matches_feed',
      'app_team_profile',
      'app_upcoming_schedule',
      'app_league_standings'
    ];

    for (const view of views) {
      console.log(`Refreshing ${view}...`);
      const start = Date.now();
      try {
        // Use non-concurrent refresh for app_league_standings
        if (view === 'app_league_standings') {
          await client.query(`REFRESH MATERIALIZED VIEW ${view}`);
        } else {
          await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
        }
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  Done in ${elapsed}s`);
      } catch (err) {
        // If concurrent fails, try non-concurrent
        console.log(`  Concurrent failed, trying non-concurrent...`);
        await client.query(`REFRESH MATERIALIZED VIEW ${view}`);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  Done in ${elapsed}s (non-concurrent)`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("ALL VIEWS REFRESHED!");
    console.log("=".repeat(60));

    // Final verification
    console.log("\nFinal verification - app_rankings Kansas U11 Boys:\n");
    const finalVerify = await client.query(`
      SELECT
          name,
          display_name,
          age_group
      FROM app_rankings
      WHERE state = 'KS'
        AND gender = 'M'
        AND age_group = 'U11'
      LIMIT 10;
    `);

    finalVerify.rows.forEach((row, i) => {
      console.log(`  ${i+1}. ${row.display_name} (age_group: ${row.age_group})`);
    });

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
