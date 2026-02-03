/**
 * Check Heartland subdivisions we've captured for U-11 Boys
 * and identify if there are subdivisions we're missing
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('='.repeat(70));
    console.log('HEARTLAND SUBDIVISION ANALYSIS');
    console.log('='.repeat(70));

    // Get all subdivisions we've captured for U-11 Boys in Premier League
    console.log('\n1. Subdivisions captured for U-11 Boys Premier...\n');

    const { rows: subdivisions } = await client.query(`
      SELECT
        raw_data->>'heartland_subdivision' as subdivision,
        COUNT(*) as match_count
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND division ILIKE '%U11%Boys%'
        AND event_name ILIKE '%Premier%'
      GROUP BY raw_data->>'heartland_subdivision'
      ORDER BY
        CASE WHEN raw_data->>'heartland_subdivision' ~ '^[0-9]+$'
             THEN (raw_data->>'heartland_subdivision')::int
             ELSE 999 END
    `);

    console.log(`  Found ${subdivisions.length} subdivisions:`);
    subdivisions.forEach(s => {
      console.log(`    Division ${s.subdivision}: ${s.match_count} matches`);
    });

    // Check which subdivisions have Sporting BV Pre-NAL 15 matches
    console.log('\n2. Subdivisions with Sporting BV Pre-NAL 15 matches...\n');

    const { rows: sportingSubdivs } = await client.query(`
      SELECT DISTINCT
        raw_data->>'heartland_subdivision' as subdivision,
        COUNT(*) as match_count
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND (home_team_name ILIKE '%SPORTING BV Pre-NAL 15%' OR away_team_name ILIKE '%SPORTING BV Pre-NAL 15%')
      GROUP BY raw_data->>'heartland_subdivision'
      ORDER BY subdivision
    `);

    console.log(`  Found in ${sportingSubdivs.length} subdivisions:`);
    sportingSubdivs.forEach(s => {
      console.log(`    Division ${s.subdivision}: ${s.match_count} matches`);
    });

    // Check which subdivision has Union KC Jr Elite B15 matches
    console.log('\n3. Subdivisions with Union KC Jr Elite B15 matches...\n');

    const { rows: unionSubdivs } = await client.query(`
      SELECT DISTINCT
        raw_data->>'heartland_subdivision' as subdivision,
        COUNT(*) as match_count,
        MIN(match_date)::date as first_match,
        MAX(match_date)::date as last_match
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND (home_team_name ILIKE '%Union KC Jr Elite B15%' OR away_team_name ILIKE '%Union KC Jr Elite B15%')
      GROUP BY raw_data->>'heartland_subdivision'
      ORDER BY subdivision
    `);

    console.log(`  Found in ${unionSubdivs.length} subdivisions:`);
    unionSubdivs.forEach(s => {
      console.log(`    Division ${s.subdivision}: ${s.match_count} matches (${s.first_match} to ${s.last_match})`);
    });

    // Check ALL subdivisions we've scraped
    console.log('\n4. All subdivisions captured in staging_games...\n');

    const { rows: allSubdivs } = await client.query(`
      SELECT DISTINCT
        raw_data->>'heartland_subdivision' as subdivision,
        COUNT(*) as match_count
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND raw_data->>'heartland_subdivision' IS NOT NULL
      GROUP BY raw_data->>'heartland_subdivision'
      ORDER BY
        CASE WHEN raw_data->>'heartland_subdivision' ~ '^[0-9]+$'
             THEN (raw_data->>'heartland_subdivision')::int
             ELSE 999 END,
        raw_data->>'heartland_subdivision'
    `);

    console.log(`  Total subdivisions: ${allSubdivs.length}`);
    console.log('  Numeric subdivisions:', allSubdivs.filter(s => /^\d+$/.test(s.subdivision)).map(s => s.subdivision).join(', '));
    console.log('  Named subdivisions:', allSubdivs.filter(s => !/^\d+$/.test(s.subdivision)).map(s => s.subdivision).join(', '));

    // Check max subdivision number
    const maxNumeric = Math.max(...allSubdivs.filter(s => /^\d+$/.test(s.subdivision)).map(s => parseInt(s.subdivision)));
    console.log(`\n  Max numeric subdivision: ${maxNumeric}`);

    // Check if there are matches in subdivisions > 14
    console.log('\n5. Matches in subdivisions > 14...\n');

    const { rows: highSubdivs } = await client.query(`
      SELECT
        raw_data->>'heartland_subdivision' as subdivision,
        COUNT(*) as match_count
      FROM staging_games
      WHERE source_platform = 'heartland'
        AND raw_data->>'heartland_subdivision' ~ '^[0-9]+$'
        AND (raw_data->>'heartland_subdivision')::int > 14
      GROUP BY raw_data->>'heartland_subdivision'
      ORDER BY (raw_data->>'heartland_subdivision')::int
    `);

    if (highSubdivs.length > 0) {
      console.log('  ⚠️ Found matches in subdivisions > 14:');
      highSubdivs.forEach(s => console.log(`    Division ${s.subdivision}: ${s.match_count} matches`));
    } else {
      console.log('  No matches found in subdivisions > 14');
    }

    console.log('\n' + '='.repeat(70));
    console.log('ROOT CAUSE ANALYSIS');
    console.log('='.repeat(70));

    console.log(`
Current scraper configuration:
- Subdivisions: 1-14 for Premier League

Potential issues:
1. Heartland may have MORE than 14 subdivisions for certain age groups
2. The missing match may be in a subdivision > 14 that we don't scrape
3. Or the subdivision naming may be different (letters instead of numbers)

UNIVERSAL FIX REQUIRED:
=======================
The scraper should DYNAMICALLY discover all subdivisions, not use a static list.
This applies to ALL data sources - we should never assume a fixed set of categories.

Principle: "Gather ALL raw data from ANY source"
`);

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
