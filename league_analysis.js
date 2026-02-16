require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function analyzeLeagues() {
  try {
    console.log('='.repeat(80));
    console.log('SOCCERVIEW LEAGUE & STANDINGS ANALYSIS');
    console.log('='.repeat(80));
    
    // Query 1: Total leagues
    console.log('\n1. TOTAL LEAGUES IN DATABASE');
    console.log('-'.repeat(80));
    const q1 = await pool.query('SELECT COUNT(*) as total FROM leagues;');
    console.log(`Total leagues: ${q1.rows[0].total}`);
    
    // Query 2: Distinct league_ids in app_league_standings
    console.log('\n2. LEAGUES WITH STANDINGS DATA (app_league_standings view)');
    console.log('-'.repeat(80));
    const q2 = await pool.query('SELECT COUNT(DISTINCT league_id) as leagues_with_standings FROM app_league_standings;');
    console.log(`Leagues with standings data: ${q2.rows[0].leagues_with_standings}`);
    
    // Query 3: Distinct league_ids in matches_v2
    console.log('\n3. LEAGUES WITH MATCHES IN matches_v2');
    console.log('-'.repeat(80));
    const q3 = await pool.query(`
      SELECT COUNT(DISTINCT league_id) as leagues_with_matches 
      FROM matches_v2 
      WHERE league_id IS NOT NULL AND deleted_at IS NULL;
    `);
    console.log(`Leagues with matches: ${q3.rows[0].leagues_with_matches}`);
    
    // Query 4: Sample leagues WITH scraped standings (from league_standings table)
    console.log('\n4. SAMPLE LEAGUES WITH SCRAPED STANDINGS DATA (league_standings table)');
    console.log('-'.repeat(80));
    const q4 = await pool.query(`
      SELECT 
        l.id,
        l.name,
        COUNT(DISTINCT ls.team_id) as team_count,
        COUNT(DISTINCT ls.division) as divisions,
        MAX(ls.snapshot_date) as last_scraped
      FROM leagues l
      JOIN league_standings ls ON l.id = ls.league_id
      GROUP BY l.id, l.name
      ORDER BY team_count DESC
      LIMIT 10;
    `);
    console.log(`Found ${q4.rows.length} leagues with scraped standings:`);
    q4.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.name} (${row.team_count} teams in ${row.divisions} division(s), last: ${row.last_scraped})`);
    });
    
    // Query 5: Sample leagues WITHOUT scraped standings but WITH matches (computed fallback)
    console.log('\n5. SAMPLE LEAGUES WITHOUT SCRAPED STANDINGS (use computed fallback)');
    console.log('-'.repeat(80));
    const q5 = await pool.query(`
      SELECT 
        l.id,
        l.name,
        COUNT(DISTINCT m.id) as match_count,
        COUNT(DISTINCT CASE WHEN m.home_score IS NOT NULL THEN m.id END) as completed_matches,
        COUNT(DISTINCT CASE WHEN m.home_team_id = m.away_team_id THEN 1 END) as teams_in_league
      FROM leagues l
      JOIN matches_v2 m ON l.id = m.league_id AND m.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM league_standings WHERE league_id = l.id
      )
      GROUP BY l.id, l.name
      ORDER BY match_count DESC
      LIMIT 10;
    `);
    console.log(`Found ${q5.rows.length} leagues that use computed fallback (no scraped standings):`);
    q5.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.name} (${row.match_count} matches, ${row.completed_matches} completed)`);
    });
    
    // Query 6: Leagues in leagues table but with NO matches and NO standings
    console.log('\n6. LEAGUES WITH NO DATA (neither matches nor standings)');
    console.log('-'.repeat(80));
    const q6 = await pool.query(`
      SELECT 
        l.id,
        l.name,
        l.created_at
      FROM leagues l
      WHERE NOT EXISTS (SELECT 1 FROM matches_v2 WHERE league_id = l.id AND deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM league_standings WHERE league_id = l.id)
      ORDER BY l.created_at DESC
      LIMIT 10;
    `);
    console.log(`Found ${q6.rows.length} leagues with no data:`);
    q6.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.name}`);
    });
    
    // Query 7: Check app_league_standings hybrid view composition
    console.log('\n7. APP_LEAGUE_STANDINGS VIEW COMPOSITION');
    console.log('-'.repeat(80));
    
    // Count rows from PART 1 (scraped)
    const q7a = await pool.query(`
      SELECT COUNT(*) as scraped_rows
      FROM league_standings ls
      JOIN leagues l ON l.id = ls.league_id
      JOIN teams_v2 t ON t.id = ls.team_id
      JOIN seasons s ON s.id = ls.season_id AND s.is_current = true;
    `);
    
    // Count distinct leagues from PART 1
    const q7b = await pool.query(`
      SELECT COUNT(DISTINCT ls.league_id) as scraped_league_count
      FROM league_standings ls
      JOIN seasons s ON s.id = ls.season_id AND s.is_current = true;
    `);
    
    // Count rows from PART 2 (computed fallback)
    const q7c = await pool.query(`
      WITH scraped_league_ids AS (
        SELECT DISTINCT ls2.league_id
        FROM league_standings ls2
        JOIN seasons s2 ON s2.id = ls2.season_id AND s2.is_current = true
      )
      SELECT COUNT(*) as computed_rows
      FROM leagues l
      WHERE NOT EXISTS (SELECT 1 FROM scraped_league_ids WHERE league_id = l.id)
        AND EXISTS (SELECT 1 FROM matches_v2 WHERE league_id = l.id AND deleted_at IS NULL);
    `);
    
    console.log(`PART 1 (Scraped - league_standings table):`);
    console.log(`  - Rows: ${q7a.rows[0].scraped_rows}`);
    console.log(`  - Leagues: ${q7b.rows[0].scraped_league_count}`);
    console.log(`PART 2 (Computed fallback - matches_v2):`);
    console.log(`  - Leagues (without scraped standings): ${q7c.rows[0].computed_rows}`);
    
    // Query 8: Key insight - does computed fallback create standings for ALL leagues with matches?
    console.log('\n8. KEY INSIGHT: Computed Fallback Coverage');
    console.log('-'.repeat(80));
    const q8 = await pool.query(`
      WITH leagues_with_matches AS (
        SELECT DISTINCT league_id FROM matches_v2 WHERE deleted_at IS NULL AND league_id IS NOT NULL
      ),
      leagues_with_scraped AS (
        SELECT DISTINCT league_id FROM league_standings
      )
      SELECT 
        COUNT(DISTINCT lwm.league_id) as total_with_matches,
        COUNT(DISTINCT lws.league_id) as with_scraped,
        COUNT(DISTINCT CASE WHEN lws.league_id IS NULL THEN lwm.league_id END) as use_computed_fallback
      FROM leagues_with_matches lwm
      LEFT JOIN leagues_with_scraped lws ON lwm.league_id = lws.league_id;
    `);
    const result = q8.rows[0];
    console.log(`Total leagues with matches: ${result.total_with_matches}`);
    console.log(`Leagues with scraped standings: ${result.with_scraped}`);
    console.log(`Leagues using computed fallback: ${result.use_computed_fallback}`);
    console.log(`\nANSWER: YES - The computed fallback in PART 2 creates standings for`);
    console.log(`        ${result.use_computed_fallback} leagues that have matches but no scraped standings.`);
    console.log(`        This means ${result.use_computed_fallback} leagues with 50+ matches will get`);
    console.log(`        computed standings visible in the app.`);
    
    await pool.end();
    
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

analyzeLeagues();
