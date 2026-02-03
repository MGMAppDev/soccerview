/**
 * FAST Match Linking v1.0
 * =======================
 *
 * Pure SQL approach - NO JavaScript loops for queries.
 * Does all matching and updating in bulk SQL statements.
 *
 * Target: Complete in < 5 minutes
 */

import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0, // No timeout
});

async function main() {
  console.log('='.repeat(70));
  console.log('FAST MATCH LINKING v1.0');
  console.log('='.repeat(70));
  console.log(`Started: ${new Date().toISOString()}\n`);

  await client.connect();

  try {
    // ========================================
    // STEP 1: Baseline
    // ========================================
    console.log('STEP 1: Baseline');
    console.log('-'.repeat(70));

    const baseline = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NULL) as home_unlinked,
        COUNT(*) FILTER (WHERE away_team_id IS NULL) as away_unlinked
      FROM match_results
    `);
    const b = baseline.rows[0];
    console.log(`Total matches:     ${parseInt(b.total).toLocaleString()}`);
    console.log(`Fully linked:      ${parseInt(b.fully_linked).toLocaleString()} (${(b.fully_linked/b.total*100).toFixed(1)}%)`);
    console.log(`Home unlinked:     ${parseInt(b.home_unlinked).toLocaleString()}`);
    console.log(`Away unlinked:     ${parseInt(b.away_unlinked).toLocaleString()}`);

    // ========================================
    // STEP 2: Link HOME teams via exact alias match
    // ========================================
    console.log('\nSTEP 2: Link HOME via Exact Alias Match');
    console.log('-'.repeat(70));
    const step2Start = Date.now();

    const homeExact = await client.query(`
      UPDATE match_results mr SET
        home_team_id = a.team_id
      FROM team_name_aliases a
      WHERE mr.home_team_id IS NULL
        AND LOWER(TRIM(mr.home_team_name)) = a.alias_name
      RETURNING mr.id
    `);
    console.log(`✅ HOME exact matches: ${homeExact.rowCount}`);
    console.log(`   Time: ${((Date.now() - step2Start) / 1000).toFixed(1)}s`);

    // ========================================
    // STEP 3: Link AWAY teams via exact alias match
    // ========================================
    console.log('\nSTEP 3: Link AWAY via Exact Alias Match');
    console.log('-'.repeat(70));
    const step3Start = Date.now();

    const awayExact = await client.query(`
      UPDATE match_results mr SET
        away_team_id = a.team_id
      FROM team_name_aliases a
      WHERE mr.away_team_id IS NULL
        AND LOWER(TRIM(mr.away_team_name)) = a.alias_name
      RETURNING mr.id
    `);
    console.log(`✅ AWAY exact matches: ${awayExact.rowCount}`);
    console.log(`   Time: ${((Date.now() - step3Start) / 1000).toFixed(1)}s`);

    // ========================================
    // STEP 4: Link HOME via fuzzy match (similarity > 0.8)
    // ========================================
    console.log('\nSTEP 4: Link HOME via Fuzzy Match (>0.8 similarity)');
    console.log('-'.repeat(70));
    const step4Start = Date.now();

    await client.query(`SET pg_trgm.similarity_threshold = 0.8`);

    const homeFuzzy = await client.query(`
      WITH unlinked_home AS (
        SELECT DISTINCT home_team_name
        FROM match_results
        WHERE home_team_id IS NULL
          AND home_team_name IS NOT NULL
          AND LENGTH(home_team_name) >= 10
          AND home_team_name ~ '^[A-Za-z]'
          AND home_team_name NOT ILIKE '%***%'
          AND home_team_name NOT ILIKE '%dropped%'
          AND home_team_name NOT ILIKE '%bye%'
          AND home_team_name NOT ILIKE '%tbd%'
      ),
      fuzzy_matches AS (
        SELECT DISTINCT ON (u.home_team_name)
          u.home_team_name,
          a.team_id,
          similarity(LOWER(TRIM(u.home_team_name)), a.alias_name) as sim
        FROM unlinked_home u
        JOIN team_name_aliases a ON LOWER(TRIM(u.home_team_name)) % a.alias_name
        ORDER BY u.home_team_name, sim DESC
      )
      UPDATE match_results mr SET
        home_team_id = fm.team_id
      FROM fuzzy_matches fm
      WHERE mr.home_team_name = fm.home_team_name
        AND mr.home_team_id IS NULL
      RETURNING mr.id
    `);
    console.log(`✅ HOME fuzzy matches: ${homeFuzzy.rowCount}`);
    console.log(`   Time: ${((Date.now() - step4Start) / 1000).toFixed(1)}s`);

    // ========================================
    // STEP 5: Link AWAY via fuzzy match (similarity > 0.8)
    // ========================================
    console.log('\nSTEP 5: Link AWAY via Fuzzy Match (>0.8 similarity)');
    console.log('-'.repeat(70));
    const step5Start = Date.now();

    const awayFuzzy = await client.query(`
      WITH unlinked_away AS (
        SELECT DISTINCT away_team_name
        FROM match_results
        WHERE away_team_id IS NULL
          AND away_team_name IS NOT NULL
          AND LENGTH(away_team_name) >= 10
          AND away_team_name ~ '^[A-Za-z]'
          AND away_team_name NOT ILIKE '%***%'
          AND away_team_name NOT ILIKE '%dropped%'
          AND away_team_name NOT ILIKE '%bye%'
          AND away_team_name NOT ILIKE '%tbd%'
      ),
      fuzzy_matches AS (
        SELECT DISTINCT ON (u.away_team_name)
          u.away_team_name,
          a.team_id,
          similarity(LOWER(TRIM(u.away_team_name)), a.alias_name) as sim
        FROM unlinked_away u
        JOIN team_name_aliases a ON LOWER(TRIM(u.away_team_name)) % a.alias_name
        ORDER BY u.away_team_name, sim DESC
      )
      UPDATE match_results mr SET
        away_team_id = fm.team_id
      FROM fuzzy_matches fm
      WHERE mr.away_team_name = fm.away_team_name
        AND mr.away_team_id IS NULL
      RETURNING mr.id
    `);
    console.log(`✅ AWAY fuzzy matches: ${awayFuzzy.rowCount}`);
    console.log(`   Time: ${((Date.now() - step5Start) / 1000).toFixed(1)}s`);

    // ========================================
    // STEP 6: Link remaining via lower threshold (0.7)
    // ========================================
    console.log('\nSTEP 6: Link Remaining via Lower Threshold (>0.7)');
    console.log('-'.repeat(70));
    const step6Start = Date.now();

    await client.query(`SET pg_trgm.similarity_threshold = 0.7`);

    const homeLow = await client.query(`
      WITH unlinked_home AS (
        SELECT DISTINCT home_team_name
        FROM match_results
        WHERE home_team_id IS NULL
          AND home_team_name IS NOT NULL
          AND LENGTH(home_team_name) >= 10
          AND home_team_name ~ '^[A-Za-z]'
      ),
      fuzzy_matches AS (
        SELECT DISTINCT ON (u.home_team_name)
          u.home_team_name,
          a.team_id,
          similarity(LOWER(TRIM(u.home_team_name)), a.alias_name) as sim
        FROM unlinked_home u
        JOIN team_name_aliases a ON LOWER(TRIM(u.home_team_name)) % a.alias_name
        ORDER BY u.home_team_name, sim DESC
      )
      UPDATE match_results mr SET
        home_team_id = fm.team_id
      FROM fuzzy_matches fm
      WHERE mr.home_team_name = fm.home_team_name
        AND mr.home_team_id IS NULL
      RETURNING mr.id
    `);

    const awayLow = await client.query(`
      WITH unlinked_away AS (
        SELECT DISTINCT away_team_name
        FROM match_results
        WHERE away_team_id IS NULL
          AND away_team_name IS NOT NULL
          AND LENGTH(away_team_name) >= 10
          AND away_team_name ~ '^[A-Za-z]'
      ),
      fuzzy_matches AS (
        SELECT DISTINCT ON (u.away_team_name)
          u.away_team_name,
          a.team_id,
          similarity(LOWER(TRIM(u.away_team_name)), a.alias_name) as sim
        FROM unlinked_away u
        JOIN team_name_aliases a ON LOWER(TRIM(u.away_team_name)) % a.alias_name
        ORDER BY u.away_team_name, sim DESC
      )
      UPDATE match_results mr SET
        away_team_id = fm.team_id
      FROM fuzzy_matches fm
      WHERE mr.away_team_name = fm.away_team_name
        AND mr.away_team_id IS NULL
      RETURNING mr.id
    `);

    console.log(`✅ Lower threshold: HOME +${homeLow.rowCount}, AWAY +${awayLow.rowCount}`);
    console.log(`   Time: ${((Date.now() - step6Start) / 1000).toFixed(1)}s`);

    // ========================================
    // STEP 7: Create new aliases for linked names
    // ========================================
    console.log('\nSTEP 7: Create New Aliases');
    console.log('-'.repeat(70));
    const step7Start = Date.now();

    // Find newly linked names that don't have aliases yet
    const newAliases = await client.query(`
      INSERT INTO team_name_aliases (id, team_id, alias_name, source)
      SELECT DISTINCT
        gen_random_uuid(),
        home_team_id,
        LOWER(TRIM(home_team_name)),
        'auto_linked'
      FROM match_results
      WHERE home_team_id IS NOT NULL
        AND home_team_name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM team_name_aliases
          WHERE alias_name = LOWER(TRIM(match_results.home_team_name))
        )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);

    const newAliasesAway = await client.query(`
      INSERT INTO team_name_aliases (id, team_id, alias_name, source)
      SELECT DISTINCT
        gen_random_uuid(),
        away_team_id,
        LOWER(TRIM(away_team_name)),
        'auto_linked'
      FROM match_results
      WHERE away_team_id IS NOT NULL
        AND away_team_name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM team_name_aliases
          WHERE alias_name = LOWER(TRIM(match_results.away_team_name))
        )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);

    console.log(`✅ New aliases: ${newAliases.rowCount + newAliasesAway.rowCount}`);
    console.log(`   Time: ${((Date.now() - step7Start) / 1000).toFixed(1)}s`);

    // ========================================
    // FINAL: Summary
    // ========================================
    console.log('\n' + '='.repeat(70));
    console.log('LINKING COMPLETE');
    console.log('='.repeat(70));

    const final = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NULL) as home_unlinked,
        COUNT(*) FILTER (WHERE away_team_id IS NULL) as away_unlinked
      FROM match_results
    `);
    const f = final.rows[0];

    const totalLinked = homeExact.rowCount + awayExact.rowCount +
                        homeFuzzy.rowCount + awayFuzzy.rowCount +
                        homeLow.rowCount + awayLow.rowCount;

    console.log(`\nResults:`);
    console.log(`  HOME exact:     ${homeExact.rowCount}`);
    console.log(`  AWAY exact:     ${awayExact.rowCount}`);
    console.log(`  HOME fuzzy:     ${homeFuzzy.rowCount}`);
    console.log(`  AWAY fuzzy:     ${awayFuzzy.rowCount}`);
    console.log(`  Lower thresh:   ${homeLow.rowCount + awayLow.rowCount}`);
    console.log(`  ─────────────────`);
    console.log(`  Total linked:   ${totalLinked}`);

    console.log(`\nFinal State:`);
    console.log(`  Total matches:    ${parseInt(f.total).toLocaleString()}`);
    console.log(`  Fully linked:     ${parseInt(f.fully_linked).toLocaleString()} (${(f.fully_linked/f.total*100).toFixed(1)}%)`);
    console.log(`  Still unlinked:`);
    console.log(`    Home:           ${parseInt(f.home_unlinked).toLocaleString()}`);
    console.log(`    Away:           ${parseInt(f.away_unlinked).toLocaleString()}`);

    const improvement = parseInt(f.fully_linked) - parseInt(b.fully_linked);
    console.log(`\n  📈 Improvement: +${improvement.toLocaleString()} fully linked matches`);

    console.log(`\nFinished: ${new Date().toISOString()}`);

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
