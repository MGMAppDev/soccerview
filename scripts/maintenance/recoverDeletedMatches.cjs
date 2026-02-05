/**
 * Session 86: Recover Deleted Matches from audit_log
 * ====================================================
 *
 * Recovers matches deleted by matchDedup.js from the audit_log table.
 * Uses ON CONFLICT (match_date, home_team_id, away_team_id) to handle
 * the semantic uniqueness constraint from Session 85.
 *
 * Usage:
 *   node scripts/maintenance/recoverDeletedMatches.cjs --dry-run   # Preview recovery
 *   node scripts/maintenance/recoverDeletedMatches.cjs --execute   # Execute recovery
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 300000, // 5 minutes
});

async function recoverMatches(dryRun = true) {
  console.log('=== SESSION 86: MATCH RECOVERY ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️  EXECUTE'}\n`);

  const client = await pool.connect();

  try {
    // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes
    if (!dryRun) {
      console.log('🔐 Authorizing pipeline writes...');
      await authorizePipelineWrite(client);
      console.log('✅ Pipeline write authorization granted\n');
    }

    // 1. Count deleted matches from matchDedup
    console.log('1. Counting matchDedup deletions in audit_log...');
    const countResult = await client.query(`
      SELECT COUNT(*) as count
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      AND changed_by = 'matchDedup'
      AND old_data IS NOT NULL
    `);
    const deleteCount = parseInt(countResult.rows[0].count);
    console.log(`   Found ${deleteCount} matches deleted by matchDedup\n`);

    if (deleteCount === 0) {
      console.log('❌ No matchDedup deletions found in audit_log.');
      console.log('   Checking for any DELETE records...');

      const anyDeletes = await client.query(`
        SELECT changed_by, COUNT(*) as count
        FROM audit_log
        WHERE table_name = 'matches_v2' AND action = 'DELETE'
        GROUP BY changed_by
        LIMIT 10
      `);
      console.log('   Deletion sources:', anyDeletes.rows);
      return { recovered: 0, skipped: 0, errors: 0 };
    }

    // 2. Get current matches count
    console.log('2. Current matches_v2 count:');
    const currentCount = await client.query('SELECT COUNT(*) as count FROM matches_v2');
    console.log(`   ${currentCount.rows[0].count} matches\n`);

    // 3. Preview recovery (sample)
    console.log('3. Sample of matches to recover:');
    const sample = await client.query(`
      SELECT
        old_data->>'id' as original_id,
        old_data->>'match_date' as match_date,
        old_data->>'home_score' as home_score,
        old_data->>'away_score' as away_score,
        old_data->>'source_match_key' as source_key
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      AND changed_by = 'matchDedup'
      AND old_data IS NOT NULL
      LIMIT 5
    `);
    sample.rows.forEach((r, i) => {
      console.log(`   [${i+1}] ${r.match_date} | Score: ${r.home_score}-${r.away_score}`);
      console.log(`       Key: ${r.source_key ? r.source_key.substring(0, 40) : 'NULL'}...`);
    });

    if (dryRun) {
      console.log(`\n⚠️  DRY RUN: Would attempt to recover ${deleteCount} matches`);
      console.log('   Use --execute to actually recover the matches');
      return { recovered: 0, skipped: 0, errors: 0, wouldRecover: deleteCount };
    }

    // 4. EXECUTE RECOVERY
    console.log('\n4. Executing recovery...');
    console.log('   This may take a few minutes...\n');

    // Begin transaction
    await client.query('BEGIN');

    // Insert recovered matches with ON CONFLICT for semantic uniqueness
    // COALESCE to merge data: keep existing scores/linkage if present
    const recoveryResult = await client.query(`
      WITH deleted_matches AS (
        SELECT
          (old_data->>'id')::uuid as original_id,
          (old_data->>'match_date')::date as match_date,
          (old_data->>'match_time')::time as match_time,
          (old_data->>'home_team_id')::uuid as home_team_id,
          (old_data->>'away_team_id')::uuid as away_team_id,
          old_data->>'home_team_name' as home_team_name,
          old_data->>'away_team_name' as away_team_name,
          NULLIF(old_data->>'home_score', 'null')::int as home_score,
          NULLIF(old_data->>'away_score', 'null')::int as away_score,
          (old_data->>'league_id')::uuid as league_id,
          (old_data->>'tournament_id')::uuid as tournament_id,
          (old_data->>'venue_id')::uuid as venue_id,
          old_data->>'division' as division,
          old_data->>'source_platform' as source_platform,
          old_data->>'source_match_key' as source_match_key,
          old_data->>'link_status' as link_status
        FROM audit_log
        WHERE table_name = 'matches_v2'
        AND action = 'DELETE'
        AND changed_by = 'matchDedup'
        AND old_data IS NOT NULL
      )
      INSERT INTO matches_v2 (
        id, match_date, match_time,
        home_team_id, away_team_id,
        home_team_name, away_team_name,
        home_score, away_score,
        league_id, tournament_id, venue_id,
        division, source_platform, source_match_key, link_status
      )
      SELECT
        gen_random_uuid(), -- New ID to avoid conflicts
        match_date, match_time,
        home_team_id, away_team_id,
        home_team_name, away_team_name,
        home_score, away_score,
        league_id, tournament_id, venue_id,
        division, source_platform, source_match_key, link_status
      FROM deleted_matches
      ON CONFLICT (match_date, home_team_id, away_team_id) DO UPDATE SET
        -- Merge: prefer non-NULL values
        home_score = COALESCE(matches_v2.home_score, EXCLUDED.home_score),
        away_score = COALESCE(matches_v2.away_score, EXCLUDED.away_score),
        league_id = COALESCE(matches_v2.league_id, EXCLUDED.league_id),
        tournament_id = COALESCE(matches_v2.tournament_id, EXCLUDED.tournament_id),
        -- Keep source_match_key if missing
        source_match_key = COALESCE(matches_v2.source_match_key, EXCLUDED.source_match_key)
      RETURNING id
    `);

    const recovered = recoveryResult.rowCount;
    console.log(`   ✅ Recovered/updated ${recovered} matches`);

    // Commit transaction
    await client.query('COMMIT');

    // 5. Verify new count
    console.log('\n5. Verifying recovery:');
    const newCount = await client.query('SELECT COUNT(*) as count FROM matches_v2');
    console.log(`   New matches_v2 count: ${newCount.rows[0].count}`);
    console.log(`   Previous count: ${currentCount.rows[0].count}`);
    console.log(`   Change: +${parseInt(newCount.rows[0].count) - parseInt(currentCount.rows[0].count)}`);

    // Log recovery to audit_log
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by, changed_at)
      VALUES ('matches_v2', NULL, 'BULK_RECOVERY', $1, 'recoverDeletedMatches', NOW())
    `, [JSON.stringify({
      session: 86,
      source: 'audit_log matchDedup deletions',
      attempted: deleteCount,
      recovered: recovered,
      timestamp: new Date().toISOString()
    })]);

    console.log('\n=== RECOVERY COMPLETE ===\n');

    return {
      attempted: deleteCount,
      recovered: recovered,
      previousCount: parseInt(currentCount.rows[0].count),
      newCount: parseInt(newCount.rows[0].count)
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error during recovery:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// CLI
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

recoverMatches(dryRun)
  .then(result => {
    console.log('Result:', result);
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
