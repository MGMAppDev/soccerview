/**
 * Manually refresh all materialized views
 * Works around the app_league_standings CONCURRENTLY issue
 *
 * Session 80 Fix: Added retry logic and fresh connections per view
 * to handle ECONNRESET errors in GitHub Actions
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a fresh database client with robust connection settings
 */
function createClient() {
  return new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 minutes
    query_timeout: 600000, // 10 minutes
    connectionTimeoutMillis: 30000, // 30 seconds to connect
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000, // Start keepalive after 10s
  });
}

/**
 * Refresh a single view with retry logic
 * Uses a fresh connection for each attempt to avoid stale connection issues
 */
async function refreshViewWithRetry(view) {
  const useConcurrent = view !== 'app_league_standings';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = createClient();
    const start = Date.now();

    try {
      await client.connect();

      if (useConcurrent) {
        try {
          await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
        } catch (concurrentErr) {
          // If concurrent fails, try non-concurrent
          console.log(`  Concurrent failed, trying non-concurrent...`);
          await client.query(`REFRESH MATERIALIZED VIEW ${view}`);
        }
      } else {
        await client.query(`REFRESH MATERIALIZED VIEW ${view}`);
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  Done in ${elapsed}s`);
      return true;

    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const isRetryable = err.code === 'ECONNRESET' ||
                          err.code === 'ETIMEDOUT' ||
                          err.code === 'ENOTFOUND' ||
                          err.code === 'ECONNREFUSED' ||
                          err.message?.includes('Connection terminated');

      if (isRetryable && attempt < MAX_RETRIES) {
        console.log(`  ⚠️ Attempt ${attempt} failed after ${elapsed}s: ${err.code || err.message}`);
        console.log(`  Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      } else if (attempt === MAX_RETRIES) {
        console.error(`  ❌ Failed after ${MAX_RETRIES} attempts: ${err.message}`);
        throw err;
      } else {
        // Non-retryable error
        throw err;
      }
    } finally {
      try {
        await client.end();
      } catch (endErr) {
        // Ignore errors when closing connection
      }
    }
  }

  return false;
}

async function main() {
  console.log("=".repeat(60));
  console.log("MANUAL VIEW REFRESH");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const views = [
    'app_rankings',
    'app_matches_feed',
    'app_team_profile',
    'app_upcoming_schedule',
    'app_league_standings'
  ];

  let failedViews = [];

  for (const view of views) {
    console.log(`Refreshing ${view}...`);
    try {
      await refreshViewWithRetry(view);
    } catch (err) {
      failedViews.push(view);
      console.error(`  Failed to refresh ${view}: ${err.message}`);
      // Continue with other views even if one fails
    }
  }

  console.log("\n" + "=".repeat(60));
  if (failedViews.length === 0) {
    console.log("ALL VIEWS REFRESHED!");
  } else {
    console.log(`VIEWS REFRESHED WITH ${failedViews.length} FAILURES`);
    console.log(`Failed: ${failedViews.join(', ')}`);
  }
  console.log("=".repeat(60));

  // Final verification using a fresh connection
  const verifyClient = createClient();
  try {
    await verifyClient.connect();
    console.log("\nFinal verification - app_rankings Kansas U11 Boys:\n");
    const finalVerify = await verifyClient.query(`
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
    console.log("\nVerification query failed (non-critical):", err.message);
  } finally {
    try {
      await verifyClient.end();
    } catch (endErr) {
      // Ignore
    }
  }

  // Exit with error if any views failed
  if (failedViews.length > 0) {
    process.exit(1);
  }
}

main();
