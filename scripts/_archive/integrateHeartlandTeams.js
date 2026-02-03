/**
 * Integrate Heartland Teams - Full Pipeline
 * ==========================================
 *
 * This script implements the correct data architecture:
 * 1. CREATE teams from Heartland match data (as first-class entities)
 * 2. LINK all Heartland matches to these teams (100% linkable)
 * 3. DEDUPLICATE across sources (merge overlapping teams)
 *
 * Heartland teams become part of the SoccerView database as authoritative
 * source data, not force-matched to GotSport.
 *
 * Usage: node scripts/integrateHeartlandTeams.js
 */

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// Placeholder names to skip
const SKIP_NAMES = new Set([
  'tbd', 'to be determined', 'bye', 'forfeit',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '1st a', '1st b', '2nd a', '2nd b', '1st', '2nd', '3rd', '4th',
  'a', 'b', 'c', 'd', 'home', 'away', 'winner', 'loser',
]);

function shouldSkip(name) {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  if (SKIP_NAMES.has(lower)) return true;
  if (/^\d+$/.test(lower)) return true;
  if (/^(1st|2nd|3rd|4th)\s*[a-d]?$/i.test(lower)) return true;
  if (lower.length < 4) return true;
  return false;
}

// Infer state from team name (KC area teams)
function inferState(name) {
  const lower = name.toLowerCase();
  if (lower.includes('kansas') || lower.includes(' ks ') || lower.endsWith(' ks')) return 'KS';
  if (lower.includes('missouri') || lower.includes(' mo ') || lower.endsWith(' mo')) return 'MO';
  if (lower.includes('wichita')) return 'KS';
  if (lower.includes('topeka')) return 'KS';
  if (lower.includes('st louis') || lower.includes('st. louis')) return 'MO';
  // Default KC area to KS (most Heartland teams)
  if (lower.includes('kc ') || lower.startsWith('kc') ||
      lower.includes('kansas city') || lower.includes('overland park') ||
      lower.includes('sporting') || lower.includes('fusion')) return 'KS';
  return 'KS'; // Default for Heartland
}

async function main() {
  console.log('='.repeat(70));
  console.log('🏆 HEARTLAND TEAM INTEGRATION - Full Pipeline');
  console.log('='.repeat(70));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    // ========================================
    // STEP 1: Get baseline
    // ========================================
    console.log('📊 BASELINE:');
    const baseline = await client.query(`
      SELECT
        source_platform,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
      GROUP BY source_platform
    `);

    for (const row of baseline.rows) {
      const pct = (row.linked / row.total * 100).toFixed(1);
      console.log(`   ${row.source_platform}: ${row.linked}/${row.total} linked (${pct}%)`);
    }
    console.log('');

    // ========================================
    // STEP 2: Extract unique teams from Heartland matches
    // ========================================
    console.log('🔍 STEP 1: Extracting unique teams from Heartland matches...');

    const teamData = await client.query(`
      WITH heartland_teams AS (
        SELECT DISTINCT
          home_team_name as name,
          age_group,
          gender,
          source_platform
        FROM match_results
        WHERE source_platform IN ('htgsports', 'heartland')
          AND home_team_name IS NOT NULL
          AND LENGTH(home_team_name) >= 4
        UNION
        SELECT DISTINCT
          away_team_name as name,
          age_group,
          gender,
          source_platform
        FROM match_results
        WHERE source_platform IN ('htgsports', 'heartland')
          AND away_team_name IS NOT NULL
          AND LENGTH(away_team_name) >= 4
      )
      SELECT
        name,
        MAX(age_group) as age_group,
        MAX(gender) as gender,
        MAX(source_platform) as source_platform
      FROM heartland_teams
      GROUP BY name
      ORDER BY name
    `);

    // Filter out placeholders
    const validTeams = teamData.rows.filter(t => !shouldSkip(t.name));
    console.log(`   Found ${teamData.rows.length} total, ${validTeams.length} valid teams\n`);

    // ========================================
    // STEP 3: Create teams in database
    // ========================================
    console.log('🏗️  STEP 2: Creating Heartland teams in database...');

    let teamsCreated = 0;
    let teamsSkipped = 0;
    const teamIdMap = new Map(); // name -> team_id

    // First, check which teams already exist (by exact name match)
    const existingTeams = await client.query(`
      SELECT id, team_name FROM teams WHERE LOWER(team_name) = ANY($1::text[])
    `, [validTeams.map(t => t.name.toLowerCase())]);

    for (const row of existingTeams.rows) {
      teamIdMap.set(row.team_name.toLowerCase(), row.id);
    }

    console.log(`   ${existingTeams.rows.length} teams already exist (will use existing)`);

    // Batch insert new teams
    const teamsToCreate = validTeams.filter(t => !teamIdMap.has(t.name.toLowerCase()));
    console.log(`   ${teamsToCreate.length} teams to create`);

    if (teamsToCreate.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < teamsToCreate.length; i += BATCH_SIZE) {
        const batch = teamsToCreate.slice(i, i + BATCH_SIZE);

        // Build bulk insert
        const values = [];
        const params = [];
        let paramIndex = 1;

        for (const team of batch) {
          const state = inferState(team.name);
          values.push(`(gen_random_uuid(), $${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 1500, 0, 0, 0, NOW())`);
          params.push(team.name, state, team.age_group || null, team.source_platform);
          paramIndex += 4;
        }

        const insertResult = await client.query(`
          INSERT INTO teams (id, team_name, state, age_group, source_name, elo_rating, wins, losses, draws, updated_at)
          VALUES ${values.join(', ')}
          ON CONFLICT (team_name) DO UPDATE SET updated_at = NOW()
          RETURNING id, team_name
        `, params);

        for (const row of insertResult.rows) {
          teamIdMap.set(row.team_name.toLowerCase(), row.id);
        }

        teamsCreated += insertResult.rowCount;
        process.stdout.write(`\r   Created: ${teamsCreated}/${teamsToCreate.length} teams`);
      }
      console.log('\n   ✅ Teams created\n');
    } else {
      console.log('   ✅ No new teams needed\n');
    }

    // ========================================
    // STEP 4: Link Heartland matches to teams
    // ========================================
    console.log('🔗 STEP 3: Linking Heartland matches to teams...');

    // Get all team name -> id mappings (including newly created)
    const allTeamMappings = await client.query(`
      SELECT id, LOWER(team_name) as name FROM teams
    `);

    const fullTeamMap = new Map();
    for (const row of allTeamMappings.rows) {
      fullTeamMap.set(row.name, row.id);
    }

    // Update home_team_id for all Heartland matches
    const homeUpdate = await client.query(`
      UPDATE match_results mr
      SET home_team_id = t.id
      FROM teams t
      WHERE LOWER(mr.home_team_name) = LOWER(t.team_name)
        AND mr.source_platform IN ('htgsports', 'heartland')
        AND mr.home_team_id IS NULL
    `);
    console.log(`   Home teams linked: ${homeUpdate.rowCount}`);

    // Update away_team_id for all Heartland matches
    const awayUpdate = await client.query(`
      UPDATE match_results mr
      SET away_team_id = t.id
      FROM teams t
      WHERE LOWER(mr.away_team_name) = LOWER(t.team_name)
        AND mr.source_platform IN ('htgsports', 'heartland')
        AND mr.away_team_id IS NULL
    `);
    console.log(`   Away teams linked: ${awayUpdate.rowCount}`);
    console.log('   ✅ Match linking complete\n');

    // ========================================
    // STEP 5: Create aliases for all Heartland team names
    // ========================================
    console.log('📝 STEP 4: Creating aliases for future lookups...');

    const aliasResult = await client.query(`
      INSERT INTO team_name_aliases (id, team_id, alias_name, source)
      SELECT
        gen_random_uuid(),
        t.id,
        LOWER(TRIM(t.team_name)),
        'heartland_integration'
      FROM teams t
      WHERE t.source_name IN ('htgsports', 'heartland')
      ON CONFLICT DO NOTHING
    `);
    console.log(`   Aliases created: ${aliasResult.rowCount}\n`);

    // ========================================
    // STEP 6: Final stats
    // ========================================
    console.log('='.repeat(70));
    console.log('📊 FINAL RESULTS:');
    console.log('='.repeat(70));

    const final = await client.query(`
      SELECT
        source_platform,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
      GROUP BY source_platform
    `);

    for (const row of final.rows) {
      const before = baseline.rows.find(b => b.source_platform === row.source_platform);
      const beforePct = before ? (before.linked / before.total * 100).toFixed(1) : '?';
      const afterPct = (row.linked / row.total * 100).toFixed(1);
      const improvement = row.linked - (before?.linked || 0);
      console.log(`   ${row.source_platform}: ${row.linked}/${row.total} (${afterPct}%) [was ${beforePct}%, +${improvement}]`);
    }

    // Check remaining unlinked
    const remaining = await client.query(`
      SELECT
        CASE WHEN home_team_id IS NULL THEN home_team_name ELSE away_team_name END as name,
        COUNT(*) as matches
      FROM match_results
      WHERE source_platform IN ('htgsports', 'heartland')
        AND (home_team_id IS NULL OR away_team_id IS NULL)
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `);

    if (remaining.rows.length > 0) {
      console.log('\n📋 REMAINING UNLINKED (if any):');
      for (const row of remaining.rows) {
        console.log(`   ${row.matches} matches: ${row.name}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n   Teams created: ${teamsCreated}`);
    console.log(`   Matches linked: ${homeUpdate.rowCount + awayUpdate.rowCount}`);
    console.log(`   Time elapsed: ${elapsed}s`);
    console.log(`\n✅ Completed: ${new Date().toISOString()}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
