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

    // 1. Find potential duplicate matches between Heartland leagues
    console.log("=== POTENTIAL DUPLICATE MATCHES BETWEEN HEARTLAND LEAGUES ===\n");

    const duplicates = await client.query(`
      WITH heartland_matches AS (
        SELECT
          m.id,
          m.match_date,
          m.home_team_id,
          m.away_team_id,
          m.home_score,
          m.away_score,
          m.league_id,
          l.name as league_name,
          m.source_match_key
        FROM matches_v2 m
        JOIN leagues l ON m.league_id = l.id
        WHERE l.name ILIKE '%heartland%'
      )
      SELECT
        m1.match_date,
        m1.home_score,
        m1.away_score,
        m1.league_name as league1,
        m2.league_name as league2,
        m1.id as match1_id,
        m2.id as match2_id,
        m1.source_match_key as key1,
        m2.source_match_key as key2,
        ht.display_name as home_team,
        at.display_name as away_team
      FROM heartland_matches m1
      JOIN heartland_matches m2 ON
        m1.match_date = m2.match_date
        AND m1.home_score = m2.home_score
        AND m1.away_score = m2.away_score
        AND m1.league_id != m2.league_id
        AND m1.id < m2.id  -- Avoid counting duplicates twice
      JOIN teams_v2 ht ON m1.home_team_id = ht.id
      JOIN teams_v2 at ON m1.away_team_id = at.id
      WHERE (
        -- Same teams (exact match)
        (m1.home_team_id = m2.home_team_id AND m1.away_team_id = m2.away_team_id)
        OR
        -- Reversed teams
        (m1.home_team_id = m2.away_team_id AND m1.away_team_id = m2.home_team_id)
      )
      ORDER BY m1.match_date DESC
      LIMIT 50
    `);

    console.log(`Found ${duplicates.rows.length} exact duplicate matches (same teams, same date, same score, different leagues):\n`);
    duplicates.rows.forEach(d => {
      console.log(`${d.match_date}: ${d.home_team} vs ${d.away_team} (${d.home_score}-${d.away_score})`);
      console.log(`  League 1: ${d.league1} (match ID: ${d.match1_id})`);
      console.log(`  League 2: ${d.league2} (match ID: ${d.match2_id})`);
      console.log(`  Key 1: ${d.key1}`);
      console.log(`  Key 2: ${d.key2}`);
      console.log('');
    });

    // 2. Check for "fuzzy" duplicates where team IDs differ but names are similar
    console.log("\n=== CHECKING FOR FUZZY DUPLICATES (same date/score, different team IDs) ===\n");

    const fuzzyDupes = await client.query(`
      WITH premier_matches AS (
        SELECT m.*, l.name as league_name
        FROM matches_v2 m
        JOIN leagues l ON m.league_id = l.id
        WHERE l.name = 'Heartland Premier League 2025'
      ),
      soccer_matches AS (
        SELECT m.*, l.name as league_name
        FROM matches_v2 m
        JOIN leagues l ON m.league_id = l.id
        WHERE l.name = 'Heartland Soccer League 2025'
      )
      SELECT
        p.match_date,
        p.home_score,
        p.away_score,
        p.id as premier_id,
        s.id as soccer_id,
        ht_p.display_name as premier_home,
        at_p.display_name as premier_away,
        ht_s.display_name as soccer_home,
        at_s.display_name as soccer_away
      FROM premier_matches p
      JOIN soccer_matches s ON
        p.match_date = s.match_date
        AND p.home_score = s.home_score
        AND p.away_score = s.away_score
        AND p.id != s.id
      JOIN teams_v2 ht_p ON p.home_team_id = ht_p.id
      JOIN teams_v2 at_p ON p.away_team_id = at_p.id
      JOIN teams_v2 ht_s ON s.home_team_id = ht_s.id
      JOIN teams_v2 at_s ON s.away_team_id = at_s.id
      ORDER BY p.match_date DESC
      LIMIT 30
    `);

    console.log(`Found ${fuzzyDupes.rows.length} potential fuzzy duplicates (same date/score, different teams):\n`);
    fuzzyDupes.rows.forEach(d => {
      console.log(`${d.match_date} (${d.home_score}-${d.away_score}):`);
      console.log(`  Premier: ${d.premier_home} vs ${d.premier_away}`);
      console.log(`  Soccer:  ${d.soccer_home} vs ${d.soccer_away}`);
      console.log('');
    });

    // 3. Count how many duplicates exist
    console.log("\n=== TOTAL DUPLICATE COUNT ===\n");
    const count = await client.query(`
      WITH premier AS (
        SELECT match_date, home_score, away_score, COUNT(*) as cnt
        FROM matches_v2 m
        JOIN leagues l ON m.league_id = l.id
        WHERE l.name = 'Heartland Premier League 2025'
        GROUP BY match_date, home_score, away_score
      ),
      soccer AS (
        SELECT match_date, home_score, away_score, COUNT(*) as cnt
        FROM matches_v2 m
        JOIN leagues l ON m.league_id = l.id
        WHERE l.name = 'Heartland Soccer League 2025'
        GROUP BY match_date, home_score, away_score
      )
      SELECT COUNT(*) as overlap_count
      FROM premier p
      JOIN soccer s ON
        p.match_date = s.match_date
        AND p.home_score = s.home_score
        AND p.away_score = s.away_score
    `);

    console.log(`Matches with same date/score in both leagues: ${count.rows[0].overlap_count}`);

  } catch (err) {
    console.error("Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
