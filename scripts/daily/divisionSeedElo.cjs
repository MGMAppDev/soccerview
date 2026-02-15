/**
 * Division-Seeded Starting ELO v1.0
 * ==================================
 *
 * Session 95: Solves the closed-pool problem where undefeated teams
 * in low divisions rank above competitive teams in top divisions.
 *
 * Algorithm:
 *   seed_elo = 1500 + (median_division - team_division) * DIVISION_STEP
 *
 * Auto-calculated per league. ZERO source-specific code.
 * Reads from league_standings.division (authoritative local league data).
 *
 * Usage:
 *   Called by recalculate_elo_v2.js as Step 1.5 (after reset, before matches).
 *   Can also run standalone: node scripts/daily/divisionSeedElo.cjs
 */

require('dotenv').config();

const DIVISION_STEP = 15;

/**
 * Named tier ordinals for leagues using word-based divisions.
 * Lower number = higher tier.
 * Universal — covers patterns across all known US premier leagues.
 */
const NAMED_TIER_ORDINALS = {
  'premier': 1,
  'elite': 1,
  'championship': 2,
  'classic': 3,
  'select': 4,
  'academy': 5,
  // Color-based tiers (NorCal, Cal North)
  'super gold': 1,
  'platinum': 1,
  'gold': 2,
  'silver': 3,
  'bronze': 4,
  'copper': 5,
  // Ordinal tiers (NCYSA Classic)
  '1st': 2,
  '1st division': 2,
  '2nd': 3,
  '2nd division': 3,
  '3rd': 4,
  '3rd division': 4,
  '4th': 5,
  '4th division': 5,
  // Flight-based (various)
  'flight a': 1,
  'flight b': 2,
  'flight c': 3,
};

/**
 * Extract a numeric tier from division text.
 * Handles: "Division 7", "Subdivision 3", "Div 2a", "Premier", "1st", "Gold", etc.
 *
 * @param {string} divisionText - Raw division string from league_standings
 * @returns {number|null} - Numeric tier (1 = highest), or null if unparseable
 */
function extractNumericTier(divisionText) {
  if (!divisionText) return null;
  const lower = divisionText.toLowerCase().trim();

  // 1. Check named tiers first (exact match or contained)
  for (const [name, ordinal] of Object.entries(NAMED_TIER_ORDINALS)) {
    if (lower === name || lower.startsWith(name + ' ') || lower.includes(name)) {
      return ordinal;
    }
  }

  // 2. Extract numeric: "Division 7", "Subdivision 3", "Div 2", "Tier 5"
  const numericMatch = lower.match(/(?:division|subdivision|div|tier)\s*(\d+)/);
  if (numericMatch) return parseInt(numericMatch[1], 10);

  // 3. Handle sub-tier: "Div 2a" → 2, "2b" → 2 (sub-tiers share the same seed)
  const subTierMatch = lower.match(/(?:div|division)\s*(\d+)[a-z]?/);
  if (subTierMatch) return parseInt(subTierMatch[1], 10);

  // 4. Bare number: "1", "14"
  const bareNum = lower.match(/^(\d+)$/);
  if (bareNum) return parseInt(bareNum[1], 10);

  return null;
}

/**
 * Build a map of team_id → seeded ELO from league_standings data.
 *
 * Groups teams by league (league_id), determines tier structure,
 * calculates median, and applies the seeding formula.
 *
 * @param {pg.Client} client - PostgreSQL client
 * @param {string} seasonStart - Season start date (YYYY-MM-DD)
 * @returns {Map<string, number>} - team_id → seeded ELO
 */
async function buildDivisionSeedMap(client, seasonStart) {
  // Get all league_standings entries with team linkage
  const result = await client.query(`
    SELECT
      ls.team_id,
      ls.division,
      ls.league_id,
      l.name as league_name
    FROM league_standings ls
    JOIN leagues l ON l.id = ls.league_id
    WHERE ls.team_id IS NOT NULL
      AND ls.division IS NOT NULL
    ORDER BY ls.league_id, ls.division
  `);

  if (result.rows.length === 0) {
    console.log('   No league standings with division data found');
    return new Map();
  }

  // Group by league
  const leagueMap = new Map(); // league_id → [{ team_id, division, tier }]
  for (const row of result.rows) {
    const tier = extractNumericTier(row.division);
    if (tier === null) continue;

    if (!leagueMap.has(row.league_id)) {
      leagueMap.set(row.league_id, { name: row.league_name, teams: [] });
    }
    leagueMap.get(row.league_id).teams.push({
      team_id: row.team_id,
      division: row.division,
      tier,
    });
  }

  // Calculate seeds per league
  const seedMap = new Map(); // team_id → seeded ELO
  let totalSeeded = 0;

  for (const [leagueId, league] of leagueMap) {
    const teams = league.teams;
    if (teams.length === 0) continue;

    // Find unique tiers and calculate median
    const tiers = [...new Set(teams.map(t => t.tier))].sort((a, b) => a - b);
    const medianTier = tiers[Math.floor(tiers.length / 2)];

    // Apply seeding formula: seed = 1500 + (median - tier) * STEP
    for (const team of teams) {
      const seed = 1500 + (medianTier - team.tier) * DIVISION_STEP;
      seedMap.set(team.team_id, seed);
      totalSeeded++;
    }

    // Log per league
    const minTier = Math.min(...tiers);
    const maxTier = Math.max(...tiers);
    const minSeed = 1500 + (medianTier - maxTier) * DIVISION_STEP;
    const maxSeed = 1500 + (medianTier - minTier) * DIVISION_STEP;
    console.log(`   ${league.name}: ${tiers.length} tiers (${minTier}-${maxTier}), median=${medianTier}, seeds ${minSeed}-${maxSeed}, ${teams.length} teams`);
  }

  console.log(`   Total teams seeded: ${totalSeeded}`);
  return seedMap;
}

/**
 * Apply division-seeded ELO ratings to teams_v2 in a batch UPDATE.
 *
 * @param {pg.Client} client - PostgreSQL client
 * @param {Map<string, number>} seedMap - team_id → seeded ELO
 * @returns {number} - Number of teams updated
 */
async function applyDivisionSeeds(client, seedMap) {
  if (seedMap.size === 0) return 0;

  const entries = Array.from(seedMap.entries());
  const BATCH_SIZE = 500;
  let updated = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    const ids = batch.map(([id]) => `'${id}'`).join(',');
    let eloCase = 'CASE id ';
    for (const [id, elo] of batch) {
      eloCase += `WHEN '${id}' THEN ${elo.toFixed(1)} `;
    }
    eloCase += 'END';

    await client.query(`
      UPDATE teams_v2
      SET elo_rating = ${eloCase}
      WHERE id IN (${ids})
    `);

    updated += batch.length;
  }

  return updated;
}

// Export for use by recalculate_elo_v2.js
module.exports = {
  DIVISION_STEP,
  NAMED_TIER_ORDINALS,
  extractNumericTier,
  buildDivisionSeedMap,
  applyDivisionSeeds,
};

// Standalone execution
if (require.main === module) {
  const pg = require('pg');

  async function main() {
    console.log('='.repeat(60));
    console.log('DIVISION-SEEDED ELO (Standalone)');
    console.log('='.repeat(60));
    console.log(`DIVISION_STEP: ${DIVISION_STEP}`);
    console.log('');

    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();
      console.log('Connected to PostgreSQL\n');

      // Get season start
      const seasonResult = await client.query(
        `SELECT start_date::text FROM seasons WHERE is_current = true LIMIT 1`
      );
      const seasonStart = seasonResult.rows[0]?.start_date || '2025-08-01';
      console.log(`Season start: ${seasonStart}\n`);

      // Build seed map
      console.log('Building division seed map...');
      const seedMap = await buildDivisionSeedMap(client, seasonStart);

      if (seedMap.size === 0) {
        console.log('\nNo teams to seed. Ensure league_standings has division data.');
        return;
      }

      // Apply seeds
      console.log(`\nApplying ${seedMap.size} division seeds...`);
      const updated = await applyDivisionSeeds(client, seedMap);
      console.log(`Updated ${updated} teams`);

      // Show sample
      const sample = await client.query(`
        SELECT display_name, elo_rating
        FROM teams_v2
        WHERE id = ANY($1::uuid[])
        ORDER BY elo_rating DESC
        LIMIT 10
      `, [Array.from(seedMap.keys()).slice(0, 10)]);

      console.log('\nSample seeded teams:');
      for (const row of sample.rows) {
        console.log(`  ${row.display_name}: ${parseFloat(row.elo_rating).toFixed(1)}`);
      }

    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      await client.end();
    }
  }

  main();
}
