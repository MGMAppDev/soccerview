/**
 * populateCanonicalTeams.cjs
 *
 * UNIVERSAL: Populate canonical_teams registry from teams_v2.
 *
 * The V2 architecture requires canonical_teams to contain ALL known teams
 * so that future data can be matched. This script ensures the registry
 * is complete.
 *
 * FAST: Uses bulk SQL operations - processes thousands per second.
 *
 * Usage:
 *   node scripts/maintenance/populateCanonicalTeams.cjs --stats
 *   node scripts/maintenance/populateCanonicalTeams.cjs --dry-run
 *   node scripts/maintenance/populateCanonicalTeams.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const STATS_ONLY = args.includes('--stats');

async function showStats() {
  console.log('='.repeat(70));
  console.log('CANONICAL TEAMS REGISTRY STATUS');
  console.log('='.repeat(70));

  const stats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2) as total_teams,
      (SELECT COUNT(*) FROM canonical_teams) as total_canonical,
      (SELECT COUNT(*) FROM canonical_teams WHERE team_v2_id IS NOT NULL) as linked_canonical,
      (SELECT COUNT(*) FROM teams_v2 t
       WHERE NOT EXISTS (
         SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
       )) as teams_not_in_registry,
      (SELECT COUNT(*) FROM teams_v2
       WHERE birth_year IS NOT NULL AND gender IS NOT NULL) as teams_with_key
  `);

  const s = stats.rows[0];
  console.log(`
teams_v2 total:             ${parseInt(s.total_teams).toLocaleString()}
canonical_teams total:      ${parseInt(s.total_canonical).toLocaleString()}
canonical linked to team:   ${parseInt(s.linked_canonical).toLocaleString()}

Teams NOT in registry:      ${parseInt(s.teams_not_in_registry).toLocaleString()} ⚠️
Teams with birth_year+gender: ${parseInt(s.teams_with_key).toLocaleString()}
`);

  return s;
}

async function populateRegistry(dryRun) {
  console.log('='.repeat(70));
  console.log(dryRun ? 'POPULATE CANONICAL TEAMS (DRY RUN)' : 'POPULATING CANONICAL TEAMS');
  console.log('='.repeat(70));

  // Count how many need to be added
  const { rows: [{ count: toAdd }] } = await pool.query(`
    SELECT COUNT(*) FROM teams_v2 t
    WHERE t.birth_year IS NOT NULL
      AND t.gender IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
      )
  `);

  console.log(`\nTeams to add to canonical_teams: ${parseInt(toAdd).toLocaleString()}`);

  if (parseInt(toAdd) === 0) {
    console.log('Registry is already complete!');
    return { added: 0 };
  }

  if (dryRun) {
    // Show sample
    const { rows: sample } = await pool.query(`
      SELECT t.id, t.display_name, t.canonical_name, t.birth_year, t.gender
      FROM teams_v2 t
      WHERE t.birth_year IS NOT NULL
        AND t.gender IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
        )
      LIMIT 10
    `);

    console.log('\nSample teams to add:');
    sample.forEach(t => {
      console.log(`  ${t.display_name?.substring(0, 50)}`);
      console.log(`    canonical=${t.canonical_name?.substring(0, 40)}, by=${t.birth_year}, g=${t.gender}`);
    });

    console.log(`\n[DRY RUN] Would add ${parseInt(toAdd).toLocaleString()} teams to canonical_teams`);
    return { wouldAdd: parseInt(toAdd) };
  }

  // Execute bulk insert
  console.log('\nExecuting bulk insert...');
  const startTime = Date.now();

  const result = await pool.query(`
    INSERT INTO canonical_teams (canonical_name, birth_year, gender, state, team_v2_id, aliases)
    SELECT
      t.canonical_name,
      t.birth_year,
      t.gender,
      t.state,
      t.id,
      ARRAY[t.display_name]  -- Original name as alias
    FROM teams_v2 t
    WHERE t.birth_year IS NOT NULL
      AND t.gender IS NOT NULL
      AND t.canonical_name IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM canonical_teams ct WHERE ct.team_v2_id = t.id
      )
    ON CONFLICT (canonical_name, birth_year, gender, state)
    DO UPDATE SET
      team_v2_id = COALESCE(canonical_teams.team_v2_id, EXCLUDED.team_v2_id),
      aliases = CASE
        WHEN EXCLUDED.aliases[1] = ANY(canonical_teams.aliases) THEN canonical_teams.aliases
        ELSE array_cat(canonical_teams.aliases, EXCLUDED.aliases)
      END
  `);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Added/updated ${result.rowCount} canonical_teams entries in ${duration}s`);

  return { added: result.rowCount };
}

async function main() {
  console.log('='.repeat(70));
  console.log('POPULATE CANONICAL TEAMS REGISTRY');
  console.log('V2 Architecture: Ensures all teams_v2 are in canonical registry');
  console.log('='.repeat(70));
  console.log(`Mode: ${STATS_ONLY ? 'STATS ONLY' : (DRY_RUN ? 'DRY RUN' : 'EXECUTE')}`);
  console.log('');

  // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
  // Note: canonical_teams is not protected by triggers, but we add auth for consistency
  if (!DRY_RUN && !STATS_ONLY) {
    console.log('🔐 Authorizing pipeline writes...');
    await authorizePipelineWrite(pool);
    console.log('✅ Pipeline write authorization granted\n');
  }

  try {
    const statsBefore = await showStats();

    if (STATS_ONLY) {
      await pool.end();
      return;
    }

    const result = await populateRegistry(DRY_RUN);

    if (!DRY_RUN) {
      console.log('\n' + '='.repeat(70));
      console.log('AFTER POPULATION');
      await showStats();
    }

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(JSON.stringify(result, null, 2));

    if (DRY_RUN) {
      console.log('\n⚠️  DRY RUN - No changes made. Use --execute to apply.');
    }

  } catch (err) {
    console.error('Error:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
