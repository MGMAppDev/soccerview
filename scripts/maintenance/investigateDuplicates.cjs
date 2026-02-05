/**
 * Investigate match double-counting issue
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function investigate() {
  console.log('=== INVESTIGATING MATCH DOUBLE-COUNTING ===\n');

  // 1. Find the team
  const team = await pool.query(`
    SELECT id, display_name, matches_played, wins, losses, draws, elo_rating
    FROM teams_v2
    WHERE display_name ILIKE '%Sporting Blue Valley%SPORTING BV%Pre-NAL%15%'
       OR display_name ILIKE '%SPORTING BV%Pre-NAL%15%'
    ORDER BY matches_played DESC
    LIMIT 1
  `);

  if (team.rows.length === 0) {
    console.log('Team not found');
    await pool.end();
    return;
  }

  const t = team.rows[0];
  console.log('1. Team Found:');
  console.log(`   Name: ${t.display_name}`);
  console.log(`   ID: ${t.id}`);
  console.log(`   Stats: ${t.matches_played} matches | ${t.wins}W-${t.losses}L-${t.draws}D`);
  console.log(`   ELO: ${t.elo_rating}`);

  const teamId = t.id;

  // 2. Count matches
  const counts = await pool.query(`
    SELECT
      COUNT(*) as total_rows,
      COUNT(DISTINCT id) as unique_ids
    FROM matches_v2
    WHERE home_team_id = $1 OR away_team_id = $1
  `, [teamId]);

  console.log('\n2. Match Counts:');
  console.log(`   Total rows: ${counts.rows[0].total_rows}`);
  console.log(`   Unique IDs: ${counts.rows[0].unique_ids}`);

  // 3. Check for duplicates by semantic key
  const semanticDupes = await pool.query(`
    SELECT match_date, home_team_id, away_team_id, COUNT(*) as cnt
    FROM matches_v2
    WHERE home_team_id = $1 OR away_team_id = $1
    GROUP BY match_date, home_team_id, away_team_id
    HAVING COUNT(*) > 1
  `, [teamId]);

  if (semanticDupes.rows.length > 0) {
    console.log('\n⚠️ SEMANTIC DUPLICATES FOUND (same date+teams):');
    semanticDupes.rows.forEach(d => {
      console.log(`   ${d.match_date} | Count: ${d.cnt}`);
    });
  } else {
    console.log('\n✅ No semantic duplicates (unique by date+teams)');
  }

  // 4. List all matches grouped by opponent
  console.log('\n3. Matches by Opponent:');
  const byOpponent = await pool.query(`
    SELECT
      CASE
        WHEN m.home_team_id = $1 THEN at.display_name
        ELSE ht.display_name
      END as opponent,
      COUNT(*) as match_count,
      array_agg(m.match_date ORDER BY m.match_date) as dates
    FROM matches_v2 m
    JOIN teams_v2 ht ON m.home_team_id = ht.id
    JOIN teams_v2 at ON m.away_team_id = at.id
    WHERE m.home_team_id = $1 OR m.away_team_id = $1
    GROUP BY opponent
    ORDER BY match_count DESC
    LIMIT 15
  `, [teamId]);

  byOpponent.rows.forEach(r => {
    const dates = r.dates.map(d => d.toISOString().split('T')[0]).join(', ');
    console.log(`   ${r.opponent.substring(0, 45)}`);
    console.log(`      Games: ${r.match_count} | Dates: ${dates}`);
  });

  // 5. Check W-L-D calculation from actual matches
  console.log('\n4. Verify W-L-D from Actual Matches:');
  const wld = await pool.query(`
    SELECT
      SUM(CASE
        WHEN home_team_id = $1 AND home_score > away_score THEN 1
        WHEN away_team_id = $1 AND away_score > home_score THEN 1
        ELSE 0
      END) as wins,
      SUM(CASE
        WHEN home_team_id = $1 AND home_score < away_score THEN 1
        WHEN away_team_id = $1 AND away_score < home_score THEN 1
        ELSE 0
      END) as losses,
      SUM(CASE
        WHEN home_score = away_score AND home_score IS NOT NULL THEN 1
        ELSE 0
      END) as draws,
      COUNT(*) as total
    FROM matches_v2
    WHERE (home_team_id = $1 OR away_team_id = $1)
      AND home_score IS NOT NULL
  `, [teamId]);

  const calc = wld.rows[0];
  console.log(`   Calculated: ${calc.wins}W-${calc.losses}L-${calc.draws}D = ${parseInt(calc.wins)+parseInt(calc.losses)+parseInt(calc.draws)} scored matches`);
  console.log(`   Stored:     ${t.wins}W-${t.losses}L-${t.draws}D = ${t.matches_played} matches`);

  // 6. Full match list
  console.log('\n5. All Matches (chronological):');
  const allMatches = await pool.query(`
    SELECT m.match_date, m.home_score, m.away_score,
           ht.display_name as home_team, at.display_name as away_team,
           m.source_platform
    FROM matches_v2 m
    JOIN teams_v2 ht ON m.home_team_id = ht.id
    JOIN teams_v2 at ON m.away_team_id = at.id
    WHERE m.home_team_id = $1 OR m.away_team_id = $1
    ORDER BY m.match_date
  `, [teamId]);

  allMatches.rows.forEach((m, i) => {
    const isHome = m.home_team.includes('SPORTING BV');
    const opponent = isHome ? m.away_team : m.home_team;
    const score = m.home_score !== null ? `${m.home_score}-${m.away_score}` : 'TBD';
    const result = m.home_score === null ? '?' :
      (isHome ? (m.home_score > m.away_score ? 'W' : m.home_score < m.away_score ? 'L' : 'D') :
                (m.away_score > m.home_score ? 'W' : m.away_score < m.home_score ? 'L' : 'D'));
    console.log(`   ${(i+1).toString().padStart(2)}. ${m.match_date.toISOString().split('T')[0]} | ${score.padStart(5)} | ${result} | ${opponent.substring(0, 45)}`);
  });

  await pool.end();
  console.log('\n=== INVESTIGATION COMPLETE ===');
}

investigate().catch(err => {
  console.error('Error:', err);
  pool.end();
});
