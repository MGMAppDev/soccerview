/**
 * Merge Sporting BV Pre-NAL duplicate teams
 *
 * Found duplicates:
 * - Birth 2015: cc329f08 (27 matches) ← KEEP | 1741aee4 (0 matches) ← MERGE INTO
 * - Birth 2014: Multiple duplicates with NULL gender
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function merge() {
  console.log('=== MERGING SPORTING BV DUPLICATES ===\n');

  const client = await pool.connect();

  try {
    await authorizePipelineWrite(client);
    await client.query('BEGIN');

    // 1. Merge the 2015 teams (the user's case)
    const keepId = 'cc329f08-1f57-4a7b-923a-768b2138fa92';  // 27 matches
    const mergeId = '1741aee4-309d-4d88-a740-271727de316c'; // 0 matches

    console.log('1. Merging 2015 team duplicates:');
    console.log(`   Keep:  ${keepId} (has 27 matches)`);
    console.log(`   Merge: ${mergeId} (has 0 matches)`);

    // Update any matches referencing the merge team
    const homeUpdate = await client.query(`
      UPDATE matches_v2 SET home_team_id = $1
      WHERE home_team_id = $2
    `, [keepId, mergeId]);
    console.log(`   Home matches updated: ${homeUpdate.rowCount}`);

    const awayUpdate = await client.query(`
      UPDATE matches_v2 SET away_team_id = $1
      WHERE away_team_id = $2
    `, [keepId, mergeId]);
    console.log(`   Away matches updated: ${awayUpdate.rowCount}`);

    // Update canonical_teams to point to keep team
    const canonicalUpdate = await client.query(`
      UPDATE canonical_teams
      SET team_v2_id = $1,
          aliases = array_append(aliases, (SELECT display_name FROM teams_v2 WHERE id = $2))
      WHERE team_v2_id = $2
    `, [keepId, mergeId]);
    console.log(`   Canonical teams updated: ${canonicalUpdate.rowCount}`);

    // Mark the merge team as merged (soft delete)
    const softDelete = await client.query(`
      UPDATE teams_v2
      SET status = 'merged',
          merged_into = $1,
          merged_at = NOW(),
          merge_reason = 'Session 86 duplicate cleanup'
      WHERE id = $2
    `, [keepId, mergeId]);
    console.log(`   Team soft-deleted: ${softDelete.rowCount}`);

    // 2. Also merge the 2014 duplicates
    console.log('\n2. Merging 2014 team duplicates:');

    // Find the team with most matches for 2014
    const teams2014 = await client.query(`
      SELECT id, display_name, matches_played
      FROM teams_v2
      WHERE display_name ILIKE '%SPORTING BV%Pre-NAL%14%'
      AND birth_year = 2014
      ORDER BY matches_played DESC
    `);

    if (teams2014.rows.length > 1) {
      const keepId2014 = teams2014.rows[0].id;
      const mergeIds2014 = teams2014.rows.slice(1).map(t => t.id);

      console.log(`   Keep: ${keepId2014} (${teams2014.rows[0].matches_played} matches)`);
      console.log(`   Merge: ${mergeIds2014.length} teams`);

      for (const mId of mergeIds2014) {
        await client.query(`UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2`, [keepId2014, mId]);
        await client.query(`UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2`, [keepId2014, mId]);
        await client.query(`
          UPDATE teams_v2 SET status = 'merged', merged_into = $1, merged_at = NOW()
          WHERE id = $2
        `, [keepId2014, mId]);
      }
      console.log(`   Merged ${mergeIds2014.length} teams`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Merge complete!');

    // Verify the result
    console.log('\n3. Verifying:');
    const verify = await client.query(`
      SELECT id, display_name, matches_played, status
      FROM teams_v2
      WHERE display_name ILIKE '%Sporting Blue Valley%SPORTING BV%Pre-NAL%'
         OR display_name ILIKE '%SPORTING BV%Pre-NAL%'
      ORDER BY birth_year DESC NULLS LAST, matches_played DESC
    `);
    verify.rows.forEach(t => {
      console.log(`   ${t.display_name}: ${t.matches_played} matches | Status: ${t.status || 'active'}`);
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

merge().catch(console.error);
