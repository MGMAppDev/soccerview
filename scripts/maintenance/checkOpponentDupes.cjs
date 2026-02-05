/**
 * Check for opponent team duplicates causing double-counted matches
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkOpponentDupes() {
  console.log('=== OPPONENT TEAM DUPLICATES ===\n');

  const teamId = 'cc329f08-1f57-4a7b-923a-768b2138fa92'; // Sporting BV Pre-NAL 15

  // Get all opponents
  const opponents = await pool.query(`
    SELECT DISTINCT
      CASE WHEN m.home_team_id = $1 THEN m.away_team_id ELSE m.home_team_id END as opponent_id,
      CASE WHEN m.home_team_id = $1 THEN at.display_name ELSE ht.display_name END as opponent_name,
      m.match_date,
      m.home_score,
      m.away_score
    FROM matches_v2 m
    JOIN teams_v2 ht ON m.home_team_id = ht.id
    JOIN teams_v2 at ON m.away_team_id = at.id
    WHERE m.home_team_id = $1 OR m.away_team_id = $1
    ORDER BY m.match_date
  `, [teamId]);

  // Group by date+score to find duplicate matches
  const byDateScore = {};
  opponents.rows.forEach(r => {
    const key = `${r.match_date.toISOString().split('T')[0]}-${r.home_score}-${r.away_score}`;
    if (!byDateScore[key]) byDateScore[key] = [];
    byDateScore[key].push(r);
  });

  console.log('Matches that appear multiple times (same date+score):');
  let duplicateCount = 0;
  const duplicateTeams = [];

  for (const [key, matches] of Object.entries(byDateScore)) {
    if (matches.length > 1) {
      duplicateCount += matches.length - 1;
      console.log(`\n${key}:`);
      matches.forEach(m => {
        console.log(`  - ${m.opponent_name}`);
        console.log(`    ID: ${m.opponent_id}`);
        duplicateTeams.push(m.opponent_id);
      });
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total matches: ${opponents.rows.length}`);
  console.log(`Duplicate matches: ${duplicateCount}`);
  console.log(`Unique matches: ${opponents.rows.length - duplicateCount}`);

  // Check if these opponent teams should be merged
  if (duplicateTeams.length > 0) {
    console.log('\n=== TEAMS TO POTENTIALLY MERGE ===');

    // Get unique team IDs from duplicates
    const uniqueTeamIds = [...new Set(duplicateTeams)];

    for (const tid of uniqueTeamIds) {
      const team = await pool.query(`
        SELECT id, display_name, birth_year, gender, matches_played, club_name
        FROM teams_v2 WHERE id = $1
      `, [tid]);

      if (team.rows.length > 0) {
        const t = team.rows[0];
        // Find similar teams
        const similar = await pool.query(`
          SELECT id, display_name, birth_year, gender, matches_played
          FROM teams_v2
          WHERE birth_year = $1 AND gender = $2
          AND display_name ILIKE '%' || $3 || '%'
          AND id != $4
        `, [t.birth_year, t.gender, t.club_name?.split(' ')[0] || t.display_name.split(' ')[0], tid]);

        if (similar.rows.length > 0) {
          console.log(`\nTeam: ${t.display_name}`);
          console.log(`  Birth: ${t.birth_year} | Gender: ${t.gender} | Matches: ${t.matches_played}`);
          console.log(`  Similar teams:`);
          similar.rows.forEach(s => {
            console.log(`    - ${s.display_name} (${s.matches_played} matches)`);
          });
        }
      }
    }
  }

  await pool.end();
}

checkOpponentDupes().catch(console.error);
