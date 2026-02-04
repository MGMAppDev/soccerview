/**
 * migrateV1Events.cjs
 * Session 83: Migrate event_registry_deprecated to canonical_events
 *
 * This script extracts event metadata from V1 and adds missing entries
 * to canonical_events for improved event discovery and linkage.
 *
 * GUARDRAILS:
 * - READ from event_registry_deprecated (V1)
 * - WRITE to canonical_events only (not teams_v2 or matches_v2)
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

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     SESSION 83: MIGRATE V1 EVENTS TO CANONICAL_EVENTS          ║');
  console.log(`║                    ${DRY_RUN ? 'DRY RUN MODE' : 'LIVE EXECUTION'}                            ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Count V1 events
    console.log('=== STEP 1: Count V1 Events ===\n');
    const { rows: countRows } = await pool.query(`
      SELECT COUNT(*) as total FROM event_registry_deprecated;
    `);
    console.log(`  Total V1 events: ${parseInt(countRows[0].total).toLocaleString()}`);

    // Step 2: Check current canonical_events
    console.log('\n=== STEP 2: Current Canonical Events ===\n');
    const { rows: ceRows } = await pool.query(`
      SELECT COUNT(*) as total FROM canonical_events;
    `);
    console.log(`  Current canonical_events: ${parseInt(ceRows[0].total).toLocaleString()}`);

    // Step 3: Find V1 events NOT in canonical_events (by name)
    console.log('\n=== STEP 3: Find Missing Events ===\n');

    const { rows: missingRows } = await pool.query(`
      SELECT COUNT(*) as total
      FROM event_registry_deprecated erd
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_events ce
        WHERE ce.canonical_name = erd.event_name
      );
    `);
    console.log(`  V1 events NOT in canonical_events: ${parseInt(missingRows[0].total).toLocaleString()}`);

    // Step 4: Preview events to add
    console.log('\n=== STEP 4: Preview Events to Add ===\n');

    const { rows: previewRows } = await pool.query(`
      SELECT
        erd.event_id,
        erd.event_name,
        erd.source_platform,
        erd.source_type,
        erd.state,
        erd.match_count
      FROM event_registry_deprecated erd
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_events ce
        WHERE ce.canonical_name = erd.event_name
      )
      ORDER BY erd.match_count DESC NULLS LAST
      LIMIT 20;
    `);

    console.log(`  Sample of events to add (by match count):`);
    for (const row of previewRows) {
      const matchInfo = row.match_count ? ` (${row.match_count} matches)` : '';
      console.log(`    ${row.event_id}: ${row.event_name.substring(0, 50)}${matchInfo}`);
    }

    if (DRY_RUN) {
      console.log('\n=== DRY RUN COMPLETE - No changes made ===\n');
      console.log(`  Would insert: ${parseInt(missingRows[0].total).toLocaleString()} events`);
      return;
    }

    // Step 5: Execute the migration
    console.log('\n=== STEP 5: Execute Migration ===\n');

    const { rowCount } = await pool.query(`
      INSERT INTO canonical_events (
        canonical_name,
        event_type,
        state,
        aliases,
        created_at
      )
      SELECT
        erd.event_name,
        CASE
          WHEN erd.source_type = 'tournament' THEN 'tournament'
          WHEN erd.source_type = 'league' THEN 'league'
          ELSE 'unknown'
        END,
        erd.state,
        ARRAY[]::text[],
        NOW()
      FROM event_registry_deprecated erd
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_events ce
        WHERE ce.canonical_name = erd.event_name
      )
      ON CONFLICT DO NOTHING;
    `);

    console.log(`  Inserted ${rowCount.toLocaleString()} new canonical_events entries`);

    // Step 6: Verify
    console.log('\n=== STEP 6: Verification ===\n');
    const { rows: verifyRows } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE event_type = 'tournament') as tournaments,
        COUNT(*) FILTER (WHERE event_type = 'league') as leagues
      FROM canonical_events;
    `);

    console.log(`  Total canonical_events: ${parseInt(verifyRows[0].total).toLocaleString()}`);
    console.log(`  Tournaments: ${parseInt(verifyRows[0].tournaments).toLocaleString()}`);
    console.log(`  Leagues: ${parseInt(verifyRows[0].leagues).toLocaleString()}`);

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
