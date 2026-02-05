/**
 * fixBirthYearFromDisplayName.cjs
 *
 * Universal fix: Set birth_year from the 4-digit year in display_name.
 *
 * Root cause: gotsport_rankings importer bypassed normalizers (Session 76)
 * and set birth_year from GotSport's age bracket instead of team name.
 * Result: 22,056 teams appear in wrong age group filters.
 *
 * Phase 1: MERGE conflicting teams FIRST (same canonical_name+name_year+gender+state)
 * Phase 2: UPDATE remaining non-conflicting teams (birth_year + display_name suffix)
 * Phase 3: Refresh materialized views
 *
 * Usage:
 *   node scripts/maintenance/fixBirthYearFromDisplayName.cjs --dry-run
 *   node scripts/maintenance/fixBirthYearFromDisplayName.cjs --execute
 */

require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--execute');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log(`\n=== Fix Birth Year from Display Name ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'EXECUTE'}\n`);

  const client = await pool.connect();

  try {
    // Authorize pipeline writes
    if (!DRY_RUN) {
      console.log('Authorizing pipeline writes...');
      await client.query("SELECT authorize_pipeline_write()");
      console.log('Pipeline write authorization granted\n');
    }

    // Step 1: Quantify the problem
    const { rows: [stats] } = await client.query(`
      SELECT
        COUNT(*) as total_mismatched,
        COUNT(CASE WHEN birth_year < (regexp_match(display_name, '(201[0-9])'))[1]::int THEN 1 END) as by_too_low,
        COUNT(CASE WHEN birth_year > (regexp_match(display_name, '(201[0-9])'))[1]::int THEN 1 END) as by_too_high
      FROM teams_v2
      WHERE display_name ~ '201[0-9]'
        AND birth_year IS NOT NULL
        AND birth_year != (regexp_match(display_name, '(201[0-9])'))[1]::int
    `);
    console.log(`BEFORE: ${stats.total_mismatched} teams with birth_year != name year`);
    console.log(`  - birth_year too low (off by -N): ${stats.by_too_low}`);
    console.log(`  - birth_year too high (off by +N): ${stats.by_too_high}\n`);

    if (parseInt(stats.total_mismatched) === 0) {
      console.log('No mismatches found. Nothing to fix.');
      return;
    }

    // Step 2: Find ALL conflicts - both with existing teams AND intra-set conflicts
    // A conflict is: multiple teams that would end up with same (canonical_name, name_year, gender, state)
    const { rows: conflictGroups } = await client.query(`
      WITH all_teams_after_fix AS (
        -- Mismatched teams: what their target state would be
        SELECT id, canonical_name,
               (regexp_match(display_name, '(201[0-9])'))[1]::int as target_by,
               gender, state, display_name,
               matches_played, elo_rating, national_rank,
               gotsport_rank, gotsport_points,
               'mismatched' as category
        FROM teams_v2
        WHERE display_name ~ '201[0-9]'
          AND birth_year IS NOT NULL
          AND birth_year != (regexp_match(display_name, '(201[0-9])'))[1]::int

        UNION ALL

        -- Existing teams that already have the target birth_year
        SELECT t.id, t.canonical_name, t.birth_year as target_by,
               t.gender, t.state, t.display_name,
               t.matches_played, t.elo_rating, t.national_rank,
               t.gotsport_rank, t.gotsport_points,
               'existing' as category
        FROM teams_v2 t
        WHERE t.birth_year IS NOT NULL
          AND (t.display_name !~ '201[0-9]'
               OR t.birth_year = (regexp_match(t.display_name, '(201[0-9])'))[1]::int)
      )
      SELECT canonical_name, target_by, gender, state,
             json_agg(json_build_object(
               'id', id, 'category', category, 'display_name', display_name,
               'matches_played', matches_played, 'elo_rating', elo_rating,
               'national_rank', national_rank, 'gotsport_rank', gotsport_rank,
               'gotsport_points', gotsport_points
             ) ORDER BY COALESCE(matches_played, 0) DESC) as teams
      FROM all_teams_after_fix
      GROUP BY canonical_name, target_by, gender, state
      HAVING COUNT(*) > 1
    `);

    const mergeIds = new Set(); // IDs to merge away (soft-delete)
    const mergeActions = []; // { keepId, mergeId, transferGS }

    for (const group of conflictGroups) {
      const teams = group.teams;
      // Keep the team with most matches
      const keeper = teams[0]; // Already sorted by matches_played DESC
      for (let i = 1; i < teams.length; i++) {
        const dupe = teams[i];
        mergeIds.add(dupe.id);
        mergeActions.push({
          keepId: keeper.id,
          mergeId: dupe.id,
          // Transfer GotSport data if merger has it and keeper doesn't
          transferGS: dupe.gotsport_rank && !keeper.gotsport_rank
        });
      }
    }

    console.log(`Conflict groups: ${conflictGroups.length}`);
    console.log(`Teams to merge: ${mergeIds.size}`);
    console.log(`Teams to direct-update: ${parseInt(stats.total_mismatched) - mergeIds.size}`);

    // Phase 1: Merge conflicts FIRST
    if (mergeActions.length > 0) {
      console.log(`\nPhase 1: Merging ${mergeActions.length} duplicate team pairs...`);

      if (!DRY_RUN) {
        let mergeCount = 0;
        for (const action of mergeActions) {
          // Soft-delete matches that would conflict with semantic uniqueness
          // (same date + same opponent already exists on keeper)
          await client.query(`
            UPDATE matches_v2 m SET deleted_at = NOW(), deletion_reason = 'Duplicate during birth_year merge to ' || $1
            WHERE m.deleted_at IS NULL AND (
              (m.home_team_id = $2 AND EXISTS (
                SELECT 1 FROM matches_v2 k WHERE k.home_team_id = $1 AND k.away_team_id = m.away_team_id
                  AND k.match_date = m.match_date AND k.deleted_at IS NULL
              ))
              OR (m.away_team_id = $2 AND EXISTS (
                SELECT 1 FROM matches_v2 k WHERE k.away_team_id = $1 AND k.home_team_id = m.home_team_id
                  AND k.match_date = m.match_date AND k.deleted_at IS NULL
              ))
            )
          `, [action.keepId, action.mergeId]);

          // Transfer remaining matches safely
          await client.query(
            `UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2 AND deleted_at IS NULL`,
            [action.keepId, action.mergeId]
          );
          await client.query(
            `UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2 AND deleted_at IS NULL`,
            [action.keepId, action.mergeId]
          );

          // Transfer GotSport data if needed
          if (action.transferGS) {
            await client.query(`
              UPDATE teams_v2 t SET gotsport_rank = s.gotsport_rank, gotsport_points = s.gotsport_points
              FROM teams_v2 s WHERE t.id = $1 AND s.id = $2
            `, [action.keepId, action.mergeId]);
          }

          // Rename merged team to avoid unique constraint on update
          await client.query(
            `UPDATE teams_v2 SET canonical_name = canonical_name || '_merged_' || $2, updated_at = NOW() WHERE id = $1`,
            [action.mergeId, action.keepId]
          );
          mergeCount++;
          if (mergeCount % 50 === 0) console.log(`  Merged ${mergeCount}/${mergeActions.length}...`);
        }
        console.log(`Phase 1 complete: Merged ${mergeCount} teams`);
      } else {
        console.log(`Phase 1: Would merge ${mergeActions.length} teams (dry run)`);
      }
    }

    // Phase 2: UPDATE remaining mismatched teams - exclude any that would still conflict
    if (!DRY_RUN) {
      // Find teams still safe to update (no collision after update)
      const { rowCount: updatedCount } = await client.query(`
        WITH to_update AS (
          SELECT t.id, t.canonical_name,
                 (regexp_match(t.display_name, '(201[0-9])'))[1]::int as name_year,
                 t.gender, t.state
          FROM teams_v2 t
          WHERE t.display_name ~ '201[0-9]'
            AND t.birth_year IS NOT NULL
            AND t.birth_year != (regexp_match(t.display_name, '(201[0-9])'))[1]::int
            AND t.canonical_name NOT LIKE '%_merged_%'
        ),
        safe_to_update AS (
          SELECT u.id FROM to_update u
          WHERE NOT EXISTS (
            -- No other team already has the target identity
            SELECT 1 FROM teams_v2 t2
            WHERE t2.canonical_name = u.canonical_name
              AND t2.birth_year = u.name_year
              AND t2.gender = u.gender
              AND t2.state = u.state
              AND t2.id != u.id
              AND t2.canonical_name NOT LIKE '%_merged_%'
          )
          AND NOT EXISTS (
            -- No other mismatched team targets the same identity
            SELECT 1 FROM to_update u2
            WHERE u2.canonical_name = u.canonical_name
              AND u2.name_year = u.name_year
              AND u2.gender = u.gender
              AND u2.state = u.state
              AND u2.id != u.id
              AND u2.id < u.id  -- Keep the first, skip later ones
          )
        )
        UPDATE teams_v2 t
        SET birth_year = (regexp_match(t.display_name, '(201[0-9])'))[1]::int,
            display_name = regexp_replace(
              t.display_name,
              '\\(U\\d+ (Boys|Girls)\\)',
              '(U' || (get_current_season_year() - (regexp_match(t.display_name, '(201[0-9])'))[1]::int) || ' ' ||
              CASE WHEN t.gender = 'M' THEN 'Boys' WHEN t.gender = 'F' THEN 'Girls' ELSE 'Boys' END || ')'
            ),
            updated_at = NOW()
        FROM safe_to_update s
        WHERE t.id = s.id
      `);
      console.log(`\nPhase 2: Updated ${updatedCount} teams (birth_year + display_name suffix)`);

      // Handle any remaining stragglers (intra-set conflicts) by merging
      const { rows: stragglers } = await client.query(`
        WITH remaining AS (
          SELECT id, canonical_name,
                 (regexp_match(display_name, '(201[0-9])'))[1]::int as name_year,
                 gender, state, matches_played
          FROM teams_v2
          WHERE display_name ~ '201[0-9]'
            AND birth_year IS NOT NULL
            AND birth_year != (regexp_match(display_name, '(201[0-9])'))[1]::int
            AND canonical_name NOT LIKE '%_merged_%'
        )
        SELECT r.id as straggler_id, r.canonical_name, r.name_year, r.gender, r.state,
               t2.id as target_id
        FROM remaining r
        JOIN teams_v2 t2 ON t2.canonical_name = r.canonical_name
          AND t2.birth_year = r.name_year AND t2.gender = r.gender AND t2.state = r.state
          AND t2.id != r.id AND t2.canonical_name NOT LIKE '%_merged_%'
      `);

      if (stragglers.length > 0) {
        console.log(`\nPhase 2b: Merging ${stragglers.length} remaining stragglers...`);
        for (const s of stragglers) {
          await client.query(`
            UPDATE matches_v2 m SET deleted_at = NOW(), deletion_reason = 'Duplicate during birth_year merge to ' || $1
            WHERE m.deleted_at IS NULL AND (
              (m.home_team_id = $2 AND EXISTS (
                SELECT 1 FROM matches_v2 k WHERE k.home_team_id = $1 AND k.away_team_id = m.away_team_id
                  AND k.match_date = m.match_date AND k.deleted_at IS NULL
              ))
              OR (m.away_team_id = $2 AND EXISTS (
                SELECT 1 FROM matches_v2 k WHERE k.away_team_id = $1 AND k.home_team_id = m.home_team_id
                  AND k.match_date = m.match_date AND k.deleted_at IS NULL
              ))
            )
          `, [s.target_id, s.straggler_id]);
          await client.query(`UPDATE matches_v2 SET home_team_id = $1 WHERE home_team_id = $2 AND deleted_at IS NULL`, [s.target_id, s.straggler_id]);
          await client.query(`UPDATE matches_v2 SET away_team_id = $1 WHERE away_team_id = $2 AND deleted_at IS NULL`, [s.target_id, s.straggler_id]);
          await client.query(`UPDATE teams_v2 SET canonical_name = canonical_name || '_merged_' || $2, updated_at = NOW() WHERE id = $1`, [s.straggler_id, s.target_id]);
        }
        console.log(`Phase 2b: Merged ${stragglers.length} stragglers`);
      }
    } else {
      console.log(`\nPhase 2: Would update remaining teams (dry run)`);
    }

    // Step 5: Verify
    const { rows: [after] } = await client.query(`
      SELECT COUNT(*) as remaining_mismatches
      FROM teams_v2
      WHERE display_name ~ '201[0-9]'
        AND birth_year IS NOT NULL
        AND birth_year != (regexp_match(display_name, '(201[0-9])'))[1]::int
        AND canonical_name NOT LIKE '%_merged_%'
    `);
    console.log(`\nAFTER: ${after.remaining_mismatches} teams still mismatched`);

    // Phase 3: Refresh views
    if (!DRY_RUN) {
      console.log('\nPhase 3: Refreshing materialized views...');
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY app_rankings');
      console.log('  app_rankings refreshed');
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY app_matches_feed');
      console.log('  app_matches_feed refreshed');
      console.log('  (app_team_profile skipped - takes 7+ min, refresh separately)');
      console.log('Views refreshed.');
    }

    console.log('\n=== Summary ===');
    console.log(`Total mismatched BEFORE: ${stats.total_mismatched}`);
    console.log(`Phase 1 (merge conflicts): ${mergeActions.length}`);
    console.log(`Phase 2 (direct update): ${parseInt(stats.total_mismatched) - mergeIds.size}`);
    console.log(`Remaining mismatched AFTER: ${after.remaining_mismatches}`);
    console.log(`Prevention: teamNormalizer.js extracts birth_year from name for all pipeline data.`);
    console.log(`Root cause: gotsport_rankings bypassed normalizers (Session 76).`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  pool.end();
  process.exit(1);
});
