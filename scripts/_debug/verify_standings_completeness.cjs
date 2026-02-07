/**
 * Verify Standings Completeness
 * ==============================
 * 1:1 comparison of staging_standings vs league_standings per division.
 * Normalizes division names (Subdivision N → Division N) for proper comparison.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    // Total counts
    const staging = await client.query('SELECT COUNT(*) as cnt FROM staging_standings');
    const prod = await client.query('SELECT COUNT(*) as cnt FROM league_standings');
    console.log('staging_standings:', staging.rows[0].cnt);
    console.log('league_standings:', prod.rows[0].cnt);
    console.log('difference:', parseInt(staging.rows[0].cnt) - parseInt(prod.rows[0].cnt));

    // Check for NULL metadata in production
    const nullMeta = await client.query(`
      SELECT COUNT(*) as cnt
      FROM league_standings ls
      JOIN teams_v2 t ON t.id = ls.team_id
      WHERE t.birth_year IS NULL OR t.gender IS NULL
    `);
    console.log('\nNULL metadata (invisible in app):', nullMeta.rows[0].cnt);
    console.log('(Previous run had 439 NULL metadata teams — improvement:', 439 - parseInt(nullMeta.rows[0].cnt) + ')');

    // PROPER comparison: normalize staging division names to match production
    const comparison = await client.query(`
      WITH staging_norm AS (
        SELECT
          age_group, gender,
          regexp_replace(division, '^[Ss]ub[Dd]ivision', 'Division') as division,
          COUNT(*) as cnt
        FROM staging_standings
        GROUP BY 1, 2, regexp_replace(division, '^[Ss]ub[Dd]ivision', 'Division')
      ),
      prod_norm AS (
        SELECT
          'U-' || (2026 - t.birth_year)::TEXT as age_group,
          CASE WHEN t.gender::TEXT = 'M' THEN 'Boys' WHEN t.gender::TEXT = 'F' THEN 'Girls' ELSE 'UNKNOWN' END as gender,
          ls.division,
          COUNT(*) as cnt
        FROM league_standings ls
        JOIN teams_v2 t ON t.id = ls.team_id
        WHERE t.birth_year IS NOT NULL AND t.gender IS NOT NULL
        GROUP BY 1, 2, 3
      )
      SELECT
        COALESCE(s.age_group, p.age_group) as age,
        COALESCE(s.gender, p.gender) as gender,
        COALESCE(s.division, p.division) as division,
        COALESCE(s.cnt, 0)::int as staging_cnt,
        COALESCE(p.cnt, 0)::int as prod_cnt,
        (COALESCE(s.cnt, 0) - COALESCE(p.cnt, 0))::int as gap
      FROM staging_norm s
      FULL OUTER JOIN prod_norm p ON s.age_group = p.age_group AND s.gender = p.gender AND s.division = p.division
      WHERE COALESCE(s.cnt, 0) != COALESCE(p.cnt, 0)
      ORDER BY 1, 2, 3
    `);

    if (comparison.rows.length === 0) {
      console.log('\n*** PERFECT MATCH: Every division matches 1:1 ***');
    } else {
      console.log('\n--- GAPS (staging vs production, normalized) ---');
      let totalPositive = 0;
      for (const r of comparison.rows) {
        console.log(`  ${r.age} ${r.gender} ${r.division}: staging=${r.staging_cnt} prod=${r.prod_cnt} gap=${r.gap}`);
        if (r.gap > 0) totalPositive += r.gap;
      }
      console.log(`\nDivisions with gaps: ${comparison.rows.length}`);
      console.log(`Total missing from production: ${totalPositive}`);
    }

    // Sporting City trace
    const sporting = await client.query(`
      SELECT t.display_name, t.birth_year, t.gender::TEXT as gender, ls.division
      FROM league_standings ls
      JOIN teams_v2 t ON t.id = ls.team_id
      WHERE t.display_name ILIKE '%Sporting City 15 Pre MLSN-East%'
    `);
    console.log('\n--- SPORTING CITY 15 Pre MLSN-East ---');
    for (const r of sporting.rows) {
      console.log(`  "${r.display_name}" by=${r.birth_year} g=${r.gender} div=${r.division}`);
    }

    // U-11 Boys Division 1 (the originally reported issue)
    const u11d1 = await client.query(`
      SELECT t.display_name, t.birth_year, ls.points, ls.played, ls.wins, ls.losses, ls.draws, ls.position
      FROM league_standings ls
      JOIN teams_v2 t ON t.id = ls.team_id
      WHERE t.birth_year = 2015 AND t.gender = 'M' AND ls.division = 'Division 1'
      ORDER BY ls.position
    `);
    console.log('\n--- U-11 BOYS DIVISION 1 (originally showed 7, should be 11) ---');
    console.log(`Teams: ${u11d1.rows.length}`);
    for (const r of u11d1.rows) {
      console.log(`  #${r.position} ${r.display_name} | ${r.played}GP ${r.wins}W-${r.losses}L-${r.draws}D | ${r.points}pts`);
    }

  } finally {
    client.release();
    await pool.end();
  }
})();
