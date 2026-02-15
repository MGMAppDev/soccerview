require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log('=========================================================');
  console.log('  COMPREHENSIVE VERIFICATION CHECKLIST');
  console.log('=========================================================');

  // === FLOW 3: Scheduled → Upcoming ===
  console.log('\n--- FLOW 3: SCHEDULED → UPCOMING ---');

  // NC future matches
  const { rows: [futureNC] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM matches_v2 WHERE source_platform = 'sincsports' AND deleted_at IS NULL AND home_score IS NULL AND match_date > NOW()"
  );
  console.log('NC future matches (NULL scores + future date): ' + futureNC.cnt);

  const { rows: [linkedFuture] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM matches_v2 WHERE source_platform = 'sincsports' AND deleted_at IS NULL AND home_score IS NULL AND match_date > NOW() AND league_id IS NOT NULL"
  );
  console.log('NC future with league_id (eligible for upcoming): ' + linkedFuture.cnt);

  // Check app_upcoming_schedule view (materialized view — check via pg_matviews)
  const { rows: viewCheck } = await pool.query(
    "SELECT attname FROM pg_attribute WHERE attrelid = 'app_upcoming_schedule'::regclass AND attnum > 0 ORDER BY attnum"
  );
  console.log('app_upcoming_schedule columns: ' + viewCheck.map(c => c.attname).join(', '));

  // Check total upcoming count
  const { rows: [upTotal] } = await pool.query('SELECT COUNT(*) as cnt FROM app_upcoming_schedule');
  console.log('Total upcoming in view: ' + upTotal.cnt);

  // Sample from upcoming
  const { rows: upSample } = await pool.query(
    'SELECT * FROM app_upcoming_schedule LIMIT 3'
  );
  if (upSample.length > 0) {
    console.log('Sample columns:', Object.keys(upSample[0]).join(', '));
  }

  // === REGRESSION ===
  console.log('\n--- REGRESSION CHECKS ---');

  const { rows: [totalTeams] } = await pool.query('SELECT COUNT(*) as cnt FROM teams_v2');
  console.log('Total teams_v2: ' + totalTeams.cnt + ' (was 145,356)');

  const { rows: [totalMatches] } = await pool.query('SELECT COUNT(*) as cnt FROM matches_v2 WHERE deleted_at IS NULL');
  console.log('Total active matches: ' + totalMatches.cnt + ' (was 402,948)');

  const { rows: [gsRanks] } = await pool.query('SELECT COUNT(*) as cnt FROM teams_v2 WHERE national_rank IS NOT NULL');
  console.log('Teams with GotSport national_rank: ' + gsRanks.cnt);

  const { rows: [eloDist] } = await pool.query(
    "SELECT AVG(elo_rating::float)::numeric(10,1) as avg_elo, MIN(elo_rating::float)::int as min_elo, MAX(elo_rating::float)::int as max_elo FROM teams_v2 WHERE matches_played > 0"
  );
  console.log('ELO distribution: avg=' + eloDist.avg_elo + ', min=' + eloDist.min_elo + ', max=' + eloDist.max_elo);

  const { rows: [heartland] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM matches_v2 WHERE source_platform = 'heartland' AND deleted_at IS NULL"
  );
  console.log('Heartland matches (unchanged): ' + heartland.cnt);

  const { rows: [gotsport] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM matches_v2 WHERE source_platform = 'gotsport' AND deleted_at IS NULL"
  );
  console.log('GotSport matches (unchanged): ' + gotsport.cnt);

  const { rows: [hStandings] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM league_standings ls JOIN leagues l ON ls.league_id = l.id WHERE l.source_platform = 'heartland'"
  );
  console.log('Heartland standings (unchanged): ' + hStandings.cnt);

  // Match count by source
  const { rows: sources } = await pool.query(
    "SELECT source_platform, COUNT(*) as cnt FROM matches_v2 WHERE deleted_at IS NULL GROUP BY source_platform ORDER BY cnt DESC"
  );
  console.log('\nMatches by source:');
  sources.forEach(s => console.log('  ' + (s.source_platform || 'NULL') + ': ' + s.cnt));

  // League standings by source
  const { rows: standSources } = await pool.query(
    "SELECT l.source_platform, COUNT(*) as cnt FROM league_standings ls JOIN leagues l ON ls.league_id = l.id GROUP BY l.source_platform"
  );
  console.log('\nStandings by source:');
  standSources.forEach(s => console.log('  ' + s.source_platform + ': ' + s.cnt));

  console.log('\n=========================================================');
  console.log('  VERIFICATION COMPLETE');
  console.log('=========================================================');

  await pool.end();
})();
