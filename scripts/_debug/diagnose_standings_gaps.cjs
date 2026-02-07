/**
 * Diagnose Standings Gaps
 * =======================
 * Classifies every gap between staging_standings and league_standings.
 * Categories:
 *   A) NULL_METADATA — resolved to team with NULL birth_year/gender
 *   B) WRONG_TEAM — resolved to wrong teams_v2 record
 *   C) UNRESOLVED — team not found (skipped by processor)
 *   D) CORRECT — team resolved correctly with proper metadata
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    console.log('='.repeat(70));
    console.log('STANDINGS GAP DIAGNOSTIC');
    console.log('='.repeat(70));

    // 1. Overall counts
    const staging = await client.query('SELECT COUNT(*) as cnt FROM staging_standings');
    const production = await client.query('SELECT COUNT(*) as cnt FROM league_standings');
    console.log(`\nStaging rows:     ${staging.rows[0].cnt}`);
    console.log(`Production rows:  ${production.rows[0].cnt}`);

    // 2. Per age_group/gender breakdown in staging
    const stagingBreakdown = await client.query(`
      SELECT age_group, gender, COUNT(*) as cnt
      FROM staging_standings
      GROUP BY age_group, gender
      ORDER BY age_group, gender
    `);
    console.log('\n--- STAGING BREAKDOWN (age_group, gender) ---');
    for (const r of stagingBreakdown.rows) {
      console.log(`  ${r.age_group} ${r.gender}: ${r.cnt} teams`);
    }

    // 3. Per age_group/gender breakdown in league_standings (via teams_v2)
    const prodBreakdown = await client.query(`
      SELECT
        CASE WHEN t.birth_year IS NOT NULL
             THEN 'U-' || (2026 - t.birth_year)::TEXT
             ELSE 'NO_BY' END as age_group,
        CASE WHEN t.gender IS NOT NULL THEN t.gender::TEXT ELSE 'NO_G' END as gender,
        COUNT(*) as cnt
      FROM league_standings ls
      JOIN teams_v2 t ON t.id = ls.team_id
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    console.log('\n--- PRODUCTION BREAKDOWN (from teams_v2 metadata) ---');
    for (const r of prodBreakdown.rows) {
      console.log(`  ${r.age_group} ${r.gender}: ${r.cnt} teams`);
    }

    // 4. NULL metadata teams in league_standings
    const nullMeta = await client.query(`
      SELECT COUNT(*) as cnt
      FROM league_standings ls
      JOIN teams_v2 t ON t.id = ls.team_id
      WHERE t.birth_year IS NULL OR t.gender IS NULL
    `);
    console.log(`\nCategory A (NULL_METADATA): ${nullMeta.rows[0].cnt} teams in league_standings with NULL birth_year or gender`);

    // 5. List the NULL metadata teams
    if (parseInt(nullMeta.rows[0].cnt) > 0) {
      const nullTeams = await client.query(`
        SELECT t.display_name,
               t.birth_year,
               CASE WHEN t.gender IS NOT NULL THEN t.gender::TEXT ELSE NULL END as gender,
               ls.division, t.id as team_id
        FROM league_standings ls
        JOIN teams_v2 t ON t.id = ls.team_id
        WHERE t.birth_year IS NULL OR t.gender IS NULL
        ORDER BY t.display_name
        LIMIT 50
      `);
      console.log('\n  NULL_METADATA teams (first 50):');
      for (const r of nullTeams.rows) {
        console.log(`    "${r.display_name}" | by=${r.birth_year} g=${r.gender} | div=${r.division}`);
      }
    }

    // 6. Count unresolved (in staging but not in production)
    // Match staging rows to league_standings by checking if team_source_id was resolved
    const processed = await client.query(`
      SELECT COUNT(*) as cnt FROM staging_standings WHERE processed = true
    `);
    const unprocessed = await client.query(`
      SELECT COUNT(*) as cnt FROM staging_standings WHERE processed = false
    `);
    console.log(`\nStaging processed:   ${processed.rows[0].cnt}`);
    console.log(`Staging unprocessed: ${unprocessed.rows[0].cnt}`);

    // 7. Per-division comparison for U-11 Boys (the reported issue)
    console.log('\n--- U-11 BOYS: STAGING vs PRODUCTION PER DIVISION ---');
    const u11Staging = await client.query(`
      SELECT division, COUNT(*) as cnt
      FROM staging_standings
      WHERE age_group = 'U-11' AND gender = 'Boys'
      GROUP BY division
      ORDER BY division
    `);
    const u11Prod = await client.query(`
      SELECT ls.division, COUNT(*) as cnt
      FROM league_standings ls
      JOIN teams_v2 t ON t.id = ls.team_id
      WHERE t.birth_year = 2015 AND t.gender = 'M'
      GROUP BY ls.division
      ORDER BY ls.division
    `);
    const prodMap = {};
    for (const r of u11Prod.rows) prodMap[r.division] = parseInt(r.cnt);
    for (const r of u11Staging.rows) {
      const prodCnt = prodMap[r.division] || 0;
      const gap = parseInt(r.cnt) - prodCnt;
      const status = gap === 0 ? 'OK' : `MISSING ${gap}`;
      console.log(`  ${r.division}: staging=${r.cnt} prod=${prodCnt} → ${status}`);
    }

    // 8. Full comparison across ALL age_group/gender/division
    console.log('\n--- FULL GAP ANALYSIS: ALL AGE GROUPS ---');
    const fullStaging = await client.query(`
      SELECT age_group, gender, division, COUNT(*) as cnt
      FROM staging_standings
      GROUP BY age_group, gender, division
      ORDER BY age_group, gender, division
    `);

    // Build production map keyed by normalized (age_group, gender, division)
    const fullProd = await client.query(`
      SELECT
        'U-' || (2026 - t.birth_year)::TEXT as age_group,
        CASE WHEN t.gender::TEXT = 'M' THEN 'Boys' WHEN t.gender::TEXT = 'F' THEN 'Girls' ELSE t.gender::TEXT END as gender,
        ls.division,
        COUNT(*) as cnt
      FROM league_standings ls
      JOIN teams_v2 t ON t.id = ls.team_id
      WHERE t.birth_year IS NOT NULL AND t.gender IS NOT NULL
      GROUP BY 1, 2, ls.division
      ORDER BY 1, 2, ls.division
    `);
    const fullProdMap = {};
    for (const r of fullProd.rows) {
      fullProdMap[`${r.age_group}|${r.gender}|${r.division}`] = parseInt(r.cnt);
    }

    let totalMissing = 0;
    let totalStaging = 0;
    let totalProd = 0;
    let divisionsWithGaps = 0;
    let divisionsOk = 0;

    for (const r of fullStaging.rows) {
      const key = `${r.age_group}|${r.gender}|${r.division}`;
      const prodCnt = fullProdMap[key] || 0;
      const stagCnt = parseInt(r.cnt);
      const gap = stagCnt - prodCnt;
      totalStaging += stagCnt;
      totalProd += prodCnt;
      totalMissing += Math.max(0, gap);

      if (gap > 0) {
        divisionsWithGaps++;
        console.log(`  ${r.age_group} ${r.gender} ${r.division}: staging=${stagCnt} prod=${prodCnt} → MISSING ${gap}`);
      } else {
        divisionsOk++;
      }
    }

    console.log(`\n--- SUMMARY ---`);
    console.log(`Total staging teams:    ${totalStaging}`);
    console.log(`Total production teams: ${totalProd}`);
    console.log(`Total missing:          ${totalMissing}`);
    console.log(`Divisions OK:           ${divisionsOk}`);
    console.log(`Divisions with gaps:    ${divisionsWithGaps}`);
    console.log(`Resolution rate:        ${((totalProd / totalStaging) * 100).toFixed(1)}%`);

    // 9. Specific: "Sporting City 15 Pre MLSN-East" resolution trace
    console.log('\n--- TRACE: Sporting City 15 Pre MLSN-East ---');
    const sportingStaging = await client.query(`
      SELECT team_name, team_source_id, age_group, gender, division, processed
      FROM staging_standings
      WHERE team_name ILIKE '%Sporting City%MLSN%'
    `);
    console.log('In staging_standings:');
    for (const r of sportingStaging.rows) {
      console.log(`  "${r.team_name}" | src_id=${r.team_source_id} | ${r.age_group} ${r.gender} | ${r.division} | processed=${r.processed}`);
    }

    const sportingTeams = await client.query(`
      SELECT id, display_name, birth_year, gender, canonical_name
      FROM teams_v2
      WHERE display_name ILIKE '%Sporting City%MLSN%'
    `);
    console.log('In teams_v2:');
    for (const r of sportingTeams.rows) {
      console.log(`  id=${r.id} | "${r.display_name}" | by=${r.birth_year} g=${r.gender}`);
    }

    const sportingMap = await client.query(`
      SELECT source_entity_id, sv_id
      FROM source_entity_map
      WHERE entity_type = 'team' AND source_entity_id ILIKE '%heartland%'
        AND sv_id IN (SELECT id FROM teams_v2 WHERE display_name ILIKE '%Sporting City%MLSN%')
    `);
    console.log('In source_entity_map:');
    for (const r of sportingMap.rows) {
      console.log(`  ${r.source_entity_id} → ${r.sv_id}`);
    }

    const sportingLS = await client.query(`
      SELECT ls.team_id, t.display_name, t.birth_year, t.gender, ls.division
      FROM league_standings ls
      JOIN teams_v2 t ON t.id = ls.team_id
      WHERE t.display_name ILIKE '%Sporting City%MLSN%'
    `);
    console.log('In league_standings:');
    for (const r of sportingLS.rows) {
      console.log(`  team_id=${r.team_id} | "${r.display_name}" | by=${r.birth_year} g=${r.gender} | ${r.division}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('DIAGNOSTIC COMPLETE');
    console.log('='.repeat(70));

  } finally {
    client.release();
    await pool.end();
  }
})();
