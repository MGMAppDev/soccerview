/**
 * Analyze Database Indexes
 * Quick script to check current indexes and table sizes
 */

import pg from "pg";
import "dotenv/config";

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected to database\n");

  // Get table sizes
  console.log("=".repeat(60));
  console.log("TABLE SIZES");
  console.log("=".repeat(60));
  const sizes = await client.query(`
    SELECT
      schemaname,
      tablename,
      pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
      pg_total_relation_size(schemaname||'.'||tablename) AS bytes
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY bytes DESC
    LIMIT 20;
  `);
  console.table(sizes.rows);

  // Get indexes for match_results
  console.log("\n" + "=".repeat(60));
  console.log("MATCH_RESULTS INDEXES");
  console.log("=".repeat(60));
  const mrIndexes = await client.query(`
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename = 'match_results'
    ORDER BY indexname;
  `);
  console.table(mrIndexes.rows);

  // Get indexes for teams
  console.log("\n" + "=".repeat(60));
  console.log("TEAMS TABLE INDEXES");
  console.log("=".repeat(60));
  const teamsIndexes = await client.query(`
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename = 'teams'
    ORDER BY indexname;
  `);
  console.table(teamsIndexes.rows);

  // Get indexes for team_name_aliases
  console.log("\n" + "=".repeat(60));
  console.log("TEAM_NAME_ALIASES INDEXES");
  console.log("=".repeat(60));
  const aliasIndexes = await client.query(`
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename = 'team_name_aliases'
    ORDER BY indexname;
  `);
  console.table(aliasIndexes.rows);

  // Check pg_trgm extension
  console.log("\n" + "=".repeat(60));
  console.log("POSTGRESQL EXTENSIONS");
  console.log("=".repeat(60));
  const extensions = await client.query(`
    SELECT extname, extversion
    FROM pg_extension
    WHERE extname IN ('pg_trgm', 'btree_gin', 'btree_gist');
  `);
  console.table(extensions.rows);

  // Get row counts
  console.log("\n" + "=".repeat(60));
  console.log("ROW COUNTS");
  console.log("=".repeat(60));
  const counts = await client.query(`
    SELECT
      'match_results' AS table_name,
      COUNT(*) AS total_rows,
      COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) AS linked_rows,
      COUNT(*) FILTER (WHERE home_team_id IS NULL OR away_team_id IS NULL) AS unlinked_rows
    FROM match_results
    UNION ALL
    SELECT
      'teams' AS table_name,
      COUNT(*) AS total_rows,
      COUNT(*) FILTER (WHERE matches_played > 0) AS with_matches,
      COUNT(*) FILTER (WHERE matches_played = 0) AS no_matches
    FROM teams
    UNION ALL
    SELECT
      'team_name_aliases' AS table_name,
      COUNT(*) AS total_rows,
      COUNT(DISTINCT team_id) AS unique_teams,
      NULL AS col3
    FROM team_name_aliases;
  `);
  console.table(counts.rows);

  await client.end();
}

main().catch(console.error);
