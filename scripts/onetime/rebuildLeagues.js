/**
 * Rebuild Leagues Utility
 * =======================
 *
 * Normalizes league entries and fills in missing metadata:
 * 1. Extract state/region from league names using eventNormalizer
 * 2. Detect and list duplicate leagues for manual review
 * 3. Update canonical_events registry
 *
 * Usage:
 *   node scripts/onetime/rebuildLeagues.js [--dry-run] [--verbose]
 *   node scripts/onetime/rebuildLeagues.js --duplicates-only
 *
 * Options:
 *   --dry-run         Show what would be done without making changes
 *   --verbose         Show detailed progress
 *   --duplicates-only Only report duplicates, don't update metadata
 */

import pg from 'pg';
import 'dotenv/config';
import { normalizeEvent } from '../universal/normalizers/eventNormalizer.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ===========================================
// MAIN LOGIC
// ===========================================

/**
 * Detect duplicate leagues
 */
async function detectDuplicateLeagues(client) {
  const { rows } = await client.query(`
    SELECT
      LOWER(name) as name_lower,
      COUNT(*) as count,
      array_agg(id) as ids,
      array_agg(name) as names,
      array_agg(source_event_id) as source_event_ids,
      array_agg(source_platform) as source_platforms
    FROM leagues
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `);

  return rows.map(r => ({
    name: r.names[0],
    count: parseInt(r.count),
    ids: r.ids,
    names: r.names,
    source_event_ids: r.source_event_ids,
    source_platforms: r.source_platforms,
  }));
}

/**
 * Normalize and update league metadata
 */
async function normalizeLeagues(client, options = {}) {
  const { dryRun = false, verbose = false } = options;

  // Get all leagues
  const { rows: leagues } = await client.query(`
    SELECT id, name, source_platform, state, region
    FROM leagues
    ORDER BY name
  `);

  console.log(`\n📋 Processing ${leagues.length} leagues...\n`);

  const updates = [];
  const noChanges = [];

  for (const league of leagues) {
    // Normalize using eventNormalizer
    const normalized = normalizeEvent({
      raw_name: league.name,
      source_platform: league.source_platform,
    });

    // Determine what needs updating
    const needsUpdate = {
      state: !league.state && normalized.state,
      region: !league.region && normalized.region,
    };

    if (needsUpdate.state || needsUpdate.region) {
      updates.push({
        id: league.id,
        name: league.name,
        current: { state: league.state, region: league.region },
        new: {
          state: needsUpdate.state ? normalized.state : league.state,
          region: needsUpdate.region ? normalized.region : league.region,
        },
      });

      if (verbose) {
        console.log(`   Update: ${league.name}`);
        if (needsUpdate.state) console.log(`      state: NULL → ${normalized.state}`);
        if (needsUpdate.region) console.log(`      region: NULL → ${normalized.region}`);
      }
    } else {
      noChanges.push(league.name);
    }
  }

  console.log(`\n📊 NORMALIZATION RESULTS:`);
  console.log(`   Leagues needing update: ${updates.length}`);
  console.log(`   Leagues already complete: ${noChanges.length}`);

  if (updates.length === 0) {
    console.log('\n✅ All leagues already have complete metadata!');
    return { updated: 0 };
  }

  if (dryRun) {
    console.log('\n⚠️  DRY RUN - Would update:');
    for (const u of updates.slice(0, 10)) {
      console.log(`   - ${u.name}: state=${u.new.state}, region=${u.new.region}`);
    }
    if (updates.length > 10) {
      console.log(`   ... and ${updates.length - 10} more`);
    }
    return { updated: 0, wouldUpdate: updates.length };
  }

  // Execute updates
  console.log('\n🔧 Applying updates...');

  let updated = 0;
  for (const u of updates) {
    await client.query(`
      UPDATE leagues
      SET state = COALESCE($2, state),
          region = COALESCE($3, region),
          updated_at = NOW()
      WHERE id = $1
    `, [u.id, u.new.state, u.new.region]);
    updated++;
  }

  console.log(`   ✅ Updated ${updated} leagues`);
  return { updated };
}

/**
 * Update canonical_events registry
 */
async function updateCanonicalRegistry(client, options = {}) {
  const { dryRun = false, verbose = false } = options;

  // Check if canonical_events table exists
  const { rows: tableCheck } = await client.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'canonical_events'
  `);

  if (tableCheck.length === 0) {
    console.log('\n⚠️  canonical_events table does not exist, skipping registry update');
    return { inserted: 0 };
  }

  // Get leagues not in canonical_events
  const { rows: unregistered } = await client.query(`
    SELECT l.id, l.name, l.source_platform, l.source_event_id
    FROM leagues l
    LEFT JOIN canonical_events ce ON ce.league_id = l.id
    WHERE ce.id IS NULL
  `);

  if (unregistered.length === 0) {
    console.log('\n✅ All leagues are in canonical_events registry');
    return { inserted: 0 };
  }

  console.log(`\n📋 Found ${unregistered.length} leagues not in canonical_events`);

  if (dryRun) {
    console.log('   Would register:');
    for (const l of unregistered.slice(0, 5)) {
      console.log(`   - ${l.name}`);
    }
    if (unregistered.length > 5) {
      console.log(`   ... and ${unregistered.length - 5} more`);
    }
    return { inserted: 0, wouldInsert: unregistered.length };
  }

  // Insert into canonical_events
  let inserted = 0;
  for (const league of unregistered) {
    try {
      await client.query(`
        INSERT INTO canonical_events (
          canonical_name, display_name, event_type, league_id,
          source_platform, source_event_id, created_at
        ) VALUES (
          $1, $1, 'league', $2, $3, $4, NOW()
        )
      `, [league.name, league.id, league.source_platform, league.source_event_id]);
      inserted++;
    } catch (error) {
      if (verbose) {
        console.log(`   ⚠️  Skip: ${league.name} (${error.message})`);
      }
    }
  }

  console.log(`   ✅ Registered ${inserted} leagues in canonical_events`);
  return { inserted };
}

/**
 * Main rebuild function
 */
async function rebuildLeagues(options = {}) {
  const { dryRun = false, verbose = false, duplicatesOnly = false } = options;

  console.log('🏆 REBUILD LEAGUES');
  console.log('='.repeat(40));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️  EXECUTE'}`);

  const client = await pool.connect();

  try {
    // Step 1: Detect duplicates
    console.log('\n📋 Step 1: Detecting duplicate leagues...');
    const duplicates = await detectDuplicateLeagues(client);

    if (duplicates.length > 0) {
      console.log(`\n⚠️  Found ${duplicates.length} duplicate league groups:\n`);
      for (const dup of duplicates) {
        console.log(`   "${dup.name}" (${dup.count} entries)`);
        for (let i = 0; i < dup.ids.length; i++) {
          console.log(`      - ID: ${dup.ids[i]}`);
          console.log(`        Source: ${dup.source_platforms[i]} / ${dup.source_event_ids[i]}`);
        }
        console.log();
      }
      console.log('   Use scripts/maintenance/mergeEvents.js to merge duplicates');
    } else {
      console.log('   ✅ No duplicate leagues found');
    }

    if (duplicatesOnly) {
      return { duplicates: duplicates.length };
    }

    // Step 2: Normalize league metadata
    console.log('\n📋 Step 2: Normalizing league metadata...');
    const normStats = await normalizeLeagues(client, { dryRun, verbose });

    // Step 3: Update canonical registry
    console.log('\n📋 Step 3: Updating canonical_events registry...');
    const registryStats = await updateCanonicalRegistry(client, { dryRun, verbose });

    // Summary
    console.log('\n' + '='.repeat(40));
    console.log('📊 SUMMARY:');
    console.log(`   Duplicate groups: ${duplicates.length}`);
    console.log(`   Leagues updated: ${normStats.updated || normStats.wouldUpdate || 0}`);
    console.log(`   Registry entries: ${registryStats.inserted || registryStats.wouldInsert || 0}`);

    if (dryRun) {
      console.log('\n⚠️  DRY RUN - No changes made. Use without --dry-run to execute.');
    }

    return {
      duplicates: duplicates.length,
      updated: normStats.updated || 0,
      registered: registryStats.inserted || 0,
    };

  } finally {
    client.release();
  }
}

// ===========================================
// CLI
// ===========================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const duplicatesOnly = args.includes('--duplicates-only');

  if (args.includes('--help')) {
    console.log(`
Rebuild Leagues Utility
=======================

Usage:
  node scripts/onetime/rebuildLeagues.js [--dry-run] [--verbose]
  node scripts/onetime/rebuildLeagues.js --duplicates-only

Options:
  --dry-run         Show what would be done without making changes
  --verbose         Show detailed progress
  --duplicates-only Only report duplicates, don't update metadata
  --help            Show this help
`);
    await pool.end();
    return;
  }

  try {
    await rebuildLeagues({ dryRun, verbose, duplicatesOnly });
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
