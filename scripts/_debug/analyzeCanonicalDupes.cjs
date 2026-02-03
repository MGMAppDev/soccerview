/**
 * analyzeCanonicalDupes.cjs
 *
 * V2-COMPLIANT: Analyze duplicates via canonical_teams registry
 * This follows GUARDRAILS: "Always use canonical_teams for deduplication"
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function analyzeCanonicalDupes() {
  console.log('=== V2-COMPLIANT CANONICAL REGISTRY DEDUPLICATION ===\n');

  // Find duplicate groups in canonical_teams
  const { rows: dupeGroups } = await pool.query(`
    WITH dupe_groups AS (
      SELECT
        canonical_name,
        birth_year,
        gender,
        array_agg(team_v2_id ORDER BY team_v2_id) as team_ids,
        COUNT(*) as count
      FROM canonical_teams
      WHERE birth_year IS NOT NULL AND gender IS NOT NULL
      GROUP BY canonical_name, birth_year, gender
      HAVING COUNT(*) > 1
    )
    SELECT * FROM dupe_groups ORDER BY count DESC
  `);

  console.log('Total duplicate groups:', dupeGroups.length);
  console.log('Total teams in duplicate groups:', dupeGroups.reduce((sum, g) => sum + parseInt(g.count), 0));

  // Sample: Get match counts for first 5 groups
  console.log('\nSample groups (with match counts):');
  for (const group of dupeGroups.slice(0, 5)) {
    console.log(`\n  ${group.canonical_name} (${group.birth_year}, ${group.gender}): ${group.count} teams`);

    // Get match counts for each team in group
    const { rows: teamDetails } = await pool.query(`
      SELECT
        t.id,
        t.display_name,
        t.matches_played,
        (SELECT COUNT(*) FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id) as actual_matches
      FROM teams_v2 t
      WHERE t.id = ANY($1)
      ORDER BY t.matches_played DESC NULLS LAST
    `, [group.team_ids]);

    teamDetails.forEach(td => {
      const name = (td.display_name || '').substring(0, 50);
      console.log(`    - ${name} | MP: ${td.matches_played || 0} | Actual: ${td.actual_matches}`);
    });
  }

  // Count how many groups have at least one team with matches
  let groupsWithMatches = 0;
  let groupsWithMultipleMatches = 0;

  for (const group of dupeGroups) {
    const { rows } = await pool.query(`
      SELECT
        t.id,
        (SELECT COUNT(*) FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id) as match_count
      FROM teams_v2 t
      WHERE t.id = ANY($1)
    `, [group.team_ids]);

    const teamsWithMatches = rows.filter(r => parseInt(r.match_count) > 0).length;
    if (teamsWithMatches > 0) groupsWithMatches++;
    if (teamsWithMatches > 1) groupsWithMultipleMatches++;
  }

  console.log(`\n=== MERGE ANALYSIS ===`);
  console.log(`Total duplicate groups: ${dupeGroups.length}`);
  console.log(`Groups with at least one team having matches: ${groupsWithMatches}`);
  console.log(`Groups where MULTIPLE teams have matches (complex merge): ${groupsWithMultipleMatches}`);
  console.log(`Groups where only ONE team has matches (simple merge): ${groupsWithMatches - groupsWithMultipleMatches}`);
  console.log(`Groups where NO teams have matches (can just pick one): ${dupeGroups.length - groupsWithMatches}`);

  await pool.end();
}

analyzeCanonicalDupes().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
