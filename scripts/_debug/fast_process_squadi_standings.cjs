/**
 * Fast bulk processor for Squadi standings (TN).
 * Principle 12: Optimize for speed — bulk SQL, not row-by-row.
 */
require('dotenv').config();
const { Pool } = require('pg');
const { removeDuplicatePrefix } = require('../universal/normalizers/cleanTeamName.cjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, idleTimeoutMillis: 60000 });

async function main() {
  const t0 = Date.now();
  await pool.query('SELECT authorize_pipeline_write()');

  const { rows: staging } = await pool.query(`
    SELECT id, league_source_id, division, team_name, team_source_id,
           played, wins, losses, draws, goals_for, goals_against, points,
           position, age_group, gender, season, source_snapshot_date, source_platform
    FROM staging_standings WHERE processed = false ORDER BY league_source_id, division, position
  `);
  console.log(`Loaded ${staging.length} unprocessed rows`);
  if (!staging.length) { await pool.end(); return; }

  const platform = staging[0].source_platform || 'squadi';

  // Resolve leagues
  const uniqueLeagueIds = [...new Set(staging.map(r => r.league_source_id))];
  const { rows: lr } = await pool.query(`SELECT source_event_id, id FROM leagues WHERE source_event_id = ANY($1)`, [uniqueLeagueIds]);
  const leagueMap = new Map(lr.map(r => [r.source_event_id, r.id]));
  const missingL = uniqueLeagueIds.filter(id => !leagueMap.has(id));
  if (missingL.length) {
    const { rows: sem } = await pool.query(`SELECT source_entity_id, sv_id FROM source_entity_map WHERE entity_type = 'league' AND source_entity_id = ANY($1)`, [missingL]);
    for (const r of sem) if (!leagueMap.has(r.source_entity_id)) leagueMap.set(r.source_entity_id, r.sv_id);
  }
  console.log(`Leagues: ${leagueMap.size}/${uniqueLeagueIds.length}`);

  // Resolve teams via SEM
  const uniqueTeamIds = [...new Set(staging.map(r => r.team_source_id).filter(Boolean))];
  const teamMap = new Map();
  if (uniqueTeamIds.length) {
    const { rows: st } = await pool.query(`SELECT source_entity_id, sv_id FROM source_entity_map WHERE entity_type = 'team' AND source_platform = $1 AND source_entity_id = ANY($2)`, [platform, uniqueTeamIds]);
    for (const r of st) teamMap.set(r.source_entity_id, r.sv_id);
  }
  console.log(`SEM teams: ${teamMap.size}/${uniqueTeamIds.length}`);

  // Exact name match for unresolved
  const unresolved = new Map();
  for (const r of staging) {
    if (r.team_source_id && !teamMap.has(r.team_source_id) && !unresolved.has(r.team_source_id)) {
      const by = r.age_group ? 2026 - parseInt(r.age_group.replace('U', ''), 10) : null;
      unresolved.set(r.team_source_id, {
        name: removeDuplicatePrefix(r.team_name),
        birth_year: by,
        gender: r.gender === 'Boys' ? 'M' : r.gender === 'Girls' ? 'F' : null,
      });
    }
  }
  if (unresolved.size) {
    const names = [...unresolved.values()].map(t => t.name);
    const { rows: nm } = await pool.query(`SELECT id, display_name, birth_year, gender FROM teams_v2 WHERE display_name = ANY($1)`, [names]);
    const idx = new Map();
    for (const t of nm) { const k = `${t.display_name}|${t.birth_year}|${t.gender}`; if (!idx.has(k)) idx.set(k, t.id); }
    let nameRes = 0;
    for (const [sid, info] of unresolved) { const k = `${info.name}|${info.birth_year}|${info.gender}`; if (idx.has(k)) { teamMap.set(sid, idx.get(k)); nameRes++; } }
    console.log(`Name matched: ${nameRes}/${unresolved.size}`);
  }

  // Create new teams for remaining
  const still = [...unresolved.entries()].filter(([id]) => !teamMap.has(id));
  if (still.length) {
    const { rows: ls } = await pool.query(`SELECT source_event_id, state FROM leagues WHERE source_event_id = ANY($1) AND state IS NOT NULL`, [uniqueLeagueIds]);
    const stMap = new Map(ls.map(r => [r.source_event_id, r.state]));
    const tlMap = new Map();
    for (const r of staging) if (r.team_source_id && !tlMap.has(r.team_source_id)) tlMap.set(r.team_source_id, r.league_source_id);

    let created = 0;
    for (let i = 0; i < still.length; i += 500) {
      const batch = still.slice(i, i + 500);
      const vals = [], params = [];
      let pi = 1;
      for (const [sid, info] of batch) {
        const st = stMap.get(tlMap.get(sid)) || 'unknown';
        vals.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++})`);
        params.push(info.name, info.name.toLowerCase(), info.birth_year, info.gender, st);
      }
      const { rows: nt } = await pool.query(
        `INSERT INTO teams_v2 (display_name, canonical_name, birth_year, gender, state) VALUES ${vals.join(', ')} ON CONFLICT DO NOTHING RETURNING id, display_name, birth_year, gender`, params
      );
      const ni = new Map();
      for (const t of nt) ni.set(`${t.display_name}|${t.birth_year}|${t.gender}`, t.id);
      for (const [sid, info] of batch) {
        const k = `${info.name}|${info.birth_year}|${info.gender}`;
        if (ni.has(k)) { teamMap.set(sid, ni.get(k)); created++; }
        else {
          const { rows: [ex] } = await pool.query(`SELECT id FROM teams_v2 WHERE display_name = $1 AND birth_year = $2 AND gender = $3 LIMIT 1`, [info.name, info.birth_year, info.gender]);
          if (ex) teamMap.set(sid, ex.id);
        }
      }
    }
    console.log(`Created ${created} new teams, total resolved: ${teamMap.size}`);

    // Register SEM
    const newM = still.filter(([id]) => teamMap.has(id));
    if (newM.length) {
      const sv = [], sp = [];
      let si = 1;
      for (const [sid] of newM) {
        const tid = teamMap.get(sid);
        if (tid) { sv.push(`('team', $${si++}, $${si++}, $${si++})`); sp.push(platform, sid, tid); }
      }
      if (sv.length) {
        await pool.query(`INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id) VALUES ${sv.join(', ')} ON CONFLICT DO NOTHING`, sp);
        console.log(`SEM registered: ${sv.length}`);
      }
    }
  }

  // Season + bulk insert
  const { rows: [season] } = await pool.query(`SELECT id FROM seasons WHERE is_current = true LIMIT 1`);
  const seasonId = season?.id || null;

  const dedupMap = new Map();
  for (const r of staging) {
    const lid = leagueMap.get(r.league_source_id);
    const tid = r.team_source_id ? teamMap.get(r.team_source_id) : null;
    if (!lid || !tid) continue;
    dedupMap.set(`${lid}|${tid}|${r.division}`, { ...r, _lid: lid, _tid: tid });
  }
  const valid = [...dedupMap.values()];
  console.log(`Valid after dedup: ${valid.length}`);

  let ins = 0;
  for (let i = 0; i < valid.length; i += 1000) {
    const batch = valid.slice(i, i + 1000);
    const vals = [], params = [];
    let pi = 1;
    for (const r of batch) {
      const sd = r.source_snapshot_date || new Date().toISOString().split('T')[0];
      vals.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++})`);
      params.push(r._lid, r._tid, r.division, r.played||0, r.wins||0, r.losses||0, r.draws||0, r.goals_for||0, r.goals_against||0, r.points||0, r.position||0, 0, platform, seasonId, sd);
    }
    const res = await pool.query(`
      INSERT INTO league_standings (league_id, team_id, division, played, wins, losses, draws, goals_for, goals_against, points, position, red_cards, source_platform, season_id, snapshot_date)
      VALUES ${vals.join(', ')}
      ON CONFLICT (league_id, team_id, division) DO UPDATE SET
        played=EXCLUDED.played, wins=EXCLUDED.wins, losses=EXCLUDED.losses, draws=EXCLUDED.draws,
        goals_for=EXCLUDED.goals_for, goals_against=EXCLUDED.goals_against,
        points=EXCLUDED.points, position=EXCLUDED.position, updated_at=NOW()
    `, params);
    ins += res.rowCount;
  }
  console.log(`Inserted/updated: ${ins}`);

  // Mark processed
  await pool.query(`UPDATE staging_standings SET processed = true WHERE id = ANY($1)`, [staging.map(r => r.id)]);
  console.log(`Marked ${staging.length} processed`);

  const { rows: [f] } = await pool.query('SELECT COUNT(*) as cnt FROM league_standings');
  const { rows: [u] } = await pool.query('SELECT COUNT(*) as cnt FROM staging_standings WHERE processed = false');
  console.log(`\nDONE in ${((Date.now()-t0)/1000).toFixed(1)}s | league_standings: ${f.cnt} | unprocessed: ${u.cnt}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
