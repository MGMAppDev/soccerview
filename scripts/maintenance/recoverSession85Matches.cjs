/**
 * Session 86: Recover Session 85 Deleted Matches
 * ================================================
 *
 * Optimized recovery using date filter (faster than scanning full audit_log).
 * Session 85 ran on 2026-02-04, so we filter by that date.
 *
 * Usage:
 *   node scripts/maintenance/recoverSession85Matches.cjs --dry-run
 *   node scripts/maintenance/recoverSession85Matches.cjs --execute
 */
require('dotenv').config();
const { Pool } = require('pg');
const { authorizePipelineWrite } = require('../universal/pipelineAuthCJS.cjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 600000, // 10 minutes for large recovery
});

// Session 85 date
const SESSION_85_DATE = '2026-02-04';

async function recover(dryRun = true) {
  console.log('=== SESSION 86: RECOVER SESSION 85 DELETIONS ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️  EXECUTE'}`);
  console.log(`Filter: Deletions from ${SESSION_85_DATE}\n`);

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    // 1. Get baseline count
    console.log('1. Baseline matches_v2 count...');
    const baseline = await client.query('SELECT COUNT(*) as count FROM matches_v2');
    console.log(`   Current: ${baseline.rows[0].count}\n`);

    // 2. Count today's matchDedup deletions (filtered by date = faster)
    console.log('2. Counting Session 85 deletions (by date)...');
    const countQuery = await client.query(`
      SELECT COUNT(*) as count
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      AND changed_by = 'matchDedup'
      AND changed_at >= $1::date
      AND changed_at < ($1::date + INTERVAL '1 day')
    `, [SESSION_85_DATE]);
    const deleteCount = parseInt(countQuery.rows[0].count);
    console.log(`   Found: ${deleteCount} matches deleted by matchDedup on ${SESSION_85_DATE}\n`);

    if (deleteCount === 0) {
      console.log('❌ No Session 85 deletions found.');
      return { recovered: 0, baseline: parseInt(baseline.rows[0].count) };
    }

    // 3. Sample preview
    console.log('3. Sample of deleted matches:');
    const sample = await client.query(`
      SELECT
        old_data->>'match_date' as match_date,
        old_data->>'home_score' as home_score,
        old_data->>'away_score' as away_score,
        SUBSTRING(old_data->>'source_match_key', 1, 40) as source_key
      FROM audit_log
      WHERE table_name = 'matches_v2'
      AND action = 'DELETE'
      AND changed_by = 'matchDedup'
      AND changed_at >= $1::date
      AND changed_at < ($1::date + INTERVAL '1 day')
      LIMIT 5
    `, [SESSION_85_DATE]);
    sample.rows.forEach((r, i) => {
      console.log(`   [${i+1}] ${r.match_date} | ${r.home_score}-${r.away_score} | ${r.source_key}...`);
    });

    if (dryRun) {
      console.log(`\n⚠️  DRY RUN: Would recover ${deleteCount} matches`);
      console.log('   Use --execute to proceed with recovery');
      return { wouldRecover: deleteCount, baseline: parseInt(baseline.rows[0].count) };
    }

    // 4. Authorize writes
    console.log('\n4. Authorizing pipeline writes...');
    await authorizePipelineWrite(client);
    console.log('   ✅ Authorized\n');

    // 5. EXECUTE BULK RECOVERY (single SQL statement)
    console.log('5. Executing bulk recovery...');
    console.log('   This may take 1-2 minutes for ~8K records...\n');

    await client.query('BEGIN');

    const recoveryResult = await client.query(`
      WITH raw_deleted AS (
        SELECT
          (old_data->>'match_date')::date as match_date,
          CASE
            WHEN old_data->>'match_time' IS NULL OR old_data->>'match_time' = 'null' THEN NULL
            ELSE (old_data->>'match_time')::time
          END as match_time,
          (old_data->>'home_team_id')::uuid as home_team_id,
          (old_data->>'away_team_id')::uuid as away_team_id,
          CASE
            WHEN old_data->>'home_score' IS NULL OR old_data->>'home_score' = 'null' THEN NULL
            ELSE (old_data->>'home_score')::int
          END as home_score,
          CASE
            WHEN old_data->>'away_score' IS NULL OR old_data->>'away_score' = 'null' THEN NULL
            ELSE (old_data->>'away_score')::int
          END as away_score,
          CASE
            WHEN old_data->>'league_id' IS NULL OR old_data->>'league_id' = 'null' THEN NULL
            ELSE (old_data->>'league_id')::uuid
          END as league_id,
          CASE
            WHEN old_data->>'tournament_id' IS NULL OR old_data->>'tournament_id' = 'null' THEN NULL
            ELSE (old_data->>'tournament_id')::uuid
          END as tournament_id,
          CASE
            WHEN old_data->>'venue_id' IS NULL OR old_data->>'venue_id' = 'null' THEN NULL
            ELSE (old_data->>'venue_id')::uuid
          END as venue_id,
          old_data->>'field_name' as field_name,
          old_data->>'source_platform' as source_platform,
          old_data->>'source_match_key' as source_match_key,
          COALESCE(old_data->>'link_status', 'unlinked') as link_status,
          changed_at
        FROM audit_log
        WHERE table_name = 'matches_v2'
        AND action = 'DELETE'
        AND changed_by = 'matchDedup'
        AND changed_at >= $1::date
        AND changed_at < ($1::date + INTERVAL '1 day')
        AND old_data IS NOT NULL
        -- Ensure we have the required fields
        AND old_data->>'home_team_id' IS NOT NULL
        AND old_data->>'away_team_id' IS NOT NULL
        AND old_data->>'match_date' IS NOT NULL
      ),
      -- Deduplicate: keep most recent deletion for each match
      deleted_matches AS (
        SELECT DISTINCT ON (match_date, home_team_id, away_team_id)
          match_date, match_time, home_team_id, away_team_id,
          home_score, away_score, league_id, tournament_id,
          venue_id, field_name, source_platform, source_match_key, link_status
        FROM raw_deleted
        ORDER BY match_date, home_team_id, away_team_id, changed_at DESC
      )
      INSERT INTO matches_v2 (
        id, match_date, match_time,
        home_team_id, away_team_id,
        home_score, away_score,
        league_id, tournament_id, venue_id,
        field_name, source_platform, source_match_key, link_status,
        created_at
      )
      SELECT
        gen_random_uuid(),
        match_date, match_time,
        home_team_id, away_team_id,
        home_score, away_score,
        league_id, tournament_id, venue_id,
        field_name, source_platform, source_match_key, link_status,
        NOW()
      FROM deleted_matches
      ON CONFLICT (match_date, home_team_id, away_team_id) DO UPDATE SET
        -- Merge: keep existing scores if present, otherwise use recovered
        home_score = COALESCE(matches_v2.home_score, EXCLUDED.home_score),
        away_score = COALESCE(matches_v2.away_score, EXCLUDED.away_score),
        -- Merge: keep existing linkage if present, otherwise use recovered
        league_id = COALESCE(matches_v2.league_id, EXCLUDED.league_id),
        tournament_id = COALESCE(matches_v2.tournament_id, EXCLUDED.tournament_id),
        -- Merge source_match_key if missing
        source_match_key = COALESCE(matches_v2.source_match_key, EXCLUDED.source_match_key)
      RETURNING id
    `, [SESSION_85_DATE]);

    const recovered = recoveryResult.rowCount;

    await client.query('COMMIT');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Recovered ${recovered} matches in ${elapsed}s`);

    // 6. Verify new count
    console.log('\n6. Verifying recovery:');
    const newCount = await client.query('SELECT COUNT(*) as count FROM matches_v2');
    const baselineInt = parseInt(baseline.rows[0].count);
    const newCountInt = parseInt(newCount.rows[0].count);
    console.log(`   Previous: ${baselineInt}`);
    console.log(`   Current:  ${newCountInt}`);
    console.log(`   Added:    +${newCountInt - baselineInt}`);

    // 7. Log recovery operation
    await client.query(`
      INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by, changed_at)
      VALUES ('matches_v2', NULL, 'BULK_RECOVERY', $1, 'recoverSession85Matches', NOW())
    `, [JSON.stringify({
      session: 86,
      recoveredFrom: 'Session 85 matchDedup deletions',
      date: SESSION_85_DATE,
      attempted: deleteCount,
      recovered: recovered,
      baseline: baselineInt,
      newTotal: newCountInt
    })]);

    console.log('\n=== RECOVERY COMPLETE ===');
    console.log(`Elapsed time: ${elapsed}s`);
    console.log(`Rate: ${(recovered / parseFloat(elapsed)).toFixed(0)} matches/second\n`);

    return {
      attempted: deleteCount,
      recovered: recovered,
      baseline: baselineInt,
      newTotal: newCountInt,
      elapsed: elapsed
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// CLI
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

recover(dryRun)
  .then(result => {
    console.log('Result:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
