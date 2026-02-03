/**
 * Fix Team Data Integrity
 * =======================
 *
 * Comprehensive fix for data integrity issues:
 * 1. Merge duplicate team records
 * 2. Deduplicate match records
 * 3. Re-link all matches to canonical team
 * 4. Update team stats
 *
 * Usage: node scripts/fixTeamDataIntegrity.js
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL required");
  process.exit(1);
}

// Teams to merge - CANONICAL team first, then duplicates to merge into it
const CANONICAL_TEAM = {
  id: 'cc329f08-1f57-4a7b-923a-768b2138fa92',
  name: 'Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)'
};

const DUPLICATE_TEAMS = [
  {
    id: '9c144013-2672-4669-8575-7d6fa1452251',
    name: 'SPORTING BV Pre-NAL 15'
  }
];

// Match name patterns to link (case-insensitive)
const TEAM_NAME_PATTERNS = [
  '%SPORTING BV Pre-NAL 15%',
  '%Sporting Blue Valley%Pre-NAL 15%'
];

async function main() {
  console.log('='.repeat(70));
  console.log('FIX TEAM DATA INTEGRITY');
  console.log('='.repeat(70));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Canonical Team: ${CANONICAL_TEAM.name}`);
  console.log(`Canonical ID: ${CANONICAL_TEAM.id}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');

    // ============================================================
    // STEP 1: Deduplicate matches (remove duplicate records)
    // ============================================================
    console.log('📋 STEP 1: Deduplicating match records...');

    // Find and delete duplicate matches (keep one with lowest ID)
    const dedupeResult = await client.query(`
      WITH duplicates AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY match_date, home_team_name, away_team_name, home_score, away_score
          ORDER BY id
        ) as rn
        FROM match_results
        WHERE home_team_name ILIKE '%SPORTING BV Pre-NAL 15%'
           OR away_team_name ILIKE '%SPORTING BV Pre-NAL 15%'
      )
      DELETE FROM match_results
      WHERE id IN (SELECT id FROM duplicates WHERE rn > 1)
      RETURNING id
    `);

    console.log(`   Deleted ${dedupeResult.rowCount} duplicate match records\n`);

    // ============================================================
    // STEP 2: Re-link all matches to canonical team
    // ============================================================
    console.log('📋 STEP 2: Re-linking matches to canonical team...');

    // Update home_team_id where home_team_name matches
    const homeResult = await client.query(`
      UPDATE match_results
      SET home_team_id = $1
      WHERE (home_team_name ILIKE '%SPORTING BV Pre-NAL 15%'
             OR home_team_name ILIKE '%Sporting Blue Valley%Pre-NAL 15%')
        AND (home_team_id IS NULL OR home_team_id != $1)
      RETURNING id
    `, [CANONICAL_TEAM.id]);

    console.log(`   Updated ${homeResult.rowCount} home team links`);

    // Update away_team_id where away_team_name matches
    const awayResult = await client.query(`
      UPDATE match_results
      SET away_team_id = $1
      WHERE (away_team_name ILIKE '%SPORTING BV Pre-NAL 15%'
             OR away_team_name ILIKE '%Sporting Blue Valley%Pre-NAL 15%')
        AND (away_team_id IS NULL OR away_team_id != $1)
      RETURNING id
    `, [CANONICAL_TEAM.id]);

    console.log(`   Updated ${awayResult.rowCount} away team links\n`);

    // ============================================================
    // STEP 3: Calculate and update team stats
    // ============================================================
    console.log('📋 STEP 3: Updating team stats...');

    // Get all matches for this team
    const matchStats = await client.query(`
      SELECT
        COUNT(*) as matches_played,
        COUNT(*) FILTER (
          WHERE (home_team_id = $1 AND home_score > away_score)
             OR (away_team_id = $1 AND away_score > home_score)
        ) as wins,
        COUNT(*) FILTER (
          WHERE (home_team_id = $1 AND home_score < away_score)
             OR (away_team_id = $1 AND away_score < home_score)
        ) as losses,
        COUNT(*) FILTER (
          WHERE home_score = away_score AND home_score IS NOT NULL
        ) as draws
      FROM match_results
      WHERE (home_team_id = $1 OR away_team_id = $1)
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
    `, [CANONICAL_TEAM.id]);

    const stats = matchStats.rows[0];
    console.log(`   Calculated: ${stats.matches_played} matches, ${stats.wins}W-${stats.losses}L-${stats.draws}D`);

    // Update the team record
    await client.query(`
      UPDATE teams
      SET matches_played = $2,
          wins = $3,
          losses = $4,
          draws = $5
      WHERE id = $1
    `, [CANONICAL_TEAM.id, stats.matches_played, stats.wins, stats.losses, stats.draws]);

    console.log(`   ✅ Updated team stats in database\n`);

    // ============================================================
    // STEP 4: Handle duplicate team records
    // ============================================================
    console.log('📋 STEP 4: Handling duplicate team records...');

    for (const dupTeam of DUPLICATE_TEAMS) {
      // Check if any matches still reference this team
      const refCheck = await client.query(`
        SELECT COUNT(*) as cnt
        FROM match_results
        WHERE home_team_id = $1 OR away_team_id = $1
      `, [dupTeam.id]);

      const refCount = parseInt(refCheck.rows[0].cnt);

      if (refCount > 0) {
        // Re-link remaining matches
        await client.query(`
          UPDATE match_results
          SET home_team_id = $1
          WHERE home_team_id = $2
        `, [CANONICAL_TEAM.id, dupTeam.id]);

        await client.query(`
          UPDATE match_results
          SET away_team_id = $1
          WHERE away_team_id = $2
        `, [CANONICAL_TEAM.id, dupTeam.id]);

        console.log(`   Re-linked ${refCount} matches from duplicate team ${dupTeam.id.substring(0,8)}`);
      }

      // Transfer any aliases
      await client.query(`
        UPDATE team_name_aliases
        SET team_id = $1
        WHERE team_id = $2
      `, [CANONICAL_TEAM.id, dupTeam.id]);

      // Note: We don't delete the duplicate team record to avoid FK issues
      // Instead, mark it or leave it - it won't show matches anymore
      console.log(`   Processed duplicate team: ${dupTeam.name}`);
    }

    // ============================================================
    // VERIFICATION
    // ============================================================
    console.log('\n' + '='.repeat(70));
    console.log('VERIFICATION');
    console.log('='.repeat(70));

    const verifyMatches = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT (match_date, home_team_name, away_team_name)) as unique_matches
      FROM match_results
      WHERE home_team_id = $1 OR away_team_id = $1
    `, [CANONICAL_TEAM.id]);

    console.log(`\nMatches linked to canonical team: ${verifyMatches.rows[0].total}`);
    console.log(`Unique matches: ${verifyMatches.rows[0].unique_matches}`);

    const verifyStats = await client.query(`
      SELECT matches_played, wins, losses, draws
      FROM teams
      WHERE id = $1
    `, [CANONICAL_TEAM.id]);

    const finalStats = verifyStats.rows[0];
    console.log(`Team stats: ${finalStats.matches_played} matches, ${finalStats.wins}W-${finalStats.losses}L-${finalStats.draws}D`);

    // Check for orphaned duplicates
    const orphanCheck = await client.query(`
      SELECT id, team_name,
             (SELECT COUNT(*) FROM match_results WHERE home_team_id = t.id OR away_team_id = t.id) as match_count
      FROM teams t
      WHERE team_name ILIKE '%SPORTING BV Pre-NAL 15%'
         OR team_name ILIKE '%Sporting Blue Valley%Pre-NAL 15%'
    `);

    console.log('\nTeam records status:');
    orphanCheck.rows.forEach(t => {
      const status = t.id === CANONICAL_TEAM.id ? '✅ CANONICAL' : (t.match_count > 0 ? '⚠️ HAS MATCHES' : '🔸 ORPHANED');
      console.log(`   ${t.id.substring(0,8)} | ${t.match_count} matches | ${status} | ${t.team_name}`);
    });

    console.log('\n✅ Data integrity fix completed!');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
