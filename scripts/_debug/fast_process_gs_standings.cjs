/**
 * Fast bulk processor for GotSport standings.
 * Principle 12: Optimize for speed — bulk SQL, not row-by-row.
 *
 * Process: Load all unprocessed → batch resolve leagues → batch resolve teams → bulk insert
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, idleTimeoutMillis: 60000 });

const { removeDuplicatePrefix } = require('../universal/normalizers/cleanTeamName.cjs');

async function main() {
  const t0 = Date.now();

  // Authorize pipeline writes (write protection trigger)
  await pool.query('SELECT authorize_pipeline_write()');

  // Step 1: Load all unprocessed staging rows
  console.log('Step 1: Loading unprocessed staging_standings...');
  const { rows: staging } = await pool.query(`
    SELECT id, league_source_id, division, team_name, team_source_id,
           played, wins, losses, draws, goals_for, goals_against, points,
           position, age_group, gender, season, source_snapshot_date
    FROM staging_standings
    WHERE processed = false
    ORDER BY league_source_id, division, position
  `);
  console.log(`  Loaded ${staging.length} rows`);

  // Step 2: Batch resolve league_source_id → league UUID
  console.log('Step 2: Resolving leagues...');
  const uniqueLeagueIds = [...new Set(staging.map(r => r.league_source_id))];
  const { rows: leagueRows } = await pool.query(`
    SELECT source_event_id, id FROM leagues WHERE source_event_id = ANY($1)
  `, [uniqueLeagueIds]);
  const leagueMap = new Map(leagueRows.map(r => [r.source_event_id, r.id]));
  console.log(`  Resolved ${leagueMap.size}/${uniqueLeagueIds.length} leagues`);

  // Also check source_entity_map for leagues
  const missingLeagueIds = uniqueLeagueIds.filter(id => !leagueMap.has(id));
  if (missingLeagueIds.length > 0) {
    const { rows: semLeagues } = await pool.query(`
      SELECT source_entity_id, sv_id FROM source_entity_map
      WHERE entity_type = 'league' AND source_entity_id = ANY($1)
    `, [missingLeagueIds]);
    for (const r of semLeagues) {
      if (!leagueMap.has(r.source_entity_id)) leagueMap.set(r.source_entity_id, r.sv_id);
    }
    console.log(`  After SEM: ${leagueMap.size}/${uniqueLeagueIds.length} leagues`);
  }

  // Step 3: Batch resolve team_source_id → team UUID via source_entity_map
  console.log('Step 3: Resolving teams via source_entity_map...');
  const uniqueTeamSourceIds = [...new Set(staging.map(r => r.team_source_id).filter(Boolean))];
  const teamMap = new Map(); // team_source_id → team UUID

  if (uniqueTeamSourceIds.length > 0) {
    // GotSport team source IDs are plain numeric strings
    const { rows: semTeams } = await pool.query(`
      SELECT source_entity_id, sv_id FROM source_entity_map
      WHERE entity_type = 'team' AND source_platform = 'gotsport'
        AND source_entity_id = ANY($1)
    `, [uniqueTeamSourceIds]);
    for (const r of semTeams) teamMap.set(r.source_entity_id, r.sv_id);
    console.log(`  SEM resolved: ${teamMap.size}/${uniqueTeamSourceIds.length} teams`);
  }

  // Step 4: For unresolved teams, try exact name + birth_year + gender match
  console.log('Step 4: Exact name matching for unresolved teams...');
  const unresolvedRows = staging.filter(r => r.team_source_id && !teamMap.has(r.team_source_id));
  const uniqueUnresolved = new Map(); // key → { name, birth_year, gender, source_id }
  for (const r of unresolvedRows) {
    if (!uniqueUnresolved.has(r.team_source_id)) {
      const birthYear = r.age_group ? 2026 - parseInt(r.age_group.replace('U', ''), 10) : null;
      const cleanName = removeDuplicatePrefix(r.team_name);
      uniqueUnresolved.set(r.team_source_id, {
        name: cleanName,
        rawName: r.team_name,
        birth_year: birthYear,
        gender: r.gender === 'Boys' ? 'M' : r.gender === 'Girls' ? 'F' : null,
        source_id: r.team_source_id,
      });
    }
  }

  if (uniqueUnresolved.size > 0) {
    // Batch exact name match
    const names = [...uniqueUnresolved.values()].map(t => t.name);
    const { rows: nameMatches } = await pool.query(`
      SELECT id, display_name, birth_year, gender FROM teams_v2
      WHERE display_name = ANY($1)
    `, [names]);

    const nameIndex = new Map();
    for (const t of nameMatches) {
      const key = `${t.display_name}|${t.birth_year}|${t.gender}`;
      if (!nameIndex.has(key)) nameIndex.set(key, t.id);
    }

    let nameResolved = 0;
    for (const [sourceId, info] of uniqueUnresolved) {
      const key = `${info.name}|${info.birth_year}|${info.gender}`;
      const teamId = nameIndex.get(key);
      if (teamId) {
        teamMap.set(sourceId, teamId);
        nameResolved++;
      }
    }
    console.log(`  Name-matched: ${nameResolved}/${uniqueUnresolved.size}`);
  }

  // Step 5: Bulk create new teams for remaining unresolved
  console.log('Step 5: Creating new teams for unresolved...');
  const stillUnresolved = [...uniqueUnresolved.entries()].filter(([id]) => !teamMap.has(id));
  if (stillUnresolved.length > 0) {
    // Get league states for state assignment
    const { rows: leagueStates } = await pool.query(`
      SELECT source_event_id, state FROM leagues WHERE source_event_id = ANY($1) AND state IS NOT NULL
    `, [uniqueLeagueIds]);
    const stateMap = new Map(leagueStates.map(r => [r.source_event_id, r.state]));

    // Find which league each unresolved team belongs to
    const teamLeagueMap = new Map();
    for (const r of staging) {
      if (r.team_source_id && !teamLeagueMap.has(r.team_source_id)) {
        teamLeagueMap.set(r.team_source_id, r.league_source_id);
      }
    }

    // Batch INSERT new teams
    const BATCH_SIZE = 500;
    let created = 0;
    for (let i = 0; i < stillUnresolved.length; i += BATCH_SIZE) {
      const batch = stillUnresolved.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const [sourceId, info] of batch) {
        const leagueSourceId = teamLeagueMap.get(sourceId);
        const state = stateMap.get(leagueSourceId) || 'XX';
        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        params.push(info.name, info.name.toLowerCase(), info.birth_year, info.gender, state);
      }

      const { rows: newTeams } = await pool.query(`
        INSERT INTO teams_v2 (display_name, canonical_name, birth_year, gender, state)
        VALUES ${values.join(', ')}
        ON CONFLICT DO NOTHING
        RETURNING id, display_name, birth_year, gender
      `, params);

      // Map back to source IDs
      const newTeamIndex = new Map();
      for (const t of newTeams) {
        const key = `${t.display_name}|${t.birth_year}|${t.gender}`;
        newTeamIndex.set(key, t.id);
      }

      for (const [sourceId, info] of batch) {
        const key = `${info.name}|${info.birth_year}|${info.gender}`;
        const teamId = newTeamIndex.get(key);
        if (teamId) {
          teamMap.set(sourceId, teamId);
          created++;
        } else {
          // ON CONFLICT hit — try fetching existing
          const { rows: [existing] } = await pool.query(`
            SELECT id FROM teams_v2
            WHERE display_name = $1 AND birth_year = $2 AND gender = $3
            LIMIT 1
          `, [info.name, info.birth_year, info.gender]);
          if (existing) {
            teamMap.set(sourceId, existing.id);
          }
        }
      }
    }
    console.log(`  Created ${created} new teams, total resolved: ${teamMap.size}`);

    // Register new source_entity_map entries
    const newMappings = stillUnresolved.filter(([id]) => teamMap.has(id));
    if (newMappings.length > 0) {
      const semValues = [];
      const semParams = [];
      let semIdx = 1;
      for (const [sourceId] of newMappings) {
        const teamId = teamMap.get(sourceId);
        if (teamId) {
          semValues.push(`('team', 'gotsport', $${semIdx++}, $${semIdx++})`);
          semParams.push(sourceId, teamId);
        }
      }
      if (semValues.length > 0) {
        await pool.query(`
          INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
          VALUES ${semValues.join(', ')}
          ON CONFLICT DO NOTHING
        `, semParams);
        console.log(`  Registered ${semValues.length} source_entity_map entries`);
      }
    }
  }

  // Step 6: Get season ID
  const { rows: [season] } = await pool.query(`
    SELECT id FROM seasons WHERE is_current = true LIMIT 1
  `);
  const seasonId = season?.id || null;

  // Step 7: Bulk INSERT into league_standings
  console.log('Step 6: Bulk inserting into league_standings...');
  let inserted = 0;
  let skipped = 0;
  const LEAGUE_BATCH = 1000;

  // Deduplicate: keep latest row per (league_id, team_id, division)
  const dedupMap = new Map();
  for (const r of staging) {
    const leagueId = leagueMap.get(r.league_source_id);
    const teamId = r.team_source_id ? teamMap.get(r.team_source_id) : null;
    if (!leagueId || !teamId) continue;
    const key = `${leagueId}|${teamId}|${r.division}`;
    dedupMap.set(key, { ...r, _leagueId: leagueId, _teamId: teamId });
  }
  const validRows = [...dedupMap.values()];
  console.log(`  Valid rows after dedup: ${validRows.length} (from ${staging.length} staging)`);

  for (let i = 0; i < validRows.length; i += LEAGUE_BATCH) {
    const batch = validRows.slice(i, i + LEAGUE_BATCH);
    const values = [];
    const params = [];
    let pIdx = 1;

    for (const r of batch) {
      const leagueId = r._leagueId;
      const teamId = r._teamId;
      const platform = r.league_source_id.split('-')[0];

      const snapshotDate = r.source_snapshot_date || new Date().toISOString().split('T')[0];
      values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
      params.push(
        leagueId, teamId, r.division,
        r.played || 0, r.wins || 0, r.losses || 0, r.draws || 0,
        r.goals_for || 0, r.goals_against || 0,
        r.points || 0, r.position || 0, 0,
        platform, seasonId, snapshotDate
      );
    }

    const result = await pool.query(`
      INSERT INTO league_standings (
        league_id, team_id, division,
        played, wins, losses, draws,
        goals_for, goals_against,
        points, position, red_cards,
        source_platform, season_id, snapshot_date
      ) VALUES ${values.join(', ')}
      ON CONFLICT (league_id, team_id, division) DO UPDATE SET
        played = EXCLUDED.played,
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        draws = EXCLUDED.draws,
        goals_for = EXCLUDED.goals_for,
        goals_against = EXCLUDED.goals_against,
        points = EXCLUDED.points,
        position = EXCLUDED.position,
        updated_at = NOW()
    `, params);
    inserted += result.rowCount;
  }

  skipped = staging.length - validRows.length;
  console.log(`  Inserted/updated: ${inserted}, skipped: ${skipped}`);

  // Step 8: Mark ALL staging rows as processed
  console.log('Step 7: Marking staging rows as processed...');
  const stagingIds = staging.map(r => r.id);
  await pool.query(`UPDATE staging_standings SET processed = true WHERE id = ANY($1)`, [stagingIds]);
  console.log(`  Marked ${stagingIds.length} rows as processed`);

  // Summary
  const { rows: [final] } = await pool.query('SELECT COUNT(*) as cnt FROM league_standings');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n============================================================`);
  console.log(`COMPLETE in ${elapsed}s`);
  console.log(`  Production league_standings: ${final.cnt}`);
  console.log(`  Teams resolved: ${teamMap.size}`);
  console.log(`  Leagues resolved: ${leagueMap.size}`);
  console.log(`============================================================`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
