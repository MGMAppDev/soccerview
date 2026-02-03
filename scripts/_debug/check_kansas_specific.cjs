/**
 * Check specific Kansas orphans for potential duplicates
 * Session 78
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkKansasOrphans() {
  // The Kansas orphans: #2, #3, #4, #8
  const orphanIds = [
    '3371a91a-907a-4ab0-a391-3bc51449ade9', // #2: Sporting Wichita 2014B SDL ACADEMY
    '43d028c3-770f-4ca2-b74c-a58a42d38e48', // #3: SOUTHWEST KANSAS GREAT BEND PANTHERS
    '1741aee4-309d-4d88-a740-271727de316c', // #4: SPORTING BV Pre-NAL 2014B
    '67d0ed17-d11d-446b-87dd-78a8f526ffd6'  // #8: Northeast United SC CKU Arsenal
  ];

  for (const id of orphanIds) {
    const orphan = await pool.query('SELECT * FROM teams_v2 WHERE id = $1', [id]);
    if (!orphan.rows[0]) continue;

    const o = orphan.rows[0];
    console.log('='.repeat(60));
    console.log('ORPHAN: ' + o.display_name);
    console.log('  ID: ' + id);
    console.log('  GS pts: ' + o.gotsport_points + ', State: ' + o.state);
    console.log('  Birth year: ' + o.birth_year + ', Gender: ' + o.gender);

    // Try multiple search patterns
    const patterns = [];

    if (o.display_name.includes('Sporting Wichita')) {
      patterns.push('%sporting%wichita%');
      patterns.push('%wichita%');
    } else if (o.display_name.includes('SOUTHWEST') || o.display_name.includes('GREAT BEND')) {
      patterns.push('%great%bend%');
      patterns.push('%panthers%');
      patterns.push('%southwest%kansas%');
    } else if (o.display_name.includes('SPORTING BV') || o.display_name.includes('Blue Valley')) {
      patterns.push('%sporting%bv%');
      patterns.push('%blue%valley%');
      patterns.push('%sbv%');
      patterns.push('%pre%nal%');
    } else if (o.display_name.includes('Northeast') || o.display_name.includes('CKU')) {
      patterns.push('%northeast%');
      patterns.push('%cku%');
      patterns.push('%arsenal%');
    }

    let found = false;
    for (const pattern of patterns) {
      const results = await pool.query(`
        SELECT id, display_name, matches_played, wins, losses, draws, state
        FROM teams_v2
        WHERE birth_year = $1 AND gender = $2 AND matches_played > 0
          AND LOWER(display_name) LIKE $3
          AND id != $4
        LIMIT 10
      `, [o.birth_year, o.gender, pattern, id]);

      if (results.rows.length > 0) {
        console.log('\n  FOUND with pattern "' + pattern + '":');
        results.rows.forEach(m => {
          console.log('    - ' + m.display_name);
          console.log('      ID: ' + m.id);
          console.log('      State: ' + m.state + ', MP: ' + m.matches_played + ', W-L-D: ' + m.wins + '-' + m.losses + '-' + m.draws);
        });
        found = true;
        break;
      }
    }

    if (!found) {
      console.log('\n  NO matches found with any pattern - checking if ANY U11 Boys in state...');

      // Check if there are ANY teams in this age group with matches in this state
      const stateCheck = await pool.query(`
        SELECT COUNT(*) as count
        FROM teams_v2
        WHERE birth_year = $1 AND gender = $2 AND matches_played > 0 AND state = $3
      `, [o.birth_year, o.gender, o.state]);

      console.log('  Teams with matches in ' + o.state + ' for U' + (2026 - o.birth_year) + ' ' + (o.gender === 'M' ? 'Boys' : 'Girls') + ': ' + stateCheck.rows[0].count);

      // If very few or none, this is a data coverage gap
      if (parseInt(stateCheck.rows[0].count) < 10) {
        console.log('  ⚠️  DATA COVERAGE GAP - we likely dont scrape this teams league');
      }
    }
    console.log('');
  }

  pool.end();
}

checkKansasOrphans().catch(console.error);
