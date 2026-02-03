/**
 * Populate Clubs from Teams
 * =========================
 *
 * Fills in missing club_id references in teams_v2 by:
 * 1. Extracting club names from team canonical_name using clubNormalizer
 * 2. Finding or creating matching clubs
 * 3. Updating teams_v2.club_id
 *
 * Usage:
 *   node scripts/onetime/populateClubs.js [--dry-run] [--limit N] [--verbose]
 *
 * Options:
 *   --dry-run    Show what would be done without making changes
 *   --limit N    Process only N teams (default: all)
 *   --verbose    Show detailed progress
 */

import pg from 'pg';
import 'dotenv/config';
import { normalizeClub } from '../universal/normalizers/clubNormalizer.js';
import { authorizePipelineWrite } from '../universal/pipelineAuth.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ===========================================
// MAIN LOGIC
// ===========================================

/**
 * Find existing club by name and state, or by normalized name
 */
async function findClub(clubName, state, client) {
  // Try exact match first
  const { rows: exact } = await client.query(`
    SELECT id, name, state FROM clubs
    WHERE LOWER(name) = LOWER($1)
    AND (state = $2 OR state = 'XX' OR $2 = 'XX')
    LIMIT 1
  `, [clubName, state]);

  if (exact.length > 0) {
    return exact[0];
  }

  // Try normalized name match
  const normalizedName = clubName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const { rows: normalized } = await client.query(`
    SELECT id, name, state FROM clubs
    WHERE LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9\\s]', '', 'g')) = $1
    AND (state = $2 OR state = 'XX' OR $2 = 'XX')
    LIMIT 1
  `, [normalizedName, state]);

  if (normalized.length > 0) {
    return normalized[0];
  }

  return null;
}

/**
 * Create a new club
 */
async function createClub(clubName, state, client) {
  const { rows } = await client.query(`
    INSERT INTO clubs (name, state)
    VALUES ($1, $2)
    RETURNING id, name, state
  `, [clubName, state || 'XX']);

  return rows[0];
}

/**
 * Process teams without club_id
 */
async function populateClubs(options = {}) {
  const { dryRun = false, limit = null, verbose = false } = options;

  console.log('🏢 POPULATE CLUBS');
  console.log('='.repeat(40));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️  EXECUTE'}`);
  if (limit) console.log(`Limit: ${limit} teams`);
  console.log();

  const client = await pool.connect();

  // Authorize writes to protected tables
  await authorizePipelineWrite(client);

  const stats = {
    teamsProcessed: 0,
    clubsFound: 0,
    clubsCreated: 0,
    teamsLinked: 0,
    errors: [],
  };

  try {
    // Get teams without club_id
    let query = `
      SELECT id, canonical_name, display_name, state
      FROM teams_v2
      WHERE club_id IS NULL
      AND canonical_name IS NOT NULL
      ORDER BY matches_played DESC NULLS LAST
    `;
    if (limit) {
      query += ` LIMIT ${parseInt(limit)}`;
    }

    const { rows: teams } = await client.query(query);
    console.log(`📋 Found ${teams.length} teams without club_id\n`);

    if (teams.length === 0) {
      console.log('✅ All teams already have club_id!');
      return stats;
    }

    // Build club cache for performance
    const clubCache = new Map(); // key: 'normalized_name|state' -> club

    // Process in batches
    const batchSize = 100;
    const batches = Math.ceil(teams.length / batchSize);

    for (let b = 0; b < batches; b++) {
      const batch = teams.slice(b * batchSize, (b + 1) * batchSize);

      if (!dryRun) {
        await client.query('BEGIN');
      }

      try {
        for (const team of batch) {
          stats.teamsProcessed++;

          // Extract club name using normalizer
          const clubData = normalizeClub({
            team_name: team.canonical_name || team.display_name,
            state: team.state,
          });

          if (!clubData.club_name) {
            if (verbose) {
              console.log(`   ⚠️  No club name extracted: ${team.canonical_name}`);
            }
            continue;
          }

          const cacheKey = `${clubData.normalized_name}|${team.state || 'XX'}`;
          let club = clubCache.get(cacheKey);

          if (!club) {
            // Try to find existing club
            club = await findClub(clubData.club_name, team.state || 'XX', client);

            if (club) {
              stats.clubsFound++;
              clubCache.set(cacheKey, club);
              if (verbose) {
                console.log(`   Found: ${club.name} (${club.state}) for ${team.canonical_name}`);
              }
            } else {
              // Create new club
              if (!dryRun) {
                club = await createClub(clubData.club_name, team.state || 'XX', client);
                clubCache.set(cacheKey, club);
              } else {
                club = { id: 'DRY-RUN', name: clubData.club_name, state: team.state || 'XX' };
              }
              stats.clubsCreated++;
              if (verbose) {
                console.log(`   Created: ${club.name} (${club.state}) for ${team.canonical_name}`);
              }
            }
          }

          // Link team to club
          if (!dryRun) {
            await client.query(`
              UPDATE teams_v2
              SET club_id = $1
              WHERE id = $2
            `, [club.id, team.id]);
          }
          stats.teamsLinked++;
        }

        if (!dryRun) {
          await client.query('COMMIT');
        }

      } catch (error) {
        if (!dryRun) {
          await client.query('ROLLBACK');
        }
        stats.errors.push({ batch: b, error: error.message });
        console.error(`   ❌ Batch ${b} error: ${error.message}`);
      }

      // Progress
      if ((b + 1) % 10 === 0 || b === batches - 1) {
        const pct = Math.round(((b + 1) / batches) * 100);
        console.log(`   Progress: ${pct}% (${stats.teamsProcessed} teams, ${stats.clubsCreated} new clubs)`);
      }
    }

    // Summary
    console.log('\n📊 RESULTS:');
    console.log(`   Teams processed: ${stats.teamsProcessed}`);
    console.log(`   Existing clubs found: ${stats.clubsFound}`);
    console.log(`   New clubs ${dryRun ? 'would be ' : ''}created: ${stats.clubsCreated}`);
    console.log(`   Teams ${dryRun ? 'would be ' : ''}linked: ${stats.teamsLinked}`);

    if (stats.errors.length > 0) {
      console.log(`   Errors: ${stats.errors.length}`);
    }

    if (dryRun) {
      console.log('\n⚠️  DRY RUN - No changes made. Use without --dry-run to execute.');
    }

    return stats;

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
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1]) : null;

  if (args.includes('--help')) {
    console.log(`
Populate Clubs from Teams
=========================

Usage:
  node scripts/onetime/populateClubs.js [--dry-run] [--limit N] [--verbose]

Options:
  --dry-run    Show what would be done without making changes
  --limit N    Process only N teams (default: all)
  --verbose    Show detailed progress
  --help       Show this help
`);
    await pool.end();
    return;
  }

  try {
    await populateClubs({ dryRun, limit, verbose });
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
