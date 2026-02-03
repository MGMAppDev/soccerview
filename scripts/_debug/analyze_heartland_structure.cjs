/**
 * Analyze Heartland data structure to find coverage gaps
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('='.repeat(70));
    console.log('HEARTLAND DATA STRUCTURE ANALYSIS');
    console.log('='.repeat(70));

    // 1. Specifically for U11 Boys subdivisions
    console.log('\n1. U11 Boys subdivisions captured:');
    const { rows: u11subs } = await client.query(`
      SELECT
        raw_data->>'heartland_subdivision' as subdivision,
        COUNT(*) as match_count
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND division ILIKE '%U11%Boys%'
        AND raw_data->>'heartland_subdivision' IS NOT NULL
      GROUP BY raw_data->>'heartland_subdivision'
      ORDER BY
        CASE WHEN raw_data->>'heartland_subdivision' ~ '^[0-9]+$'
             THEN (raw_data->>'heartland_subdivision')::int
             ELSE 999 END
    `);

    u11subs.forEach(c => {
      console.log(`  Subdivision ${c.subdivision}: ${c.match_count} matches`);
    });

    // 2. Check for any Sept 14 U11 Boys matches
    console.log('\n2. ALL U11 Boys matches on Sept 14:');
    const { rows: sept14u11 } = await client.query(`
      SELECT DISTINCT
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        raw_data->>'heartland_subdivision' as subdivision
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND match_date::text LIKE '2025-09-14%'
        AND division ILIKE '%U11%Boys%'
      ORDER BY home_team_name
    `);

    console.log(`  Found ${sept14u11.length} U11 Boys matches on Sept 14`);

    // Check for Union matches
    const unionMatches = sept14u11.filter(m =>
      m.home_team_name.toLowerCase().includes('union') ||
      m.away_team_name.toLowerCase().includes('union')
    );
    console.log(`  Union team matches on Sept 14: ${unionMatches.length}`);
    unionMatches.forEach(m => {
      console.log(`    ${m.home_team_name} vs ${m.away_team_name} (${m.home_score}-${m.away_score}) [Subdiv ${m.subdivision}]`);
    });

    // 3. Check what dates Sporting BV Pre-NAL 15 has matches
    console.log('\n3. All SPORTING BV Pre-NAL 15 match dates:');
    const { rows: sportingDates } = await client.query(`
      SELECT DISTINCT
        match_date::date as match_date
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND (home_team_name ILIKE '%pre-nal%15%' OR away_team_name ILIKE '%pre-nal%15%')
      ORDER BY match_date
    `);
    sportingDates.forEach(d => {
      console.log(`  ${d.match_date}`);
    });

    // 4. Did we miss Sept 14 entirely for subdivision 1?
    console.log('\n4. Subdivision 1 matches on Sept 14:');
    const { rows: subdiv1sept14 } = await client.query(`
      SELECT DISTINCT
        home_team_name,
        away_team_name,
        home_score,
        away_score
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND match_date::text LIKE '2025-09-14%'
        AND division ILIKE '%U11%Boys%'
        AND raw_data->>'heartland_subdivision' = '1'
      ORDER BY home_team_name
    `);

    console.log(`  Found ${subdiv1sept14.length} matches in Subdivision 1 on Sept 14`);
    subdiv1sept14.forEach(m => {
      console.log(`    ${m.home_team_name} vs ${m.away_team_name} (${m.home_score}-${m.away_score})`);
    });

    // 5. Check if the specific Sept 14 match exists anywhere
    console.log('\n5. Searching for Union KC Jr Elite + 4-1 on Sept 14:');
    const { rows: specific } = await client.query(`
      SELECT
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        division,
        raw_data->>'heartland_subdivision' as subdivision,
        source_platform
      FROM staging_games
      WHERE match_date::text LIKE '2025-09-14%'
        AND (
          (home_team_name ILIKE '%union%kc%elite%' AND home_score = 4 AND away_score = 1)
          OR (away_team_name ILIKE '%union%kc%elite%' AND home_score = 1 AND away_score = 4)
        )
    `);

    if (specific.length === 0) {
      console.log('  ❌ NOT FOUND - This match was NEVER SCRAPED');
    } else {
      specific.forEach(m => {
        console.log(`  ✓ Found: ${m.home_team_name} vs ${m.away_team_name}`);
        console.log(`    Score: ${m.home_score}-${m.away_score}, Division: ${m.division}`);
      });
    }

    // 6. Check the overall scrape dates for Sept
    console.log('\n6. September 2025 scrape coverage:');
    const { rows: septDates } = await client.query(`
      SELECT
        match_date::date as date,
        COUNT(DISTINCT id) as match_count
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND match_date::text LIKE '2025-09-%'
        AND division ILIKE '%U11%Boys%'
        AND raw_data->>'heartland_subdivision' = '1'
      GROUP BY match_date::date
      ORDER BY match_date::date
    `);

    console.log('  Subdivision 1 U11 Boys matches by date:');
    septDates.forEach(d => {
      const marker = d.date.toISOString().includes('09-14') ? '⚠️' : '  ';
      console.log(`  ${marker} ${d.date.toISOString().split('T')[0]}: ${d.match_count} matches`);
    });

    console.log('\n' + '='.repeat(70));
    console.log('ROOT CAUSE ANALYSIS');
    console.log('='.repeat(70));

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
