/**
 * Session 86: UNIVERSAL fix for same-name team duplicates
 *
 * This is FASTER than the teamDedup.js same-name mode because:
 * - Uses exact canonical_name match (indexed) instead of similarity()
 * - Groups by canonical_name to find all duplicates at once
 *
 * Targets: Teams with IDENTICAL canonical_name but different birth_year/gender (including NULL)
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 300000,
});

async function fix(dryRun = true) {
  console.log('=== UNIVERSAL SAME-NAME DUPLICATE FIX ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️ EXECUTE'}\n`);

  const client = await pool.connect();

  try {
    await authorizePipelineWrite(client);

    // Step 1: Find all canonical_names with multiple entries
    console.log('1. Finding duplicate canonical_names...');
    const duplicates = await client.query(`
      SELECT
        canonical_name,
        COUNT(*) as count,
        array_agg(id ORDER BY matches_played DESC, created_at) as team_ids,
        array_agg(display_name) as display_names,
        array_agg(birth_year) as birth_years,
        array_agg(gender) as genders,
        array_agg(matches_played) as matches_played_arr
      FROM teams_v2
      WHERE canonical_name IS NOT NULL
        AND matches_played > 0
      GROUP BY canonical_name
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 500
    `);

    console.log(`   Found ${duplicates.rows.length} canonical_names with duplicates\n`);

    if (duplicates.rows.length === 0) {
      console.log('✅ No duplicates found!');
      await pool.end();
      return;
    }

    let stats = { groupsProcessed: 0, teamsDeleted: 0, matchesMoved: 0, duplicateMatchesDeleted: 0 };

    // Step 2: Process each duplicate group
    for (const group of duplicates.rows) {
      const { canonical_name, team_ids, display_names, birth_years, genders, matches_played_arr } = group;

      // Choose team to keep: most matches, then most complete metadata
      let keepIndex = 0;
      let maxScore = -1;

      for (let i = 0; i < team_ids.length; i++) {
        const metaScore = (birth_years[i] ? 2 : 0) + (genders[i] ? 1 : 0);
        const score = matches_played_arr[i] * 10 + metaScore;
        if (score > maxScore) {
          maxScore = score;
          keepIndex = i;
        }
      }

      const keepId = team_ids[keepIndex];
      const mergeIds = team_ids.filter((_, i) => i !== keepIndex);

      console.log(`\n[${canonical_name}]`);
      console.log(`   Keep: ${display_names[keepIndex]} (BY:${birth_years[keepIndex]}, G:${genders[keepIndex]}, ${matches_played_arr[keepIndex]} matches)`);
      for (let i = 0; i < team_ids.length; i++) {
        if (i !== keepIndex) {
          console.log(`   Merge: ${display_names[i]} (BY:${birth_years[i]}, G:${genders[i]}, ${matches_played_arr[i]} matches)`);
        }
      }

      if (dryRun) {
        stats.groupsProcessed++;
        stats.teamsDeleted += mergeIds.length;
        continue;
      }

      await client.query('BEGIN');

      try {
        // Fix NULL metadata on keep team
        const bestBirthYear = birth_years.find(b => b !== null);
        const bestGender = genders.find(g => g !== null);

        if (bestBirthYear && !birth_years[keepIndex]) {
          await client.query('UPDATE teams_v2 SET birth_year = $1 WHERE id = $2', [bestBirthYear, keepId]);
        }
        if (bestGender && !genders[keepIndex]) {
          await client.query('UPDATE teams_v2 SET gender = $1 WHERE id = $2', [bestGender, keepId]);
        }

        // Update match references
        for (const mergeId of mergeIds) {
          const { rowCount: home } = await client.query(
            'UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2',
            [keepId, mergeId]
          );
          const { rowCount: away } = await client.query(
            'UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2',
            [keepId, mergeId]
          );
          stats.matchesMoved += home + away;
        }

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

        // Audit log
        await client.query(`
          INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
          SELECT 'teams_v2', id, 'SAME_NAME_MERGE',
            row_to_json(teams_v2),
            jsonb_build_object('merged_into', $1),
            'fixSameNameDuplicates', NOW()
          FROM teams_v2
          WHERE id = ANY($2)
        `, [keepId, mergeIds]);

        // Delete merged teams
        await client.query('DELETE FROM teams_v2 WHERE id = ANY($1)', [mergeIds]);

        await client.query('COMMIT');

        stats.groupsProcessed++;
        stats.teamsDeleted += mergeIds.length;

        console.log(`   ✅ Merged ${mergeIds.length} teams`);

      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`   ❌ Error: ${err.message}`);
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Groups processed: ${stats.groupsProcessed}`);
    console.log(`Teams ${dryRun ? 'would be ' : ''}deleted: ${stats.teamsDeleted}`);
    console.log(`Matches ${dryRun ? 'would be ' : ''}moved: ${stats.matchesMoved}`);
    console.log(`Duplicate matches ${dryRun ? 'would be ' : ''}deleted: ${stats.duplicateMatchesDeleted}`);

    if (dryRun) {
      console.log('\n⚠️ This was a DRY RUN. Use --execute to apply changes.');
    }

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
