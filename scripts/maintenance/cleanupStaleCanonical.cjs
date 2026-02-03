/**
 * cleanupStaleCanonical.cjs
 *
 * V2 ARCHITECTURE COMPLIANT:
 * Cleans up canonical_teams entries that point to teams no longer in teams_v2
 * These are artifacts from previous merge operations where the merged team
 * was deleted but the canonical entry wasn't removed.
 *
 * Usage:
 *   node scripts/maintenance/cleanupStaleCanonical.cjs --dry-run
 *   node scripts/maintenance/cleanupStaleCanonical.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');

async function cleanup() {
  console.log('=== CLEANUP STALE CANONICAL ENTRIES ===\n');

  // Find stale entries (point to non-existent teams)
  const { rows: stale } = await pool.query(`
    SELECT ct.id, ct.team_v2_id, ct.canonical_name, ct.birth_year, ct.gender
    FROM canonical_teams ct
    WHERE NOT EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = ct.team_v2_id)
  `);

  console.log(`Found ${stale.length} stale canonical entries\n`);

  if (stale.length === 0) {
    console.log('✅ No stale entries to clean up');
    await pool.end();
    return;
  }

  // Show sample
  console.log('Sample stale entries (first 10):');
  stale.slice(0, 10).forEach(s => {
    console.log(`  - ${s.canonical_name} (${s.birth_year} ${s.gender})`);
  });

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would delete ${stale.length} stale canonical entries`);
    console.log('Run with --execute to actually delete');
    await pool.end();
    return;
  }

  // Execute cleanup
  console.log('\n🗑️  Deleting stale entries...');

  const { rowCount } = await pool.query(`
    DELETE FROM canonical_teams
    WHERE NOT EXISTS (
      SELECT 1 FROM teams_v2 t WHERE t.id = canonical_teams.team_v2_id
    )
  `);

  console.log(`✅ Deleted ${rowCount} stale canonical entries`);

  // Verify
  const { rows: [check] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM canonical_teams) as total,
      (SELECT COUNT(*) FROM canonical_teams ct
       WHERE NOT EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = ct.team_v2_id)) as stale,
      (SELECT COUNT(*) FROM (
        SELECT canonical_name, birth_year, gender
        FROM canonical_teams
        WHERE birth_year IS NOT NULL AND gender IS NOT NULL
        GROUP BY canonical_name, birth_year, gender
        HAVING COUNT(*) > 1
      ) d) as dupe_groups
  `);

  console.log('\n=== VERIFICATION ===');
  console.log(`Total canonical entries: ${check.total}`);
  console.log(`Remaining stale entries: ${check.stale}`);
  console.log(`Duplicate groups: ${check.dupe_groups}`);

  await pool.end();
}

cleanup().catch(err => {
  console.error('Error:', err);
  pool.end();
  process.exit(1);
});
