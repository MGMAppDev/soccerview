/**
 * backfill_event_metadata.cjs
 *
 * Retroactive backfill for event metadata gaps:
 * - Step 3A: League state via team majority-vote
 * - Step 3B: League season_id from match dates
 * - Step 3C: SEM registration for leagues + tournaments missing entries
 * - Step 3D: Tournament state via team majority-vote
 *
 * Usage:
 *   node scripts/_debug/backfill_event_metadata.cjs --dry-run
 *   node scripts/_debug/backfill_event_metadata.cjs --execute
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const dryRun = !process.argv.includes('--execute');

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`EVENT METADATA BACKFILL (${dryRun ? 'DRY RUN' : 'EXECUTE'})`);
  console.log(`${'='.repeat(70)}\n`);

  // Pre-counts
  const pre = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM leagues WHERE state IS NULL) as leagues_null_state,
      (SELECT COUNT(*) FROM leagues WHERE season_id IS NULL) as leagues_null_season,
      (SELECT COUNT(*) FROM tournaments WHERE state IS NULL) as tournaments_null_state,
      (SELECT COUNT(*) FROM source_entity_map WHERE entity_type = 'league') as sem_leagues,
      (SELECT COUNT(*) FROM source_entity_map WHERE entity_type = 'tournament') as sem_tournaments,
      (SELECT COUNT(*) FROM leagues) as total_leagues,
      (SELECT COUNT(*) FROM tournaments) as total_tournaments
  `);
  const p = pre.rows[0];
  console.log('=== PRE-BACKFILL STATE ===');
  console.log(`  Leagues:      ${p.total_leagues} total, ${p.leagues_null_state} NULL state, ${p.leagues_null_season} NULL season_id`);
  console.log(`  Tournaments:  ${p.total_tournaments} total, ${p.tournaments_null_state} NULL state`);
  console.log(`  SEM:          ${p.sem_leagues} league entries, ${p.sem_tournaments} tournament entries`);

  // ===== STEP 3A: League state via team majority-vote =====
  console.log(`\n${'─'.repeat(50)}`);
  console.log('STEP 3A: League state via team majority-vote');
  console.log(`${'─'.repeat(50)}`);

  // First, run the existing fixLeagueStates regex rules (they're good for ~70% of cases)
  // Then fill remaining via team majority-vote

  const leagueMajorityVote = await pool.query(`
    WITH league_team_states AS (
      SELECT l.id as league_id, l.name, t.state, COUNT(*) as cnt,
        ROW_NUMBER() OVER (PARTITION BY l.id ORDER BY COUNT(*) DESC) as rn
      FROM leagues l
      JOIN matches_v2 m ON m.league_id = l.id AND m.deleted_at IS NULL
      JOIN teams_v2 t ON t.id IN (m.home_team_id, m.away_team_id)
      WHERE l.state IS NULL
        AND t.state IS NOT NULL AND t.state != 'unknown' AND t.state != 'XX'
      GROUP BY l.id, l.name, t.state
    )
    SELECT league_id, name, state, cnt
    FROM league_team_states
    WHERE rn = 1
    ORDER BY name
  `);

  console.log(`  Found ${leagueMajorityVote.rows.length} leagues fixable via team majority-vote`);

  // Show state distribution
  const stateCountsL = {};
  for (const r of leagueMajorityVote.rows) {
    stateCountsL[r.state] = (stateCountsL[r.state] || 0) + 1;
  }
  const topStatesL = Object.entries(stateCountsL).sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('  State distribution (top 15):');
  topStatesL.forEach(([st, ct]) => console.log(`    ${st}: ${ct}`));

  if (!dryRun && leagueMajorityVote.rows.length > 0) {
    let updated = 0;
    for (const r of leagueMajorityVote.rows) {
      await pool.query('UPDATE leagues SET state = $1 WHERE id = $2 AND state IS NULL', [r.state, r.league_id]);
      updated++;
    }
    console.log(`  ✓ Updated ${updated} leagues with state`);
  }

  // ===== STEP 3B: League season_id from match dates =====
  console.log(`\n${'─'.repeat(50)}`);
  console.log('STEP 3B: League season_id from match dates');
  console.log(`${'─'.repeat(50)}`);

  const seasonBackfill = await pool.query(`
    SELECT l.id as league_id, l.name, s.id as season_id, s.name as season_name, m.first_match
    FROM leagues l
    CROSS JOIN LATERAL (
      SELECT MIN(match_date) as first_match
      FROM matches_v2 WHERE league_id = l.id AND deleted_at IS NULL
    ) m
    JOIN seasons s ON m.first_match BETWEEN s.start_date AND s.end_date
    WHERE l.season_id IS NULL
      AND m.first_match IS NOT NULL
  `);

  console.log(`  Found ${seasonBackfill.rows.length} leagues fixable with season_id`);

  // Show season distribution
  const seasonDist = {};
  for (const r of seasonBackfill.rows) {
    seasonDist[r.season_name] = (seasonDist[r.season_name] || 0) + 1;
  }
  Object.entries(seasonDist).forEach(([s, c]) => console.log(`    ${s}: ${c}`));

  if (!dryRun && seasonBackfill.rows.length > 0) {
    let updated = 0;
    for (const r of seasonBackfill.rows) {
      await pool.query('UPDATE leagues SET season_id = $1 WHERE id = $2 AND season_id IS NULL', [r.season_id, r.league_id]);
      updated++;
    }
    console.log(`  ✓ Updated ${updated} leagues with season_id`);
  }

  // ===== STEP 3C: SEM registration for events missing entries =====
  console.log(`\n${'─'.repeat(50)}`);
  console.log('STEP 3C: SEM registration for leagues + tournaments missing entries');
  console.log(`${'─'.repeat(50)}`);

  const missingLeagueSem = await pool.query(`
    SELECT l.id, l.source_platform, l.source_event_id
    FROM leagues l
    WHERE l.source_platform IS NOT NULL AND l.source_event_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM source_entity_map sem
        WHERE sem.entity_type = 'league' AND sem.sv_id = l.id
      )
  `);

  const missingTournSem = await pool.query(`
    SELECT t.id, t.source_platform, t.source_event_id
    FROM tournaments t
    WHERE t.source_platform IS NOT NULL AND t.source_event_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM source_entity_map sem
        WHERE sem.entity_type = 'tournament' AND sem.sv_id = t.id
      )
  `);

  console.log(`  Leagues missing SEM: ${missingLeagueSem.rows.length}`);
  console.log(`  Tournaments missing SEM: ${missingTournSem.rows.length}`);

  if (!dryRun) {
    if (missingLeagueSem.rows.length > 0) {
      const res1 = await pool.query(`
        INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
        SELECT 'league', l.source_platform, l.source_event_id, l.id
        FROM leagues l
        WHERE l.source_platform IS NOT NULL AND l.source_event_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM source_entity_map sem WHERE sem.entity_type = 'league' AND sem.sv_id = l.id)
        ON CONFLICT DO NOTHING
      `);
      console.log(`  ✓ Inserted ${res1.rowCount} league SEM entries`);
    }

    if (missingTournSem.rows.length > 0) {
      const res2 = await pool.query(`
        INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
        SELECT 'tournament', t.source_platform, t.source_event_id, t.id
        FROM tournaments t
        WHERE t.source_platform IS NOT NULL AND t.source_event_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM source_entity_map sem WHERE sem.entity_type = 'tournament' AND sem.sv_id = t.id)
        ON CONFLICT DO NOTHING
      `);
      console.log(`  ✓ Inserted ${res2.rowCount} tournament SEM entries`);
    }
  }

  // ===== STEP 3D: Tournament state via team majority-vote =====
  console.log(`\n${'─'.repeat(50)}`);
  console.log('STEP 3D: Tournament state via team majority-vote');
  console.log(`${'─'.repeat(50)}`);

  const tournMajorityVote = await pool.query(`
    WITH tourn_team_states AS (
      SELECT t.id as tourn_id, t.name, tm.state, COUNT(*) as cnt,
        ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY COUNT(*) DESC) as rn
      FROM tournaments t
      JOIN matches_v2 m ON m.tournament_id = t.id AND m.deleted_at IS NULL
      JOIN teams_v2 tm ON tm.id IN (m.home_team_id, m.away_team_id)
      WHERE t.state IS NULL
        AND tm.state IS NOT NULL AND tm.state != 'unknown' AND tm.state != 'XX'
      GROUP BY t.id, t.name, tm.state
    )
    SELECT tourn_id, name, state, cnt
    FROM tourn_team_states
    WHERE rn = 1
    ORDER BY name
  `);

  console.log(`  Found ${tournMajorityVote.rows.length} tournaments fixable via team majority-vote`);

  // Show state distribution
  const stateCountsT = {};
  for (const r of tournMajorityVote.rows) {
    stateCountsT[r.state] = (stateCountsT[r.state] || 0) + 1;
  }
  const topStatesT = Object.entries(stateCountsT).sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('  State distribution (top 15):');
  topStatesT.forEach(([st, ct]) => console.log(`    ${st}: ${ct}`));

  if (!dryRun && tournMajorityVote.rows.length > 0) {
    let updated = 0;
    for (const r of tournMajorityVote.rows) {
      await pool.query('UPDATE tournaments SET state = $1 WHERE id = $2 AND state IS NULL', [r.state, r.tourn_id]);
      updated++;
    }
    console.log(`  ✓ Updated ${updated} tournaments with state`);
  }

  // ===== POST-BACKFILL VERIFICATION =====
  console.log(`\n${'='.repeat(70)}`);
  console.log('POST-BACKFILL VERIFICATION');
  console.log(`${'='.repeat(70)}`);

  const post = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM leagues WHERE state IS NULL) as leagues_null_state,
      (SELECT COUNT(*) FROM leagues WHERE season_id IS NULL) as leagues_null_season,
      (SELECT COUNT(*) FROM tournaments WHERE state IS NULL) as tournaments_null_state,
      (SELECT COUNT(*) FROM source_entity_map WHERE entity_type = 'league') as sem_leagues,
      (SELECT COUNT(*) FROM source_entity_map WHERE entity_type = 'tournament') as sem_tournaments
  `);
  const q = post.rows[0];
  console.log(`  Leagues NULL state:     ${p.leagues_null_state} → ${q.leagues_null_state}`);
  console.log(`  Leagues NULL season_id: ${p.leagues_null_season} → ${q.leagues_null_season}`);
  console.log(`  Tournaments NULL state: ${p.tournaments_null_state} → ${q.tournaments_null_state}`);
  console.log(`  SEM leagues:            ${p.sem_leagues} → ${q.sem_leagues}`);
  console.log(`  SEM tournaments:        ${p.sem_tournaments} → ${q.sem_tournaments}`);

  // Show remaining NULL-state leagues (should be multi-state/national only)
  if (parseInt(q.leagues_null_state) > 0 && parseInt(q.leagues_null_state) <= 50) {
    const { rows: remaining } = await pool.query(`
      SELECT name, source_event_id, source_platform FROM leagues WHERE state IS NULL ORDER BY name
    `);
    console.log(`\n  Remaining NULL-state leagues (${remaining.length} — expected: multi-state/national):`);
    remaining.forEach(r => console.log(`    ${r.source_platform || '?'} | ${r.source_event_id || '?'} | ${r.name}`));
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
