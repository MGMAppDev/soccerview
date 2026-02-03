require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function analyze() {
  // Sample a duplicate group to see what's happening
  const { rows: sample } = await pool.query(`
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
    LIMIT 5
  `);

  console.log('=== DUPLICATE GROUP ANALYSIS ===\n');
  console.log('Total duplicate groups found:', sample.length, '(showing first 5)\n');

  for (const group of sample) {
    console.log('--- Group:', group.canonical_name, '|', group.birth_year, group.gender, '---');
    console.log('  Canonical entries:', group.count);

    // Check which teams exist
    const { rows: teams } = await pool.query(`
      SELECT t.id, t.display_name,
        (SELECT COUNT(*) FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id) as matches
      FROM teams_v2 t
      WHERE t.id = ANY($1)
    `, [group.team_ids]);

    console.log('  Teams still in teams_v2:', teams.length, 'of', group.team_ids.length);

    if (teams.length < group.team_ids.length) {
      console.log('  ⚠️  MISSING:', group.team_ids.length - teams.length, 'teams were deleted');
    }

    teams.forEach(t => console.log('    -', t.display_name, '| matches:', t.matches));
    console.log();
  }

  // Summary
  const { rows: [summary] } = await pool.query(`
    SELECT
      COUNT(*) as orphan_entries
    FROM canonical_teams ct
    WHERE NOT EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = ct.team_v2_id)
  `);

  console.log('=== SUMMARY ===');
  console.log('Orphan canonical entries (point to deleted teams):', summary.orphan_entries);
  console.log('\nFIX: Clean up canonical_teams to remove entries pointing to deleted teams');

  await pool.end();
}
analyze();
