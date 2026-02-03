import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");

    // Get all tables with row counts
    console.log("=== ALL TABLES WITH ROW COUNTS ===\n");

    const tables = await client.query(`
      SELECT
        schemaname,
        relname as table_name,
        n_live_tup as row_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY n_live_tup DESC
    `);

    console.log(`Found ${tables.rows.length} tables:\n`);

    let totalRows = 0;
    tables.rows.forEach(t => {
      const count = parseInt(t.row_count) || 0;
      totalRows += count;
      console.log(`  ${t.table_name.padEnd(35)} ${count.toLocaleString().padStart(12)} rows`);
    });

    console.log(`\n  ${"TOTAL".padEnd(35)} ${totalRows.toLocaleString().padStart(12)} rows`);

    // Get all materialized views
    console.log("\n\n=== MATERIALIZED VIEWS ===\n");

    const views = await client.query(`
      SELECT
        matviewname as view_name,
        pg_size_pretty(pg_relation_size(matviewname::regclass)) as size
      FROM pg_matviews
      WHERE schemaname = 'public'
      ORDER BY matviewname
    `);

    console.log(`Found ${views.rows.length} materialized views:\n`);
    for (const v of views.rows) {
      const countResult = await client.query(`SELECT COUNT(*) as cnt FROM ${v.view_name}`);
      console.log(`  ${v.view_name.padEnd(30)} ${parseInt(countResult.rows[0].cnt).toLocaleString().padStart(12)} rows  (${v.size})`);
    }

    // Get all regular views
    console.log("\n\n=== REGULAR VIEWS ===\n");

    const regularViews = await client.query(`
      SELECT viewname
      FROM pg_views
      WHERE schemaname = 'public'
      ORDER BY viewname
    `);

    console.log(`Found ${regularViews.rows.length} regular views:\n`);
    regularViews.rows.forEach(v => {
      console.log(`  ${v.viewname}`);
    });

    // Group tables by purpose
    console.log("\n\n=== TABLES BY PURPOSE ===\n");

    const purposes = {
      "PRODUCTION (Core Data)": ["teams_v2", "matches_v2", "clubs", "leagues", "tournaments", "seasons"],
      "STAGING (Scraper Input)": ["staging_games", "staging_teams", "staging_events"],
      "USER DATA": ["user_predictions", "prediction_scores", "profiles"],
      "CONFIGURATION": ["scrape_targets", "active_events"],
      "ARCHIVED/LEGACY": [],
    };

    // Find tables that match each category
    const tableNames = tables.rows.map(t => t.table_name);

    for (const [category, knownTables] of Object.entries(purposes)) {
      const matches = knownTables.filter(t => tableNames.includes(t));
      if (matches.length > 0 || category === "ARCHIVED/LEGACY") {
        console.log(`${category}:`);
        if (matches.length > 0) {
          matches.forEach(t => {
            const row = tables.rows.find(r => r.table_name === t);
            console.log(`  - ${t}: ${parseInt(row?.row_count || 0).toLocaleString()} rows`);
          });
        }
        // Find archived tables
        if (category === "ARCHIVED/LEGACY") {
          const archived = tableNames.filter(t =>
            t.includes("deprecated") ||
            t.includes("_old") ||
            t.includes("_backup") ||
            t.includes("_v1") ||
            (t.startsWith("match_") && !t.includes("_v2")) ||
            (t.startsWith("team_") && !t.includes("_v2"))
          );
          archived.forEach(t => {
            const row = tables.rows.find(r => r.table_name === t);
            console.log(`  - ${t}: ${parseInt(row?.row_count || 0).toLocaleString()} rows`);
          });
        }
        console.log("");
      }
    }

  } catch (err) {
    console.error("Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
