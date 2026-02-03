/**
 * Fast Link - Bulk SQL Only (No row-by-row fuzzy)
 * 
 * Runs all indexed lookups in bulk SQL. Completes in 5-10 minutes.
 * 
 * Usage: node scripts/fastLink.js
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log("⚡ Fast Link - Bulk SQL Operations");
  console.log("═".repeat(55));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000, // 10 min
  });

  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Baseline
    const baseline = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked
      FROM match_results
    `);
    const b = baseline.rows[0];
    console.log(`📊 BASELINE: ${parseInt(b.fully_linked).toLocaleString()} / ${parseInt(b.total).toLocaleString()} (${(b.fully_linked/b.total*100).toFixed(1)}%)\n`);

    const chunks = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

    // ============================================================
    // STRATEGY 1: Exact alias match
    // ============================================================
    console.log("1️⃣  Exact alias match...");
    let s1h = 0, s1a = 0;
    for (const letter of chunks) {
      let r = await client.query(`
        UPDATE match_results mr SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL AND UPPER(LEFT(mr.home_team_name,1)) = $1
          AND LOWER(TRIM(mr.home_team_name)) = ta.alias_name
      `, [letter]);
      s1h += r.rowCount;
      r = await client.query(`
        UPDATE match_results mr SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL AND UPPER(LEFT(mr.away_team_name,1)) = $1
          AND LOWER(TRIM(mr.away_team_name)) = ta.alias_name
      `, [letter]);
      s1a += r.rowCount;
    }
    console.log(`   Home: +${s1h.toLocaleString()}, Away: +${s1a.toLocaleString()}`);

    // ============================================================
    // STRATEGY 2: Suffix stripped from input
    // ============================================================
    console.log("2️⃣  Suffix stripped from input...");
    let s2h = 0, s2a = 0;
    for (const letter of chunks) {
      let r = await client.query(`
        UPDATE match_results mr SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL AND UPPER(LEFT(mr.home_team_name,1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(mr.home_team_name, '\\s*\\([^)]*\\)\\s*$', ''))) = ta.alias_name
      `, [letter]);
      s2h += r.rowCount;
      r = await client.query(`
        UPDATE match_results mr SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL AND UPPER(LEFT(mr.away_team_name,1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(mr.away_team_name, '\\s*\\([^)]*\\)\\s*$', ''))) = ta.alias_name
      `, [letter]);
      s2a += r.rowCount;
    }
    console.log(`   Home: +${s2h.toLocaleString()}, Away: +${s2a.toLocaleString()}`);

    // ============================================================
    // STRATEGY 3: Punctuation normalized
    // ============================================================
    console.log("3️⃣  Punctuation normalized...");
    let s3h = 0, s3a = 0;
    for (const letter of chunks) {
      let r = await client.query(`
        UPDATE match_results mr SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL AND UPPER(LEFT(mr.home_team_name,1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(mr.home_team_name, '[.''\"\\-]', '', 'g'), '\\s+', ' ', 'g'))) = ta.alias_name
      `, [letter]);
      s3h += r.rowCount;
      r = await client.query(`
        UPDATE match_results mr SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL AND UPPER(LEFT(mr.away_team_name,1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(mr.away_team_name, '[.''\"\\-]', '', 'g'), '\\s+', ' ', 'g'))) = ta.alias_name
      `, [letter]);
      s3a += r.rowCount;
    }
    console.log(`   Home: +${s3h.toLocaleString()}, Away: +${s3a.toLocaleString()}`);

    // ============================================================
    // STRATEGY 4: Color words removed
    // ============================================================
    console.log("4️⃣  Color words removed...");
    const colorPattern = `\\s+(red|blue|black|white|gold|silver|green|orange|navy|royal|gray|grey|purple|yellow|maroon|teal|pink)\\s*`;
    let s4h = 0, s4a = 0;
    for (const letter of chunks) {
      let r = await client.query(`
        UPDATE match_results mr SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL AND UPPER(LEFT(mr.home_team_name,1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(mr.home_team_name, '${colorPattern}', ' ', 'gi'), '\\s+', ' ', 'g'))) = ta.alias_name
      `, [letter]);
      s4h += r.rowCount;
      r = await client.query(`
        UPDATE match_results mr SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL AND UPPER(LEFT(mr.away_team_name,1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(mr.away_team_name, '${colorPattern}', ' ', 'gi'), '\\s+', ' ', 'g'))) = ta.alias_name
      `, [letter]);
      s4a += r.rowCount;
    }
    console.log(`   Home: +${s4h.toLocaleString()}, Away: +${s4a.toLocaleString()}`);

    // ============================================================
    // STRATEGY 5: All combined (suffix + punct + color)
    // ============================================================
    console.log("5️⃣  All normalizations combined...");
    let s5h = 0, s5a = 0;
    for (const letter of chunks) {
      let r = await client.query(`
        UPDATE match_results mr SET home_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.home_team_id IS NULL AND UPPER(LEFT(mr.home_team_name,1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(mr.home_team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                '${colorPattern}', ' ', 'gi'),
              '[.''\"\\-]', '', 'g'),
            '\\s+', ' ', 'g'))) = ta.alias_name
      `, [letter]);
      s5h += r.rowCount;
      r = await client.query(`
        UPDATE match_results mr SET away_team_id = ta.team_id
        FROM team_name_aliases ta
        WHERE mr.away_team_id IS NULL AND UPPER(LEFT(mr.away_team_name,1)) = $1
          AND LOWER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(mr.away_team_name, '\\s*\\([^)]*\\)\\s*$', ''),
                '${colorPattern}', ' ', 'gi'),
              '[.''\"\\-]', '', 'g'),
            '\\s+', ' ', 'g'))) = ta.alias_name
      `, [letter]);
      s5a += r.rowCount;
    }
    console.log(`   Home: +${s5h.toLocaleString()}, Away: +${s5a.toLocaleString()}`);

    // ============================================================
    // STRATEGY 6: Bulk fuzzy (high threshold, single pass)
    // ============================================================
    console.log("6️⃣  Bulk fuzzy match (similarity > 0.8)...");
    
    // Home - single bulk update with high threshold
    const fuzzyHome = await client.query(`
      UPDATE match_results mr
      SET home_team_id = best.team_id
      FROM (
        SELECT DISTINCT ON (mr_name) 
          mr_name,
          ta.team_id,
          similarity(LOWER(TRIM(mr_name)), ta.alias_name) as sim
        FROM (
          SELECT DISTINCT home_team_name as mr_name
          FROM match_results 
          WHERE home_team_id IS NULL 
            AND home_team_name IS NOT NULL
            AND LENGTH(home_team_name) >= 12
            AND home_team_name ~ '^[A-Za-z]'
            AND home_team_name NOT ILIKE '%***%'
            AND home_team_name NOT ILIKE '%dropped%'
            AND home_team_name NOT ILIKE '%bye%'
            AND home_team_name NOT ILIKE '%tbd%'
        ) unlinked
        JOIN team_name_aliases ta ON ta.alias_name % LOWER(TRIM(unlinked.mr_name))
        WHERE similarity(LOWER(TRIM(unlinked.mr_name)), ta.alias_name) > 0.8
        ORDER BY mr_name, sim DESC
      ) best
      WHERE mr.home_team_name = best.mr_name
        AND mr.home_team_id IS NULL
    `);
    console.log(`   Home: +${fuzzyHome.rowCount.toLocaleString()}`);

    // Away - single bulk update
    const fuzzyAway = await client.query(`
      UPDATE match_results mr
      SET away_team_id = best.team_id
      FROM (
        SELECT DISTINCT ON (mr_name) 
          mr_name,
          ta.team_id,
          similarity(LOWER(TRIM(mr_name)), ta.alias_name) as sim
        FROM (
          SELECT DISTINCT away_team_name as mr_name
          FROM match_results 
          WHERE away_team_id IS NULL 
            AND away_team_name IS NOT NULL
            AND LENGTH(away_team_name) >= 12
            AND away_team_name ~ '^[A-Za-z]'
            AND away_team_name NOT ILIKE '%***%'
            AND away_team_name NOT ILIKE '%dropped%'
            AND away_team_name NOT ILIKE '%bye%'
            AND away_team_name NOT ILIKE '%tbd%'
        ) unlinked
        JOIN team_name_aliases ta ON ta.alias_name % LOWER(TRIM(unlinked.mr_name))
        WHERE similarity(LOWER(TRIM(unlinked.mr_name)), ta.alias_name) > 0.8
        ORDER BY mr_name, sim DESC
      ) best
      WHERE mr.away_team_name = best.mr_name
        AND mr.away_team_id IS NULL
    `);
    console.log(`   Away: +${fuzzyAway.rowCount.toLocaleString()}`);

    // ============================================================
    // FINAL RESULTS
    // ============================================================
    const final = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL) as fully_linked,
        COUNT(*) FILTER (WHERE home_team_id IS NOT NULL) as home_linked,
        COUNT(*) FILTER (WHERE away_team_id IS NOT NULL) as away_linked
      FROM match_results
    `);
    const f = final.rows[0];

    console.log("\n" + "═".repeat(55));
    console.log("📊 FINAL RESULTS:");
    console.log("═".repeat(55));
    console.log(`   Total:        ${parseInt(f.total).toLocaleString()}`);
    console.log(`   Fully linked: ${parseInt(f.fully_linked).toLocaleString()} (${(f.fully_linked/f.total*100).toFixed(1)}%)`);
    console.log(`   Home linked:  ${parseInt(f.home_linked).toLocaleString()} (${(f.home_linked/f.total*100).toFixed(1)}%)`);
    console.log(`   Away linked:  ${parseInt(f.away_linked).toLocaleString()} (${(f.away_linked/f.total*100).toFixed(1)}%)`);
    console.log(`\n   ✨ IMPROVEMENT: +${(f.fully_linked - b.fully_linked).toLocaleString()} fully linked`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log("\n✅ Complete!");
}

main();
