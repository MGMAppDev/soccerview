/**
 * Merge Teams Utility
 * ===================
 *
 * Manually merge two or more teams into one.
 * Useful for fixing known duplicates that automatic detection might miss.
 *
 * Usage:
 *   node scripts/maintenance/mergeTeams.js --keep <uuid> --merge <uuid1,uuid2,...>
 *   node scripts/maintenance/mergeTeams.js --keep <uuid> --merge <uuid1,uuid2,...> --execute
 *
 * Examples:
 *   # Dry run - see what would happen
 *   node scripts/maintenance/mergeTeams.js --keep abc123 --merge def456,ghi789
 *
 *   # Actually execute the merge
 *   node scripts/maintenance/mergeTeams.js --keep abc123 --merge def456,ghi789 --execute
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Merge multiple teams into a single team
 */
async function mergeTeams(keepId, mergeIds, options = {}) {
  const { dryRun = true, verbose = true } = options;

  const client = await pool.connect();

  try {
    // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
    await authorizePipelineWrite(client);

    // 1. Validate that all teams exist
    const { rows: teams } = await client.query(`
      SELECT id, canonical_name, display_name, birth_year, gender, state,
             matches_played, elo_rating
      FROM teams_v2
      WHERE id = ANY($1)
    `, [[keepId, ...mergeIds]]);

    const keepTeam = teams.find(t => t.id === keepId);
    const teamsToMerge = teams.filter(t => mergeIds.includes(t.id));

    if (!keepTeam) {
      throw new Error(`Keep team ${keepId} not found`);
    }

    const missingIds = mergeIds.filter(id => !teamsToMerge.find(t => t.id === id));
    if (missingIds.length > 0) {
      throw new Error(`Teams not found: ${missingIds.join(', ')}`);
    }

    // 2. Show what will happen
    console.log('\n📋 MERGE PLAN:');
    console.log('\n   Team to KEEP:');
    console.log(`   ID: ${keepTeam.id}`);
    console.log(`   Name: ${keepTeam.display_name || keepTeam.canonical_name}`);
    console.log(`   Birth Year: ${keepTeam.birth_year}`);
    console.log(`   Gender: ${keepTeam.gender}`);
    console.log(`   Matches: ${keepTeam.matches_played}`);
    console.log(`   ELO: ${keepTeam.elo_rating}`);

    console.log('\n   Teams to MERGE (will be deleted):');
    for (const team of teamsToMerge) {
      console.log(`   - ${team.display_name || team.canonical_name} (${team.matches_played} matches, ELO: ${team.elo_rating})`);
    }

    // 3. Count affected matches
    const { rows: matchCounts } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE home_team_id = ANY($1)) as home_matches,
        COUNT(*) FILTER (WHERE away_team_id = ANY($1)) as away_matches
      FROM matches_v2
    `, [mergeIds]);

    const totalMatches = parseInt(matchCounts[0].home_matches) + parseInt(matchCounts[0].away_matches);
    console.log(`\n   Matches to migrate: ${totalMatches}`);

    if (dryRun) {
      console.log('\n⚠️  DRY RUN - No changes made');
      console.log('   Use --execute to perform the merge');
      return { success: true, dryRun: true };
    }

    // 4. Execute merge
    console.log('\n🔧 Executing merge...');

    await client.query('BEGIN');

    // Update home_team_id references
    const { rowCount: homeUpdated } = await client.query(`
      UPDATE matches_v2
      SET home_team_id = $1
      WHERE home_team_id = ANY($2)
    `, [keepId, mergeIds]);

    // Update away_team_id references
    const { rowCount: awayUpdated } = await client.query(`
      UPDATE matches_v2
      SET away_team_id = $1
      WHERE away_team_id = ANY($2)
    `, [keepId, mergeIds]);

    // Update matches_played count
    const { rows: newCount } = await client.query(`
      SELECT COUNT(*) as total FROM matches_v2
      WHERE home_team_id = $1 OR away_team_id = $1
    `, [keepId]);

    await client.query(`
      UPDATE teams_v2
      SET matches_played = $1
      WHERE id = $2
    `, [parseInt(newCount[0].total), keepId]);

    // Log to audit
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
      SELECT 'teams_v2', id, 'MANUAL_MERGE',
        row_to_json(teams_v2),
        jsonb_build_object('merged_into', $1),
        'mergeTeams', NOW()
      FROM teams_v2
      WHERE id = ANY($2)
    `, [keepId, mergeIds]);

    // Delete merged teams
    const { rowCount: deleted } = await client.query(`
      DELETE FROM teams_v2
      WHERE id = ANY($1)
    `, [mergeIds]);

    // SELF-LEARNING: Add merged team names as aliases to canonical_teams registry
    // This prevents future duplicates by recognizing these name variants
    const mergedNames = teamsToMerge.map(t => t.display_name || t.canonical_name);

    // Check if canonical entry exists for the kept team
    const { rows: existingCanonical } = await client.query(`
      SELECT id, aliases FROM canonical_teams
      WHERE team_v2_id = $1
    `, [keepId]);

    if (existingCanonical.length > 0) {
      // Update existing entry with new aliases
      const currentAliases = existingCanonical[0].aliases || [];
      const newAliases = [...new Set([...currentAliases, ...mergedNames])];
      await client.query(`
        UPDATE canonical_teams
        SET aliases = $1, updated_at = NOW()
        WHERE id = $2
      `, [newAliases, existingCanonical[0].id]);
      console.log(`   ✅ Added ${mergedNames.length} aliases to canonical_teams`);
    } else {
      // Create new canonical entry
      await client.query(`
        INSERT INTO canonical_teams (
          canonical_name, birth_year, gender, state, aliases, team_v2_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [
        keepTeam.display_name || keepTeam.canonical_name,
        keepTeam.birth_year,
        keepTeam.gender,
        keepTeam.state,
        mergedNames,
        keepId
      ]);
      console.log(`   ✅ Created canonical_teams entry with ${mergedNames.length} aliases`);
    }

    await client.query('COMMIT');

    console.log(`   ✅ Migrated ${homeUpdated + awayUpdated} match references`);
    console.log(`   ✅ Deleted ${deleted} teams`);
    console.log(`   ✅ Updated matches_played to ${newCount[0].total}`);

    return {
      success: true,
      matchesMigrated: homeUpdated + awayUpdated,
      teamsDeleted: deleted,
      aliasesAdded: mergedNames.length,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Find teams by name pattern
 */
async function findTeams(pattern, options = {}) {
  const { birthYear = null, limit = 20 } = options;

  const client = await pool.connect();

  try {
    let query = `
      SELECT id, canonical_name, display_name, birth_year, gender, state,
             matches_played, elo_rating
      FROM teams_v2
      WHERE canonical_name ILIKE $1
    `;
    const params = [`%${pattern}%`];

    if (birthYear) {
      query += ` AND birth_year = $2`;
      params.push(birthYear);
    }

    query += ` ORDER BY matches_played DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await client.query(query, params);

    console.log(`\n📋 Found ${rows.length} teams matching "${pattern}":`);
    for (const team of rows) {
      console.log(`   ${team.id}`);
      console.log(`      Name: ${team.display_name || team.canonical_name}`);
      console.log(`      BY: ${team.birth_year}, Gender: ${team.gender}, State: ${team.state}`);
      console.log(`      Matches: ${team.matches_played}, ELO: ${team.elo_rating}`);
    }

    return rows;

  } finally {
    client.release();
  }
}

// ===========================================
// CLI
// ===========================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const keepIndex = args.indexOf('--keep');
  const mergeIndex = args.indexOf('--merge');
  const findIndex = args.indexOf('--find');
  const execute = args.includes('--execute');
  const byIndex = args.indexOf('--birth-year');

  if (findIndex >= 0) {
    const pattern = args[findIndex + 1];
    const birthYear = byIndex >= 0 ? parseInt(args[byIndex + 1]) : null;
    await findTeams(pattern, { birthYear });
    await pool.end();
    return;
  }

  if (keepIndex < 0 || mergeIndex < 0) {
    console.log(`
Merge Teams Utility
==================

Usage:
  node scripts/maintenance/mergeTeams.js --keep <uuid> --merge <uuid1,uuid2,...> [--execute]
  node scripts/maintenance/mergeTeams.js --find <pattern> [--birth-year <year>]

Options:
  --keep <uuid>        The team ID to keep (will absorb all matches)
  --merge <uuids>      Comma-separated team IDs to merge into the kept team
  --execute            Actually perform the merge (default is dry-run)
  --find <pattern>     Search for teams by name pattern
  --birth-year <year>  Filter search by birth year

Examples:
  # Find teams to merge
  node scripts/maintenance/mergeTeams.js --find "sporting bv" --birth-year 2014

  # Dry run merge
  node scripts/maintenance/mergeTeams.js --keep abc-123 --merge def-456,ghi-789

  # Execute merge
  node scripts/maintenance/mergeTeams.js --keep abc-123 --merge def-456,ghi-789 --execute
`);
    await pool.end();
    return;
  }

  const keepId = args[keepIndex + 1];
  const mergeIds = args[mergeIndex + 1].split(',').map(s => s.trim());

  console.log('👥 MANUAL TEAM MERGE');
  console.log('='.repeat(40));
  console.log(`Mode: ${execute ? '⚠️  EXECUTE' : 'DRY RUN'}`);

  try {
    await mergeTeams(keepId, mergeIds, { dryRun: !execute });
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }

  await pool.end();
}

main();
