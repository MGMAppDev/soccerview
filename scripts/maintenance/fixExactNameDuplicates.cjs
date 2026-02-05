/**
 * Session 86: UNIVERSAL fix for EXACT same display_name duplicates
 *
 * Targets: Teams with IDENTICAL display_name but different IDs
 * These are definite duplicates that should be merged.
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 300000,
});

async function fix(dryRun = true) {
  console.log('=== UNIVERSAL EXACT-NAME DUPLICATE FIX ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️ EXECUTE'}\n`);

  const client = await pool.connect();

  try {
    await authorizePipelineWrite(client);

    // Step 1: Find all display_names with multiple entries
    console.log('1. Finding exact duplicate display_names...');
    const duplicates = await client.query(`
      SELECT
        display_name,
        COUNT(*) as count,
        array_agg(id ORDER BY matches_played DESC, created_at) as team_ids,
        array_agg(birth_year) as birth_years,
        array_agg(gender) as genders,
        array_agg(matches_played) as matches_played_arr
      FROM teams_v2
      WHERE display_name IS NOT NULL
      GROUP BY display_name
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 1000
    `);

    console.log(`   Found ${duplicates.rows.length} display_names with duplicates\n`);

    if (duplicates.rows.length === 0) {
      console.log('✅ No duplicates found!');
      await pool.end();
      return;
    }

    // Show sample
    console.log('Sample duplicates:');
    duplicates.rows.slice(0, 10).forEach(g => {
      console.log(`   "${g.display_name}" - ${g.count} entries`);
      for (let i = 0; i < g.team_ids.length; i++) {
        console.log(`      [${i}] BY:${g.birth_years[i]} G:${g.genders[i]} M:${g.matches_played_arr[i]}`);
      }
    });

    if (dryRun) {
      const totalExtra = duplicates.rows.reduce((sum, g) => sum + g.count - 1, 0);
      console.log(`\n=== DRY RUN SUMMARY ===`);
      console.log(`Groups: ${duplicates.rows.length}`);
      console.log(`Extra teams to delete: ${totalExtra}`);
      console.log('\n⚠️ Use --execute to apply changes.');
      await pool.end();
      return;
    }

    let stats = { groupsProcessed: 0, teamsDeleted: 0, matchesMoved: 0, duplicateMatchesDeleted: 0 };

    // Step 2: Process each duplicate group
    console.log('\n2. Processing duplicates...');

    for (const group of duplicates.rows) {
      const { display_name, team_ids, birth_years, matches_played_arr } = group;
      // Parse genders - pg returns varchar[] as string like "{M,NULL,F}"
      const gendersStr = group.genders || '';
      const gendersArr = gendersStr.replace(/[{}]/g, '').split(',').map(g => g === 'NULL' ? null : g);

      // Choose team to keep: most matches, then most complete metadata
      let keepIndex = 0;
      let maxScore = -1;

      for (let i = 0; i < team_ids.length; i++) {
        const metaScore = (birth_years[i] ? 2 : 0) + (gendersArr[i] ? 1 : 0);
        const score = matches_played_arr[i] * 10 + metaScore;
        if (score > maxScore) {
          maxScore = score;
          keepIndex = i;
        }
      }

      const keepId = team_ids[keepIndex];
      const mergeIds = team_ids.filter((_, i) => i !== keepIndex);

      await client.query('BEGIN');

      try {
        // Fix NULL metadata on keep team
        const bestBirthYear = birth_years.find(b => b !== null);
        const bestGender = gendersArr.find(g => g !== null && g !== '');

        if (bestBirthYear && !birth_years[keepIndex]) {
          await client.query('UPDATE teams_v2 SET birth_year = $1 WHERE id = $2', [bestBirthYear, keepId]);
        }
        if (bestGender && !gendersArr[keepIndex]) {
          await client.query('UPDATE teams_v2 SET gender = $1 WHERE id = $2', [bestGender, keepId]);
        }

        // Bulk update match references
        const { rowCount: home } = await client.query(
          'UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = ANY($2)',
          [keepId, mergeIds]
        );
        const { rowCount: away } = await client.query(
          'UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = ANY($2)',
          [keepId, mergeIds]
        );
        stats.matchesMoved += home + away;

        // Delete duplicate matches (same date + teams)
        const { rowCount: dupeMatches } = await client.query(`
          WITH dupes AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                     PARTITION BY match_date, home_team_id, away_team_id
                     ORDER BY created_at ASC
                   ) as rn
            FROM matches_v2
            WHERE home_team_id = $1 OR away_team_id = $1
          )
          DELETE FROM matches_v2
          WHERE id IN (SELECT id FROM dupes WHERE rn > 1)
        `, [keepId]);
        stats.duplicateMatchesDeleted += dupeMatches;

        // Update matches_played count
        const { rows: count } = await client.query(
          'SELECT COUNT(*) as total FROM matches_v2 WHERE home_team_id = $1 OR away_team_id = $1',
          [keepId]
        );
        await client.query('UPDATE teams_v2 SET matches_played = $1 WHERE id = $2', [parseInt(count[0].total), keepId]);

        // Audit log (bulk)
        await client.query(`
          INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
          SELECT 'teams_v2', id, 'EXACT_NAME_MERGE',
            row_to_json(teams_v2),
            jsonb_build_object('merged_into', $1),
            'fixExactNameDuplicates', NOW()
          FROM teams_v2
          WHERE id = ANY($2)
        `, [keepId, mergeIds]);

        // Delete merged teams
        await client.query('DELETE FROM teams_v2 WHERE id = ANY($1)', [mergeIds]);

        await client.query('COMMIT');

        stats.groupsProcessed++;
        stats.teamsDeleted += mergeIds.length;

      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`   ❌ Error for "${display_name}": ${err.message}`);
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Groups processed: ${stats.groupsProcessed}`);
    console.log(`Teams deleted: ${stats.teamsDeleted}`);
    console.log(`Matches moved: ${stats.matchesMoved}`);
    console.log(`Duplicate matches deleted: ${stats.duplicateMatchesDeleted}`);

  } finally {
    client.release();
    await pool.end();
  }
}

// CLI
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

fix(dryRun).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
