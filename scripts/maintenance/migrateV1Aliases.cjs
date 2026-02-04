/**
 * migrateV1Aliases.cjs
 * Session 83: Migrate team_name_aliases_deprecated to canonical_teams
 *
 * This script extracts valid team name aliases from V1 and adds them
 * to the canonical_teams.aliases TEXT[] array for improved deduplication.
 *
 * GUARDRAILS:
 * - READ from team_name_aliases_deprecated (V1)
 * - WRITE to canonical_teams only (not teams_v2 or matches_v2)
 * - Uses pg Pool with bulk SQL
 * - Dry-run mode available
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 300000, // 5 minutes
});

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1])
  : null;

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     SESSION 83: MIGRATE V1 ALIASES TO CANONICAL_TEAMS          ║');
  console.log(`║                    ${DRY_RUN ? 'DRY RUN MODE' : 'LIVE EXECUTION'}                            ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Count V1 aliases
    console.log('=== STEP 1: Count V1 Aliases ===\n');
    const { rows: countRows } = await pool.query(`
      SELECT COUNT(*) as total FROM team_name_aliases_deprecated;
    `);
    console.log(`  Total V1 aliases: ${parseInt(countRows[0].total).toLocaleString()}`);

    // Step 2: Find aliases with valid team_ids in V2
    console.log('\n=== STEP 2: Find Valid Team IDs ===\n');
    const { rows: validRows } = await pool.query(`
      SELECT COUNT(*) as total
      FROM team_name_aliases_deprecated tna
      WHERE EXISTS (SELECT 1 FROM teams_v2 t WHERE t.id = tna.team_id);
    `);
    console.log(`  Aliases with valid team_id in V2: ${parseInt(validRows[0].total).toLocaleString()}`);

    // Step 3: Find matching canonical_teams entries
    console.log('\n=== STEP 3: Match to Canonical Teams ===\n');

    // Get canonical_teams that match V1 team_ids
    const { rows: matchRows } = await pool.query(`
      SELECT COUNT(DISTINCT ct.id) as canonical_count, COUNT(DISTINCT tna.id) as alias_count
      FROM team_name_aliases_deprecated tna
      JOIN teams_v2 t ON t.id = tna.team_id
      JOIN canonical_teams ct ON ct.canonical_name = t.canonical_name;
    `);
    console.log(`  Canonical teams with V1 aliases: ${parseInt(matchRows[0].canonical_count).toLocaleString()}`);
    console.log(`  V1 aliases matching: ${parseInt(matchRows[0].alias_count).toLocaleString()}`);

    // Step 4: Preview aliases to add
    console.log('\n=== STEP 4: Preview Aliases to Add ===\n');

    const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';
    const { rows: previewRows } = await pool.query(`
      SELECT
        ct.id as canonical_id,
        ct.canonical_name,
        tna.alias_name,
        ct.aliases as current_aliases
      FROM team_name_aliases_deprecated tna
      JOIN teams_v2 t ON t.id = tna.team_id
      JOIN canonical_teams ct ON ct.canonical_name = t.canonical_name
      WHERE NOT (tna.alias_name = ANY(COALESCE(ct.aliases, ARRAY[]::text[])))
        AND tna.alias_name IS NOT NULL
        AND tna.alias_name != ''
        AND tna.alias_name != ct.canonical_name
      ${limitClause};
    `);

    console.log(`  New aliases to add: ${previewRows.length.toLocaleString()}`);

    if (previewRows.length > 0) {
      console.log('\n  Sample (first 5):');
      for (const row of previewRows.slice(0, 5)) {
        console.log(`    ${row.canonical_name.substring(0, 40)}... + "${row.alias_name.substring(0, 30)}..."`);
      }
    }

    if (DRY_RUN) {
      console.log('\n=== DRY RUN COMPLETE - No changes made ===\n');
      return;
    }

    // Step 5: Execute the migration
    console.log('\n=== STEP 5: Execute Migration ===\n');

    // Use a CTE to batch update
    const { rowCount } = await pool.query(`
      WITH aliases_to_add AS (
        SELECT
          ct.id as canonical_id,
          tna.alias_name
        FROM team_name_aliases_deprecated tna
        JOIN teams_v2 t ON t.id = tna.team_id
        JOIN canonical_teams ct ON ct.canonical_name = t.canonical_name
        WHERE NOT (tna.alias_name = ANY(COALESCE(ct.aliases, ARRAY[]::text[])))
          AND tna.alias_name IS NOT NULL
          AND tna.alias_name != ''
          AND tna.alias_name != ct.canonical_name
        ${limitClause}
      ),
      grouped AS (
        SELECT
          canonical_id,
          array_agg(alias_name) as new_aliases
        FROM aliases_to_add
        GROUP BY canonical_id
      )
      UPDATE canonical_teams ct
      SET aliases = COALESCE(ct.aliases, ARRAY[]::text[]) || g.new_aliases
      FROM grouped g
      WHERE ct.id = g.canonical_id;
    `);

    console.log(`  Updated ${rowCount.toLocaleString()} canonical_teams entries`);

    // Step 6: Verify
    console.log('\n=== STEP 6: Verification ===\n');
    const { rows: verifyRows } = await pool.query(`
      SELECT
        COUNT(*) as total_canonical,
        COUNT(*) FILTER (WHERE cardinality(aliases) > 0) as with_aliases,
        SUM(cardinality(COALESCE(aliases, ARRAY[]::text[]))) as total_aliases
      FROM canonical_teams;
    `);

    console.log(`  Total canonical_teams: ${parseInt(verifyRows[0].total_canonical).toLocaleString()}`);
    console.log(`  With aliases: ${parseInt(verifyRows[0].with_aliases).toLocaleString()}`);
    console.log(`  Total aliases: ${parseInt(verifyRows[0].total_aliases).toLocaleString()}`);

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    MIGRATION COMPLETE                           ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

  } catch (err) {
    console.error('MIGRATION FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
