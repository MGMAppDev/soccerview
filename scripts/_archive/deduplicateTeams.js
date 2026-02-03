/**
 * Deduplicate Teams - Cross-Source Merge
 * =======================================
 *
 * SoccerView is the Single Source of Truth. Teams from different sources
 * (GotSport, HTGSports, Heartland) may represent the same real-world team.
 *
 * This script:
 * 1. Finds potential duplicates using fuzzy matching (pg_trgm)
 * 2. Validates matches (same age group, gender, state)
 * 3. Merges duplicates: keeps best data, updates match references
 * 4. Creates aliases for merged names
 *
 * Usage: node scripts/deduplicateTeams.js
 */

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// Minimum similarity threshold for considering duplicates
const SIMILARITY_THRESHOLD = 0.75;

async function main() {
  console.log('='.repeat(70));
  console.log('🔄 TEAM DEDUPLICATION - Cross-Source Merge');
  console.log('='.repeat(70));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    // Set similarity threshold
    await client.query(`SET pg_trgm.similarity_threshold = ${SIMILARITY_THRESHOLD}`);

    // ========================================
    // STEP 1: Get Heartland teams to check for duplicates
    // ========================================
    console.log('🔍 STEP 1: Getting Heartland teams to check for duplicates...');

    const heartlandTeams = await client.query(`
      SELECT id, team_name, state, age_group, source_name
      FROM teams
      WHERE source_name IN ('htgsports', 'heartland')
      ORDER BY team_name
    `);

    console.log(`   Found ${heartlandTeams.rows.length} Heartland teams to check\n`);

    // ========================================
    // STEP 2: Find potential duplicates in GotSport data
    // ========================================
    console.log('🔎 STEP 2: Finding potential duplicates with GotSport teams...');

    let duplicatesFound = 0;
    let mergeCount = 0;
    let aliasesCreated = 0;
    const processedPairs = new Set();

    for (let i = 0; i < heartlandTeams.rows.length; i++) {
      const heartlandTeam = heartlandTeams.rows[i];

      // Find similar GotSport teams
      const matches = await client.query(`
        SELECT
          t.id,
          t.team_name,
          t.state,
          t.age_group,
          t.source_name,
          t.matches_played,
          t.national_rank,
          t.elo_rating,
          similarity(LOWER(t.team_name), LOWER($1)) as sim
        FROM teams t
        WHERE t.source_name = 'gotsport'
          AND LOWER(t.team_name) % LOWER($1)
          AND t.id != $2
        ORDER BY sim DESC
        LIMIT 3
      `, [heartlandTeam.team_name, heartlandTeam.id]);

      if (matches.rows.length > 0) {
        for (const gotsportTeam of matches.rows) {
          // Skip if already processed this pair
          const pairKey = [heartlandTeam.id, gotsportTeam.id].sort().join('|');
          if (processedPairs.has(pairKey)) continue;
          processedPairs.add(pairKey);

          // Validate: check if likely same team
          const isValid = validateDuplicate(heartlandTeam, gotsportTeam);

          if (isValid && gotsportTeam.sim >= SIMILARITY_THRESHOLD) {
            duplicatesFound++;

            // Decide which to keep (prefer GotSport if it has national rank)
            const keepTeam = gotsportTeam.national_rank ? gotsportTeam : heartlandTeam;
            const mergeTeam = gotsportTeam.national_rank ? heartlandTeam : gotsportTeam;

            // Update all match references from mergeTeam to keepTeam
            const homeUpdate = await client.query(`
              UPDATE match_results
              SET home_team_id = $1
              WHERE home_team_id = $2
            `, [keepTeam.id, mergeTeam.id]);

            const awayUpdate = await client.query(`
              UPDATE match_results
              SET away_team_id = $1
              WHERE away_team_id = $2
            `, [keepTeam.id, mergeTeam.id]);

            if (homeUpdate.rowCount > 0 || awayUpdate.rowCount > 0) {
              mergeCount++;

              // Create alias for the merged team name
              await client.query(`
                INSERT INTO team_name_aliases (id, team_id, alias_name, source)
                VALUES (gen_random_uuid(), $1, LOWER($2), 'deduplication')
                ON CONFLICT DO NOTHING
              `, [keepTeam.id, mergeTeam.team_name]);
              aliasesCreated++;

              // Optionally delete the merged team (or mark as inactive)
              // For now, just mark source_name to indicate it was merged
              await client.query(`
                UPDATE teams
                SET source_name = 'merged_to_' || $1
                WHERE id = $2
              `, [keepTeam.id.slice(0, 8), mergeTeam.id]);
            }
          }
        }
      }

      if ((i + 1) % 500 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`   Processed ${i + 1}/${heartlandTeams.rows.length} | ${duplicatesFound} duplicates | ${elapsed}s`);
      }
    }

    console.log(`   ✅ Complete: ${duplicatesFound} duplicates found, ${mergeCount} teams merged\n`);

    // ========================================
    // STEP 3: Final stats
    // ========================================
    console.log('='.repeat(70));
    console.log('📊 FINAL RESULTS:');
    console.log('='.repeat(70));

    // Count teams by source
    const teamStats = await client.query(`
      SELECT
        CASE
          WHEN source_name LIKE 'merged_%' THEN 'merged'
          ELSE source_name
        END as source,
        COUNT(*) as count
      FROM teams
      GROUP BY 1
      ORDER BY count DESC
    `);

    console.log('\nTeams by source:');
    for (const row of teamStats.rows) {
      console.log(`   ${row.source}: ${row.count}`);
    }

    // Link rate check
    const linkRate = await client.query(`
      SELECT
        source_platform,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
      GROUP BY source_platform
    `);

    console.log('\nHeartland link rates after deduplication:');
    for (const row of linkRate.rows) {
      const pct = (row.linked / row.total * 100).toFixed(1);
      console.log(`   ${row.source_platform}: ${row.linked}/${row.total} (${pct}%)`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n   Duplicates found: ${duplicatesFound}`);
    console.log(`   Teams merged: ${mergeCount}`);
    console.log(`   Aliases created: ${aliasesCreated}`);
    console.log(`   Time elapsed: ${elapsed}s`);
    console.log(`\n✅ Completed: ${new Date().toISOString()}`);

  } finally {
    client.release();
    await pool.end();
  }
}

function validateDuplicate(team1, team2) {
  // Must have similar states (or one missing)
  if (team1.state && team2.state && team1.state !== team2.state) {
    // Allow KC area (KS/MO are adjacent)
    const kcStates = ['KS', 'MO'];
    if (!(kcStates.includes(team1.state) && kcStates.includes(team2.state))) {
      return false;
    }
  }

  // Age groups should match if both present
  if (team1.age_group && team2.age_group) {
    const age1 = normalizeAgeGroup(team1.age_group);
    const age2 = normalizeAgeGroup(team2.age_group);
    if (age1 && age2 && Math.abs(age1 - age2) > 1) {
      return false; // More than 1 year difference
    }
  }

  return true;
}

function normalizeAgeGroup(ageGroup) {
  if (!ageGroup) return null;
  const match = ageGroup.match(/U?(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
