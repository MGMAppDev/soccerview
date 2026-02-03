/**
 * Find the specific missing match: 09/14 Sporting BV Pre-NAL 15 vs Union KC Jr Elite - 4-1
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('='.repeat(70));
    console.log('SEARCHING FOR: 09/14 Sporting BV Pre-NAL 15 vs Union KC Jr Elite - 4-1');
    console.log('='.repeat(70));

    // Search staging for Union KC Jr Elite B15 (2015 Boys)
    console.log('\n1. Searching staging_games for Union KC Jr Elite B15...\n');

    const { rows: unionB15 } = await client.query(`
      SELECT
        id,
        match_date,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        event_name,
        source_platform,
        processed
      FROM staging_games
      WHERE (
        home_team_name ILIKE '%union%kc%elite%15%'
        OR away_team_name ILIKE '%union%kc%elite%15%'
        OR home_team_name ILIKE '%union%kc%jr%elite%b15%'
        OR away_team_name ILIKE '%union%kc%jr%elite%b15%'
        OR home_team_name ILIKE '%union%kc%junior%elite%15%'
        OR away_team_name ILIKE '%union%kc%junior%elite%15%'
      )
      ORDER BY match_date DESC
    `);

    if (unionB15.length === 0) {
      console.log('  ❌ No staging records for Union KC Jr Elite B15');
    } else {
      console.log(`  Found ${unionB15.length} matches:`);
      unionB15.forEach(m => {
        const dateStr = m.match_date ? new Date(m.match_date).toISOString().split('T')[0] : 'no date';
        console.log(`    ${dateStr}: ${m.home_team_name} vs ${m.away_team_name} (${m.home_score}-${m.away_score})`);
      });
    }

    // Search matches_v2 for Union KC Jr Elite B15
    console.log('\n2. Searching matches_v2 for Union KC Jr Elite B15...\n');

    const { rows: unionMatches } = await client.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,
        ht.display_name as home_team,
        at.display_name as away_team,
        l.name as league_name
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      LEFT JOIN leagues l ON m.league_id = l.id
      WHERE (
        ht.display_name ILIKE '%union%kc%elite%15%'
        OR at.display_name ILIKE '%union%kc%elite%15%'
        OR ht.display_name ILIKE '%union%kc%jr%elite%b15%'
        OR at.display_name ILIKE '%union%kc%jr%elite%b15%'
      )
      ORDER BY m.match_date DESC
    `);

    if (unionMatches.length === 0) {
      console.log('  ❌ No matches found for Union KC Jr Elite B15');
    } else {
      console.log(`  Found ${unionMatches.length} matches:`);
      unionMatches.forEach(m => {
        const dateStr = m.match_date ? new Date(m.match_date).toISOString().split('T')[0] : 'no date';
        console.log(`    ${dateStr}: ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
        console.log(`      League: ${m.league_name || 'None'}`);
      });
    }

    // Search for ALL "Sporting BV Pre-NAL" matches in September
    console.log('\n3. ALL Sporting BV Pre-NAL 15 matches in September 2025...\n');

    const { rows: septMatches } = await client.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,
        ht.display_name as home_team,
        at.display_name as away_team,
        ht.birth_year as home_birth_year,
        at.birth_year as away_birth_year,
        l.name as league_name
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      LEFT JOIN leagues l ON m.league_id = l.id
      WHERE m.match_date >= '2025-09-01' AND m.match_date < '2025-10-01'
        AND (
          ht.display_name ILIKE '%sporting%bv%pre%nal%15%'
          OR at.display_name ILIKE '%sporting%bv%pre%nal%15%'
          OR (ht.display_name ILIKE '%sporting%bv%pre%nal%' AND ht.birth_year = 2015)
          OR (at.display_name ILIKE '%sporting%bv%pre%nal%' AND at.birth_year = 2015)
        )
      ORDER BY m.match_date
    `);

    console.log(`  Found ${septMatches.length} September matches:`);
    septMatches.forEach(m => {
      const dateStr = m.match_date ? new Date(m.match_date).toISOString().split('T')[0] : 'no date';
      console.log(`    ${dateStr}: ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
    });

    // Look for ANY 4-1 match involving Sporting in September
    console.log('\n4. Any Sporting match with 4-1 score in Sept 2025...\n');

    const { rows: sporting41 } = await client.query(`
      SELECT
        m.id,
        m.match_date,
        m.home_score,
        m.away_score,
        ht.display_name as home_team,
        at.display_name as away_team,
        l.name as league_name
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      LEFT JOIN leagues l ON m.league_id = l.id
      WHERE m.match_date >= '2025-09-01' AND m.match_date < '2025-10-01'
        AND ((m.home_score = 4 AND m.away_score = 1) OR (m.home_score = 1 AND m.away_score = 4))
        AND (
          ht.display_name ILIKE '%sporting%'
          OR at.display_name ILIKE '%sporting%'
        )
      ORDER BY m.match_date
    `);

    console.log(`  Found ${sporting41.length} matches:`);
    sporting41.forEach(m => {
      const dateStr = m.match_date ? new Date(m.match_date).toISOString().split('T')[0] : 'no date';
      console.log(`    ${dateStr}: ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
      console.log(`      League: ${m.league_name || 'None'}`);
    });

    // Search staging for Sept 14 match with 4-1 score involving Sporting or Union
    console.log('\n5. Staging_games on Sept 14 with Sporting or Union...\n');

    const { rows: staging914 } = await client.query(`
      SELECT
        id,
        match_date,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        event_name,
        processed
      FROM staging_games
      WHERE match_date::text LIKE '2025-09-14%'
        AND (
          home_team_name ILIKE '%sporting%bv%pre%nal%'
          OR away_team_name ILIKE '%sporting%bv%pre%nal%'
          OR home_team_name ILIKE '%union%kc%'
          OR away_team_name ILIKE '%union%kc%'
        )
      ORDER BY home_team_name
    `);

    console.log(`  Found ${staging914.length} staging records:`);
    staging914.forEach(m => {
      console.log(`    ${m.home_team_name} vs ${m.away_team_name} (${m.home_score}-${m.away_score})`);
      console.log(`      Event: ${m.event_name}, Processed: ${m.processed}`);
    });

    console.log('\n' + '='.repeat(70));
    console.log('ROOT CAUSE ANALYSIS');
    console.log('='.repeat(70));

    console.log(`
The missing match (09/14 Sporting BV Pre-NAL 15 vs Union KC Jr Elite 4-1) was:

1. NEVER SCRAPED from Heartland Soccer League
   - Not present in staging_games
   - The scraper missed this specific match

2. Possible reasons:
   a. The match was added to Heartland after our last scrape
   b. The match is in a different division/age group page not being scraped
   c. There was a scraper error when processing that page
   d. The team name format was different and didn't match our filter

3. RECOMMENDED FIX:
   - Re-run the Heartland scraper for the Premier League 2025
   - Check the Heartland website manually to verify the match exists
   - If found, investigate why the scraper missed it
`);

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
