/**
 * Verify Mt Olive Cup matches are visible after view refresh
 */

import pg from "pg";
import "dotenv/config";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  console.log("Connected to database\n");

  // Check Mt Olive Cup matches in matches_v2
  const source = await client.query(`
    SELECT COUNT(*) as count
    FROM matches_v2
    WHERE source_match_key ILIKE '%mt-olive%' OR source_match_key ILIKE '%mount-olive%'
  `);
  console.log("📊 Mt Olive Cup matches in matches_v2:", source.rows[0].count);

  // Check tournament exists
  const tournament = await client.query(`
    SELECT id, name, start_date, end_date
    FROM tournaments
    WHERE name ILIKE '%mt olive%' OR name ILIKE '%mount olive%'
  `);
  console.log("\n🏆 Mt Olive Cup tournament:");
  for (const row of tournament.rows) {
    console.log(`  ID: ${row.id}`);
    console.log(`  Name: ${row.name}`);
    console.log(`  Dates: ${row.start_date} to ${row.end_date}`);
  }

  // Check matches linked to tournament
  if (tournament.rows.length > 0) {
    const linked = await client.query(`
      SELECT COUNT(*) as count
      FROM matches_v2
      WHERE tournament_id = $1
    `, [tournament.rows[0].id]);
    console.log(`\n📊 Matches linked to tournament: ${linked.rows[0].count}`);
  }

  // Check app_matches_feed for recent Mt Olive matches
  const feed = await client.query(`
    SELECT COUNT(*) as count
    FROM app_matches_feed
    WHERE match_date >= '2025-01-24' AND match_date <= '2025-01-26'
  `);
  console.log(`\n📊 Matches in app_matches_feed (Jan 24-26, 2025): ${feed.rows[0].count}`);

  // Sample from app_matches_feed on those dates
  const samples = await client.query(`
    SELECT match_date, home_team_name, away_team_name, home_score, away_score
    FROM app_matches_feed
    WHERE match_date >= '2025-01-24' AND match_date <= '2025-01-26'
    ORDER BY match_date
    LIMIT 5
  `);
  console.log("\n📋 Sample matches from app_matches_feed (Jan 24-26):");
  for (const row of samples.rows) {
    console.log(`  ${row.match_date}: ${row.home_team_name} vs ${row.away_team_name} (${row.home_score}-${row.away_score})`);
  }

  await client.end();
  console.log("\n✅ Verification complete");
}

main().catch(console.error);
