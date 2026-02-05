/**
 * Check for duplicate Sporting Blue Valley Pre-NAL teams
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  console.log('=== CHECKING SPORTING BV PRE-NAL TEAMS ===\n');

  const teams = await pool.query(`
    SELECT id, display_name, birth_year, gender, matches_played, wins, losses, draws, elo_rating, state
    FROM teams_v2
    WHERE display_name ILIKE '%Sporting Blue Valley%Pre-NAL%'
       OR display_name ILIKE '%SPORTING BV%Pre-NAL%'
    ORDER BY birth_year DESC, display_name
  `);

  console.log(`Found ${teams.rows.length} teams:\n`);
  teams.rows.forEach((t, i) => {
    console.log(`[${i+1}] ${t.display_name}`);
    console.log(`    ID: ${t.id}`);
    console.log(`    Birth: ${t.birth_year} | Gender: ${t.gender} | State: ${t.state}`);
    console.log(`    Record: ${t.wins}W-${t.losses}L-${t.draws}D | Matches: ${t.matches_played}`);
    console.log(`    ELO: ${t.elo_rating}`);
    console.log('');
  });

  // Check for potential duplicates (same birth_year, different names)
  console.log('=== CHECKING FOR DUPLICATES ===\n');
  const dupes = await pool.query(`
    SELECT birth_year, gender, COUNT(*) as count,
           array_agg(display_name) as names,
           array_agg(matches_played) as match_counts
    FROM teams_v2
    WHERE (display_name ILIKE '%Sporting Blue Valley%Pre-NAL%'
       OR display_name ILIKE '%SPORTING BV%Pre-NAL%')
    GROUP BY birth_year, gender
    HAVING COUNT(*) > 1
  `);

  if (dupes.rows.length === 0) {
    console.log('No duplicates found (same birth_year + gender)');
  } else {
    console.log(`Found ${dupes.rows.length} potential duplicate groups:`);
    dupes.rows.forEach(d => {
      console.log(`  Birth: ${d.birth_year} | Gender: ${d.gender}`);
      console.log(`  Names: ${d.names.join(' | ')}`);
      console.log(`  Match counts: ${d.match_counts.join(' | ')}`);
    });
  }

  await pool.end();
}

check().catch(console.error);
