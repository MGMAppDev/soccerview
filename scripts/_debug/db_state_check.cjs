require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL) as matches,
      (SELECT COUNT(*) FROM teams_v2) as teams,
      (SELECT COUNT(*) FROM league_standings) as standings,
      (SELECT COUNT(*) FROM leagues) as leagues,
      (SELECT COUNT(*) FROM tournaments) as tournaments,
      (SELECT COUNT(*) FROM source_entity_map) as sem,
      (SELECT COUNT(*) FROM staging_games WHERE NOT processed) as unproc_staging,
      (SELECT COUNT(*) FROM staging_standings WHERE NOT processed) as unproc_standings,
      (SELECT COUNT(*) FROM teams_v2 WHERE elo_rating > 0) as teams_with_elo,
      (SELECT COUNT(*) FROM teams_v2 WHERE national_rank IS NOT NULL) as teams_with_rank,
      (SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL AND home_score IS NULL AND match_date > NOW()) as upcoming,
      (SELECT COUNT(*) FROM matches_v2 WHERE deleted_at IS NULL AND home_score IS NULL AND match_date > NOW() AND (league_id IS NOT NULL OR tournament_id IS NOT NULL)) as upcoming_linked
  `);
  const m = r.rows[0];
  console.log('=== CURRENT DATABASE STATE ===');
  console.log('matches_v2 active:    ', m.matches);
  console.log('teams_v2:             ', m.teams);
  console.log('league_standings:     ', m.standings);
  console.log('leagues:              ', m.leagues);
  console.log('tournaments:          ', m.tournaments);
  console.log('source_entity_map:    ', m.sem);
  console.log('unproc staging_games: ', m.unproc_staging);
  console.log('unproc staging_stndgs:', m.unproc_standings);
  console.log('teams with ELO:       ', m.teams_with_elo);
  console.log('teams with GS rank:   ', m.teams_with_rank);
  console.log('upcoming (total):     ', m.upcoming);
  console.log('upcoming (linked):    ', m.upcoming_linked);

  // Check league_standings indexes
  const idx = await pool.query(`
    SELECT indexname FROM pg_indexes 
    WHERE tablename = 'league_standings' 
    ORDER BY indexname
  `);
  console.log('\n=== league_standings INDEXES ===');
  idx.rows.forEach(r => console.log(' ', r.indexname));

  // Check SEM stats  
  const sem = await pool.query(`
    SELECT source_platform, COUNT(*) as cnt 
    FROM source_entity_map 
    WHERE entity_type = 'team'
    GROUP BY source_platform 
    ORDER BY cnt DESC
    LIMIT 10
  `);
  console.log('\n=== SEM by Platform (teams) ===');
  sem.rows.forEach(r => console.log(' ' + r.source_platform.padEnd(20) + ' ' + r.cnt));

  // Check staging_standings unprocessed breakdown by source
  const ss = await pool.query(`
    SELECT source_platform, COUNT(*) as cnt
    FROM staging_standings
    WHERE NOT processed
    GROUP BY source_platform
    ORDER BY cnt DESC
  `);
  console.log('\n=== Unprocessed staging_standings by source ===');
  if (ss.rows.length === 0) {
    console.log('  (none)');
  } else {
    ss.rows.forEach(r => console.log(' ' + (r.source_platform || 'NULL').padEnd(20) + ' ' + r.cnt));
  }

  pool.end();
}
main().catch(e => { console.error(e); pool.end(); process.exit(1); });
