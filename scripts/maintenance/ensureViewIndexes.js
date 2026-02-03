#!/usr/bin/env node
/**
 * ensureViewIndexes.js - Universal index maintenance for materialized views
 *
 * Purpose: Ensures ALL expected indexes exist on ALL app_* materialized views.
 * This is a universal solution - works for any view, any index pattern.
 *
 * Usage:
 *   node scripts/maintenance/ensureViewIndexes.js --audit     # Check what's missing
 *   node scripts/maintenance/ensureViewIndexes.js --fix       # Create missing indexes
 *   node scripts/maintenance/ensureViewIndexes.js --fix --dry-run  # Preview fixes
 *
 * Created: Session 69 (February 1, 2026)
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// =============================================================================
// INDEX DEFINITIONS - Single source of truth for all view indexes
// =============================================================================

const VIEW_INDEXES = {
  app_rankings: [
    { name: 'idx_app_rankings_id', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_app_rankings_id ON app_rankings (id)' },
    { name: 'idx_app_rankings_rank', sql: 'CREATE INDEX IF NOT EXISTS idx_app_rankings_rank ON app_rankings (national_rank ASC NULLS LAST, elo_rating DESC)' },
    { name: 'idx_app_rankings_filter', sql: 'CREATE INDEX IF NOT EXISTS idx_app_rankings_filter ON app_rankings (state, gender, birth_year)' },
    { name: 'idx_app_rankings_with_matches', sql: 'CREATE INDEX IF NOT EXISTS idx_app_rankings_with_matches ON app_rankings (national_rank ASC NULLS LAST) WHERE has_matches = TRUE' },
    { name: 'idx_app_rankings_featured', sql: 'CREATE INDEX IF NOT EXISTS idx_app_rankings_featured ON app_rankings (elo_rating DESC) WHERE has_matches = TRUE' },
  ],

  app_team_profile: [
    { name: 'idx_app_team_profile_id', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_app_team_profile_id ON app_team_profile (id)' },
    { name: 'idx_app_team_profile_rank', sql: 'CREATE INDEX IF NOT EXISTS idx_app_team_profile_rank ON app_team_profile (national_rank NULLS LAST, elo_rating DESC)' },
    { name: 'idx_app_team_profile_state_rank', sql: 'CREATE INDEX IF NOT EXISTS idx_app_team_profile_state_rank ON app_team_profile (state, elo_rating DESC)' },
    { name: 'idx_app_team_profile_filter', sql: 'CREATE INDEX IF NOT EXISTS idx_app_team_profile_filter ON app_team_profile (state, gender, birth_year)' },
    { name: 'idx_app_team_profile_club', sql: 'CREATE INDEX IF NOT EXISTS idx_app_team_profile_club ON app_team_profile (club_id)' },
    { name: 'idx_app_team_profile_search', sql: "CREATE INDEX IF NOT EXISTS idx_app_team_profile_search ON app_team_profile USING GIN (to_tsvector('english', name || ' ' || COALESCE(club_name, '')))" },
    { name: 'idx_app_team_profile_with_matches', sql: 'CREATE INDEX IF NOT EXISTS idx_app_team_profile_with_matches ON app_team_profile (matches_played DESC) WHERE matches_played > 0' },
  ],

  app_matches_feed: [
    { name: 'idx_app_matches_feed_id', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_app_matches_feed_id ON app_matches_feed (id)' },
    { name: 'idx_app_matches_feed_date', sql: 'CREATE INDEX IF NOT EXISTS idx_app_matches_feed_date ON app_matches_feed (match_date DESC)' },
    { name: 'idx_app_matches_feed_filter', sql: 'CREATE INDEX IF NOT EXISTS idx_app_matches_feed_filter ON app_matches_feed (state, gender, birth_year)' },
  ],

  app_league_standings: [
    { name: 'idx_app_league_standings_league', sql: 'CREATE INDEX IF NOT EXISTS idx_app_league_standings_league ON app_league_standings (league_id, position)' },
    { name: 'idx_app_league_standings_team', sql: 'CREATE INDEX IF NOT EXISTS idx_app_league_standings_team ON app_league_standings (team_id)' },
    { name: 'idx_app_league_standings_filter', sql: 'CREATE INDEX IF NOT EXISTS idx_app_league_standings_filter ON app_league_standings (league_id, gender, birth_year)' },
  ],

  app_upcoming_schedule: [
    { name: 'idx_app_upcoming_schedule_id', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_app_upcoming_schedule_id ON app_upcoming_schedule (id)' },
    { name: 'idx_app_upcoming_schedule_date', sql: 'CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_date ON app_upcoming_schedule (match_date ASC)' },
    { name: 'idx_app_upcoming_schedule_filter', sql: 'CREATE INDEX IF NOT EXISTS idx_app_upcoming_schedule_filter ON app_upcoming_schedule (state, gender, birth_year)' },
  ],
};

// =============================================================================
// AUDIT FUNCTION - Check what indexes exist vs expected
// =============================================================================

async function auditIndexes() {
  console.log('=== MATERIALIZED VIEW INDEX AUDIT ===\n');

  const results = { missing: [], present: [] };

  for (const [viewName, indexes] of Object.entries(VIEW_INDEXES)) {
    // Check if view exists
    const { rows: viewCheck } = await pool.query(
      'SELECT 1 FROM pg_matviews WHERE matviewname = $1',
      [viewName]
    );

    if (viewCheck.length === 0) {
      console.log(`⚠️  ${viewName}: VIEW DOES NOT EXIST`);
      continue;
    }

    // Get existing indexes
    const { rows: existingIndexes } = await pool.query(
      'SELECT indexname FROM pg_indexes WHERE tablename = $1',
      [viewName]
    );
    const existingNames = new Set(existingIndexes.map(r => r.indexname));

    const missing = indexes.filter(idx => !existingNames.has(idx.name));
    const present = indexes.filter(idx => existingNames.has(idx.name));

    console.log(`${viewName}:`);
    console.log(`  Expected: ${indexes.length} | Present: ${present.length} | Missing: ${missing.length}`);

    if (missing.length > 0) {
      missing.forEach(idx => {
        console.log(`    ✗ ${idx.name}`);
        results.missing.push({ view: viewName, ...idx });
      });
    } else {
      console.log('    ✓ All indexes present');
    }

    results.present.push(...present.map(idx => ({ view: viewName, ...idx })));
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total indexes expected: ${Object.values(VIEW_INDEXES).flat().length}`);
  console.log(`Present: ${results.present.length}`);
  console.log(`Missing: ${results.missing.length}`);

  return results;
}

// =============================================================================
// FIX FUNCTION - Create missing indexes
// =============================================================================

async function fixIndexes(dryRun = false) {
  console.log(`=== ${dryRun ? 'DRY RUN: ' : ''}CREATING MISSING INDEXES ===\n`);

  const { missing } = await auditIndexes();

  if (missing.length === 0) {
    console.log('\n✅ No missing indexes. Database is healthy.');
    return;
  }

  console.log(`\n${dryRun ? 'Would create' : 'Creating'} ${missing.length} missing indexes...\n`);

  for (const idx of missing) {
    console.log(`${idx.view}.${idx.name}...`);

    if (dryRun) {
      console.log(`  [DRY RUN] Would execute: ${idx.sql.substring(0, 60)}...`);
    } else {
      const start = Date.now();
      try {
        await pool.query(idx.sql);
        console.log(`  ✓ Created in ${Date.now() - start}ms`);
      } catch (err) {
        console.log(`  ✗ Error: ${err.message}`);
      }
    }
  }

  if (!dryRun) {
    console.log('\n=== VERIFYING ===');
    await auditIndexes();
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const audit = args.includes('--audit');
  const fix = args.includes('--fix');
  const dryRun = args.includes('--dry-run');

  if (!audit && !fix) {
    console.log('Usage:');
    console.log('  node ensureViewIndexes.js --audit         # Check what indexes are missing');
    console.log('  node ensureViewIndexes.js --fix           # Create missing indexes');
    console.log('  node ensureViewIndexes.js --fix --dry-run # Preview without making changes');
    process.exit(0);
  }

  try {
    if (fix) {
      await fixIndexes(dryRun);
    } else if (audit) {
      await auditIndexes();
    }
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
