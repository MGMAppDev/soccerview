/**
 * cleanupGarbageMatches.js
 *
 * Analyzes and optionally removes CLEARLY INVALID matches:
 * - Dates in 2027+ (impossible future dates)
 * - NOT 2026 dates - those may be valid upcoming season matches!
 *
 * USAGE:
 *   node scripts/maintenance/cleanupGarbageMatches.js --dry-run    # Analyze only (default)
 *   node scripts/maintenance/cleanupGarbageMatches.js --delete     # Actually delete garbage
 *
 * SAFETY:
 * - Only deletes matches with NULL league_id AND tournament_id
 * - Only deletes dates >= 2027 (clearly impossible)
 * - PRESERVES 2026 dates (may be valid upcoming Fall 2026 season)
 *
 * V2 ARCHITECTURE (Session 79):
 * - Converted from Supabase to pg Pool for write authorization
 * - Uses authorizePipelineWrite() before deletes
 */

import pg from 'pg';
import 'dotenv/config';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const DELETE_MODE = process.argv.includes('--delete');

// Only delete dates from 2027+ (clearly impossible future dates)
// PRESERVE 2026 dates - may be valid upcoming Fall 2026 season!
const GARBAGE_DATE_START = '2027-01-01';

async function main() {
  console.log('='.repeat(60));
  console.log('ANALYZE UNLINKED MATCHES');
  console.log('='.repeat(60));
  console.log(`Mode: ${DELETE_MODE ? '⚠️  DELETE MODE' : 'ANALYZE ONLY (use --delete to remove)'}`);
  console.log('');

  const client = await pool.connect();

  try {
    // ============================================================
    // STEP 1: Analyze all unlinked matches
    // ============================================================
    console.log('Step 1: Analyzing unlinked matches...\n');

    // Get ALL unlinked matches
    const { rows: allUnlinked } = await client.query(`
      SELECT id, match_date, source_platform, source_match_key
      FROM matches_v2
      WHERE league_id IS NULL AND tournament_id IS NULL
      ORDER BY match_date
    `);

    console.log(`  Total unlinked matches: ${allUnlinked.length}`);

    // Categorize by year
    const byYear = {};
    allUnlinked.forEach(m => {
      const year = m.match_date?.toISOString?.().split('-')[0] ||
                   (typeof m.match_date === 'string' ? m.match_date.split('-')[0] : 'NULL');
      byYear[year] = (byYear[year] || 0) + 1;
    });
    console.log('\n  By year:', byYear);

    // Categorize by source
    const bySource = {};
    allUnlinked.forEach(m => {
      const src = m.source_platform || 'NULL';
      bySource[src] = (bySource[src] || 0) + 1;
    });
    console.log('  By source:', bySource);

    // Categorize by has source_match_key
    const withKey = allUnlinked.filter(m => m.source_match_key).length;
    const noKey = allUnlinked.filter(m => !m.source_match_key).length;
    console.log(`\n  Has source_match_key: ${withKey}`);
    console.log(`  No source_match_key: ${noKey}`);

    // Helper to get date string
    const getDateStr = (d) => {
      if (!d) return null;
      if (typeof d === 'string') return d;
      return d.toISOString().split('T')[0];
    };

    // Identify CLEARLY GARBAGE (2027+ dates)
    const garbageMatches = allUnlinked.filter(m => getDateStr(m.match_date) >= GARBAGE_DATE_START);
    console.log(`\n  ❌ GARBAGE (dates >= 2027): ${garbageMatches.length}`);

    // Identify 2026 dates (may be valid upcoming)
    const upcoming2026 = allUnlinked.filter(m => {
      const d = getDateStr(m.match_date);
      return d >= '2026-01-01' && d < '2027-01-01';
    });
    console.log(`  ⚠️  2026 dates (MAY BE VALID UPCOMING): ${upcoming2026.length}`);

    // Show sample 2026 matches
    if (upcoming2026.length > 0) {
      console.log('\n  Sample 2026 matches (check if valid upcoming):');
      upcoming2026.slice(0, 5).forEach(m => {
        console.log(`    - ${getDateStr(m.match_date)} | ${m.source_platform} | key: ${m.source_match_key ? 'yes' : 'NO'}`);
      });
    }

    // ============================================================
    // STEP 2: Delete ONLY clearly garbage (2027+)
    // ============================================================
    if (garbageMatches.length === 0) {
      console.log('\n✅ No clearly garbage matches (2027+) found!');
      console.log('\n📋 REMAINING INVESTIGATION NEEDED:');
      console.log(`   - ${upcoming2026.length} matches in 2026 - verify if valid upcoming`);
      console.log(`   - ${noKey} matches without source_match_key - may need manual linking`);
      return;
    }

    if (!DELETE_MODE) {
      console.log('\n[ANALYZE ONLY] Would delete:');
      console.log(`  - ${garbageMatches.length} garbage matches (dates >= 2027)`);
      console.log('\nRun with --delete to actually remove them.');
      return;
    }

    // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
    console.log('\n🔐 Authorizing pipeline writes...');
    await authorizePipelineWrite(client);
    console.log('✅ Pipeline write authorization granted\n');

    console.log(`Step 2: Deleting ${garbageMatches.length} garbage matches...`);

    const ids = garbageMatches.map(m => m.id);
    const BATCH = 500;

    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      await client.query(`
        DELETE FROM matches_v2
        WHERE id = ANY($1::uuid[])
      `, [batch]);

      console.log(`  Deleted ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
    }
    console.log(`  ✅ Deleted ${ids.length} garbage matches`);

    // ============================================================
    // STEP 3: Refresh views
    // ============================================================
    console.log('\nStep 3: Refreshing materialized views...');
    try {
      await client.query('SELECT refresh_app_views()');
      console.log('  ✅ Views refreshed');
    } catch (refreshErr) {
      console.log('  ⚠️  Manual refresh may be needed:', refreshErr.message);
    }

    // ============================================================
    // Summary
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Garbage deleted: ${ids.length}`);
    console.log(`2026 matches preserved: ${upcoming2026.length}`);
    console.log(`Remaining unlinked: ${allUnlinked.length - ids.length}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
