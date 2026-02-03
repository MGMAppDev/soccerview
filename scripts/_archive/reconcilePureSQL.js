/**
 * PURE SQL Reconciliation v4.0
 * ============================
 *
 * Does ALL matching in single SQL statements - no JavaScript loops.
 * PostgreSQL handles the heavy lifting with proper indexes.
 *
 * Target: Complete in < 30 minutes
 */

import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0, // No timeout - let it run
});

async function main() {
  console.log('='.repeat(70));
  console.log('PURE SQL RECONCILIATION v4.0');
  console.log('='.repeat(70));
  console.log(`Started: ${new Date().toISOString()}\n`);

  await client.connect();

  try {
    // ========================================
    // STEP 1: Count initial state
    // ========================================
    console.log('STEP 1: Initial State');
    console.log('-'.repeat(70));

    const initial = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND matches_played = 0) as needs_reconcile,
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND matches_played > 0) as already_good,
        COUNT(*) FILTER (WHERE matches_played > 0 AND national_rank IS NULL) as has_matches_no_rank
      FROM teams
    `);
    const init = initial.rows[0];
    console.log(`Teams needing reconciliation: ${parseInt(init.needs_reconcile).toLocaleString()}`);
    console.log(`Teams already have rank+matches: ${parseInt(init.already_good).toLocaleString()}`);
    console.log(`Teams with matches, no rank (candidates): ${parseInt(init.has_matches_no_rank).toLocaleString()}`);

    // ========================================
    // STEP 2: Use existing aliases for matching
    // ========================================
    console.log('\nSTEP 2: Match via Aliases Table');
    console.log('-'.repeat(70));
    const step2Start = Date.now();

    // Try to find ranked teams that match existing aliases
    const aliasMatch = await client.query(`
      WITH ranked_teams AS (
        SELECT id, team_name, normalized_name, national_rank, state_rank, gotsport_team_id
        FROM teams
        WHERE national_rank IS NOT NULL AND matches_played = 0
      ),
      alias_matches AS (
        SELECT DISTINCT ON (a.team_id)
          r.id as ranked_id,
          r.national_rank,
          r.state_rank,
          r.gotsport_team_id,
          a.team_id as matched_id
        FROM ranked_teams r
        JOIN team_name_aliases a ON LOWER(TRIM(r.team_name)) = a.alias_name
                                 OR r.normalized_name = a.alias_name
        JOIN teams t ON t.id = a.team_id
        WHERE t.matches_played > 0
          AND t.national_rank IS NULL
        ORDER BY a.team_id, r.national_rank
      )
      UPDATE teams t SET
        national_rank = am.national_rank,
        state_rank = am.state_rank,
        gotsport_team_id = COALESCE(t.gotsport_team_id, am.gotsport_team_id)
      FROM alias_matches am
      WHERE t.id = am.matched_id
      RETURNING t.id
    `);
    console.log(`✅ Matched via aliases: ${aliasMatch.rowCount}`);

    // Clear ranks from matched ranked-only records
    if (aliasMatch.rowCount > 0) {
      await client.query(`
        UPDATE teams SET national_rank = NULL, state_rank = NULL
        WHERE national_rank IS NOT NULL
          AND matches_played = 0
          AND EXISTS (
            SELECT 1 FROM teams t2
            WHERE t2.matches_played > 0
              AND t2.national_rank = teams.national_rank
          )
      `);
    }
    console.log(`Step 2 completed in ${((Date.now() - step2Start) / 1000).toFixed(1)}s`);

    // ========================================
    // STEP 3: Exact normalized name match
    // ========================================
    console.log('\nSTEP 3: Exact Normalized Name Match');
    console.log('-'.repeat(70));
    const step3Start = Date.now();

    const exactMatch = await client.query(`
      WITH ranked_teams AS (
        SELECT id, team_name, normalized_name, national_rank, state_rank,
               gotsport_team_id, age_group, gender, state
        FROM teams
        WHERE national_rank IS NOT NULL AND matches_played = 0
      ),
      candidate_teams AS (
        SELECT id, team_name, normalized_name, matches_played, age_group, gender, state
        FROM teams
        WHERE matches_played > 0 AND national_rank IS NULL
      ),
      exact_matches AS (
        SELECT DISTINCT ON (c.id)
          r.id as ranked_id,
          r.national_rank,
          r.state_rank,
          r.gotsport_team_id,
          c.id as matched_id
        FROM ranked_teams r
        JOIN candidate_teams c ON r.normalized_name = c.normalized_name
        WHERE (r.state IS NULL OR c.state IS NULL OR r.state = c.state)
        ORDER BY c.id, r.national_rank
      )
      UPDATE teams t SET
        national_rank = em.national_rank,
        state_rank = em.state_rank,
        gotsport_team_id = COALESCE(t.gotsport_team_id, em.gotsport_team_id)
      FROM exact_matches em
      WHERE t.id = em.matched_id
      RETURNING t.id
    `);
    console.log(`✅ Exact matches: ${exactMatch.rowCount}`);
    console.log(`Step 3 completed in ${((Date.now() - step3Start) / 1000).toFixed(1)}s`);

    // ========================================
    // STEP 4: Fuzzy match with HIGH threshold (0.8+)
    // ========================================
    console.log('\nSTEP 4: High-Confidence Fuzzy Match (similarity > 0.8)');
    console.log('-'.repeat(70));
    const step4Start = Date.now();

    // Set pg_trgm threshold
    await client.query(`SET pg_trgm.similarity_threshold = 0.8`);

    const fuzzyHigh = await client.query(`
      WITH ranked_teams AS (
        SELECT id, team_name, normalized_name, national_rank, state_rank,
               gotsport_team_id, age_group, gender, state
        FROM teams
        WHERE national_rank IS NOT NULL AND matches_played = 0
      ),
      candidate_teams AS (
        SELECT id, team_name, normalized_name, matches_played, age_group, gender, state
        FROM teams
        WHERE matches_played > 0 AND national_rank IS NULL
      ),
      fuzzy_matches AS (
        SELECT DISTINCT ON (c.id)
          r.id as ranked_id,
          r.national_rank,
          r.state_rank,
          r.gotsport_team_id,
          c.id as matched_id,
          similarity(r.normalized_name, c.normalized_name) as sim
        FROM ranked_teams r
        JOIN candidate_teams c ON r.normalized_name % c.normalized_name
        WHERE (r.state IS NULL OR c.state IS NULL OR r.state = c.state)
        ORDER BY c.id, sim DESC
      )
      UPDATE teams t SET
        national_rank = fm.national_rank,
        state_rank = fm.state_rank,
        gotsport_team_id = COALESCE(t.gotsport_team_id, fm.gotsport_team_id)
      FROM fuzzy_matches fm
      WHERE t.id = fm.matched_id
      RETURNING t.id
    `);
    console.log(`✅ High-confidence fuzzy matches: ${fuzzyHigh.rowCount}`);
    console.log(`Step 4 completed in ${((Date.now() - step4Start) / 1000).toFixed(1)}s`);

    // ========================================
    // STEP 5: Fuzzy match with MEDIUM threshold (0.65+)
    // ========================================
    console.log('\nSTEP 5: Medium-Confidence Fuzzy Match (similarity > 0.65)');
    console.log('-'.repeat(70));
    const step5Start = Date.now();

    await client.query(`SET pg_trgm.similarity_threshold = 0.65`);

    const fuzzyMed = await client.query(`
      WITH ranked_teams AS (
        SELECT id, team_name, normalized_name, national_rank, state_rank,
               gotsport_team_id, age_group, gender, state
        FROM teams
        WHERE national_rank IS NOT NULL AND matches_played = 0
      ),
      candidate_teams AS (
        SELECT id, team_name, normalized_name, matches_played, age_group, gender, state
        FROM teams
        WHERE matches_played > 0 AND national_rank IS NULL
      ),
      fuzzy_matches AS (
        SELECT DISTINCT ON (c.id)
          r.id as ranked_id,
          r.national_rank,
          r.state_rank,
          r.gotsport_team_id,
          c.id as matched_id,
          similarity(r.normalized_name, c.normalized_name) as sim
        FROM ranked_teams r
        JOIN candidate_teams c ON r.normalized_name % c.normalized_name
        WHERE (r.state IS NULL OR c.state IS NULL OR r.state = c.state)
        ORDER BY c.id, sim DESC
      )
      UPDATE teams t SET
        national_rank = fm.national_rank,
        state_rank = fm.state_rank,
        gotsport_team_id = COALESCE(t.gotsport_team_id, fm.gotsport_team_id)
      FROM fuzzy_matches fm
      WHERE t.id = fm.matched_id
      RETURNING t.id
    `);
    console.log(`✅ Medium-confidence fuzzy matches: ${fuzzyMed.rowCount}`);
    console.log(`Step 5 completed in ${((Date.now() - step5Start) / 1000).toFixed(1)}s`);

    // ========================================
    // STEP 6: Clean up duplicate ranked records
    // ========================================
    console.log('\nSTEP 6: Clean Up Duplicates');
    console.log('-'.repeat(70));
    const step6Start = Date.now();

    // Remove ranks from teams that have been reconciled (ranked-only records)
    const cleanup = await client.query(`
      UPDATE teams SET
        national_rank = NULL,
        state_rank = NULL
      WHERE matches_played = 0
        AND national_rank IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM teams t2
          WHERE t2.id != teams.id
            AND t2.matches_played > 0
            AND t2.national_rank = teams.national_rank
        )
      RETURNING id
    `);
    console.log(`✅ Cleaned up ${cleanup.rowCount} duplicate rank entries`);
    console.log(`Step 6 completed in ${((Date.now() - step6Start) / 1000).toFixed(1)}s`);

    // ========================================
    // FINAL: Summary
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('RECONCILIATION COMPLETE');
    console.log('='.repeat(70));

    const final = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND matches_played = 0) as still_needs,
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND matches_played > 0) as has_both,
        COUNT(*) FILTER (WHERE matches_played > 0) as total_with_matches
      FROM teams
    `);
    const f = final.rows[0];

    const totalReconciled = aliasMatch.rowCount + exactMatch.rowCount + fuzzyHigh.rowCount + fuzzyMed.rowCount;

    console.log(`\nResults:`);
    console.log(`  Via aliases:      ${aliasMatch.rowCount}`);
    console.log(`  Exact matches:    ${exactMatch.rowCount}`);
    console.log(`  Fuzzy (high):     ${fuzzyHigh.rowCount}`);
    console.log(`  Fuzzy (medium):   ${fuzzyMed.rowCount}`);
    console.log(`  ─────────────────`);
    console.log(`  Total reconciled: ${totalReconciled}`);

    console.log(`\nFinal State:`);
    console.log(`  Teams with rank + matches: ${parseInt(f.has_both).toLocaleString()}`);
    console.log(`  Teams still needing reconcile: ${parseInt(f.still_needs).toLocaleString()}`);
    console.log(`  Teams with match history: ${parseInt(f.total_with_matches).toLocaleString()}`);

    console.log(`\nFinished: ${new Date().toISOString()}`);

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
