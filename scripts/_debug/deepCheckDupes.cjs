require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function deepCheck() {
  console.log('=== DEEP CHECK OF DUPLICATE GROUPS ===\n');

  // Get one specific group and examine all entries
  const group = { canonical_name: '14g air heald', birth_year: 2014, gender: 'F' };

  const { rows: entries } = await pool.query(`
    SELECT
      ct.id as canonical_id,
      ct.team_v2_id,
      ct.canonical_name,
      ct.birth_year,
      ct.gender,
      t.display_name,
      t.id as team_exists
    FROM canonical_teams ct
    LEFT JOIN teams_v2 t ON t.id = ct.team_v2_id
    WHERE ct.canonical_name = $1 AND ct.birth_year = $2 AND ct.gender = $3
  `, [group.canonical_name, group.birth_year, group.gender]);

  console.log('Group: 14g air heald | 2014 F\n');
  console.log('Canonical entries:');
  entries.forEach(e => {
    console.log(`  canonical_id: ${e.canonical_id}`);
    console.log(`  team_v2_id: ${e.team_v2_id}`);
    console.log(`  display_name: ${e.display_name || 'NULL (team deleted)'}`);
    console.log(`  team_exists: ${e.team_exists ? 'YES' : 'NO'}`);
    console.log();
  });

  // Count all truly orphan entries
  const { rows: [counts] } = await pool.query(`
    SELECT
      COUNT(*) as total_canonical,
      COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = ct.team_v2_id)) as orphan_count
    FROM canonical_teams ct
  `);

  console.log('=== COUNTS ===');
  console.log('Total canonical entries:', counts.total_canonical);
  console.log('Orphan entries (team deleted):', counts.orphan_count);

  await pool.end();
}

deepCheck().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
