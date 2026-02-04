/**
 * analyzeRecreationalData.cjs
 * ===========================
 * Session 84: Pre-migration analysis for Premier-Only conversion
 *
 * This script analyzes the scope of recreational data before cleanup.
 * Run this BEFORE making any changes to understand what will be affected.
 *
 * Usage: node scripts/audit/analyzeRecreationalData.cjs
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function analyze() {
  console.log('='.repeat(70));
  console.log('SESSION 84: Recreational Data Analysis');
  console.log('Pre-migration analysis for Premier-Only conversion');
  console.log('='.repeat(70));
  console.log();

  const results = {};

  // 1. Count recreational matches in production
  console.log('1. Recreational matches in matches_v2...');
  const recMatches = await pool.query(`
    SELECT COUNT(*) as count
    FROM matches_v2
    WHERE source_match_key LIKE 'heartland-recreational-%'
  `);
  results.recMatchesProduction = parseInt(recMatches.rows[0].count);
  console.log(`   Found: ${results.recMatchesProduction.toLocaleString()} recreational matches`);

  // 2. Count recreational matches in staging
  console.log('\n2. Recreational matches in staging_games...');
  const recStaging = await pool.query(`
    SELECT COUNT(*) as count
    FROM staging_games
    WHERE source_match_key LIKE 'heartland-recreational-%'
  `);
  results.recMatchesStaging = parseInt(recStaging.rows[0].count);
  console.log(`   Found: ${results.recMatchesStaging.toLocaleString()} recreational staging records`);

  // 3. Count recreational leagues
  console.log('\n3. Recreational leagues...');
  const recLeagues = await pool.query(`
    SELECT id, name, source_event_id
    FROM leagues
    WHERE name ILIKE '%recreational%'
       OR source_event_id LIKE 'heartland-recreational-%'
  `);
  results.recLeagues = recLeagues.rows;
  console.log(`   Found: ${recLeagues.rows.length} recreational leagues`);
  recLeagues.rows.forEach(l => console.log(`     - ${l.name} (${l.source_event_id})`));

  // 4. Count calendar matches (may include rec)
  console.log('\n4. Calendar matches (heartland-cal-%)...');
  const calMatches = await pool.query(`
    SELECT COUNT(*) as count
    FROM matches_v2
    WHERE source_match_key LIKE 'heartland-cal-%'
  `);
  results.calendarMatches = parseInt(calMatches.rows[0].count);
  console.log(`   Found: ${results.calendarMatches.toLocaleString()} calendar matches`);

  // 4b. Calendar matches with "rec" in team names (join with teams_v2)
  const calRecMatches = await pool.query(`
    SELECT COUNT(*) as count
    FROM matches_v2 m
    JOIN teams_v2 ht ON m.home_team_id = ht.id
    JOIN teams_v2 at ON m.away_team_id = at.id
    WHERE m.source_match_key LIKE 'heartland-cal-%'
      AND (ht.display_name ILIKE '%rec%' OR at.display_name ILIKE '%rec%')
  `);
  results.calendarRecMatches = parseInt(calRecMatches.rows[0].count);
  console.log(`   Of those, ${results.calendarRecMatches.toLocaleString()} have "rec" in team names`);

  // 5. Teams with ONLY recreational matches
  console.log('\n5. Teams with ONLY recreational matches (will have 0 matches after cleanup)...');
  const teamsOnlyRec = await pool.query(`
    SELECT COUNT(DISTINCT t.id) as count
    FROM teams_v2 t
    WHERE EXISTS (
      SELECT 1 FROM matches_v2 m
      WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
        AND m.source_match_key LIKE 'heartland-recreational-%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM matches_v2 m
      WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
        AND m.source_match_key NOT LIKE 'heartland-recreational-%'
    )
  `);
  results.teamsOnlyRec = parseInt(teamsOnlyRec.rows[0].count);
  console.log(`   Found: ${results.teamsOnlyRec.toLocaleString()} teams with ONLY recreational matches`);

  // 6. Teams with BOTH premier and recreational matches
  console.log('\n6. Teams with BOTH premier AND recreational matches...');
  const teamsBoth = await pool.query(`
    SELECT COUNT(DISTINCT t.id) as count
    FROM teams_v2 t
    WHERE EXISTS (
      SELECT 1 FROM matches_v2 m
      WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
        AND m.source_match_key LIKE 'heartland-recreational-%'
    )
    AND EXISTS (
      SELECT 1 FROM matches_v2 m
      WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
        AND m.source_match_key NOT LIKE 'heartland-recreational-%'
    )
  `);
  results.teamsBoth = parseInt(teamsBoth.rows[0].count);
  console.log(`   Found: ${results.teamsBoth.toLocaleString()} teams with BOTH premier and recreational`);

  // 7. Total teams affected (have any recreational matches)
  console.log('\n7. Total teams with ANY recreational matches...');
  const teamsAnyRec = await pool.query(`
    SELECT COUNT(DISTINCT t.id) as count
    FROM teams_v2 t
    WHERE EXISTS (
      SELECT 1 FROM matches_v2 m
      WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
        AND m.source_match_key LIKE 'heartland-recreational-%'
    )
  `);
  results.teamsAnyRec = parseInt(teamsAnyRec.rows[0].count);
  console.log(`   Found: ${results.teamsAnyRec.toLocaleString()} teams with any recreational matches`);

  // 8. Canonical events with recreational
  console.log('\n8. Canonical events with recreational...');
  const canonicalRec = await pool.query(`
    SELECT COUNT(*) as count
    FROM canonical_events
    WHERE canonical_name ILIKE '%recreational%'
  `);
  results.canonicalRecEvents = parseInt(canonicalRec.rows[0].count);
  console.log(`   Found: ${results.canonicalRecEvents.toLocaleString()} canonical events`);

  // 9. Current totals for comparison
  console.log('\n9. Current database totals (for comparison)...');
  const totalMatches = await pool.query(`SELECT COUNT(*) as count FROM matches_v2`);
  const totalTeams = await pool.query(`SELECT COUNT(*) as count FROM teams_v2`);
  const totalLeagues = await pool.query(`SELECT COUNT(*) as count FROM leagues`);
  results.totalMatches = parseInt(totalMatches.rows[0].count);
  results.totalTeams = parseInt(totalTeams.rows[0].count);
  results.totalLeagues = parseInt(totalLeagues.rows[0].count);
  console.log(`   matches_v2: ${results.totalMatches.toLocaleString()}`);
  console.log(`   teams_v2: ${results.totalTeams.toLocaleString()}`);
  console.log(`   leagues: ${results.totalLeagues.toLocaleString()}`);

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY: Impact of Premier-Only Migration');
  console.log('='.repeat(70));

  const totalRecDeletes = results.recMatchesProduction + results.calendarRecMatches;
  const percentMatches = ((totalRecDeletes / results.totalMatches) * 100).toFixed(2);

  console.log(`
  MATCHES TO DELETE:
    - Recreational matches: ${results.recMatchesProduction.toLocaleString()}
    - Calendar rec matches: ${results.calendarRecMatches.toLocaleString()}
    - TOTAL: ${totalRecDeletes.toLocaleString()} (${percentMatches}% of all matches)

  LEAGUES TO DELETE:
    - ${results.recLeagues.length} recreational leagues

  TEAMS AFFECTED:
    - Teams with ONLY rec (will have 0 matches): ${results.teamsOnlyRec.toLocaleString()}
    - Teams with BOTH (will keep premier matches): ${results.teamsBoth.toLocaleString()}
    - Total teams affected: ${results.teamsAnyRec.toLocaleString()}

  AFTER CLEANUP:
    - matches_v2: ~${(results.totalMatches - totalRecDeletes).toLocaleString()} matches
    - leagues: ~${(results.totalLeagues - results.recLeagues.length).toLocaleString()} leagues
    - Teams with 0 matches (won't appear in rankings): ${results.teamsOnlyRec.toLocaleString()}
  `);

  console.log('='.repeat(70));
  console.log('Proceed with Phase 2? Review counts above first.');
  console.log('='.repeat(70));

  await pool.end();
  return results;
}

analyze()
  .then(results => {
    console.log('\nAnalysis complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Analysis failed:', err);
    process.exit(1);
  });
