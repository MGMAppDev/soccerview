/**
 * fixCrossImportDuplicates.cjs
 *
 * Universal fix: Detect and soft-delete cross-import duplicate matches.
 *
 * Root cause: V1 migration + scrapers both imported the same real-world games,
 * but resolved opponent teams to DIFFERENT teams_v2 records (different name
 * normalization = different IDs). The semantic uniqueness constraint
 * (match_date, home_team_id, away_team_id) doesn't catch these because
 * the team IDs differ.
 *
 * Detection: Same date + same event + one shared team + compatible scores +
 * "different" teams have matching birth_year/gender + name similarity > 0.3
 *
 * Resolution: Always soft-delete the legacy copy, keep the scraper copy.
 *
 * Usage:
 *   node scripts/maintenance/fixCrossImportDuplicates.cjs --dry-run
 *   node scripts/maintenance/fixCrossImportDuplicates.cjs --execute
 *   node scripts/maintenance/fixCrossImportDuplicates.cjs --execute --verbose
 *   node scripts/maintenance/fixCrossImportDuplicates.cjs --execute --no-similarity
 */

require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--execute');
const VERBOSE = process.argv.includes('--verbose');
const SKIP_SIMILARITY = process.argv.includes('--no-similarity');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('\n=== Fix Cross-Import Duplicate Matches (Session 90) ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'EXECUTE'}`);
  console.log(`Similarity check: ${SKIP_SIMILARITY ? 'DISABLED' : 'ENABLED'}\n`);

  const client = await pool.connect();

  try {
    // Authorize pipeline writes
    if (!DRY_RUN) {
      console.log('Authorizing pipeline writes...');
      await client.query("SELECT authorize_pipeline_write()");
      console.log('Pipeline write authorization granted\n');
    }

    // Step 1: Detect cross-import pairs
    console.log('Step 1: Detecting cross-import duplicate pairs...');
    console.log('  (This may take 30-60 seconds for 400K+ matches)\n');

    const detectStart = Date.now();
    await client.query(`
      CREATE TEMP TABLE cross_import_pairs AS
      WITH legacy_matches AS (
        SELECT id, match_date, home_team_id, away_team_id,
               home_score, away_score, league_id, tournament_id,
               source_match_key, source_platform, created_at
        FROM matches_v2
        WHERE deleted_at IS NULL
          AND (source_match_key LIKE 'v1-legacy-%' OR source_match_key LIKE 'legacy-%')
      ),
      scraper_matches AS (
        SELECT id, match_date, home_team_id, away_team_id,
               home_score, away_score, league_id, tournament_id,
               source_match_key, source_platform, created_at
        FROM matches_v2
        WHERE deleted_at IS NULL
          AND source_match_key NOT LIKE 'v1-legacy-%'
          AND source_match_key NOT LIKE 'legacy-%'
      ),
      -- Case 1: shared HOME team, different AWAY team
      shared_home AS (
        SELECT l.id AS legacy_id, s.id AS scraper_id,
               l.match_date, l.home_team_id AS shared_team_id,
               l.away_team_id AS legacy_diff_id, s.away_team_id AS scraper_diff_id,
               l.home_score AS l_hs, l.away_score AS l_as,
               s.home_score AS s_hs, s.away_score AS s_as,
               COALESCE(l.tournament_id, l.league_id) AS l_event,
               COALESCE(s.tournament_id, s.league_id) AS s_event,
               l.source_match_key AS l_key, s.source_match_key AS s_key,
               'shared_home' AS pair_type
        FROM legacy_matches l
        JOIN scraper_matches s ON l.match_date = s.match_date
          AND l.home_team_id = s.home_team_id
          AND l.away_team_id != s.away_team_id
        WHERE (
          (l.tournament_id IS NOT NULL AND l.tournament_id = s.tournament_id)
          OR (l.league_id IS NOT NULL AND l.league_id = s.league_id)
        )
        AND (
          (l.home_score IS NULL OR s.home_score IS NULL)
          OR (l.home_score = s.home_score AND l.away_score = s.away_score)
        )
      ),
      -- Case 2: shared AWAY team, different HOME team
      shared_away AS (
        SELECT l.id AS legacy_id, s.id AS scraper_id,
               l.match_date, l.away_team_id AS shared_team_id,
               l.home_team_id AS legacy_diff_id, s.home_team_id AS scraper_diff_id,
               l.home_score AS l_hs, l.away_score AS l_as,
               s.home_score AS s_hs, s.away_score AS s_as,
               COALESCE(l.tournament_id, l.league_id) AS l_event,
               COALESCE(s.tournament_id, s.league_id) AS s_event,
               l.source_match_key AS l_key, s.source_match_key AS s_key,
               'shared_away' AS pair_type
        FROM legacy_matches l
        JOIN scraper_matches s ON l.match_date = s.match_date
          AND l.away_team_id = s.away_team_id
          AND l.home_team_id != s.home_team_id
        WHERE (
          (l.tournament_id IS NOT NULL AND l.tournament_id = s.tournament_id)
          OR (l.league_id IS NOT NULL AND l.league_id = s.league_id)
        )
        AND (
          (l.home_score IS NULL OR s.home_score IS NULL)
          OR (l.home_score = s.home_score AND l.away_score = s.away_score)
        )
      ),
      -- Case 3: legacy HOME = scraper AWAY (reversed position)
      shared_rev_ha AS (
        SELECT l.id AS legacy_id, s.id AS scraper_id,
               l.match_date, l.home_team_id AS shared_team_id,
               l.away_team_id AS legacy_diff_id, s.home_team_id AS scraper_diff_id,
               l.home_score AS l_hs, l.away_score AS l_as,
               s.home_score AS s_hs, s.away_score AS s_as,
               COALESCE(l.tournament_id, l.league_id) AS l_event,
               COALESCE(s.tournament_id, s.league_id) AS s_event,
               l.source_match_key AS l_key, s.source_match_key AS s_key,
               'shared_reversed' AS pair_type
        FROM legacy_matches l
        JOIN scraper_matches s ON l.match_date = s.match_date
          AND l.home_team_id = s.away_team_id
          AND l.away_team_id != s.home_team_id
        WHERE (
          (l.tournament_id IS NOT NULL AND l.tournament_id = s.tournament_id)
          OR (l.league_id IS NOT NULL AND l.league_id = s.league_id)
        )
        AND (
          (l.home_score IS NULL OR s.home_score IS NULL)
          OR (l.home_score = s.away_score AND l.away_score = s.home_score)
        )
      ),
      -- Case 4: legacy AWAY = scraper HOME (reversed position)
      shared_rev_ah AS (
        SELECT l.id AS legacy_id, s.id AS scraper_id,
               l.match_date, l.away_team_id AS shared_team_id,
               l.home_team_id AS legacy_diff_id, s.away_team_id AS scraper_diff_id,
               l.home_score AS l_hs, l.away_score AS l_as,
               s.home_score AS s_hs, s.away_score AS s_as,
               COALESCE(l.tournament_id, l.league_id) AS l_event,
               COALESCE(s.tournament_id, s.league_id) AS s_event,
               l.source_match_key AS l_key, s.source_match_key AS s_key,
               'shared_reversed' AS pair_type
        FROM legacy_matches l
        JOIN scraper_matches s ON l.match_date = s.match_date
          AND l.away_team_id = s.home_team_id
          AND l.home_team_id != s.away_team_id
        WHERE (
          (l.tournament_id IS NOT NULL AND l.tournament_id = s.tournament_id)
          OR (l.league_id IS NOT NULL AND l.league_id = s.league_id)
        )
        AND (
          (l.home_score IS NULL OR s.home_score IS NULL)
          OR (l.away_score = s.home_score AND l.home_score = s.away_score)
        )
      ),
      all_pairs AS (
        SELECT * FROM shared_home
        UNION ALL SELECT * FROM shared_away
        UNION ALL SELECT * FROM shared_rev_ha
        UNION ALL SELECT * FROM shared_rev_ah
      )
      SELECT DISTINCT ON (LEAST(p.legacy_id, p.scraper_id), GREATEST(p.legacy_id, p.scraper_id))
        p.*,
        lt.birth_year AS l_diff_by, lt.gender AS l_diff_gender, lt.canonical_name AS l_diff_name, lt.display_name AS l_diff_display,
        st.birth_year AS s_diff_by, st.gender AS s_diff_gender, st.canonical_name AS s_diff_name, st.display_name AS s_diff_display
      FROM all_pairs p
      JOIN teams_v2 lt ON lt.id = p.legacy_diff_id
      JOIN teams_v2 st ON st.id = p.scraper_diff_id
      WHERE (lt.birth_year IS NULL OR st.birth_year IS NULL OR ABS(lt.birth_year - st.birth_year) <= 1)
        AND (lt.gender IS NULL OR st.gender IS NULL OR lt.gender = st.gender)
      ORDER BY LEAST(p.legacy_id, p.scraper_id), GREATEST(p.legacy_id, p.scraper_id), p.match_date
    `);

    const detectMs = Date.now() - detectStart;
    const { rows: [countRow] } = await client.query('SELECT COUNT(*) AS cnt FROM cross_import_pairs');
    const totalPairs = parseInt(countRow.cnt);
    console.log(`  Detected ${totalPairs} candidate pairs in ${(detectMs / 1000).toFixed(1)}s\n`);

    if (totalPairs === 0) {
      console.log('No cross-import duplicates found. Done.');
      await client.query('DROP TABLE IF EXISTS cross_import_pairs');
      return;
    }

    // Step 2: Apply similarity filter (optional)
    let filteredOut = 0;
    if (!SKIP_SIMILARITY && totalPairs > 0) {
      console.log('Step 2: Applying pg_trgm similarity filter (threshold > 0.3)...');
      const { rowCount } = await client.query(`
        DELETE FROM cross_import_pairs
        WHERE similarity(COALESCE(l_diff_name, ''), COALESCE(s_diff_name, '')) < 0.3
      `);
      filteredOut = rowCount;
      console.log(`  Filtered out ${filteredOut} false positives (name similarity < 0.3)\n`);
    } else {
      console.log('Step 2: Similarity filter SKIPPED\n');
    }

    const { rows: [afterFilter] } = await client.query('SELECT COUNT(*) AS cnt FROM cross_import_pairs');
    const confirmedPairs = parseInt(afterFilter.cnt);
    console.log(`  Confirmed cross-import duplicates: ${confirmedPairs}\n`);

    if (confirmedPairs === 0) {
      console.log('No confirmed duplicates after filtering. Done.');
      await client.query('DROP TABLE IF EXISTS cross_import_pairs');
      return;
    }

    // Step 3: Report breakdown
    console.log('Step 3: Breakdown\n');

    const { rows: byType } = await client.query(
      'SELECT pair_type, COUNT(*) AS cnt FROM cross_import_pairs GROUP BY pair_type ORDER BY cnt DESC'
    );
    console.log('  By pair type:');
    byType.forEach(r => console.log(`    ${r.pair_type}: ${r.cnt}`));

    const { rows: byPlatform } = await client.query(`
      SELECT
        CASE
          WHEN s_key LIKE 'gotsport-%' THEN 'gotsport'
          WHEN s_key LIKE 'htg-%' THEN 'htgsports'
          WHEN s_key LIKE 'heartland-%' THEN 'heartland'
          ELSE 'other'
        END AS platform,
        COUNT(*) AS cnt
      FROM cross_import_pairs GROUP BY 1 ORDER BY cnt DESC
    `);
    console.log('\n  By scraper platform:');
    byPlatform.forEach(r => console.log(`    ${r.platform}: ${r.cnt}`));

    // Count unique legacy IDs (one legacy could pair with multiple scrapers)
    const { rows: [uniqueIds] } = await client.query(`
      SELECT COUNT(DISTINCT legacy_id) AS legacy_cnt,
             COUNT(DISTINCT scraper_id) AS scraper_cnt
      FROM cross_import_pairs
    `);
    console.log(`\n  Unique legacy matches to soft-delete: ${uniqueIds.legacy_cnt}`);
    console.log(`  Unique scraper matches kept: ${uniqueIds.scraper_cnt}`);

    // Show samples
    if (VERBOSE || confirmedPairs <= 20) {
      const { rows: samples } = await client.query(`
        SELECT legacy_id, scraper_id, match_date, pair_type,
               l_diff_display, s_diff_display,
               l_hs || '-' || l_as AS l_score,
               s_hs || '-' || s_as AS s_score,
               l_key, s_key
        FROM cross_import_pairs
        ORDER BY match_date
        LIMIT 30
      `);
      console.log(`\n  Samples (${Math.min(samples.length, 30)} of ${confirmedPairs}):`);
      samples.forEach(s => {
        console.log(`    ${s.match_date} | ${s.pair_type}`);
        console.log(`      Legacy:  ${s.l_diff_display} | ${s.l_score} | ${s.l_key}`);
        console.log(`      Scraper: ${s.s_diff_display} | ${s.s_score} | ${s.s_key}`);
      });
    } else {
      console.log(`\n  (Use --verbose to see all pairs)`);
    }

    // Step 4: Deduplicate — one legacy match could pair with multiple scraper matches
    // Keep only one pair per legacy_id (the first by match_date)
    console.log('\nStep 4: Deduplicating pairs (one delete per legacy match)...');
    await client.query(`
      DELETE FROM cross_import_pairs p1
      USING cross_import_pairs p2
      WHERE p1.legacy_id = p2.legacy_id
        AND p1.scraper_id > p2.scraper_id
    `);
    const { rows: [dedupCount] } = await client.query('SELECT COUNT(*) AS cnt FROM cross_import_pairs');
    const finalCount = parseInt(dedupCount.cnt);
    console.log(`  Final pairs to process: ${finalCount}\n`);

    // Step 5: Execute
    if (!DRY_RUN) {
      // Audit log
      console.log('Step 5a: Writing audit log...');
      const { rowCount: auditCount } = await client.query(`
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
        SELECT
          'matches_v2',
          p.legacy_id,
          'CROSS_IMPORT_SOFT_DELETE',
          jsonb_build_object(
            'source_match_key', m.source_match_key,
            'home_team_id', m.home_team_id::text,
            'away_team_id', m.away_team_id::text,
            'home_score', m.home_score,
            'away_score', m.away_score,
            'match_date', m.match_date::text,
            'tournament_id', m.tournament_id::text,
            'league_id', m.league_id::text
          ),
          jsonb_build_object(
            'kept_match_id', p.scraper_id::text,
            'pair_type', p.pair_type,
            'legacy_diff_team', p.l_diff_display,
            'scraper_diff_team', p.s_diff_display
          ),
          'fixCrossImportDuplicates',
          NOW()
        FROM cross_import_pairs p
        JOIN matches_v2 m ON m.id = p.legacy_id
      `);
      console.log(`  Audit log entries: ${auditCount}\n`);

      // Soft-delete
      console.log('Step 5b: Soft-deleting legacy matches (bulk UPDATE)...');
      const { rowCount: deleteCount } = await client.query(`
        UPDATE matches_v2 m
        SET deleted_at = NOW(),
            deletion_reason = 'Cross-import duplicate of ' || p.scraper_id::text || ' (' || p.pair_type || ')'
        FROM cross_import_pairs p
        WHERE m.id = p.legacy_id
          AND m.deleted_at IS NULL
      `);
      console.log(`  Soft-deleted: ${deleteCount} matches\n`);
    } else {
      console.log(`Step 5: DRY RUN — would soft-delete ${finalCount} legacy matches\n`);
    }

    // Step 6: Verification
    console.log('Step 6: Verification\n');

    const { rows: [activeCount] } = await client.query(
      "SELECT COUNT(*) AS cnt FROM matches_v2 WHERE deleted_at IS NULL"
    );
    console.log(`  Active matches: ${activeCount.cnt}`);

    // Check the specific team from the bug report
    const { rows: [sbvCheck] } = await client.query(`
      SELECT COUNT(*) AS cnt FROM matches_v2
      WHERE deleted_at IS NULL
        AND tournament_id = '024236d3-12a9-499c-9443-ad1fb5b1ac83'
        AND (home_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92'
          OR away_team_id = 'cc329f08-1f57-4a7b-923a-768b2138fa92')
    `);
    console.log(`  SBV Pre-NAL 15 in Heartland Invitational: ${sbvCheck.cnt} matches (expected: 3)`);

    // Check remaining cross-import pairs
    const { rows: [remainCheck] } = await client.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT l.id
        FROM matches_v2 l
        JOIN matches_v2 s ON l.match_date = s.match_date
          AND l.home_team_id = s.home_team_id
          AND l.away_team_id != s.away_team_id
          AND (l.tournament_id = s.tournament_id OR l.league_id = s.league_id)
        WHERE l.deleted_at IS NULL AND s.deleted_at IS NULL
          AND (l.source_match_key LIKE 'v1-legacy-%' OR l.source_match_key LIKE 'legacy-%')
          AND s.source_match_key NOT LIKE 'v1-legacy-%'
          AND s.source_match_key NOT LIKE 'legacy-%'
          AND (l.home_score IS NULL OR s.home_score IS NULL OR l.home_score = s.home_score)
          AND (l.away_score IS NULL OR s.away_score IS NULL OR l.away_score = s.away_score)
        LIMIT 1
      ) remaining
    `);
    console.log(`  Remaining shared_home cross-import pairs: ${remainCheck.cnt > 0 ? 'some remain' : '0'}`);

    // Cleanup
    await client.query('DROP TABLE IF EXISTS cross_import_pairs');

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Total candidate pairs: ${totalPairs}`);
    console.log(`False positives filtered (similarity): ${filteredOut}`);
    console.log(`Confirmed duplicates: ${confirmedPairs}`);
    console.log(`Final pairs (after dedup): ${finalCount}`);
    if (!DRY_RUN) {
      console.log(`Soft-deleted: ${finalCount}`);
    }
    console.log(`Active matches remaining: ${activeCount.cnt}`);
    console.log(`SBV Pre-NAL 15 tournament matches: ${sbvCheck.cnt}`);
    console.log(`\nPrevention: source_entity_map (Session 89) prevents future cross-import duplicates.`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  pool.end();
  process.exit(1);
});
