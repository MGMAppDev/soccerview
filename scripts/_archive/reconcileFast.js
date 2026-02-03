/**
 * FAST Reconciliation v3.0
 * ========================
 *
 * Optimized approach using:
 * 1. Pre-normalized names stored in DB
 * 2. GIN trigram index for fast similarity search
 * 3. SET-based operations (bulk matching via SQL)
 * 4. Batch updates instead of one-by-one
 *
 * Target: Complete 69K teams in < 2 hours
 */

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  statement_timeout: 600000, // 10 min per query
});

// Normalize team name - strip suffix, lowercase, remove extra spaces
function normalizeTeamName(name) {
  if (!name) return '';
  return name
    .replace(/\s*\([^)]*\)\s*$/, '')  // Remove (Uxx Boys/Girls) suffix
    .replace(/\s+/g, ' ')              // Normalize spaces
    .toLowerCase()
    .trim();
}

async function main() {
  console.log('='.repeat(70));
  console.log('FAST RECONCILIATION v3.0');
  console.log('='.repeat(70));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = await pool.connect();

  try {
    // ========================================
    // PHASE 1: Setup - Ensure indexes exist
    // ========================================
    console.log('PHASE 1: Checking/Creating Indexes');
    console.log('-'.repeat(70));

    // Check if GIN index exists on normalized_name
    const indexCheck = await client.query(`
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'teams' AND indexname = 'idx_teams_normalized_trgm'
    `);

    if (indexCheck.rows.length === 0) {
      console.log('Creating GIN trigram index on normalized_name...');
      await client.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_normalized_trgm
        ON teams USING gin (normalized_name gin_trgm_ops)
      `);
      console.log('✅ Index created');
    } else {
      console.log('✅ GIN index already exists');
    }

    // ========================================
    // PHASE 2: Update normalized_name column
    // ========================================
    console.log('\nPHASE 2: Updating normalized_name column');
    console.log('-'.repeat(70));

    // First, update any teams missing normalized_name
    const updateNorm = await client.query(`
      UPDATE teams
      SET normalized_name = LOWER(TRIM(
        regexp_replace(team_name, '\\s*\\([^)]*\\)\\s*$', '', 'g')
      ))
      WHERE normalized_name IS NULL OR normalized_name = ''
    `);
    console.log(`✅ Updated ${updateNorm.rowCount} teams with normalized names`);

    // ========================================
    // PHASE 3: Count teams to reconcile
    // ========================================
    console.log('\nPHASE 3: Counting Teams');
    console.log('-'.repeat(70));

    const counts = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND matches_played = 0) as needs_reconcile,
        COUNT(*) FILTER (WHERE matches_played > 0) as has_matches,
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL) as has_rank
      FROM teams
    `);
    const { needs_reconcile, has_matches, has_rank } = counts.rows[0];
    console.log(`Teams needing reconciliation: ${parseInt(needs_reconcile).toLocaleString()}`);
    console.log(`Teams with match history:     ${parseInt(has_matches).toLocaleString()}`);
    console.log(`Teams with official rank:     ${parseInt(has_rank).toLocaleString()}`);

    // ========================================
    // PHASE 4: EXACT MATCH via normalized_name
    // ========================================
    console.log('\nPHASE 4: Exact Match on Normalized Name');
    console.log('-'.repeat(70));
    const phase4Start = Date.now();

    // Find exact matches where normalized names are identical
    const exactMatches = await client.query(`
      WITH ranked_teams AS (
        SELECT id, team_name, normalized_name, national_rank, state_rank,
               gotsport_team_id, age_group, gender, state
        FROM teams
        WHERE national_rank IS NOT NULL AND matches_played = 0
      ),
      matched_teams AS (
        SELECT id, team_name, normalized_name, matches_played, age_group, gender, state
        FROM teams
        WHERE matches_played > 0
      ),
      exact_matches AS (
        SELECT DISTINCT ON (m.id)
          r.id as ranked_id,
          r.team_name as ranked_name,
          r.national_rank,
          r.state_rank,
          r.gotsport_team_id,
          m.id as matched_id,
          m.team_name as matched_name,
          m.matches_played
        FROM ranked_teams r
        JOIN matched_teams m ON r.normalized_name = m.normalized_name
        WHERE (r.age_group IS NULL OR m.age_group IS NULL OR r.age_group = m.age_group)
          AND (r.gender IS NULL OR m.gender IS NULL OR r.gender = m.gender)
          AND (r.state IS NULL OR m.state IS NULL OR r.state = m.state)
        ORDER BY m.id, m.matches_played DESC
      )
      SELECT * FROM exact_matches
    `);

    console.log(`Found ${exactMatches.rows.length} exact matches`);

    // Apply exact matches
    if (exactMatches.rows.length > 0) {
      // Batch update - transfer ranks to matched teams
      const matchedIds = exactMatches.rows.map(r => r.matched_id);
      const rankMap = new Map(exactMatches.rows.map(r => [r.matched_id, r]));

      let updated = 0;
      const batchSize = 1000;

      for (let i = 0; i < exactMatches.rows.length; i += batchSize) {
        const batch = exactMatches.rows.slice(i, i + batchSize);

        // Build VALUES clause for bulk update
        const values = batch.map((r, idx) =>
          `($${idx*4+1}::uuid, $${idx*4+2}::int, $${idx*4+3}::int, $${idx*4+4}::int)`
        ).join(', ');

        const params = batch.flatMap(r => [
          r.matched_id, r.national_rank, r.state_rank, r.gotsport_team_id
        ]);

        await client.query(`
          UPDATE teams t SET
            national_rank = v.national_rank,
            state_rank = v.state_rank,
            gotsport_team_id = COALESCE(t.gotsport_team_id, v.gotsport_team_id)
          FROM (VALUES ${values}) AS v(id, national_rank, state_rank, gotsport_team_id)
          WHERE t.id = v.id::uuid
        `, params);

        updated += batch.length;
        if (updated % 5000 === 0 || updated === exactMatches.rows.length) {
          console.log(`  Updated ${updated}/${exactMatches.rows.length} exact matches`);
        }
      }

      // Clear ranks from the ranked-only records (they're now duplicates)
      const rankedIds = exactMatches.rows.map(r => r.ranked_id);
      for (let i = 0; i < rankedIds.length; i += 1000) {
        const batch = rankedIds.slice(i, i + 1000);
        await client.query(`
          UPDATE teams SET national_rank = NULL, state_rank = NULL
          WHERE id = ANY($1::uuid[])
        `, [batch]);
      }
    }

    const phase4Time = ((Date.now() - phase4Start) / 1000).toFixed(1);
    console.log(`✅ Phase 4 complete in ${phase4Time}s - ${exactMatches.rows.length} exact matches applied`);

    // ========================================
    // PHASE 5: FUZZY MATCH using pg_trgm
    // ========================================
    console.log('\nPHASE 5: Fuzzy Match (pg_trgm similarity)');
    console.log('-'.repeat(70));
    const phase5Start = Date.now();

    // Recount after exact matches
    const remaining = await client.query(`
      SELECT COUNT(*) as count FROM teams
      WHERE national_rank IS NOT NULL AND matches_played = 0
    `);
    console.log(`Remaining teams to reconcile: ${parseInt(remaining.rows[0].count).toLocaleString()}`);

    // Do fuzzy matching in batches
    let totalFuzzyMatched = 0;
    const fuzzyBatchSize = 5000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // Find fuzzy matches for a batch
      const fuzzyMatches = await client.query(`
        WITH ranked_batch AS (
          SELECT id, team_name, normalized_name, national_rank, state_rank,
                 gotsport_team_id, age_group, gender, state
          FROM teams
          WHERE national_rank IS NOT NULL AND matches_played = 0
          ORDER BY national_rank
          LIMIT ${fuzzyBatchSize} OFFSET ${offset}
        ),
        fuzzy_matches AS (
          SELECT DISTINCT ON (m.id)
            r.id as ranked_id,
            r.team_name as ranked_name,
            r.national_rank,
            r.state_rank,
            r.gotsport_team_id,
            m.id as matched_id,
            m.team_name as matched_name,
            m.matches_played,
            similarity(r.normalized_name, m.normalized_name) as sim
          FROM ranked_batch r
          JOIN teams m ON m.matches_played > 0
            AND r.normalized_name % m.normalized_name
            AND similarity(r.normalized_name, m.normalized_name) > 0.6
          WHERE (r.age_group IS NULL OR m.age_group IS NULL OR r.age_group = m.age_group)
            AND (r.gender IS NULL OR m.gender IS NULL OR r.gender = m.gender)
            AND (r.state IS NULL OR m.state IS NULL OR r.state = m.state)
            AND m.national_rank IS NULL
          ORDER BY m.id, sim DESC, m.matches_played DESC
        )
        SELECT * FROM fuzzy_matches
      `);

      if (fuzzyMatches.rows.length === 0) {
        // Check if there are more teams to process
        const check = await client.query(`
          SELECT COUNT(*) as count FROM teams
          WHERE national_rank IS NOT NULL AND matches_played = 0
          OFFSET ${offset}
        `);
        hasMore = parseInt(check.rows[0].count) > 0;
        if (hasMore) {
          offset += fuzzyBatchSize;
          continue;
        }
        break;
      }

      // Apply fuzzy matches
      for (const match of fuzzyMatches.rows) {
        await client.query(`
          UPDATE teams SET
            national_rank = $1,
            state_rank = $2,
            gotsport_team_id = COALESCE(gotsport_team_id, $3)
          WHERE id = $4
        `, [match.national_rank, match.state_rank, match.gotsport_team_id, match.matched_id]);

        // Clear the ranked-only record
        await client.query(`
          UPDATE teams SET national_rank = NULL, state_rank = NULL
          WHERE id = $1
        `, [match.ranked_id]);
      }

      totalFuzzyMatched += fuzzyMatches.rows.length;
      offset += fuzzyBatchSize;

      const elapsed = ((Date.now() - phase5Start) / 1000 / 60).toFixed(1);
      console.log(`  Batch complete: +${fuzzyMatches.rows.length} fuzzy matches (${totalFuzzyMatched} total, ${elapsed} min)`);

      // Safety limit - don't run forever
      if (offset > 100000) {
        console.log('  Reached offset limit, stopping fuzzy matching');
        break;
      }
    }

    const phase5Time = ((Date.now() - phase5Start) / 1000 / 60).toFixed(1);
    console.log(`✅ Phase 5 complete in ${phase5Time} min - ${totalFuzzyMatched} fuzzy matches applied`);

    // ========================================
    // PHASE 6: Summary
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('RECONCILIATION COMPLETE');
    console.log('='.repeat(70));

    const finalCounts = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND matches_played = 0) as still_needs,
        COUNT(*) FILTER (WHERE national_rank IS NOT NULL AND matches_played > 0) as reconciled,
        COUNT(*) FILTER (WHERE matches_played > 0) as has_matches
      FROM teams
    `);
    const final = finalCounts.rows[0];

    console.log(`\nResults:`);
    console.log(`  Exact matches applied:  ${exactMatches.rows.length}`);
    console.log(`  Fuzzy matches applied:  ${totalFuzzyMatched}`);
    console.log(`  Total reconciled:       ${exactMatches.rows.length + totalFuzzyMatched}`);
    console.log(`\nFinal State:`);
    console.log(`  Teams with rank + matches: ${parseInt(final.reconciled).toLocaleString()}`);
    console.log(`  Teams still needing reconcile: ${parseInt(final.still_needs).toLocaleString()}`);
    console.log(`  Teams with match history: ${parseInt(final.has_matches).toLocaleString()}`);

    console.log(`\nFinished: ${new Date().toISOString()}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
