require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  // Find duplicate groups where BOTH teams still exist
  const { rows } = await pool.query(`
    WITH dupe_groups AS (
      SELECT
        canonical_name,
        birth_year,
        gender,
        array_agg(team_v2_id) as team_ids
      FROM canonical_teams
      WHERE birth_year IS NOT NULL AND gender IS NOT NULL
      GROUP BY canonical_name, birth_year, gender
      HAVING COUNT(*) > 1
    )
    SELECT dg.*,
      (SELECT COUNT(*) FROM teams_v2 t WHERE t.id = ANY(dg.team_ids)) as teams_exist
    FROM dupe_groups dg
    LIMIT 10
  `);

  console.log('Sample duplicate groups (showing teams_exist count):\n');
  rows.forEach(r => {
    console.log(r.canonical_name, '|', r.birth_year, r.gender);
    console.log('  Canonical entries:', r.team_ids.length, '| Teams exist:', r.teams_exist);
  });

  // Count groups where both teams actually exist
  const { rows: [summary] } = await pool.query(`
    WITH dupe_groups AS (
      SELECT
        canonical_name,
        birth_year,
        gender,
        array_agg(team_v2_id) as team_ids
      FROM canonical_teams
      WHERE birth_year IS NOT NULL AND gender IS NOT NULL
      GROUP BY canonical_name, birth_year, gender
      HAVING COUNT(*) > 1
    )
    SELECT
      COUNT(*) as total_dupe_groups,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM teams_v2 t WHERE t.id = ANY(team_ids)) > 1) as real_dupes,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM teams_v2 t WHERE t.id = ANY(team_ids)) = 1) as single_team,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM teams_v2 t WHERE t.id = ANY(team_ids)) = 0) as no_teams
    FROM dupe_groups
  `);

  console.log('\n=== SUMMARY ===');
  console.log('Total duplicate groups:', summary.total_dupe_groups);
  console.log('Real duplicates (2+ teams exist):', summary.real_dupes);
  console.log('Single team left (stale canonical):', summary.single_team);
  console.log('No teams exist:', summary.no_teams);

  if (parseInt(summary.single_team) > 0) {
    console.log('\n⚠️  Stale canonical entries need cleanup');
    console.log('These are duplicate entries in canonical_teams where the duplicate team was deleted');
    console.log('but the canonical entry wasn\'t removed.\n');

    // Clean them up
    const { rowCount } = await pool.query(`
      DELETE FROM canonical_teams ct1
      WHERE EXISTS (
        SELECT 1 FROM canonical_teams ct2
        WHERE ct2.canonical_name = ct1.canonical_name
          AND ct2.birth_year = ct1.birth_year
          AND ct2.gender = ct1.gender
          AND ct2.team_v2_id != ct1.team_v2_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM teams_v2 t WHERE t.id = ct1.team_v2_id
      )
    `);
    console.log('Cleaned up', rowCount, 'stale canonical entries');
  }

  await pool.end();
}
check();
