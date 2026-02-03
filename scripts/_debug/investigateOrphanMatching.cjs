/**
 * investigateOrphanMatching.cjs
 *
 * Investigate why orphaned teams don't match in canonical registry
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Get some orphaned teams
  const { rows: orphans } = await pool.query(`
    SELECT t.id, t.display_name, t.canonical_name, t.birth_year, t.gender, t.state, t.national_rank
    FROM teams_v2 t
    WHERE t.national_rank IS NOT NULL
      AND t.birth_year IS NOT NULL
      AND t.gender IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1)
    ORDER BY t.national_rank ASC
    LIMIT 5
  `);

  console.log('Sample orphaned teams:');
  for (const o of orphans) {
    console.log('\n' + '='.repeat(70));
    console.log('ORPHAN #' + o.national_rank + ': ' + o.display_name.substring(0, 60));
    console.log('  canonical_name: ' + o.canonical_name);
    console.log('  birth_year=' + o.birth_year + ', gender=' + o.gender + ', state=' + o.state);

    // Look for teams with SAME canonical_name
    const exact = await pool.query(`
      SELECT t.id, t.display_name, t.canonical_name,
             EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1) as has_matches
      FROM teams_v2 t
      WHERE t.canonical_name = $1
        AND t.birth_year = $2
        AND t.gender = $3
        AND t.id != $4
      LIMIT 5
    `, [o.canonical_name, o.birth_year, o.gender, o.id]);

    if (exact.rows.length > 0) {
      console.log('  EXACT matches (same canonical_name):');
      for (const e of exact.rows) {
        console.log('    - ' + e.display_name.substring(0, 45));
        console.log('      has_matches: ' + e.has_matches);
      }
    }

    // Look for similar teams WITH matches using similarity()
    const similar = await pool.query(`
      SELECT t.id, t.display_name, t.canonical_name,
             similarity(t.canonical_name, $4) as sim
      FROM teams_v2 t
      WHERE t.birth_year = $1
        AND t.gender = $2
        AND t.id != $3
        AND EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id LIMIT 1)
        AND similarity(t.canonical_name, $4) > 0.5
      ORDER BY similarity(t.canonical_name, $4) DESC
      LIMIT 3
    `, [o.birth_year, o.gender, o.id, o.canonical_name]);

    if (similar.rows.length > 0) {
      console.log('  SIMILAR teams (with matches):');
      for (const s of similar.rows) {
        console.log('    - ' + s.display_name.substring(0, 45));
        console.log('      canonical: ' + s.canonical_name);
        console.log('      similarity: ' + (s.sim * 100).toFixed(1) + '%');
      }
    } else {
      console.log('  No similar teams WITH matches found');
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
