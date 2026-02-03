/**
 * Find all events that have U11 Boys matches
 */

import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function findU11Events() {
  console.log("🔍 Finding events with U11 Boys (2015 birth year) matches...\n");

  // Find all events that have U11 matches in our database
  const { rows } = await pool.query(`
    SELECT DISTINCT
      COALESCE(l.name, t2.name) as event_name,
      COALESCE(l.source_event_id, t2.source_event_id) as source_id,
      CASE WHEN l.id IS NOT NULL THEN 'league' ELSE 'tournament' END as event_type,
      MIN(m.match_date) as first_match,
      MAX(m.match_date) as last_match,
      COUNT(DISTINCT m.id) as match_count
    FROM matches_v2 m
    LEFT JOIN leagues l ON m.league_id = l.id
    LEFT JOIN tournaments t2 ON m.tournament_id = t2.id
    JOIN teams_v2 t ON (m.home_team_id = t.id OR m.away_team_id = t.id)
    WHERE t.birth_year = 2015
      AND t.gender = 'M'
      AND m.match_date >= '2025-08-01'
    GROUP BY COALESCE(l.name, t2.name), COALESCE(l.source_event_id, t2.source_event_id),
             CASE WHEN l.id IS NOT NULL THEN 'league' ELSE 'tournament' END
    ORDER BY last_match DESC
  `);

  console.log("Events with U11 Boys (2015) matches:\n");
  rows.forEach(r => {
    console.log(`  ${r.event_type.toUpperCase().padEnd(10)} ${r.event_name}`);
    console.log(`    Source: ${r.source_id || "none"}`);
    console.log(`    Dates: ${r.first_match?.toISOString()?.split("T")[0]} to ${r.last_match?.toISOString()?.split("T")[0]}`);
    console.log(`    Matches: ${r.match_count}`);
    console.log("");
  });

  // Check for Sporting BV Pre-NAL 15 specifically
  console.log("\n" + "=".repeat(60));
  console.log("Sporting BV Pre-NAL 15 specific matches:\n");

  const { rows: sportingMatches } = await pool.query(`
    SELECT m.match_date, m.home_score, m.away_score,
           COALESCE(l.name, t2.name) as event_name,
           m.source_match_key
    FROM matches_v2 m
    LEFT JOIN leagues l ON m.league_id = l.id
    LEFT JOIN tournaments t2 ON m.tournament_id = t2.id
    WHERE m.home_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
       OR m.away_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
    ORDER BY m.match_date DESC
  `);

  sportingMatches.forEach(m => {
    console.log(`  ${m.match_date?.toISOString()?.split("T")[0]} | ${m.home_score ?? "?"}-${m.away_score ?? "?"} | ${m.event_name || "No event"}`);
  });

  // Check HTGSports events in our system for spring 2026
  console.log("\n" + "=".repeat(60));
  console.log("HTGSports events in system:\n");

  const { rows: htgEvents } = await pool.query(`
    SELECT DISTINCT source_event_id, name, start_date, end_date
    FROM tournaments
    WHERE source_event_id LIKE 'htg-%'
    ORDER BY start_date DESC
    LIMIT 20
  `);

  htgEvents.forEach(e => {
    console.log(`  ${e.name} [${e.source_event_id}] - ${e.start_date?.toISOString()?.split("T")[0]} to ${e.end_date?.toISOString()?.split("T")[0]}`);
  });

  await pool.end();
}

findU11Events().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
