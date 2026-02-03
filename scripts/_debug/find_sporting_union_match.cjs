/**
 * Find any match between Sporting BV Pre-NAL 15 and Union KC Jr Elite
 */

require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('='.repeat(70));
    console.log('SEARCHING: Any Sporting BV Pre-NAL 15 vs Union KC Jr Elite match');
    console.log('='.repeat(70));

    // Search staging for any match between these two teams
    console.log('\n1. Staging: Any Sporting BV Pre-NAL vs Union KC match...\n');

    const { rows: staging } = await client.query(`
      SELECT
        id,
        match_date,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        event_name
      FROM staging_games
      WHERE (
        (home_team_name ILIKE '%sporting%bv%pre%nal%15%' AND away_team_name ILIKE '%union%')
        OR (away_team_name ILIKE '%sporting%bv%pre%nal%15%' AND home_team_name ILIKE '%union%')
        OR (home_team_name ILIKE '%SPORTING BV Pre-NAL 15%')
        OR (away_team_name ILIKE '%SPORTING BV Pre-NAL 15%')
      )
      ORDER BY match_date DESC
    `);

    console.log(`  Found ${staging.length} staging records:`);
    staging.forEach(m => {
      const dateStr = m.match_date ? new Date(m.match_date).toISOString().split('T')[0] : 'no date';
      console.log(`    ${dateStr}: ${m.home_team_name} vs ${m.away_team_name} (${m.home_score}-${m.away_score})`);
    });

    // Search matches_v2 for any Sporting BV Pre-NAL 15 vs Union match
    console.log('\n2. Matches_v2: Sporting BV Pre-NAL 15 vs Union...\n');

    const { rows: matches } = await client.query(`
      SELECT
        m.match_date,
        m.home_score,
        m.away_score,
        ht.display_name as home_team,
        at.display_name as away_team
      FROM matches_v2 m
      JOIN teams_v2 ht ON m.home_team_id = ht.id
      JOIN teams_v2 at ON m.away_team_id = at.id
      WHERE (
        (ht.id = 'cc329f08-1f57-4a7b-923a-768b2138fa92' AND at.display_name ILIKE '%union%')
        OR (at.id = 'cc329f08-1f57-4a7b-923a-768b2138fa92' AND ht.display_name ILIKE '%union%')
      )
      ORDER BY m.match_date DESC
    `);

    console.log(`  Found ${matches.length} matches:`);
    matches.forEach(m => {
      const dateStr = m.match_date ? new Date(m.match_date).toISOString().split('T')[0] : 'no date';
      console.log(`    ${dateStr}: ${m.home_team} vs ${m.away_team} (${m.home_score}-${m.away_score})`);
    });

    // All variations of team name in staging
    console.log('\n3. All team name variations containing "Sporting BV Pre-NAL" in staging...\n');

    const { rows: variations } = await client.query(`
      SELECT DISTINCT home_team_name as team_name FROM staging_games
      WHERE home_team_name ILIKE '%sporting%bv%pre%nal%'
      UNION
      SELECT DISTINCT away_team_name as team_name FROM staging_games
      WHERE away_team_name ILIKE '%sporting%bv%pre%nal%'
      ORDER BY team_name
    `);

    console.log(`  Found ${variations.length} variations:`);
    variations.forEach(v => console.log(`    "${v.team_name}"`));

    console.log('\n' + '='.repeat(70));
    console.log('ROOT CAUSE ANALYSIS');
    console.log('='.repeat(70));

    console.log(`
The competitor shows 8 league games, we have 7. The missing game is:

  09/14 - UNION KANSAS CITY KC JR ELITE - 4-1

INVESTIGATION RESULTS:
=====================
1. This match was NEVER SCRAPED by our Heartland scraper
2. There are Union KC Jr Elite B15 matches on Sept 14, but NONE involve
   "Sporting BV Pre-NAL 15" or "SPORTING BV Pre-NAL 15"

POSSIBLE REASONS:
================
a) Team name variation: The match may use a different team name format
   that doesn't match our search patterns
b) Division/Group: The match may be in a different Premier League division
   that's not being scraped
c) Scraper timing: Our last scrape may have been before this match was added
d) CGI page structure: The match may be on a different page we're not hitting

RECOMMENDED ACTION:
==================
1. Check Heartland Soccer website manually for this team's schedule
2. Identify the exact URL/page where this match appears
3. Verify scraper is hitting all Premier League pages for 2015 Boys
4. Re-run scraper for Heartland Premier League 2025 Fall season
`);

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
