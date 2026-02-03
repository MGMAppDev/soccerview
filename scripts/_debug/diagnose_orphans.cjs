/**
 * Diagnose orphan teams (GotSport points but no matches)
 * Session 77 - February 2, 2026
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function analyzeCoverage() {
  console.log('=== ANALYZING DATA COVERAGE GAP ===\n');

  // 1. What % of teams with GS points have matches?
  const coverage = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE gotsport_points > 0) as gs_teams,
      COUNT(*) FILTER (WHERE gotsport_points > 0 AND matches_played > 0) as gs_teams_with_matches,
      COUNT(*) FILTER (WHERE gotsport_points > 0 AND matches_played = 0) as gs_teams_no_matches
    FROM teams_v2
  `);
  const c = coverage.rows[0];
  console.log('Teams with GotSport points:', c.gs_teams);
  console.log('  - WITH matches in our system:', c.gs_teams_with_matches, `(${(c.gs_teams_with_matches/c.gs_teams*100).toFixed(1)}%)`);
  console.log('  - WITHOUT matches:', c.gs_teams_no_matches, `(${(c.gs_teams_no_matches/c.gs_teams*100).toFixed(1)}%)`);

  // 2. Check staging_games for SPORTING BV Pre-MLS Next 15 specifically
  const sbvStaging = await pool.query(`
    SELECT home_team_name, away_team_name, match_date, home_score, away_score, source_platform, processed
    FROM staging_games
    WHERE (home_team_name ILIKE '%Sporting%MLS%Next%15%' OR away_team_name ILIKE '%Sporting%MLS%Next%15%')
       OR (home_team_name ILIKE '%SPORTING BV%MLS%Next%15%' OR away_team_name ILIKE '%SPORTING BV%MLS%Next%15%')
    ORDER BY match_date DESC
  `);
  console.log('\nStaging games for SPORTING BV Pre-MLS Next 15:', sbvStaging.rows.length);
  sbvStaging.rows.slice(0, 10).forEach(m => {
    const dateStr = m.match_date ? m.match_date.toISOString().split('T')[0] : 'null';
    const home = m.home_team_name ? m.home_team_name.substring(0, 40) : '';
    const away = m.away_team_name ? m.away_team_name.substring(0, 40) : '';
    console.log(`  - ${dateStr}: ${home} vs ${away}`);
    console.log(`    Score: ${m.home_score}-${m.away_score}, Source: ${m.source_platform}, Processed: ${m.processed}`);
  });

  // 3. Check what sources we have matches from
  const sources = await pool.query(`
    SELECT
      source_platform,
      COUNT(*) as match_count,
      COUNT(*) FILTER (WHERE home_score IS NOT NULL) as scored
    FROM matches_v2
    GROUP BY source_platform
    ORDER BY match_count DESC
  `);
  console.log('\nMatches by source:');
  sources.rows.forEach(s => console.log(`  - ${s.source_platform || 'unknown'}: ${s.match_count} total, ${s.scored} scored`));

  // 4. Check if there's a pattern - are most orphans from certain states?
  const orphansByState = await pool.query(`
    SELECT state, COUNT(*) as count
    FROM teams_v2
    WHERE gotsport_points > 0 AND matches_played = 0
    GROUP BY state
    ORDER BY count DESC
    LIMIT 15
  `);
  console.log('\nOrphans (GS points, no matches) by state:');
  orphansByState.rows.forEach(s => console.log(`  - ${s.state || 'NULL'}: ${s.count}`));

  // 5. Check if orphans might be DUPLICATES of teams with matches (different name variants)
  console.log('\n=== CHECKING FOR POSSIBLE DUPLICATES ===');
  const sampleOrphans = await pool.query(`
    SELECT id, display_name, gotsport_points, state, birth_year, gender
    FROM teams_v2
    WHERE gotsport_points > 500 AND matches_played = 0
    ORDER BY gotsport_points DESC
    LIMIT 10
  `);

  for (const orphan of sampleOrphans.rows) {
    // Try to find a team with matches that could be the same team
    const nameParts = orphan.display_name.split(' ').filter(p => p.length > 3);
    const searchPattern = '%' + nameParts.slice(0, 3).join('%') + '%';

    const potentialMatches = await pool.query(`
      SELECT id, display_name, matches_played, wins, losses, draws, elo_rating
      FROM teams_v2
      WHERE display_name ILIKE $1
        AND birth_year = $2 AND gender = $3
        AND matches_played > 0
      LIMIT 3
    `, [searchPattern, orphan.birth_year, orphan.gender]);

    console.log(`\nOrphan: ${orphan.display_name}`);
    console.log(`  GS pts: ${orphan.gotsport_points}, State: ${orphan.state}`);
    if (potentialMatches.rows.length > 0) {
      console.log('  POSSIBLE MATCHES (teams with matches):');
      potentialMatches.rows.forEach(m => {
        console.log(`    - ${m.display_name}`);
        console.log(`      MP: ${m.matches_played}, W-L-D: ${m.wins}-${m.losses}-${m.draws}`);
      });
    } else {
      console.log('  NO potential duplicates found - might be missing data');
    }
  }

  pool.end();
}

analyzeCoverage().catch(console.error);
