/**
 * Merge V1-Legacy Duplicate Teams — BULK SQL
 * ============================================
 * Session 89: Retroactive fix for v1-legacy duplicate team pairs.
 *
 * ROOT CAUSE: V1 migration created teams with NULL birth_year, NULL gender,
 * state='Unknown'/'XX'. Scrapers later created the SAME real-world team with
 * proper metadata. Result: two teams_v2 records for one real team.
 *
 * APPROACH: Pure bulk SQL on a dedicated client.
 * 1. Detect all pairs in one query → temp table
 * 2. Transfer metadata (bulk UPDATE...FROM)
 * 3. Temporarily drop semantic constraint
 * 4. Bulk update all FK refs
 * 5. Soft-delete newly-created semantic duplicates
 * 6. Recreate constraint
 * 7. Audit log, cleanup, delete merge teams
 *
 * Performance: ~3,000 pairs in < 60 seconds.
 *
 * Usage:
 *   node scripts/maintenance/mergeV1LegacyDuplicates.cjs --dry-run
 *   node scripts/maintenance/mergeV1LegacyDuplicates.cjs --execute
 */

const projDir = 'c:\\Users\\MathieuMiles\\Projects\\soccerview';
require(projDir + '\\node_modules\\dotenv').config({ path: projDir + '\\.env' });
const { Pool } = require(projDir + '\\node_modules\\pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

async function main() {
  console.log('=== MERGE V1-LEGACY DUPLICATE TEAMS (BULK SQL) ===');
  console.log('Mode: ' + (dryRun ? 'DRY RUN' : 'EXECUTE'));
  console.log('');

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    await client.query('SELECT authorize_pipeline_write()');
    console.log('Pipeline authorized');

    // ===================================================================
    // STEP 1: Detect all pairs → temp table
    // Decision logic: keep team with better metadata score
    // ===================================================================
    console.log('\nStep 1: Detecting duplicate pairs...');
    await client.query(`
      CREATE TEMP TABLE merge_pairs AS
      WITH pair_candidates AS (
        SELECT
          t1.id AS id1, t1.birth_year AS by1, t1.gender AS g1,
          t1.state AS st1, t1.matches_played AS mp1,
          t1.canonical_name AS cname,
          t2.id AS id2, t2.birth_year AS by2, t2.gender AS g2,
          t2.state AS st2, t2.matches_played AS mp2,
          -- Metadata score: birth_year=2, gender=1, good state=1
          (CASE WHEN t1.birth_year IS NOT NULL THEN 2 ELSE 0 END
           + CASE WHEN t1.gender IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN t1.state IS NOT NULL AND t1.state != 'unknown' THEN 1 ELSE 0 END) AS score1,
          (CASE WHEN t2.birth_year IS NOT NULL THEN 2 ELSE 0 END
           + CASE WHEN t2.gender IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN t2.state IS NOT NULL AND t2.state != 'unknown' THEN 1 ELSE 0 END) AS score2
        FROM teams_v2 t1
        JOIN teams_v2 t2 ON t1.canonical_name = t2.canonical_name
          AND t1.id < t2.id
        WHERE (t1.birth_year IS NULL OR t2.birth_year IS NULL)
          AND (t1.birth_year IS NULL OR t2.birth_year IS NULL
               OR ABS(t1.birth_year - t2.birth_year) <= 1)
          AND (t1.gender IS NULL OR t2.gender IS NULL OR t1.gender = t2.gender)
          AND (t1.matches_played > 0 OR t2.matches_played > 0)
      )
      SELECT
        CASE
          WHEN score1 > score2 THEN id1
          WHEN score2 > score1 THEN id2
          WHEN mp1 >= mp2 THEN id1
          ELSE id2
        END AS keep_id,
        CASE
          WHEN score1 > score2 THEN id2
          WHEN score2 > score1 THEN id1
          WHEN mp1 >= mp2 THEN id2
          ELSE id1
        END AS merge_id
      FROM pair_candidates
    `);

    const { rows: [{ count: pairCount }] } = await client.query('SELECT COUNT(*) FROM merge_pairs');
    console.log('  Detected ' + pairCount + ' pairs');

    if (parseInt(pairCount) === 0) {
      console.log('  No duplicates to merge!');
      return;
    }

    // Show samples
    const { rows: samples } = await client.query(`
      SELECT mp.keep_id, mp.merge_id,
             k.canonical_name, k.birth_year as k_by, k.gender as k_g, k.state as k_st, k.matches_played as k_mp,
             m.birth_year as m_by, m.gender as m_g, m.state as m_st, m.matches_played as m_mp
      FROM merge_pairs mp
      JOIN teams_v2 k ON k.id = mp.keep_id
      JOIN teams_v2 m ON m.id = mp.merge_id
      ORDER BY (k.matches_played + m.matches_played) DESC
      LIMIT 5
    `);
    console.log('\n  Top 5 pairs:');
    samples.forEach(s => {
      console.log('    "' + s.canonical_name + '"');
      console.log('      Keep:  BY=' + s.k_by + ' G=' + s.k_g + ' ST=' + s.k_st + ' MP=' + s.k_mp);
      console.log('      Merge: BY=' + s.m_by + ' G=' + s.m_g + ' ST=' + s.m_st + ' MP=' + s.m_mp);
    });

    if (dryRun) {
      const { rows: [{ total_matches }] } = await client.query(`
        SELECT SUM(t.matches_played) as total_matches
        FROM merge_pairs mp
        JOIN teams_v2 t ON t.id = mp.merge_id
      `);
      console.log('\n  DRY RUN SUMMARY:');
      console.log('    Pairs to merge: ' + pairCount);
      console.log('    Merge team matches to reassign: ' + (total_matches || 0));
      console.log('\n  Run with --execute to apply.');
      await client.query('DROP TABLE IF EXISTS merge_pairs');
      return;
    }

    // ===================================================================
    // STEP 2: Temporarily drop constraints that may block bulk operations
    // ===================================================================
    console.log('\nStep 2: Temporarily dropping constraints...');
    await client.query('DROP INDEX IF EXISTS unique_match_semantic');
    await client.query('ALTER TABLE teams_v2 DROP CONSTRAINT IF EXISTS unique_team_identity');
    console.log('  Constraints dropped (unique_match_semantic + unique_team_identity)');

    // ===================================================================
    // STEP 3: Transfer metadata from merge → keep (BULK)
    // ===================================================================
    console.log('\nStep 3: Transferring metadata...');
    const { rowCount: metaUpdated } = await client.query(`
      UPDATE teams_v2 k
      SET
        birth_year = COALESCE(k.birth_year, m.birth_year),
        gender = COALESCE(k.gender, m.gender),
        state = CASE
          WHEN k.state = 'unknown' AND m.state != 'unknown' THEN m.state
          ELSE k.state
        END,
        display_name = CASE
          WHEN LENGTH(COALESCE(m.display_name, '')) > LENGTH(COALESCE(k.display_name, ''))
          THEN m.display_name ELSE k.display_name
        END
      FROM merge_pairs mp
      JOIN teams_v2 m ON m.id = mp.merge_id
      WHERE k.id = mp.keep_id
    `);
    console.log('  Metadata transferred for ' + metaUpdated + ' teams');

    // ===================================================================
    // STEP 3: Audit log (before deletion)
    // ===================================================================
    console.log('\nStep 3: Writing audit log...');
    const { rowCount: auditRows } = await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
      SELECT 'teams_v2', mp.merge_id, 'V1_LEGACY_MERGE',
        jsonb_build_object(
          'canonical_name', t.canonical_name,
          'display_name', t.display_name,
          'birth_year', t.birth_year,
          'gender', t.gender::text,
          'state', t.state,
          'matches_played', t.matches_played
        ),
        jsonb_build_object('merged_into', mp.keep_id::text),
        'mergeV1LegacyBulk', NOW()
      FROM merge_pairs mp
      JOIN teams_v2 t ON t.id = mp.merge_id
    `);
    console.log('  Audit entries: ' + auditRows);

    // ===================================================================
    // STEP 4b: Soft-delete matches where BOTH teams merge into same keep team
    // These would violate the different_teams_match constraint
    // ===================================================================
    console.log('\nStep 4b: Soft-deleting intra-squad matches...');
    const { rowCount: intraSoftDeleted } = await client.query(`
      UPDATE matches_v2 m
      SET deleted_at = NOW(),
          deletion_reason = 'Both teams merged to same entity (intra-squad)'
      FROM merge_pairs mp_home, merge_pairs mp_away
      WHERE m.home_team_id = mp_home.merge_id
        AND m.away_team_id = mp_away.merge_id
        AND mp_home.keep_id = mp_away.keep_id
        AND m.deleted_at IS NULL
    `);
    // Also catch: home=merge, away=keep (same team after merge)
    const { rowCount: intraSoftDeleted2 } = await client.query(`
      UPDATE matches_v2 m
      SET deleted_at = NOW(),
          deletion_reason = 'Both teams merged to same entity (intra-squad)'
      FROM merge_pairs mp
      WHERE m.deleted_at IS NULL
        AND (
          (m.home_team_id = mp.merge_id AND m.away_team_id = mp.keep_id)
          OR (m.away_team_id = mp.merge_id AND m.home_team_id = mp.keep_id)
        )
    `);
    console.log('  Intra-squad matches soft-deleted: ' + (intraSoftDeleted + intraSoftDeleted2));

    // ===================================================================
    // STEP 5: Bulk update FK refs (BULK UPDATE...FROM)
    // ===================================================================
    console.log('\nStep 5: Updating match FK refs...');
    const { rowCount: homeUpdated } = await client.query(`
      UPDATE matches_v2 m
      SET home_team_id = mp.keep_id
      FROM merge_pairs mp
      WHERE m.home_team_id = mp.merge_id
        AND m.deleted_at IS NULL
    `);
    console.log('  Home FK updated: ' + homeUpdated);

    const { rowCount: awayUpdated } = await client.query(`
      UPDATE matches_v2 m
      SET away_team_id = mp.keep_id
      FROM merge_pairs mp
      WHERE m.away_team_id = mp.merge_id
        AND m.deleted_at IS NULL
    `);
    console.log('  Away FK updated: ' + awayUpdated);

    // ===================================================================
    // STEP 6: Soft-delete semantic duplicates created by FK merge
    // Keeps oldest match (by created_at), prefers non-v1-legacy source
    // ===================================================================
    console.log('\nStep 6: Soft-deleting semantic duplicates...');
    const { rowCount: dupesDeleted } = await client.query(`
      UPDATE matches_v2
      SET deleted_at = NOW(),
          deletion_reason = 'Semantic duplicate from v1-legacy bulk merge'
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY match_date, home_team_id, away_team_id
                   ORDER BY
                     CASE WHEN source_match_key LIKE 'v1-%' OR source_match_key LIKE 'legacy-%' THEN 1 ELSE 0 END,
                     created_at ASC
                 ) AS rn
          FROM matches_v2
          WHERE deleted_at IS NULL
        ) ranked
        WHERE rn > 1
      )
    `);
    console.log('  Semantic duplicates soft-deleted: ' + dupesDeleted);

    // ===================================================================
    // STEP 7: Handle 3-way team duplicates created by metadata transfer
    // After filling NULL birth_year, some keep teams may now share
    // (canonical_name, birth_year, gender, state) with other teams.
    // Merge these too before recreating the constraint.
    // ===================================================================
    console.log('\nStep 7: Handling 3-way team duplicates...');
    const { rowCount: threeWayMerged } = await client.query(`
      WITH team_dupes AS (
        SELECT canonical_name, birth_year, gender, state,
               array_agg(id ORDER BY matches_played DESC, created_at) AS ids,
               COUNT(*) AS cnt
        FROM teams_v2
        WHERE canonical_name IS NOT NULL
        GROUP BY canonical_name, birth_year, gender, state
        HAVING COUNT(*) > 1
      ),
      to_delete AS (
        SELECT unnest(ids[2:]) AS merge_id, ids[1] AS keep_id
        FROM team_dupes
      )
      -- Delete the extra teams (update their match refs first)
      UPDATE matches_v2 m
      SET home_team_id = td.keep_id
      FROM to_delete td
      WHERE m.home_team_id = td.merge_id AND m.deleted_at IS NULL
    `);
    console.log('  3-way home FK updated: ' + threeWayMerged);

    const { rowCount: threeWayAway } = await client.query(`
      WITH team_dupes AS (
        SELECT canonical_name, birth_year, gender, state,
               array_agg(id ORDER BY matches_played DESC, created_at) AS ids
        FROM teams_v2
        WHERE canonical_name IS NOT NULL
        GROUP BY canonical_name, birth_year, gender, state
        HAVING COUNT(*) > 1
      ),
      to_delete AS (
        SELECT unnest(ids[2:]) AS merge_id, ids[1] AS keep_id
        FROM team_dupes
      )
      UPDATE matches_v2 m
      SET away_team_id = td.keep_id
      FROM to_delete td
      WHERE m.away_team_id = td.merge_id AND m.deleted_at IS NULL
    `);
    console.log('  3-way away FK updated: ' + threeWayAway);

    // Soft-delete any new semantic match duplicates from 3-way merges
    const { rowCount: threeWayDupes } = await client.query(`
      UPDATE matches_v2
      SET deleted_at = NOW(),
          deletion_reason = 'Semantic duplicate from 3-way team merge'
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY match_date, home_team_id, away_team_id
            ORDER BY CASE WHEN source_match_key LIKE 'v1-%' OR source_match_key LIKE 'legacy-%' THEN 1 ELSE 0 END,
                     created_at ASC
          ) AS rn
          FROM matches_v2 WHERE deleted_at IS NULL
        ) x WHERE rn > 1
      )
    `);
    console.log('  3-way semantic duplicates soft-deleted: ' + threeWayDupes);

    // Now delete the 3-way duplicate teams
    const { rowCount: threeWayTeamsDeleted } = await client.query(`
      WITH team_dupes AS (
        SELECT canonical_name, birth_year, gender, state,
               array_agg(id ORDER BY matches_played DESC, created_at) AS ids
        FROM teams_v2
        WHERE canonical_name IS NOT NULL
        GROUP BY canonical_name, birth_year, gender, state
        HAVING COUNT(*) > 1
      ),
      to_delete AS (
        SELECT unnest(ids[2:]) AS merge_id FROM team_dupes
      )
      DELETE FROM canonical_teams WHERE team_v2_id IN (SELECT merge_id FROM to_delete)
    `);

    await client.query(`
      WITH team_dupes AS (
        SELECT canonical_name, birth_year, gender, state,
               array_agg(id ORDER BY matches_played DESC, created_at) AS ids
        FROM teams_v2
        WHERE canonical_name IS NOT NULL
        GROUP BY canonical_name, birth_year, gender, state
        HAVING COUNT(*) > 1
      ),
      to_delete AS (
        SELECT unnest(ids[2:]) AS merge_id FROM team_dupes
      )
      DELETE FROM rank_history_v2 WHERE team_id IN (SELECT merge_id FROM to_delete)
    `);

    const { rowCount: threeWayTeams } = await client.query(`
      WITH team_dupes AS (
        SELECT canonical_name, birth_year, gender, state,
               array_agg(id ORDER BY matches_played DESC, created_at) AS ids
        FROM teams_v2
        WHERE canonical_name IS NOT NULL
        GROUP BY canonical_name, birth_year, gender, state
        HAVING COUNT(*) > 1
      ),
      to_delete AS (
        SELECT unnest(ids[2:]) AS merge_id FROM team_dupes
      )
      DELETE FROM teams_v2 WHERE id IN (SELECT merge_id FROM to_delete)
    `);
    console.log('  3-way duplicate teams deleted: ' + threeWayTeams);

    // ===================================================================
    // STEP 7b: Final cleanup loop — keep deduplicating until clean
    // ===================================================================
    console.log('\nStep 7b: Final dedup cleanup...');
    let totalFinalDupes = 0;
    for (let pass = 1; pass <= 5; pass++) {
      const { rowCount: finalDupes } = await client.query(`
        UPDATE matches_v2
        SET deleted_at = NOW(),
            deletion_reason = 'Final cleanup pass ' || $1 || ' from v1-legacy bulk merge'
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY match_date, home_team_id, away_team_id
              ORDER BY CASE WHEN source_match_key LIKE 'v1-%' OR source_match_key LIKE 'legacy-%' THEN 1 ELSE 0 END,
                       created_at ASC
            ) AS rn
            FROM matches_v2 WHERE deleted_at IS NULL
          ) x WHERE rn > 1
        )
      `, [pass]);
      totalFinalDupes += finalDupes;
      console.log('  Pass ' + pass + ': ' + finalDupes + ' duplicates soft-deleted');
      if (finalDupes === 0) break;
    }
    console.log('  Total final cleanup: ' + totalFinalDupes);

    // Also handle any remaining team duplicates
    let totalTeamDupes = 0;
    for (let pass = 1; pass <= 3; pass++) {
      const { rows: [{ cnt }] } = await client.query(`
        SELECT COUNT(*) AS cnt FROM (
          SELECT canonical_name, birth_year, gender, state
          FROM teams_v2
          WHERE canonical_name IS NOT NULL
          GROUP BY canonical_name, birth_year, gender, state
          HAVING COUNT(*) > 1
        ) x
      `);
      if (parseInt(cnt) === 0) break;
      console.log('  Team dedup pass ' + pass + ': ' + cnt + ' groups');

      // Update FKs
      await client.query(`
        WITH team_dupes AS (
          SELECT canonical_name, birth_year, gender, state,
                 array_agg(id ORDER BY matches_played DESC, created_at) AS ids
          FROM teams_v2 WHERE canonical_name IS NOT NULL
          GROUP BY canonical_name, birth_year, gender, state
          HAVING COUNT(*) > 1
        ),
        to_merge AS (
          SELECT ids[1] AS keep_id, unnest(ids[2:]) AS merge_id FROM team_dupes
        )
        UPDATE matches_v2 m SET home_team_id = tm.keep_id
        FROM to_merge tm WHERE m.home_team_id = tm.merge_id AND m.deleted_at IS NULL
      `);
      await client.query(`
        WITH team_dupes AS (
          SELECT canonical_name, birth_year, gender, state,
                 array_agg(id ORDER BY matches_played DESC, created_at) AS ids
          FROM teams_v2 WHERE canonical_name IS NOT NULL
          GROUP BY canonical_name, birth_year, gender, state
          HAVING COUNT(*) > 1
        ),
        to_merge AS (
          SELECT ids[1] AS keep_id, unnest(ids[2:]) AS merge_id FROM team_dupes
        )
        UPDATE matches_v2 m SET away_team_id = tm.keep_id
        FROM to_merge tm WHERE m.away_team_id = tm.merge_id AND m.deleted_at IS NULL
      `);

      // Dedup matches
      await client.query(`
        UPDATE matches_v2
        SET deleted_at = NOW(), deletion_reason = 'Team dedup cleanup pass ' || $1
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY match_date, home_team_id, away_team_id
              ORDER BY created_at ASC
            ) AS rn FROM matches_v2 WHERE deleted_at IS NULL
          ) x WHERE rn > 1
        )
      `, [pass]);

      // Delete dupe teams
      await client.query(`
        WITH team_dupes AS (
          SELECT canonical_name, birth_year, gender, state,
                 array_agg(id ORDER BY matches_played DESC, created_at) AS ids
          FROM teams_v2 WHERE canonical_name IS NOT NULL
          GROUP BY canonical_name, birth_year, gender, state
          HAVING COUNT(*) > 1
        ),
        to_merge AS (
          SELECT unnest(ids[2:]) AS merge_id FROM team_dupes
        )
        DELETE FROM canonical_teams WHERE team_v2_id IN (SELECT merge_id FROM to_merge)
      `);
      await client.query(`
        WITH team_dupes AS (
          SELECT canonical_name, birth_year, gender, state,
                 array_agg(id ORDER BY matches_played DESC, created_at) AS ids
          FROM teams_v2 WHERE canonical_name IS NOT NULL
          GROUP BY canonical_name, birth_year, gender, state
          HAVING COUNT(*) > 1
        ),
        to_merge AS (
          SELECT unnest(ids[2:]) AS merge_id FROM team_dupes
        )
        DELETE FROM rank_history_v2 WHERE team_id IN (SELECT merge_id FROM to_merge)
      `);
      const { rowCount: deletedTeams } = await client.query(`
        WITH team_dupes AS (
          SELECT canonical_name, birth_year, gender, state,
                 array_agg(id ORDER BY matches_played DESC, created_at) AS ids
          FROM teams_v2 WHERE canonical_name IS NOT NULL
          GROUP BY canonical_name, birth_year, gender, state
          HAVING COUNT(*) > 1
        ),
        to_merge AS (
          SELECT unnest(ids[2:]) AS merge_id FROM team_dupes
        )
        DELETE FROM teams_v2 WHERE id IN (SELECT merge_id FROM to_merge)
      `);
      totalTeamDupes += deletedTeams;
      console.log('    Deleted ' + deletedTeams + ' duplicate teams');
    }

    // ===================================================================
    // STEP 7c: Recreate ALL constraints
    // ===================================================================
    console.log('\nStep 7c: Recreating constraints...');
    // Use partial unique index (not constraint) to allow soft-deleted duplicates
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS unique_match_semantic
      ON matches_v2 (match_date, home_team_id, away_team_id)
      WHERE deleted_at IS NULL
    `);
    console.log('  unique_match_semantic restored (partial index)');

    await client.query(`
      ALTER TABLE teams_v2
      ADD CONSTRAINT unique_team_identity
      UNIQUE (canonical_name, birth_year, gender, state)
    `);
    console.log('  unique_team_identity restored');

    // ===================================================================
    // STEP 8: Transfer source_entity_map entries
    // ===================================================================
    console.log('\nStep 8: Transferring source entity mappings...');
    const { rowCount: semUpdated } = await client.query(`
      UPDATE source_entity_map sem
      SET sv_id = mp.keep_id, updated_at = NOW()
      FROM merge_pairs mp
      WHERE sem.sv_id = mp.merge_id
        AND sem.entity_type = 'team'
    `);
    console.log('  Source entity mappings transferred: ' + semUpdated);

    // ===================================================================
    // STEP 9: Self-learning — bulk update canonical_teams aliases
    // ===================================================================
    console.log('\nStep 9: Updating canonical registry (self-learning)...');
    const { rowCount: aliasesUpdated } = await client.query(`
      UPDATE canonical_teams ct
      SET aliases = (
        SELECT array_agg(DISTINCT a)
        FROM (
          SELECT unnest(COALESCE(ct.aliases, ARRAY[]::text[])) AS a
          UNION
          SELECT t.display_name
          FROM merge_pairs mp
          JOIN teams_v2 t ON t.id = mp.merge_id
          WHERE mp.keep_id = ct.team_v2_id
            AND t.display_name IS NOT NULL
        ) combined
      ),
      updated_at = NOW()
      WHERE ct.team_v2_id IN (SELECT keep_id FROM merge_pairs)
        AND EXISTS (
          SELECT 1 FROM merge_pairs mp
          JOIN teams_v2 t ON t.id = mp.merge_id
          WHERE mp.keep_id = ct.team_v2_id
            AND t.display_name IS NOT NULL
        )
    `);
    console.log('  Canonical aliases updated: ' + aliasesUpdated);

    // ===================================================================
    // STEP 10: Delete FK refs and merge teams (BULK)
    // ===================================================================
    console.log('\nStep 10: Deleting merge team records...');

    const { rowCount: canonDeleted } = await client.query(`
      DELETE FROM canonical_teams WHERE team_v2_id IN (SELECT merge_id FROM merge_pairs)
    `);
    console.log('  Canonical team entries deleted: ' + canonDeleted);

    const { rowCount: rankHistDeleted } = await client.query(`
      DELETE FROM rank_history_v2 WHERE team_id IN (SELECT merge_id FROM merge_pairs)
    `);
    console.log('  Rank history entries deleted: ' + rankHistDeleted);

    const { rowCount: teamsDeleted } = await client.query(`
      DELETE FROM teams_v2 WHERE id IN (SELECT merge_id FROM merge_pairs)
    `);
    console.log('  Merge teams deleted: ' + teamsDeleted);

    // ===================================================================
    // STEP 11: Recalculate matches_played for affected keep teams
    // ===================================================================
    console.log('\nStep 11: Recalculating matches_played...');
    const { rowCount: mpUpdated } = await client.query(`
      UPDATE teams_v2 t
      SET matches_played = COALESCE(sub.cnt, 0)
      FROM (
        SELECT team_id, COUNT(*) AS cnt FROM (
          SELECT home_team_id AS team_id FROM matches_v2 WHERE deleted_at IS NULL
          UNION ALL
          SELECT away_team_id FROM matches_v2 WHERE deleted_at IS NULL
        ) x
        WHERE team_id IN (SELECT keep_id FROM merge_pairs)
        GROUP BY team_id
      ) sub
      WHERE t.id = sub.team_id
    `);
    console.log('  matches_played recalculated for ' + mpUpdated + ' teams');

    // Cleanup temp table
    await client.query('DROP TABLE IF EXISTS merge_pairs');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n=== MERGE COMPLETE ===');
    console.log('  Teams merged: ' + teamsDeleted);
    console.log('  Matches FK-updated: ' + (homeUpdated + awayUpdated));
    console.log('  Semantic duplicates soft-deleted: ' + dupesDeleted);
    console.log('  Time: ' + elapsed + 's');

  } catch (err) {
    // If we failed after dropping constraints, try to restore them
    try {
      await client.query('CREATE UNIQUE INDEX IF NOT EXISTS unique_match_semantic ON matches_v2 (match_date, home_team_id, away_team_id) WHERE deleted_at IS NULL');
    } catch (_) { /* may already exist */ }
    try {
      await client.query('ALTER TABLE teams_v2 ADD CONSTRAINT unique_team_identity UNIQUE (canonical_name, birth_year, gender, state)');
    } catch (_) { /* may already exist */ }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
