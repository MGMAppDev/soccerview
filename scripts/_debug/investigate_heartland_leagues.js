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

    // 1. Find the specific team using display_name
    console.log("=== SPORTING BLUE VALLEY TEAM ===\n");
    const team = await client.query(`
      SELECT id, display_name, club_id, birth_year, gender
      FROM teams_v2
      WHERE display_name ILIKE '%sporting%bv%pre-nal%15%'
         OR display_name ILIKE '%sporting%blue%valley%pre-nal%15%'
      LIMIT 5
    `);

    if (team.rows.length === 0) {
      console.log("Team not found with specific search, trying broader...\n");
      const broader = await client.query(`
        SELECT id, display_name, birth_year
        FROM teams_v2
        WHERE display_name ILIKE '%sporting%bv%'
        LIMIT 15
      `);
      console.log(`Found ${broader.rows.length} Sporting BV teams:\n`);
      broader.rows.forEach(t => {
        console.log(`  ${t.id}: ${t.display_name} (${t.birth_year})`);
      });

      // Try yet another search
      console.log("\nTrying 'sporting blue valley'...\n");
      const broader2 = await client.query(`
        SELECT id, display_name, birth_year
        FROM teams_v2
        WHERE display_name ILIKE '%sporting%blue%valley%'
        LIMIT 15
      `);
      broader2.rows.forEach(t => {
        console.log(`  ${t.id}: ${t.display_name} (${t.birth_year})`);
      });

      // Search for the exact name from screenshot
      console.log("\nSearching for 'SPORTING BV Pre-NAL 15'...\n");
      const exact = await client.query(`
        SELECT id, display_name, birth_year
        FROM teams_v2
        WHERE display_name ILIKE '%SPORTING BV Pre-NAL 15%'
        LIMIT 15
      `);
      exact.rows.forEach(t => {
        console.log(`  ${t.id}: ${t.display_name} (${t.birth_year})`);
      });

      if (exact.rows.length > 0) {
        await analyzeTeamMatches(client, exact.rows[0].id);
      }
    } else {
      const t = team.rows[0];
      console.log(`Team ID: ${t.id}`);
      console.log(`Display: ${t.display_name}`);
      console.log(`Club ID: ${t.club_id}`);
      console.log(`Birth Year: ${t.birth_year}`);
      console.log(`Gender: ${t.gender}`);

      await analyzeTeamMatches(client, t.id);
    }

    // 5. Look for duplicate league patterns
    console.log("\n\n=== POTENTIAL DUPLICATE LEAGUES (same name, different IDs) ===\n");
    const duplicates = await client.query(`
      SELECT
        name,
        COUNT(*) as entry_count,
        array_agg(id) as ids
      FROM leagues
      GROUP BY name
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);

    console.log(`Found ${duplicates.rows.length} league names with multiple entries:\n`);
    duplicates.rows.forEach(d => {
      console.log(`"${d.name}": ${d.entry_count} entries`);
      console.log(`  IDs: ${d.ids.join(', ')}`);
      console.log('');
    });

    // 6. Analyze Heartland leagues specifically
    console.log("\n=== HEARTLAND LEAGUES ANALYSIS ===\n");
    const heartland = await client.query(`
      SELECT
        l.id,
        l.name,
        l.source_event_id,
        COUNT(DISTINCT m.id) as match_count,
        COUNT(DISTINCT m.home_team_id) + COUNT(DISTINCT m.away_team_id) as team_count,
        MIN(m.match_date) as first_match,
        MAX(m.match_date) as last_match
      FROM leagues l
      LEFT JOIN matches_v2 m ON m.league_id = l.id
      WHERE l.name ILIKE '%heartland%'
      GROUP BY l.id, l.name, l.source_event_id
      ORDER BY l.name, match_count DESC
    `);

    heartland.rows.forEach(r => {
      console.log(`${r.name}`);
      console.log(`  ID: ${r.id}`);
      console.log(`  Source: ${r.source_event_id}`);
      console.log(`  Matches: ${r.match_count}`);
      console.log(`  Teams: ${r.team_count}`);
      console.log(`  Dates: ${r.first_match} to ${r.last_match}`);
      console.log('');
    });

  } catch (err) {
    console.error("Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function analyzeTeamMatches(client, teamId) {
  // 4. Get this team's matches grouped by league
  console.log("\n=== THIS TEAM'S MATCHES BY LEAGUE ===\n");
  const teamMatches = await client.query(`
    SELECT
      l.id as league_id,
      l.name as league_name,
      COUNT(*) as match_count,
      MIN(m.match_date) as first_match,
      MAX(m.match_date) as last_match
    FROM matches_v2 m
    JOIN leagues l ON m.league_id = l.id
    WHERE m.home_team_id = $1 OR m.away_team_id = $1
    GROUP BY l.id, l.name
    ORDER BY l.name
  `, [teamId]);

  teamMatches.rows.forEach(r => {
    console.log(`${r.league_name}`);
    console.log(`  League ID: ${r.league_id}`);
    console.log(`  Matches: ${r.match_count}`);
    console.log(`  Dates: ${r.first_match} to ${r.last_match}`);
    console.log('');
  });

  // Also get all matches for this team
  console.log("\n=== ALL MATCHES FOR THIS TEAM (recent) ===\n");
  const allMatches = await client.query(`
    SELECT
      m.id,
      m.match_date,
      m.league_id,
      l.name as league_name,
      ht.display_name as home_team,
      at.display_name as away_team,
      m.home_score,
      m.away_score
    FROM matches_v2 m
    LEFT JOIN leagues l ON m.league_id = l.id
    LEFT JOIN teams_v2 ht ON m.home_team_id = ht.id
    LEFT JOIN teams_v2 at ON m.away_team_id = at.id
    WHERE m.home_team_id = $1 OR m.away_team_id = $1
    ORDER BY m.match_date DESC
    LIMIT 20
  `, [teamId]);

  allMatches.rows.forEach(m => {
    console.log(`${m.match_date}: ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
    console.log(`  League: ${m.league_name || 'NONE'} (${m.league_id || 'null'})`);
  });
}

main();
