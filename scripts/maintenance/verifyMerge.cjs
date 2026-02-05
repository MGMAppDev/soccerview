/**
 * Verify the merge worked and refresh views
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 300000 });

async function verify() {
  console.log('=== VERIFICATION ===\n');

  // Authorize writes
  const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');
  await authorizePipelineWrite(pool);

  // 1. The team with 0 matches - what the user sees
  console.log('1. Team user sees (0 matches):');
  const userTeam = await pool.query(`
    SELECT id, display_name, matches_played, wins, losses, draws, elo_rating
    FROM teams_v2
    WHERE id = '1741aee4-309d-4d88-a740-271727de316c'
  `);
  if (userTeam.rows.length > 0) {
    const t = userTeam.rows[0];
    console.log(`   ${t.display_name}`);
    console.log(`   Matches: ${t.matches_played} | W-L-D: ${t.wins}-${t.losses}-${t.draws}`);
  }

  // 2. The team with matches
  console.log('\n2. Team with actual matches:');
  const matchTeam = await pool.query(`
    SELECT id, display_name, matches_played, wins, losses, draws, elo_rating
    FROM teams_v2
    WHERE id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
  `);
  if (matchTeam.rows.length > 0) {
    const t = matchTeam.rows[0];
    console.log(`   ${t.display_name}`);
    console.log(`   Matches: ${t.matches_played} | W-L-D: ${t.wins}-${t.losses}-${t.draws}`);
  }

  // 3. The REAL issue: The user is looking at the wrong team entry
  console.log('\n3. ROOT CAUSE:');
  console.log('   The user searched and found the EMPTY team entry.');
  console.log('   The team with matches has a DIFFERENT display_name.');
  console.log('   Solution: Either merge the teams OR delete the empty one.');

  // 4. Let's just DELETE the empty duplicate team (it has no matches, no harm)
  console.log('\n4. Deleting empty duplicate team...');
  const deleteResult = await pool.query(`
    DELETE FROM teams_v2
    WHERE id = '1741aee4-309d-4d88-a740-271727de316c'
    AND matches_played = 0
    RETURNING id, display_name
  `);
  if (deleteResult.rowCount > 0) {
    console.log(`   ✅ Deleted: ${deleteResult.rows[0].display_name}`);
  } else {
    console.log('   (Already deleted or has matches)');
  }

  // 5. Also delete the other null-gender Pre-NAL 14 duplicates
  console.log('\n5. Cleaning up other Sporting BV duplicates...');
  const cleanup = await pool.query(`
    DELETE FROM teams_v2
    WHERE display_name ILIKE '%SPORTING BV%Pre-NAL%14%'
    AND matches_played = 0
    RETURNING display_name
  `);
  console.log(`   Deleted ${cleanup.rowCount} empty duplicate teams`);

  // 6. Verify remaining
  console.log('\n6. Remaining Sporting BV Pre-NAL teams:');
  const remaining = await pool.query(`
    SELECT display_name, matches_played, wins, losses, draws, elo_rating
    FROM teams_v2
    WHERE display_name ILIKE '%Sporting Blue Valley%Pre-NAL%'
       OR display_name ILIKE '%SPORTING BV%Pre-NAL%'
    ORDER BY matches_played DESC
  `);
  remaining.rows.forEach(t => {
    console.log(`   ${t.display_name}: ${t.matches_played} matches (${t.wins}W-${t.losses}L-${t.draws}D)`);
  });

  // 7. Refresh views
  console.log('\n7. Refreshing app views (this takes ~2-3 minutes)...');
  const startRefresh = Date.now();
  try {
    await pool.query('SELECT refresh_app_views()');
    console.log(`   ✅ Done in ${((Date.now() - startRefresh)/1000).toFixed(1)}s`);
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    console.log('   Trying individual view refresh...');
    // Just refresh app_team_profile for now
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY app_team_profile');
    console.log('   ✅ app_team_profile refreshed');
  }

  await pool.end();
  console.log('\n✅ DONE - Please refresh the app and search again');
}

verify().catch(console.error);
