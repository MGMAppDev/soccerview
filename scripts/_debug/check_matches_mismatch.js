/**
 * Debug script to analyze matches_played mismatches
 */
import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected to database\n");

  // Query 1: Distribution of mismatches
  console.log("=".repeat(60));
  console.log("QUERY 1: Distribution of matches_played mismatches");
  console.log("=".repeat(60));
  const q1 = await client.query(`
    WITH match_counts AS (
        SELECT team_id, COUNT(*) as actual_count
        FROM (
            SELECT home_team_id as team_id FROM matches_v2 WHERE home_team_id IS NOT NULL
            UNION ALL
            SELECT away_team_id as team_id FROM matches_v2 WHERE away_team_id IS NOT NULL
        ) m
        GROUP BY team_id
    )
    SELECT
        CASE
            WHEN t.matches_played = mc.actual_count THEN 'exact_match'
            WHEN t.matches_played > mc.actual_count THEN 'stored_higher'
            WHEN t.matches_played < mc.actual_count THEN 'stored_lower'
        END as comparison,
        COUNT(*) as team_count,
        ROUND(AVG(ABS(t.matches_played - mc.actual_count))::numeric, 2) as avg_difference
    FROM teams_v2 t
    JOIN match_counts mc ON t.id = mc.team_id
    GROUP BY 1
    ORDER BY 1
  `);
  console.table(q1.rows);

  // Query 2: Specific examples of mismatches
  console.log("\n" + "=".repeat(60));
  console.log("QUERY 2: Top 10 mismatches by difference");
  console.log("=".repeat(60));
  const q2 = await client.query(`
    WITH match_counts AS (
        SELECT team_id, COUNT(*) as actual_count
        FROM (
            SELECT home_team_id as team_id FROM matches_v2 WHERE home_team_id IS NOT NULL
            UNION ALL
            SELECT away_team_id as team_id FROM matches_v2 WHERE away_team_id IS NOT NULL
        ) m
        GROUP BY team_id
    )
    SELECT
        t.display_name,
        t.matches_played as stored_count,
        mc.actual_count,
        t.matches_played - mc.actual_count as difference
    FROM teams_v2 t
    JOIN match_counts mc ON t.id = mc.team_id
    WHERE t.matches_played != mc.actual_count
    ORDER BY ABS(t.matches_played - mc.actual_count) DESC
    LIMIT 10
  `);
  console.table(q2.rows);

  // Query 3: Check if stored stats match CURRENT SEASON only
  console.log("\n" + "=".repeat(60));
  console.log("QUERY 3: Does stored count match CURRENT SEASON (2025-08-01+)?");
  console.log("=".repeat(60));
  const q3 = await client.query(`
    WITH season_match_counts AS (
        SELECT team_id, COUNT(*) as season_count
        FROM (
            SELECT home_team_id as team_id FROM matches_v2
            WHERE home_team_id IS NOT NULL AND match_date >= '2025-08-01'
            UNION ALL
            SELECT away_team_id as team_id FROM matches_v2
            WHERE away_team_id IS NOT NULL AND match_date >= '2025-08-01'
        ) m
        GROUP BY team_id
    )
    SELECT
        CASE
            WHEN t.matches_played = mc.season_count THEN 'matches_season'
            ELSE 'no_match'
        END as comparison,
        COUNT(*) as team_count
    FROM teams_v2 t
    JOIN season_match_counts mc ON t.id = mc.team_id
    GROUP BY 1
  `);
  console.table(q3.rows);

  // Query 4: Total matches by date range
  console.log("\n" + "=".repeat(60));
  console.log("QUERY 4: Matches by season/period");
  console.log("=".repeat(60));
  const q4 = await client.query(`
    SELECT
        CASE
            WHEN match_date >= '2025-08-01' THEN 'current_season'
            WHEN match_date >= '2024-08-01' THEN 'previous_season'
            ELSE 'older'
        END as period,
        COUNT(*) as match_count
    FROM matches_v2
    GROUP BY 1
    ORDER BY 1
  `);
  console.table(q4.rows);

  // Query 5: Get a specific example to see detail
  console.log("\n" + "=".repeat(60));
  console.log("QUERY 5: Detailed breakdown for mismatched teams");
  console.log("=".repeat(60));
  const q5 = await client.query(`
    WITH match_counts AS (
        SELECT team_id, COUNT(*) as actual_count
        FROM (
            SELECT home_team_id as team_id FROM matches_v2 WHERE home_team_id IS NOT NULL
            UNION ALL
            SELECT away_team_id as team_id FROM matches_v2 WHERE away_team_id IS NOT NULL
        ) m
        GROUP BY team_id
    ),
    season_counts AS (
        SELECT team_id, COUNT(*) as season_count
        FROM (
            SELECT home_team_id as team_id FROM matches_v2
            WHERE home_team_id IS NOT NULL AND match_date >= '2025-08-01'
            UNION ALL
            SELECT away_team_id as team_id FROM matches_v2
            WHERE away_team_id IS NOT NULL AND match_date >= '2025-08-01'
        ) m
        GROUP BY team_id
    )
    SELECT
        t.display_name,
        t.matches_played as stored_count,
        mc.actual_count as all_time_count,
        COALESCE(sc.season_count, 0) as current_season_count
    FROM teams_v2 t
    JOIN match_counts mc ON t.id = mc.team_id
    LEFT JOIN season_counts sc ON t.id = sc.team_id
    WHERE t.matches_played != mc.actual_count
    LIMIT 5
  `);
  console.table(q5.rows);

  await client.end();
  console.log("\nDone.");
}

main();
