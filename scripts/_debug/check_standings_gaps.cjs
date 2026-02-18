/**
 * Check standings gaps — Session 113 audit follow-up
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // GotSport leagues WITH standings
  const { rows: gsStandings } = await pool.query(`
    SELECT l.state, l.name, l.source_event_id, COUNT(ls.id) as standings_count
    FROM leagues l
    LEFT JOIN league_standings ls ON ls.league_id = l.id AND ls.source_platform = 'gotsport'
    WHERE l.source_event_id LIKE 'gotsport-%'
    GROUP BY l.id, l.state, l.name, l.source_event_id
    HAVING COUNT(ls.id) > 0
    ORDER BY l.state, COUNT(ls.id) DESC
  `);
  console.log('=== GotSport leagues WITH standings ===');
  gsStandings.forEach(r => console.log(`  [${r.state||'XX'}] ${r.name.slice(0,55)} => ${r.standings_count}`));

  // Leagues with matches but NO standings, grouped by state
  const { rows: leaguesNoStandings } = await pool.query(`
    SELECT l.state, l.source_event_id, COUNT(DISTINCT m.id) as matches, l.name
    FROM leagues l
    JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    LEFT JOIN league_standings ls ON ls.league_id = l.id
    WHERE ls.id IS NULL
    GROUP BY l.id, l.state, l.name, l.source_event_id
    ORDER BY l.state, matches DESC
    LIMIT 60
  `);
  console.log('\n=== Top leagues with matches but NO standings (top 60) ===');
  leaguesNoStandings.forEach(r => console.log(`  [${r.state||'XX'}] ${r.name.slice(0,55)} (${r.source_event_id}) => ${r.matches} matches`));

  // States where GotSport has leagues without standings - how many leagues?
  const { rows: stateGS } = await pool.query(`
    SELECT l.state,
           COUNT(DISTINCT l.id) as gs_leagues,
           COUNT(DISTINCT ls.league_id) as gs_leagues_with_standings,
           SUM(CASE WHEN ls.league_id IS NULL THEN 1 ELSE 0 END) as gs_leagues_without_standings
    FROM leagues l
    JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
    LEFT JOIN league_standings ls ON ls.league_id = l.id
    WHERE l.source_event_id LIKE 'gotsport-%'
    GROUP BY l.state
    ORDER BY gs_leagues_without_standings DESC
    LIMIT 30
  `);
  console.log('\n=== GotSport leagues by state: with vs without standings ===');
  stateGS.forEach(r => console.log(`  ${r.state||'XX'}: ${r.gs_leagues_with_standings} with standings / ${r.gs_leagues_without_standings} WITHOUT / ${r.gs_leagues} total`));

  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
