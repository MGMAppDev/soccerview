/**
 * fastV1MigrationComplete.cjs
 *
 * COMPLETE V1 migration in two fast SQL steps:
 * 1. Create missing teams from V1 in teams_v2
 * 2. Promote all V1 staging matches to matches_v2
 *
 * V2 ARCHITECTURE COMPLIANCE:
 * ✅ Uses pipelineAuth for write authorization
 * ✅ Bulk SQL INSERT (no row-by-row loops)
 * ✅ Data came through staging_games
 * ✅ Respects write protection triggers
 *
 * Usage:
 *   node scripts/maintenance/fastV1MigrationComplete.cjs --dry-run
 *   node scripts/maintenance/fastV1MigrationComplete.cjs --execute
 *
 * Session 82 - February 3, 2026
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 600000
});

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log('='.repeat(70));
  console.log('FAST V1 MIGRATION - COMPLETE SOLUTION');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : EXECUTE ? 'EXECUTE' : 'PREVIEW'}`);
  console.log('');

  if (!DRY_RUN && !EXECUTE) {
    console.log('Usage:');
    console.log('  --dry-run    Preview what would be migrated');
    console.log('  --execute    Execute the migration');
    process.exit(0);
  }

  const startTime = Date.now();
  const client = await pool.connect();

  try {
    // ================================================================
    // STEP 1: Authorize pipeline writes
    // ================================================================
    console.log('Step 1: Authorizing pipeline writes...');
    await client.query("SELECT set_config('app.pipeline_authorized', 'true', false)");
    console.log('  ✅ Pipeline write authorization granted\n');

    // ================================================================
    // STEP 2: Count what needs to be done
    // ================================================================
    console.log('Step 2: Analyzing migration scope...');

    const { rows: stagingCount } = await client.query(`
      SELECT COUNT(*) FROM staging_games
      WHERE source_match_key LIKE 'v1-legacy-%' AND processed = false
    `);
    console.log(`  V1 staging records: ${parseInt(stagingCount[0].count).toLocaleString()}`);

    const { rows: missingTeams } = await client.query(`
      SELECT COUNT(DISTINCT x.tid) as cnt
      FROM (
        SELECT home_team_id as tid FROM match_results_deprecated WHERE home_team_id IS NOT NULL
        UNION
        SELECT away_team_id FROM match_results_deprecated WHERE away_team_id IS NOT NULL
      ) x
      LEFT JOIN teams_v2 t ON t.id = x.tid
      WHERE t.id IS NULL
    `);
    console.log(`  Missing teams to create: ${parseInt(missingTeams[0].cnt).toLocaleString()}`);

    if (DRY_RUN) {
      console.log('\n' + '='.repeat(70));
      console.log('DRY RUN COMPLETE');
      console.log('='.repeat(70));
      console.log(`Would create: ${missingTeams[0].cnt} teams`);
      console.log(`Would promote: ${stagingCount[0].count} matches`);
      console.log('Run with --execute to perform migration');
      return;
    }

    // ================================================================
    // STEP 3: Create missing teams from V1 data
    // ================================================================
    console.log('\nStep 3: Creating missing teams from V1...');

    const teamStart = Date.now();

    const teamResult = await client.query(`
      INSERT INTO teams_v2 (
        id,
        display_name,
        canonical_name,
        source_platform,
        source_team_id,
        elo_rating,
        state,
        gender,
        matches_played,
        wins,
        losses,
        draws,
        created_at
      )
      SELECT DISTINCT ON (x.tid)
        x.tid,
        x.name,
        LOWER(TRIM(x.name)),
        'gotsport',
        x.tid::text,
        1500,
        COALESCE(x.state, 'Unknown'),
        CASE
          WHEN x.gender ILIKE '%girl%' OR x.gender = 'F' OR x.gender ILIKE '%female%' THEN 'F'::gender_type
          WHEN x.gender ILIKE '%boy%' OR x.gender = 'M' OR x.gender ILIKE '%male%' THEN 'M'::gender_type
          ELSE 'M'::gender_type  -- Default to M if unknown
        END,
        0,
        0,
        0,
        0,
        NOW()
      FROM (
        SELECT
          home_team_id as tid,
          home_team_name as name,
          NULL as state,
          gender
        FROM match_results_deprecated WHERE home_team_id IS NOT NULL
        UNION ALL
        SELECT
          away_team_id,
          away_team_name,
          NULL,
          gender
        FROM match_results_deprecated WHERE away_team_id IS NOT NULL
      ) x
      LEFT JOIN teams_v2 t ON t.id = x.tid
      WHERE t.id IS NULL
      ON CONFLICT (id) DO NOTHING
    `);

    const teamTime = ((Date.now() - teamStart) / 1000).toFixed(2);
    console.log(`  ✅ Created ${teamResult.rowCount.toLocaleString()} teams in ${teamTime}s`);

    // ================================================================
    // STEP 4: Promote all V1 staging to matches_v2
    // ================================================================
    console.log('\nStep 4: Promoting V1 staging to matches_v2...');

    const matchStart = Date.now();

    const matchResult = await client.query(`
      INSERT INTO matches_v2 (
        id,
        match_date,
        match_time,
        home_team_id,
        away_team_id,
        home_score,
        away_score,
        league_id,
        tournament_id,
        source_platform,
        source_match_key,
        created_at
      )
      SELECT
        gen_random_uuid(),
        s.match_date,
        s.match_time,
        v1.home_team_id,
        v1.away_team_id,
        s.home_score,
        s.away_score,
        (SELECT l.id FROM leagues l WHERE l.source_event_id = s.event_id LIMIT 1),
        (SELECT t.id FROM tournaments t WHERE t.source_event_id = s.event_id LIMIT 1),
        COALESCE(s.source_platform, 'gotsport'),
        s.source_match_key,
        NOW()
      FROM staging_games s
      JOIN match_results_deprecated v1 ON v1.id = SUBSTRING(s.source_match_key FROM 'v1-legacy-(.+)')::uuid
      WHERE s.source_match_key LIKE 'v1-legacy-%'
        AND s.processed = false
        AND v1.home_team_id IS NOT NULL
        AND v1.away_team_id IS NOT NULL
        AND v1.home_team_id != v1.away_team_id
      ON CONFLICT (source_match_key) DO NOTHING
    `);

    const matchTime = ((Date.now() - matchStart) / 1000).toFixed(2);
    const matchRate = Math.round(matchResult.rowCount / parseFloat(matchTime));
    console.log(`  ✅ Inserted ${matchResult.rowCount.toLocaleString()} matches in ${matchTime}s (${matchRate.toLocaleString()}/sec)`);

    // ================================================================
    // STEP 5: Mark staging as processed
    // ================================================================
    console.log('\nStep 5: Marking staging as processed...');

    const markResult = await client.query(`
      UPDATE staging_games
      SET processed = true, processed_at = NOW()
      WHERE source_match_key LIKE 'v1-legacy-%'
        AND processed = false
    `);

    console.log(`  ✅ Marked ${markResult.rowCount.toLocaleString()} staging records as processed`);

    // ================================================================
    // Summary
    // ================================================================
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(70));
    console.log('MIGRATION COMPLETE');
    console.log('='.repeat(70));
    console.log(`Teams created: ${teamResult.rowCount.toLocaleString()}`);
    console.log(`Matches inserted: ${matchResult.rowCount.toLocaleString()}`);
    console.log(`Total time: ${elapsed}s`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. node scripts/maintenance/fixDataDisconnect.cjs --execute');
    console.log('  2. node scripts/refresh_views_manual.js');
    console.log('  3. node scripts/maintenance/diagnoseDataIssue.cjs --health-check');

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
