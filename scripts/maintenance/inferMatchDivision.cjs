/**
 * inferMatchDivision.cjs — Infer NULL division from team's other matches
 *
 * Phase 9, Issue #3 Layer 2: For remaining NULL-division league matches,
 * infer division from the team's majority division in the same league.
 *
 * In youth soccer, a team plays in exactly ONE division per league per season.
 * If a team has 7 "Division 1" matches and 1 NULL match in the same league,
 * the NULL one is also Division 1.
 *
 * Universal: works for ANY source platform. No source-specific logic.
 * Uses pipeline auth + dedicated client per MEMORY.md.
 *
 * Usage:
 *   node scripts/maintenance/inferMatchDivision.cjs --dry-run
 *   node scripts/maintenance/inferMatchDivision.cjs --execute
 */
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  console.log('=== INFER MATCH DIVISION FROM TEAM CONTEXT ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}\n`);

  // Get a dedicated client for pipeline auth
  const client = await pool.connect();

  try {
    // Pipeline auth (required for writes)
    if (!dryRun) {
      await client.query('SELECT authorize_pipeline_write()');
    }

    // Step 1: Show current state
    const { rows: beforeStats } = await client.query(`
      SELECT
        source_platform,
        COUNT(*) FILTER (WHERE division IS NOT NULL) as with_div,
        COUNT(*) FILTER (WHERE division IS NULL AND league_id IS NOT NULL) as null_league,
        COUNT(*) FILTER (WHERE division IS NULL AND league_id IS NULL) as null_no_league
      FROM matches_v2
      WHERE deleted_at IS NULL
      GROUP BY source_platform
      ORDER BY source_platform NULLS LAST
    `);
    console.log('Before — Division status by source:');
    for (const r of beforeStats) {
      console.log(`  ${r.source_platform || 'NULL'}: ${r.with_div} with div, ${r.null_league} NULL (league), ${r.null_no_league} NULL (no league)`);
    }
    console.log();

    // Step 2: Count how many can be inferred
    const { rows: previewRows } = await client.query(`
      WITH team_division AS (
        SELECT team_id, league_id, division, COUNT(*) as cnt FROM (
          SELECT home_team_id as team_id, league_id, division FROM matches_v2
          WHERE division IS NOT NULL AND deleted_at IS NULL AND league_id IS NOT NULL
          UNION ALL
          SELECT away_team_id as team_id, league_id, division FROM matches_v2
          WHERE division IS NOT NULL AND deleted_at IS NULL AND league_id IS NOT NULL
        ) x GROUP BY team_id, league_id, division
      ),
      best_division AS (
        SELECT DISTINCT ON (team_id, league_id) team_id, league_id, division
        FROM team_division ORDER BY team_id, league_id, cnt DESC
      )
      SELECT COUNT(*) as cnt
      FROM matches_v2 m
      WHERE m.division IS NULL AND m.deleted_at IS NULL AND m.league_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM best_division bd
          WHERE (bd.team_id = m.home_team_id OR bd.team_id = m.away_team_id)
            AND bd.league_id = m.league_id
        )
    `);
    console.log(`Matches eligible for inference: ${previewRows[0].cnt}`);

    // Step 3: Show per-league breakdown
    const { rows: leagueBreakdown } = await client.query(`
      WITH team_division AS (
        SELECT team_id, league_id, division, COUNT(*) as cnt FROM (
          SELECT home_team_id as team_id, league_id, division FROM matches_v2
          WHERE division IS NOT NULL AND deleted_at IS NULL AND league_id IS NOT NULL
          UNION ALL
          SELECT away_team_id as team_id, league_id, division FROM matches_v2
          WHERE division IS NOT NULL AND deleted_at IS NULL AND league_id IS NOT NULL
        ) x GROUP BY team_id, league_id, division
      ),
      best_division AS (
        SELECT DISTINCT ON (team_id, league_id) team_id, league_id, division
        FROM team_division ORDER BY team_id, league_id, cnt DESC
      )
      SELECT l.name as league_name, COUNT(*) as inferable
      FROM matches_v2 m
      JOIN leagues l ON l.id = m.league_id
      WHERE m.division IS NULL AND m.deleted_at IS NULL AND m.league_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM best_division bd
          WHERE (bd.team_id = m.home_team_id OR bd.team_id = m.away_team_id)
            AND bd.league_id = m.league_id
        )
      GROUP BY l.name
      ORDER BY inferable DESC
    `);
    console.log('\nPer-league breakdown:');
    for (const r of leagueBreakdown) {
      console.log(`  ${r.league_name}: ${r.inferable} matches`);
    }

    if (dryRun) {
      console.log('\n[DRY RUN] No changes made. Run with --execute to apply.\n');
      return;
    }

    // Step 4: Execute the inference UPDATE
    console.log('\nExecuting inference UPDATE...');
    const startTime = Date.now();

    const { rowCount } = await client.query(`
      WITH team_division AS (
        SELECT team_id, league_id, division, COUNT(*) as cnt FROM (
          SELECT home_team_id as team_id, league_id, division FROM matches_v2
          WHERE division IS NOT NULL AND deleted_at IS NULL AND league_id IS NOT NULL
          UNION ALL
          SELECT away_team_id as team_id, league_id, division FROM matches_v2
          WHERE division IS NOT NULL AND deleted_at IS NULL AND league_id IS NOT NULL
        ) x GROUP BY team_id, league_id, division
      ),
      best_division AS (
        SELECT DISTINCT ON (team_id, league_id) team_id, league_id, division
        FROM team_division ORDER BY team_id, league_id, cnt DESC
      )
      UPDATE matches_v2 m SET division = COALESCE(
        (SELECT division FROM best_division WHERE team_id = m.home_team_id AND league_id = m.league_id),
        (SELECT division FROM best_division WHERE team_id = m.away_team_id AND league_id = m.league_id)
      )
      WHERE m.division IS NULL AND m.deleted_at IS NULL AND m.league_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM best_division
          WHERE (team_id = m.home_team_id OR team_id = m.away_team_id) AND league_id = m.league_id
        )
    `);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Updated: ${rowCount} matches in ${elapsed}s`);

    // Step 5: Show after state
    const { rows: afterStats } = await client.query(`
      SELECT
        source_platform,
        COUNT(*) FILTER (WHERE division IS NOT NULL) as with_div,
        COUNT(*) FILTER (WHERE division IS NULL AND league_id IS NOT NULL) as null_league,
        COUNT(*) FILTER (WHERE division IS NULL AND league_id IS NULL) as null_no_league
      FROM matches_v2
      WHERE deleted_at IS NULL
      GROUP BY source_platform
      ORDER BY source_platform NULLS LAST
    `);
    console.log('\nAfter — Division status by source:');
    for (const r of afterStats) {
      console.log(`  ${r.source_platform || 'NULL'}: ${r.with_div} with div, ${r.null_league} NULL (league), ${r.null_no_league} NULL (no league)`);
    }

    // Step 6: Check for remaining split teams (same team, same league, different division/NULL)
    const { rows: splitCheck } = await client.query(`
      SELECT COUNT(*) as cnt FROM (
        SELECT team_id, league_id
        FROM (
          SELECT home_team_id as team_id, league_id, division FROM matches_v2
          WHERE deleted_at IS NULL AND league_id IS NOT NULL
          UNION ALL
          SELECT away_team_id, league_id, division FROM matches_v2
          WHERE deleted_at IS NULL AND league_id IS NOT NULL
        ) x
        GROUP BY team_id, league_id
        HAVING COUNT(DISTINCT COALESCE(division, '__NULL__')) > 1
      ) splits
    `);
    console.log(`\nRemaining split teams (div + NULL in same league): ${splitCheck[0].cnt}`);

  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n=== INFERENCE COMPLETE ===');
}

main().catch(e => { console.error(e); process.exit(1); });
