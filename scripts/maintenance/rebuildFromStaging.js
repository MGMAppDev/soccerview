/**
 * rebuildFromStaging.js
 *
 * Session 79 - V2 Architecture Enforcement - Phase F1
 *
 * Historical Data Reprocessing Orchestrator
 *
 * Creates parallel _rebuild tables and reprocesses ALL staging data
 * through the V2 pipeline (dataQualityEngine) into clean rebuild tables.
 *
 * This allows us to:
 * 1. Rebuild with CLEAN data using the V2 architecture
 * 2. Compare rebuild vs production before swapping
 * 3. Atomic swap when validated
 *
 * Usage:
 *   node scripts/maintenance/rebuildFromStaging.js --dry-run
 *   node scripts/maintenance/rebuildFromStaging.js --create-tables
 *   node scripts/maintenance/rebuildFromStaging.js --process --batch-size 10000
 *   node scripts/maintenance/rebuildFromStaging.js --status
 *
 * IMPORTANT: This does NOT modify production tables.
 * Use executeSwap.js after validation to perform the atomic swap.
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

const DRY_RUN = process.argv.includes('--dry-run');
const CREATE_TABLES = process.argv.includes('--create-tables');
const PROCESS = process.argv.includes('--process');
const STATUS = process.argv.includes('--status');
const BATCH_SIZE = parseInt(process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '10000');

async function showStatus() {
  console.log('='.repeat(60));
  console.log('REBUILD STATUS');
  console.log('='.repeat(60));
  console.log('');

  // Check if rebuild tables exist
  const { rows: tables } = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('teams_v2_rebuild', 'matches_v2_rebuild')
    ORDER BY table_name
  `);

  if (tables.length === 0) {
    console.log('❌ Rebuild tables do not exist');
    console.log('   Run: node scripts/maintenance/rebuildFromStaging.js --create-tables');
    return;
  }

  console.log('✅ Rebuild tables exist:');
  tables.forEach(t => console.log(`   - ${t.table_name}`));
  console.log('');

  // Get counts
  const { rows: counts } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2) as teams_prod,
      (SELECT COUNT(*) FROM teams_v2_rebuild) as teams_rebuild,
      (SELECT COUNT(*) FROM matches_v2) as matches_prod,
      (SELECT COUNT(*) FROM matches_v2_rebuild) as matches_rebuild,
      (SELECT COUNT(*) FROM staging_games) as staging_total,
      (SELECT COUNT(*) FROM staging_games WHERE processed = true) as staging_processed
  `);

  const c = counts[0];
  console.log('📊 COUNTS:');
  console.log('');
  console.log('   Staging:');
  console.log(`      Total: ${parseInt(c.staging_total).toLocaleString()}`);
  console.log(`      Processed: ${parseInt(c.staging_processed).toLocaleString()}`);
  console.log('');
  console.log('   Production vs Rebuild:');
  console.log(`      Teams:   ${parseInt(c.teams_prod).toLocaleString()} prod  |  ${parseInt(c.teams_rebuild).toLocaleString()} rebuild`);
  console.log(`      Matches: ${parseInt(c.matches_prod).toLocaleString()} prod  |  ${parseInt(c.matches_rebuild).toLocaleString()} rebuild`);
  console.log('');

  // Calculate progress
  const progress = parseInt(c.matches_rebuild) / Math.max(parseInt(c.matches_prod), 1) * 100;
  console.log(`   Progress: ${progress.toFixed(1)}%`);
  console.log('');
}

async function createRebuildTables() {
  console.log('='.repeat(60));
  console.log('CREATE REBUILD TABLES');
  console.log('='.repeat(60));
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN - Would create:');
    console.log('   - teams_v2_rebuild (copy of teams_v2 structure)');
    console.log('   - matches_v2_rebuild (copy of matches_v2 structure)');
    console.log('   - canonical_teams_rebuild');
    console.log('');
    return;
  }

  const client = await pool.connect();
  try {
    await authorizePipelineWrite(client);
    await client.query('BEGIN');

    // Drop existing rebuild tables if they exist
    console.log('📋 Dropping existing rebuild tables...');
    await client.query('DROP TABLE IF EXISTS matches_v2_rebuild CASCADE');
    await client.query('DROP TABLE IF EXISTS teams_v2_rebuild CASCADE');
    await client.query('DROP TABLE IF EXISTS canonical_teams_rebuild CASCADE');

    // Create teams_v2_rebuild as copy of teams_v2 structure
    console.log('📋 Creating teams_v2_rebuild...');
    await client.query(`
      CREATE TABLE teams_v2_rebuild (LIKE teams_v2 INCLUDING ALL)
    `);

    // Create matches_v2_rebuild as copy of matches_v2 structure
    console.log('📋 Creating matches_v2_rebuild...');
    await client.query(`
      CREATE TABLE matches_v2_rebuild (LIKE matches_v2 INCLUDING ALL)
    `);

    // Create canonical_teams_rebuild
    console.log('📋 Creating canonical_teams_rebuild...');
    await client.query(`
      CREATE TABLE canonical_teams_rebuild (LIKE canonical_teams INCLUDING ALL)
    `);

    // Add foreign key constraints
    console.log('📋 Adding foreign key constraints...');
    await client.query(`
      ALTER TABLE matches_v2_rebuild
        ADD CONSTRAINT matches_v2_rebuild_home_team_fkey
        FOREIGN KEY (home_team_id) REFERENCES teams_v2_rebuild(id)
    `);
    await client.query(`
      ALTER TABLE matches_v2_rebuild
        ADD CONSTRAINT matches_v2_rebuild_away_team_fkey
        FOREIGN KEY (away_team_id) REFERENCES teams_v2_rebuild(id)
    `);

    // Add indexes for performance
    console.log('📋 Creating indexes...');
    await client.query('CREATE INDEX idx_teams_v2_rebuild_display_name ON teams_v2_rebuild(display_name)');
    await client.query('CREATE INDEX idx_teams_v2_rebuild_birth_year ON teams_v2_rebuild(birth_year)');
    await client.query('CREATE INDEX idx_teams_v2_rebuild_gender ON teams_v2_rebuild(gender)');
    await client.query('CREATE INDEX idx_matches_v2_rebuild_source_key ON matches_v2_rebuild(source_match_key)');
    await client.query('CREATE INDEX idx_matches_v2_rebuild_date ON matches_v2_rebuild(match_date)');

    await client.query('COMMIT');
    console.log('');
    console.log('✅ Rebuild tables created successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function processStagingToRebuild() {
  console.log('='.repeat(60));
  console.log('PROCESS STAGING TO REBUILD TABLES');
  console.log('='.repeat(60));
  console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);
  console.log('');

  // Check rebuild tables exist
  const { rows: tables } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'teams_v2_rebuild'
  `);

  if (tables.length === 0) {
    console.log('❌ Rebuild tables do not exist');
    console.log('   Run: node scripts/maintenance/rebuildFromStaging.js --create-tables');
    return;
  }

  // Get staging count
  const { rows: countRows } = await pool.query('SELECT COUNT(*) as total FROM staging_games');
  const totalStaging = parseInt(countRows[0].total);
  console.log(`📊 Total staging records: ${totalStaging.toLocaleString()}`);

  // Get current rebuild count
  const { rows: rebuildCount } = await pool.query('SELECT COUNT(*) as total FROM matches_v2_rebuild');
  const currentRebuild = parseInt(rebuildCount[0].total);
  console.log(`📊 Current rebuild records: ${currentRebuild.toLocaleString()}`);
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN - Would process all staging records through V2 pipeline');
    console.log('   into teams_v2_rebuild and matches_v2_rebuild tables.');
    console.log('');
    console.log('   To execute:');
    console.log('   node scripts/maintenance/rebuildFromStaging.js --process');
    return;
  }

  // Process in batches
  let processed = 0;
  let offset = 0;
  const startTime = Date.now();

  console.log('🚀 Starting batch processing...');
  console.log('');

  while (offset < totalStaging) {
    console.log(`   Processing batch ${Math.floor(offset / BATCH_SIZE) + 1}... (offset: ${offset})`);

    // Get batch of staging records
    const { rows: batch } = await pool.query(`
      SELECT *
      FROM staging_games
      ORDER BY id
      LIMIT $1 OFFSET $2
    `, [BATCH_SIZE, offset]);

    if (batch.length === 0) break;

    // Process each record through the V2 normalizers
    // This is a simplified version - the full dataQualityEngine would be used in production
    for (const game of batch) {
      try {
        await processGameToRebuild(game);
        processed++;
      } catch (err) {
        console.error(`   ⚠️ Error processing game ${game.id}: ${err.message}`);
      }
    }

    offset += BATCH_SIZE;

    // Progress update
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const remaining = totalStaging - offset;
    const eta = remaining / rate;

    console.log(`      Processed: ${processed.toLocaleString()} | Rate: ${rate.toFixed(0)}/sec | ETA: ${(eta / 60).toFixed(1)} min`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`✅ Rebuild processing complete`);
  console.log(`   Total processed: ${processed.toLocaleString()}`);
  console.log(`   Time: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
}

async function processGameToRebuild(game) {
  // This is a simplified processor for the rebuild
  // In production, this would call the full dataQualityEngine logic

  const client = await pool.connect();
  try {
    await authorizePipelineWrite(client);
    // Normalize team names using the V2 normalizers
    const homeTeamName = normalizeTeamName(game.home_team_name);
    const awayTeamName = normalizeTeamName(game.away_team_name);

    // Extract birth year from team names
    const birthYear = extractBirthYear(homeTeamName) || game.birth_year;
    const gender = extractGender(homeTeamName) || game.gender || 'M';

    // Find or create home team
    const homeTeamId = await findOrCreateTeamRebuild(client, homeTeamName, birthYear, gender);
    const awayTeamId = await findOrCreateTeamRebuild(client, awayTeamName, birthYear, gender);

    // Generate source_match_key if not present
    const sourceMatchKey = game.source_match_key ||
      `rebuild-${game.source || 'unknown'}-${game.id}`;

    // Insert match into rebuild table
    await client.query(`
      INSERT INTO matches_v2_rebuild (
        source_match_key, match_date, match_time,
        home_team_id, away_team_id,
        home_score, away_score,
        league_id, tournament_id,
        source, status, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (source_match_key) DO NOTHING
    `, [
      sourceMatchKey,
      game.match_date,
      game.match_time,
      homeTeamId,
      awayTeamId,
      game.home_score,
      game.away_score,
      game.league_id,
      game.tournament_id,
      game.source,
      game.status || 'completed'
    ]);

  } finally {
    client.release();
  }
}

async function findOrCreateTeamRebuild(client, name, birthYear, gender) {
  // Try to find existing team
  const { rows: existing } = await client.query(`
    SELECT id FROM teams_v2_rebuild
    WHERE display_name = $1
      AND (birth_year = $2 OR birth_year IS NULL OR $2 IS NULL)
      AND (gender = $3 OR gender IS NULL OR $3 IS NULL)
    LIMIT 1
  `, [name, birthYear, gender]);

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Create new team
  const { rows: newTeam } = await client.query(`
    INSERT INTO teams_v2_rebuild (
      display_name, birth_year, gender,
      elo_rating, matches_played, wins, losses, draws,
      created_at, updated_at
    )
    VALUES ($1, $2, $3, 1500, 0, 0, 0, 0, NOW(), NOW())
    RETURNING id
  `, [name, birthYear, gender]);

  return newTeam[0].id;
}

// V2 Normalizer functions (simplified versions)
function normalizeTeamName(name) {
  if (!name) return 'Unknown Team';

  let normalized = name.trim();

  // Remove duplicate prefixes (e.g., "One FC One FC" -> "One FC")
  const words = normalized.split(/\s+/);
  if (words.length >= 4) {
    const firstTwo = words.slice(0, 2).join(' ');
    const nextTwo = words.slice(2, 4).join(' ');
    if (firstTwo.toLowerCase() === nextTwo.toLowerCase()) {
      normalized = [firstTwo, ...words.slice(4)].join(' ');
    }
  }

  // Remove trailing whitespace and normalize spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

function extractBirthYear(name) {
  if (!name) return null;

  // Try birth year pattern (2014, 2015, etc.)
  const birthYearMatch = name.match(/\b(20[0-2]\d)\b/);
  if (birthYearMatch) {
    return parseInt(birthYearMatch[1]);
  }

  // Try age group pattern (U11, U-12, etc.)
  const ageGroupMatch = name.match(/\bU[-\s]?(\d{1,2})\b/i);
  if (ageGroupMatch) {
    const age = parseInt(ageGroupMatch[1]);
    // Assume current season year 2026, calculate birth year
    return 2026 - age;
  }

  return null;
}

function extractGender(name) {
  if (!name) return null;

  const lowerName = name.toLowerCase();
  if (lowerName.includes('boys') || lowerName.includes('(b)') || /\bb\d{4}\b/.test(lowerName)) {
    return 'M';
  }
  if (lowerName.includes('girls') || lowerName.includes('(g)') || /\bg\d{4}\b/.test(lowerName)) {
    return 'F';
  }

  return null;
}

async function main() {
  console.log('='.repeat(60));
  console.log('REBUILD FROM STAGING');
  console.log('Session 79 - V2 Architecture Enforcement');
  console.log('='.repeat(60));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  try {
    if (STATUS || (!CREATE_TABLES && !PROCESS)) {
      await showStatus();
    } else if (CREATE_TABLES) {
      await createRebuildTables();
    } else if (PROCESS) {
      await processStagingToRebuild();
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
