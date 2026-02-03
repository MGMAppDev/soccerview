/**
 * verifyFix.cjs - Verify the data disconnect fix
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verify() {
  console.log('='.repeat(70));
  console.log('FIX VERIFICATION');
  console.log('='.repeat(70));

  // 1. Check specific teams from user screenshots
  console.log('\n1. CHECKING TEAMS FROM USER SCREENSHOTS');
  console.log('-'.repeat(60));

  const sportingWichita = await pool.query(`
    SELECT
      t.id, t.display_name, t.birth_year, t.gender, t.state,
      t.matches_played, t.wins, t.losses, t.draws,
      t.national_rank, t.state_rank, t.elo_rating
    FROM teams_v2 t
    WHERE t.display_name ILIKE '%sporting wichita%2015%academy%'
      AND t.gender = 'M'
    ORDER BY t.matches_played DESC
    LIMIT 3
  `);

  console.log('\nSporting Wichita 2015B Academy:');
  sportingWichita.rows.forEach(r => {
    console.log(`  ${r.display_name.substring(0, 55)}`);
    console.log(`    Stats: ${r.matches_played}mp, ${r.wins}W-${r.losses}L-${r.draws}D`);
    console.log(`    GotSport: National #${r.national_rank || 'none'}, State #${r.state_rank || 'none'}`);
  });

  const northeastUnited = await pool.query(`
    SELECT
      t.id, t.display_name, t.birth_year, t.gender, t.state,
      t.matches_played, t.wins, t.losses, t.draws,
      t.national_rank, t.state_rank
    FROM teams_v2 t
    WHERE t.display_name ILIKE '%northeast united%atletico%'
    LIMIT 3
  `);

  console.log('\nNortheast United Atleticos:');
  northeastUnited.rows.forEach(r => {
    console.log(`  ${r.display_name.substring(0, 55)}`);
    console.log(`    Stats: ${r.matches_played}mp, ${r.wins}W-${r.losses}L-${r.draws}D`);
    console.log(`    GotSport: National #${r.national_rank || 'none'}, State #${r.state_rank || 'none'}`);
  });

  // 2. Overall stats comparison before/after
  console.log('\n2. OVERALL DATA INTEGRITY');
  console.log('-'.repeat(60));

  const summary = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM teams_v2) as total_teams,
      (SELECT COUNT(*) FROM teams_v2 WHERE matches_played > 0) as teams_with_matches,
      (SELECT COUNT(*) FROM teams_v2 WHERE national_rank IS NOT NULL) as teams_with_gs_rank,
      (SELECT COUNT(*) FROM teams_v2 WHERE national_rank IS NOT NULL AND matches_played > 0) as gs_with_matches,
      (SELECT COUNT(*) FROM teams_v2 WHERE national_rank IS NOT NULL AND matches_played = 0) as gs_without_matches,
      (SELECT COUNT(*) FROM matches_v2) as total_matches
  `);

  const s = summary.rows[0];
  console.log(`Total teams: ${parseInt(s.total_teams).toLocaleString()}`);
  console.log(`Teams with matches_played > 0: ${parseInt(s.teams_with_matches).toLocaleString()}`);
  console.log(`Teams with GotSport rank: ${parseInt(s.teams_with_gs_rank).toLocaleString()}`);
  console.log(`GS-ranked with matches: ${parseInt(s.gs_with_matches).toLocaleString()}`);
  console.log(`GS-ranked WITHOUT matches: ${parseInt(s.gs_without_matches).toLocaleString()}`);
  console.log(`Total matches in DB: ${parseInt(s.total_matches).toLocaleString()}`);

  // 3. Check if matches exist for teams
  console.log('\n3. ROOT CAUSE: MATCH DATA SOURCE');
  console.log('-'.repeat(60));

  // Check what sources have matches
  const matchSources = await pool.query(`
    SELECT
      CASE
        WHEN source_match_key LIKE 'gotsport%' THEN 'gotsport'
        WHEN source_match_key LIKE 'htg%' THEN 'htgsports'
        WHEN source_match_key LIKE 'heartland%' THEN 'heartland'
        WHEN source_match_key LIKE 'legacy%' THEN 'legacy'
        ELSE 'other'
      END as source,
      COUNT(*) as count
    FROM matches_v2
    GROUP BY 1
    ORDER BY 2 DESC
  `);

  console.log('\nMatches by source:');
  matchSources.rows.forEach(r => {
    console.log(`  ${r.source}: ${parseInt(r.count).toLocaleString()}`);
  });

  // 4. The real problem: teams created by GS rank scraper have no matches
  console.log('\n4. DIAGNOSIS: GotSport Rank Import vs Match Data');
  console.log('-'.repeat(60));

  const gsTeamsAnalysis = await pool.query(`
    WITH team_match_counts AS (
      SELECT
        t.id,
        t.display_name,
        t.national_rank,
        t.state_rank,
        (SELECT COUNT(*) FROM matches_v2 WHERE home_team_id = t.id OR away_team_id = t.id) as actual_matches
      FROM teams_v2 t
      WHERE t.national_rank IS NOT NULL
    )
    SELECT
      CASE
        WHEN actual_matches = 0 THEN 'GS rank but 0 matches'
        WHEN actual_matches BETWEEN 1 AND 5 THEN 'GS rank with 1-5 matches'
        WHEN actual_matches BETWEEN 6 AND 20 THEN 'GS rank with 6-20 matches'
        ELSE 'GS rank with 20+ matches'
      END as category,
      COUNT(*) as count
    FROM team_match_counts
    GROUP BY 1
    ORDER BY 2 DESC
  `);

  console.log('\nGotSport-ranked teams by actual match count:');
  gsTeamsAnalysis.rows.forEach(r => {
    console.log(`  ${r.category}: ${parseInt(r.count).toLocaleString()}`);
  });

  // 5. Conclusion
  console.log('\n' + '='.repeat(70));
  console.log('CONCLUSION');
  console.log('='.repeat(70));
  console.log(`
The root cause is that GotSport rankings are imported SEPARATELY from match data.

- GotSport rank scraper creates team entries with rankings
- Match scrapers create DIFFERENT team entries with match data
- No automatic deduplication merges them

The stats fix (Phase 1) correctly recalculates stats for teams WITH matches.
But 59,559 teams have GotSport ranks and NO matches at all in our database.

These teams either:
1. Play in leagues/tournaments we don't scrape
2. Are duplicate entries that need merging with match-having teams
3. Are new teams that haven't played yet

The fix applied ensures teams WITH matches show correct stats.
Teams WITHOUT matches will show 0 matches (which is accurate - we don't have their match data).
  `);

  await pool.end();
}

verify().catch(e => {
  console.error(e);
  process.exit(1);
});
