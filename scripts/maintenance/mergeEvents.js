/**
 * Merge Events Utility
 * ====================
 *
 * Manually merge two or more leagues or tournaments into one.
 * Useful for fixing known duplicates that automatic detection might miss.
 *
 * Usage:
 *   node scripts/maintenance/mergeEvents.js --type league --keep <uuid> --merge <uuid1,uuid2,...>
 *   node scripts/maintenance/mergeEvents.js --type tournament --keep <uuid> --merge <uuid1,uuid2,...> --execute
 *
 * Examples:
 *   # Find leagues by name
 *   node scripts/maintenance/mergeEvents.js --type league --find "Heartland"
 *
 *   # Dry run - see what would happen
 *   node scripts/maintenance/mergeEvents.js --type league --keep abc123 --merge def456,ghi789
 *
 *   # Actually execute the merge
 *   node scripts/maintenance/mergeEvents.js --type league --keep abc123 --merge def456,ghi789 --execute
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Merge multiple events into a single event
 */
async function mergeEvents(type, keepId, mergeIds, options = {}) {
  const { dryRun = true, verbose = true } = options;

  const tableName = type === 'league' ? 'leagues' : 'tournaments';
  const fkColumn = type === 'league' ? 'league_id' : 'tournament_id';

  const client = await pool.connect();

  try {
    // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
    await authorizePipelineWrite(client);

    // 1. Validate that all events exist
    const { rows: events } = await client.query(`
      SELECT e.id, e.name, e.source_event_id,
             COALESCE(m.match_count, 0) as match_count
      FROM ${tableName} e
      LEFT JOIN (
        SELECT ${fkColumn}, COUNT(*) as match_count
        FROM matches_v2
        WHERE ${fkColumn} IS NOT NULL
        GROUP BY ${fkColumn}
      ) m ON e.id = m.${fkColumn}
      WHERE e.id = ANY($1)
    `, [[keepId, ...mergeIds]]);

    const keepEvent = events.find(e => e.id === keepId);
    const eventsToMerge = events.filter(e => mergeIds.includes(e.id));

    if (!keepEvent) {
      throw new Error(`Keep ${type} ${keepId} not found`);
    }

    const missingIds = mergeIds.filter(id => !eventsToMerge.find(e => e.id === id));
    if (missingIds.length > 0) {
      throw new Error(`${type}s not found: ${missingIds.join(', ')}`);
    }

    // 2. Show what will happen
    console.log('\n📋 MERGE PLAN:');
    console.log(`\n   ${type.toUpperCase()} to KEEP:`);
    console.log(`   ID: ${keepEvent.id}`);
    console.log(`   Name: ${keepEvent.name}`);
    console.log(`   Source ID: ${keepEvent.source_event_id}`);
    console.log(`   Matches: ${keepEvent.match_count}`);

    console.log(`\n   ${type.toUpperCase()}s to MERGE (will be deleted):`);
    let totalMatchesToMigrate = 0;
    for (const event of eventsToMerge) {
      console.log(`   - ${event.name} (${event.match_count} matches)`);
      totalMatchesToMigrate += parseInt(event.match_count);
    }

    console.log(`\n   Matches to migrate: ${totalMatchesToMigrate}`);

    if (dryRun) {
      console.log('\n⚠️  DRY RUN - No changes made');
      console.log('   Use --execute to perform the merge');
      return { success: true, dryRun: true };
    }

    // 3. Execute merge
    console.log('\n🔧 Executing merge...');

    await client.query('BEGIN');

    // Update match references
    const { rowCount: migrated } = await client.query(`
      UPDATE matches_v2
      SET ${fkColumn} = $1
      WHERE ${fkColumn} = ANY($2)
    `, [keepId, mergeIds]);

    // Log to audit
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
      SELECT $1, id, 'MANUAL_MERGE',
        row_to_json(${tableName}),
        jsonb_build_object('merged_into', $2),
        'mergeEvents', NOW()
      FROM ${tableName}
      WHERE id = ANY($3)
    `, [tableName, keepId, mergeIds]);

    // Delete merged events
    const { rowCount: deleted } = await client.query(`
      DELETE FROM ${tableName}
      WHERE id = ANY($1)
    `, [mergeIds]);

    // SELF-LEARNING: Add merged event names as aliases to canonical_events registry
    // This prevents future duplicates by recognizing these name variants
    const mergedNames = eventsToMerge.map(e => e.name);

    // Check if canonical entry exists for the kept event
    const fkColumnCanonical = type === 'league' ? 'league_id' : 'tournament_id';
    const { rows: existingCanonical } = await client.query(`
      SELECT id, aliases FROM canonical_events
      WHERE ${fkColumnCanonical} = $1
    `, [keepId]);

    if (existingCanonical.length > 0) {
      // Update existing entry with new aliases
      const currentAliases = existingCanonical[0].aliases || [];
      const newAliases = [...new Set([...currentAliases, ...mergedNames])];
      await client.query(`
        UPDATE canonical_events
        SET aliases = $1, updated_at = NOW()
        WHERE id = $2
      `, [newAliases, existingCanonical[0].id]);
      console.log(`   ✅ Added ${mergedNames.length} aliases to canonical_events`);
    } else {
      // Create new canonical entry
      await client.query(`
        INSERT INTO canonical_events (
          canonical_name, event_type, aliases, ${fkColumnCanonical}
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [
        keepEvent.name,
        type,
        mergedNames,
        keepId
      ]);
      console.log(`   ✅ Created canonical_events entry with ${mergedNames.length} aliases`);
    }

    await client.query('COMMIT');

    console.log(`   ✅ Migrated ${migrated} match references`);
    console.log(`   ✅ Deleted ${deleted} ${type}s`);

    return {
      success: true,
      matchesMigrated: migrated,
      eventsDeleted: deleted,
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
 * Find events by name pattern
 */
async function findEvents(type, pattern, options = {}) {
  const { limit = 20 } = options;

  const tableName = type === 'league' ? 'leagues' : 'tournaments';
  const fkColumn = type === 'league' ? 'league_id' : 'tournament_id';

  const client = await pool.connect();

  try {
    const { rows } = await client.query(`
      SELECT e.id, e.name, e.source_event_id,
             COALESCE(m.match_count, 0) as match_count
      FROM ${tableName} e
      LEFT JOIN (
        SELECT ${fkColumn}, COUNT(*) as match_count
        FROM matches_v2
        WHERE ${fkColumn} IS NOT NULL
        GROUP BY ${fkColumn}
      ) m ON e.id = m.${fkColumn}
      WHERE e.name ILIKE $1
      ORDER BY match_count DESC
      LIMIT $2
    `, [`%${pattern}%`, limit]);

    console.log(`\n📋 Found ${rows.length} ${type}s matching "${pattern}":`);
    for (const event of rows) {
      console.log(`\n   ${event.id}`);
      console.log(`      Name: ${event.name}`);
      console.log(`      Source ID: ${event.source_event_id}`);
      console.log(`      Matches: ${event.match_count}`);
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
  const typeIndex = args.indexOf('--type');
  const keepIndex = args.indexOf('--keep');
  const mergeIndex = args.indexOf('--merge');
  const findIndex = args.indexOf('--find');
  const execute = args.includes('--execute');

  const type = typeIndex >= 0 ? args[typeIndex + 1] : null;

  if (!type || !['league', 'tournament'].includes(type)) {
    console.log(`
Merge Events Utility
===================

Usage:
  node scripts/maintenance/mergeEvents.js --type <league|tournament> --keep <uuid> --merge <uuid1,uuid2,...> [--execute]
  node scripts/maintenance/mergeEvents.js --type <league|tournament> --find <pattern>

Options:
  --type <type>        Event type: "league" or "tournament"
  --keep <uuid>        The event ID to keep (will absorb all matches)
  --merge <uuids>      Comma-separated event IDs to merge into the kept event
  --execute            Actually perform the merge (default is dry-run)
  --find <pattern>     Search for events by name pattern

Examples:
  # Find duplicate leagues
  node scripts/maintenance/mergeEvents.js --type league --find "Heartland"

  # Dry run merge leagues
  node scripts/maintenance/mergeEvents.js --type league --keep abc-123 --merge def-456

  # Execute merge tournaments
  node scripts/maintenance/mergeEvents.js --type tournament --keep abc-123 --merge def-456,ghi-789 --execute
`);
    await pool.end();
    return;
  }

  if (findIndex >= 0) {
    const pattern = args[findIndex + 1];
    await findEvents(type, pattern);
    await pool.end();
    return;
  }

  if (keepIndex < 0 || mergeIndex < 0) {
    console.log('Error: --keep and --merge are required for merging');
    console.log('Use --find to search for events first');
    await pool.end();
    return;
  }

  const keepId = args[keepIndex + 1];
  const mergeIds = args[mergeIndex + 1].split(',').map(s => s.trim());

  console.log('🏆 MANUAL EVENT MERGE');
  console.log('='.repeat(40));
  console.log(`Type: ${type}`);
  console.log(`Mode: ${execute ? '⚠️  EXECUTE' : 'DRY RUN'}`);

  try {
    await mergeEvents(type, keepId, mergeIds, { dryRun: !execute });
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }

  await pool.end();
}

main();
