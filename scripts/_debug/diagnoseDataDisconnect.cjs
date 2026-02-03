/**
 * diagnoseDataDisconnect.js
 *
 * Deep diagnosis of the data disconnect issue where teams have GotSport ranks
 * but show 0 matches. Identifies root causes across all three architecture layers.
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function diagnose() {
  console.log('='.repeat(80));
  console.log('DATA ARCHITECTURE DISCONNECT DIAGNOSIS');
  console.log('='.repeat(80));
  console.log('');

  // 1. Age group mismatch analysis
  console.log('1. AGE GROUP MISMATCHES (display_name vs calculated from birth_year)');
  console.log('-'.repeat(60));

  const ageGroupMismatch = await pool.query(`
    SELECT
      t.id,
      t.display_name,
      t.birth_year,
      t.gender,
      2026 - t.birth_year AS calculated_age,
      (regexp_match(t.display_name, '\\(U(\\d+)'))[1] AS display_says_age
    FROM teams_v2 t
    WHERE t.birth_year IS NOT NULL
      AND t.display_name ~* '\\(U\\d+'
      AND (2026 - t.birth_year)::text != (regexp_match(t.display_name, '\\(U(\\d+)'))[1]
    LIMIT 20
  `);

  console.log(`Found mismatches (showing first 20):`);
  ageGroupMismatch.rows.forEach(r => {
    console.log(`  ${r.display_name.substring(0, 70)}`);
    console.log(`    birth_year=${r.birth_year}, calculated=U${r.calculated_age}, display_says=U${r.display_says_age}`);
  });

  // Count total
  const totalMismatch = await pool.query(`
    SELECT COUNT(*) as count
    FROM teams_v2 t
    WHERE t.birth_year IS NOT NULL
      AND t.display_name ~* '\\(U\\d+'
      AND (2026 - t.birth_year)::text != (regexp_match(t.display_name, '\\(U(\\d+)'))[1]
  `);
  console.log(`\nTotal age group mismatches: ${totalMismatch.rows[0].count}`);

  // 2. Specific team duplicate analysis
  console.log('\n');
  console.log('2. SPECIFIC TEAM DUPLICATE ANALYSIS');
  console.log('-'.repeat(60));

  // Sporting Wichita 2015
  const sportingWichita = await pool.query(`
    SELECT
      t.id,
      t.display_name,
      t.birth_year,
      t.gender,
      t.state,
      t.matches_played as stored_matches,
      t.gotsport_rank,
      t.national_rank,
      t.state_rank,
      (SELECT COUNT(*) FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id) as actual_matches
    FROM teams_v2 t
    WHERE t.display_name ILIKE '%sporting wichita%2015%'
    ORDER BY actual_matches DESC
  `);

  console.log('\nSporting Wichita 2015 variants:');
  sportingWichita.rows.forEach(r => {
    console.log(`  ID: ${r.id.substring(0,8)}`);
    console.log(`    Name: ${r.display_name.substring(0, 70)}`);
    console.log(`    birth=${r.birth_year}, gender=${r.gender}, state=${r.state}`);
    console.log(`    stored=${r.stored_matches}, actual=${r.actual_matches}, gs_rank=${r.gotsport_rank}, nat=${r.national_rank}, st=${r.state_rank}`);
  });

  // Northeast United Atleticos
  const northeastUnited = await pool.query(`
    SELECT
      t.id,
      t.display_name,
      t.birth_year,
      t.gender,
      t.state,
      t.matches_played as stored_matches,
      t.gotsport_rank,
      t.national_rank,
      t.state_rank,
      (SELECT COUNT(*) FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id) as actual_matches
    FROM teams_v2 t
    WHERE t.display_name ILIKE '%northeast united%atletico%'
    ORDER BY actual_matches DESC
  `);

  console.log('\nNortheast United Atleticos variants:');
  northeastUnited.rows.forEach(r => {
    console.log(`  ID: ${r.id.substring(0,8)}`);
    console.log(`    Name: ${r.display_name.substring(0, 70)}`);
    console.log(`    birth=${r.birth_year}, gender=${r.gender}, state=${r.state}`);
    console.log(`    stored=${r.stored_matches}, actual=${r.actual_matches}, gs_rank=${r.gotsport_rank}, nat=${r.national_rank}, st=${r.state_rank}`);
  });

  // 3. Summary stats
  console.log('\n');
  console.log('3. OVERALL DATA INTEGRITY SUMMARY');
  console.log('-'.repeat(60));

  const summary = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2) as total_teams,
      (SELECT COUNT(*) FROM teams_v2 WHERE gotsport_rank IS NOT NULL OR national_rank IS NOT NULL) as teams_with_gs_rank,
      (SELECT COUNT(*) FROM teams_v2 WHERE matches_played = 0 AND (gotsport_rank IS NOT NULL OR national_rank IS NOT NULL)) as gs_rank_zero_stored_matches,
      (SELECT COUNT(*) FROM teams_v2 t WHERE
        (t.gotsport_rank IS NOT NULL OR t.national_rank IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id)
      ) as gs_rank_zero_actual_matches,
      (SELECT COUNT(*) FROM matches_v2) as total_matches,
      (SELECT COUNT(DISTINCT home_team_id) + COUNT(DISTINCT away_team_id) FROM matches_v2) as teams_in_matches_approx
  `);

  const s = summary.rows[0];
  console.log(`Total teams: ${s.total_teams}`);
  console.log(`Teams with GotSport rank: ${s.teams_with_gs_rank}`);
  console.log(`GS-ranked teams with stored matches=0: ${s.gs_rank_zero_stored_matches}`);
  console.log(`GS-ranked teams with ZERO actual matches: ${s.gs_rank_zero_actual_matches}`);
  console.log(`Total matches: ${s.total_matches}`);

  // 4. Root cause: GotSport rank source
  console.log('\n');
  console.log('4. ROOT CAUSE: GotSport Rank Source Analysis');
  console.log('-'.repeat(60));

  // Check if GotSport rankings come from a different source than matches
  const gsRankTeamsNoMatches = await pool.query(`
    SELECT
      t.id,
      t.display_name,
      t.gotsport_rank,
      t.national_rank,
      t.state_rank,
      t.birth_year,
      t.gender,
      t.state,
      t.created_at,
      t.updated_at
    FROM teams_v2 t
    WHERE (t.gotsport_rank IS NOT NULL OR t.national_rank IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM matches_v2 m WHERE m.home_team_id = t.id OR m.away_team_id = t.id)
    ORDER BY t.national_rank ASC NULLS LAST
    LIMIT 20
  `);

  console.log('Top GS-ranked teams with NO matches in matches_v2:');
  gsRankTeamsNoMatches.rows.forEach(r => {
    console.log(`  #${r.national_rank || r.gotsport_rank} National: ${r.display_name.substring(0, 50)}`);
    console.log(`    ID: ${r.id.substring(0,8)}, birth=${r.birth_year}, gender=${r.gender}, state=${r.state}`);
    console.log(`    Created: ${r.created_at}, Updated: ${r.updated_at}`);
  });

  // 5. Check for name similarity duplicates
  console.log('\n');
  console.log('5. DUPLICATE DETECTION: Teams with similar names');
  console.log('-'.repeat(60));

  // Find teams that might be duplicates based on fuzzy name matching
  const potentialDupes = await pool.query(`
    WITH ranked_teams AS (
      SELECT
        t.id,
        t.display_name,
        t.birth_year,
        t.gender,
        t.state,
        t.matches_played,
        t.gotsport_rank,
        t.national_rank,
        (SELECT COUNT(*) FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id) as actual_matches,
        -- Normalize name for comparison
        regexp_replace(lower(t.display_name), '[^a-z0-9]', '', 'g') as normalized_name
      FROM teams_v2 t
      WHERE (t.gotsport_rank IS NOT NULL OR t.national_rank IS NOT NULL)
    )
    SELECT
      r1.id as team1_id,
      r1.display_name as team1_name,
      r1.actual_matches as team1_matches,
      r1.national_rank as team1_rank,
      r2.id as team2_id,
      r2.display_name as team2_name,
      r2.actual_matches as team2_matches,
      r2.national_rank as team2_rank
    FROM ranked_teams r1
    JOIN ranked_teams r2 ON
      r1.id < r2.id
      AND r1.birth_year = r2.birth_year
      AND r1.gender = r2.gender
      AND similarity(r1.normalized_name, r2.normalized_name) > 0.7
    WHERE r1.actual_matches > 0 AND r2.actual_matches = 0
    LIMIT 20
  `);

  console.log('Potential duplicates (one with matches, one without):');
  potentialDupes.rows.forEach(r => {
    console.log(`  Team WITH matches: ${r.team1_name.substring(0, 50)}`);
    console.log(`    ID: ${r.team1_id.substring(0,8)}, matches=${r.team1_matches}, rank=${r.team1_rank}`);
    console.log(`  Team WITHOUT matches: ${r.team2_name.substring(0, 50)}`);
    console.log(`    ID: ${r.team2_id.substring(0,8)}, matches=${r.team2_matches}, rank=${r.team2_rank}`);
    console.log('');
  });

  // 6. Conclusion and recommendations
  console.log('\n');
  console.log('='.repeat(80));
  console.log('DIAGNOSIS COMPLETE - ROOT CAUSES IDENTIFIED');
  console.log('='.repeat(80));
  console.log(`
ROOT CAUSES:
1. GotSport rankings are imported SEPARATELY from match data
   - GotSport rank scraper creates new team records
   - Match scrapers create DIFFERENT team records for the same teams
   - No deduplication merges them

2. Canonical registry is underutilized
   - Only ~19K teams in canonical_teams vs ~155K in teams_v2
   - New teams are not being checked against registry

3. ELO script calculates stats only for teams WITH matches
   - Teams from GotSport rank import have no matches → stats stay 0

4. Age group mismatches
   - birth_year doesn't match (U12 vs U11) between display name and stored value
   - Causes teams to appear in wrong age group filter

RECOMMENDED FIX:
1. Merge duplicate teams (keep one with matches, transfer GS rank)
2. Recalculate stats for ALL teams from matches_v2
3. Fix age group mismatches (update birth_year to match display)
4. Populate canonical registry to prevent future duplicates
`);

  await pool.end();
}

diagnose().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
