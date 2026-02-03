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

    // 1. Look for KC Fusion team variants
    console.log("=== KC FUSION 15B GOLD VARIANTS ===\n");
    const fusion = await client.query(`
      SELECT id, display_name, canonical_name, birth_year, gender, source_team_id
      FROM teams_v2
      WHERE display_name ILIKE '%kc fusion%15%gold%'
         OR canonical_name ILIKE '%kc fusion%15%gold%'
      ORDER BY display_name
    `);

    console.log(`Found ${fusion.rows.length} KC Fusion 15B Gold variants:\n`);
    fusion.rows.forEach(t => {
      console.log(`  ID: ${t.id}`);
      console.log(`  Display: ${t.display_name}`);
      console.log(`  Canonical: ${t.canonical_name}`);
      console.log(`  Birth Year: ${t.birth_year}, Gender: ${t.gender}`);
      console.log(`  Source: ${t.source_team_id}`);
      console.log('');
    });

    // 2. Look for Sporting BV team variants
    console.log("=== SPORTING BV PRE-NAL 15 VARIANTS ===\n");
    const sporting = await client.query(`
      SELECT id, display_name, canonical_name, birth_year, gender, source_team_id
      FROM teams_v2
      WHERE display_name ILIKE '%sporting%bv%pre-nal%15%'
         OR display_name ILIKE '%sporting%blue%valley%pre-nal%15%'
         OR canonical_name ILIKE '%sporting%bv%pre-nal%15%'
      ORDER BY display_name
    `);

    console.log(`Found ${sporting.rows.length} Sporting BV Pre-NAL 15 variants:\n`);
    sporting.rows.forEach(t => {
      console.log(`  ID: ${t.id}`);
      console.log(`  Display: ${t.display_name}`);
      console.log(`  Canonical: ${t.canonical_name}`);
      console.log(`  Birth Year: ${t.birth_year}, Gender: ${t.gender}`);
      console.log(`  Source: ${t.source_team_id}`);
      console.log('');
    });

    // 3. Check the specific matches on Sep 27
    console.log("\n=== MATCHES ON SEP 27 WITH SPORTING BV ===\n");
    const sep27 = await client.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,
        m.league_id,
        l.name as league_name,
        ht.id as home_id,
        ht.display_name as home_team,
        at.id as away_id,
        at.display_name as away_team,
        m.source_match_key
      FROM matches_v2 m
      LEFT JOIN leagues l ON m.league_id = l.id
      LEFT JOIN teams_v2 ht ON m.home_team_id = ht.id
      LEFT JOIN teams_v2 at ON m.away_team_id = at.id
      WHERE m.match_date = '2025-09-27'
        AND (
          ht.display_name ILIKE '%sporting%bv%pre-nal%15%'
          OR at.display_name ILIKE '%sporting%bv%pre-nal%15%'
          OR ht.display_name ILIKE '%sporting%blue%valley%pre-nal%15%'
          OR at.display_name ILIKE '%sporting%blue%valley%pre-nal%15%'
        )
      ORDER BY m.league_id
    `);

    console.log(`Found ${sep27.rows.length} matches on Sep 27 involving Sporting BV Pre-NAL 15:\n`);
    sep27.rows.forEach(m => {
      console.log(`Match ID: ${m.id}`);
      console.log(`  ${m.home_team} (${m.home_id})`);
      console.log(`  vs ${m.away_team} (${m.away_id})`);
      console.log(`  Score: ${m.home_score}-${m.away_score}`);
      console.log(`  League: ${m.league_name} (${m.league_id})`);
      console.log(`  Source Key: ${m.source_match_key}`);
      console.log('');
    });

    // 4. Count how many teams have potential duplicates (same normalized name, different IDs)
    console.log("\n=== TEAMS WITH POTENTIAL DUPLICATES (same canonical_name) ===\n");
    const dupeTeams = await client.query(`
      SELECT
        canonical_name,
        COUNT(*) as count,
        array_agg(id) as ids,
        array_agg(display_name) as display_names
      FROM teams_v2
      WHERE canonical_name IS NOT NULL
      GROUP BY canonical_name
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);

    console.log(`Found ${dupeTeams.rows.length} canonical names with multiple team entries:\n`);
    dupeTeams.rows.slice(0, 10).forEach(d => {
      console.log(`"${d.canonical_name}": ${d.count} entries`);
      console.log(`  IDs: ${d.ids.join(', ')}`);
      console.log(`  Names: ${d.display_names.join(' | ')}`);
      console.log('');
    });

    // 5. Check how leagues are assigned in the scrapers
    console.log("\n=== SOURCE DATA FOR HEARTLAND MATCHES (sample) ===\n");
    const sources = await client.query(`
      SELECT
        l.name as league_name,
        m.source_match_key,
        COUNT(*) as count
      FROM matches_v2 m
      JOIN leagues l ON m.league_id = l.id
      WHERE l.name ILIKE '%heartland%'
      GROUP BY l.name, LEFT(m.source_match_key, 20)
      ORDER BY l.name, count DESC
      LIMIT 20
    `);

    sources.rows.forEach(s => {
      console.log(`${s.league_name}: ${s.source_match_key}... (${s.count} matches)`);
    });

  } catch (err) {
    console.error("Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
