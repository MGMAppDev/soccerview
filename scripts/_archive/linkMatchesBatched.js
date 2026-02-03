/**
 * BATCHED Match Linking v2.0
 * ==========================
 *
 * Uses batched fuzzy matching to avoid query timeout.
 * Processes 1000 unique names at a time.
 *
 * Target: Complete in < 15 minutes
 */

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

async function main() {
  console.log('='.repeat(70));
  console.log('BATCHED MATCH LINKING v2.0');
  console.log('='.repeat(70));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = await pool.connect();

  try {
    // Baseline
    console.log('BASELINE:');
    const baseline = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked
      FROM match_results
    `);
    const b = baseline.rows[0];
    console.log(`  ${parseInt(b.linked).toLocaleString()} / ${parseInt(b.total).toLocaleString()} (${(b.linked/b.total*100).toFixed(1)}%)\n`);

    // Set similarity threshold
    await client.query(`SET pg_trgm.similarity_threshold = 0.75`);

    // ========================================
    // PROCESS HOME TEAMS
    // ========================================
    console.log('PROCESSING HOME TEAMS');
    console.log('-'.repeat(70));

    // Get all unlinked home names
    const homeNames = await client.query(`
      SELECT DISTINCT home_team_name as name
      FROM match_results
      WHERE home_team_id IS NULL
        AND home_team_name IS NOT NULL
        AND LENGTH(home_team_name) >= 8
        AND home_team_name ~ '^[A-Za-z]'
        AND home_team_name NOT ILIKE '%***%'
        AND home_team_name NOT ILIKE '%tbd%'
        AND home_team_name NOT ILIKE '%bye%'
    `);
    console.log(`Unique HOME names to process: ${homeNames.rows.length}`);

    let homeLinked = 0;
    const homeBatchSize = 500;
    const homeStart = Date.now();

    for (let i = 0; i < homeNames.rows.length; i += homeBatchSize) {
      const batch = homeNames.rows.slice(i, i + homeBatchSize);
      const names = batch.map(r => r.name);

      // Find matches for this batch
      const matches = await client.query(`
        WITH batch_names AS (
          SELECT unnest($1::text[]) as name
        ),
        best_matches AS (
          SELECT DISTINCT ON (bn.name)
            bn.name,
            a.team_id,
            similarity(LOWER(TRIM(bn.name)), a.alias_name) as sim
          FROM batch_names bn
          JOIN team_name_aliases a ON LOWER(TRIM(bn.name)) % a.alias_name
          ORDER BY bn.name, sim DESC
        )
        SELECT * FROM best_matches WHERE sim >= 0.75
      `, [names]);

      // Apply matches
      for (const m of matches.rows) {
        const result = await client.query(`
          UPDATE match_results SET home_team_id = $1
          WHERE home_team_name = $2 AND home_team_id IS NULL
        `, [m.team_id, m.name]);
        homeLinked += result.rowCount;
      }

      const elapsed = ((Date.now() - homeStart) / 1000).toFixed(0);
      const progress = Math.min(i + homeBatchSize, homeNames.rows.length);
      console.log(`  ${progress}/${homeNames.rows.length} processed, +${homeLinked} linked (${elapsed}s)`);
    }
    console.log(`✅ HOME complete: +${homeLinked} linked\n`);

    // ========================================
    // PROCESS AWAY TEAMS
    // ========================================
    console.log('PROCESSING AWAY TEAMS');
    console.log('-'.repeat(70));

    const awayNames = await client.query(`
      SELECT DISTINCT away_team_name as name
      FROM match_results
      WHERE away_team_id IS NULL
        AND away_team_name IS NOT NULL
        AND LENGTH(away_team_name) >= 8
        AND away_team_name ~ '^[A-Za-z]'
        AND away_team_name NOT ILIKE '%***%'
        AND away_team_name NOT ILIKE '%tbd%'
        AND away_team_name NOT ILIKE '%bye%'
    `);
    console.log(`Unique AWAY names to process: ${awayNames.rows.length}`);

    let awayLinked = 0;
    const awayBatchSize = 500;
    const awayStart = Date.now();

    for (let i = 0; i < awayNames.rows.length; i += awayBatchSize) {
      const batch = awayNames.rows.slice(i, i + awayBatchSize);
      const names = batch.map(r => r.name);

      const matches = await client.query(`
        WITH batch_names AS (
          SELECT unnest($1::text[]) as name
        ),
        best_matches AS (
          SELECT DISTINCT ON (bn.name)
            bn.name,
            a.team_id,
            similarity(LOWER(TRIM(bn.name)), a.alias_name) as sim
          FROM batch_names bn
          JOIN team_name_aliases a ON LOWER(TRIM(bn.name)) % a.alias_name
          ORDER BY bn.name, sim DESC
        )
        SELECT * FROM best_matches WHERE sim >= 0.75
      `, [names]);

      for (const m of matches.rows) {
        const result = await client.query(`
          UPDATE match_results SET away_team_id = $1
          WHERE away_team_name = $2 AND away_team_id IS NULL
        `, [m.team_id, m.name]);
        awayLinked += result.rowCount;
      }

      const elapsed = ((Date.now() - awayStart) / 1000).toFixed(0);
      const progress = Math.min(i + awayBatchSize, awayNames.rows.length);
      console.log(`  ${progress}/${awayNames.rows.length} processed, +${awayLinked} linked (${elapsed}s)`);
    }
    console.log(`✅ AWAY complete: +${awayLinked} linked\n`);

    // ========================================
    // CREATE NEW ALIASES
    // ========================================
    console.log('CREATING NEW ALIASES');
    console.log('-'.repeat(70));

    const newAliases = await client.query(`
      INSERT INTO team_name_aliases (id, team_id, alias_name, source)
      SELECT DISTINCT
        gen_random_uuid(),
        COALESCE(home_team_id, away_team_id),
        LOWER(TRIM(COALESCE(
          CASE WHEN home_team_id IS NOT NULL THEN home_team_name END,
          CASE WHEN away_team_id IS NOT NULL THEN away_team_name END
        ))),
        'batch_linked'
      FROM match_results
      WHERE (home_team_id IS NOT NULL OR away_team_id IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM team_name_aliases
          WHERE alias_name = LOWER(TRIM(COALESCE(
            CASE WHEN match_results.home_team_id IS NOT NULL THEN match_results.home_team_name END,
            CASE WHEN match_results.away_team_id IS NOT NULL THEN match_results.away_team_name END
          )))
        )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    console.log(`✅ New aliases created: ${newAliases.rowCount}\n`);

    // ========================================
    // FINAL SUMMARY
    // ========================================
    console.log('='.repeat(70));
    console.log('LINKING COMPLETE');
    console.log('='.repeat(70));

    const final = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as linked
      FROM match_results
    `);
    const f = final.rows[0];

    console.log(`\nResults:`);
    console.log(`  HOME linked: ${homeLinked}`);
    console.log(`  AWAY linked: ${awayLinked}`);
    console.log(`  New aliases: ${newAliases.rowCount}`);

    console.log(`\nFinal State:`);
    console.log(`  Fully linked: ${parseInt(f.linked).toLocaleString()} / ${parseInt(f.total).toLocaleString()} (${(f.linked/f.total*100).toFixed(1)}%)`);
    console.log(`  Improvement:  +${parseInt(f.linked) - parseInt(b.linked)} matches`);

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
