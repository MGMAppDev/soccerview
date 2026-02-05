/**
 * Fast Bulk Processor for HTGSports staging data
 * Uses direct SQL bulk operations instead of row-by-row DQE processing.
 *
 * Steps:
 * 1. Bulk resolve teams (find existing or create new)
 * 2. Bulk resolve events (find existing or create new tournaments)
 * 3. Bulk insert matches with ON CONFLICT
 * 4. Mark staging records as processed
 */
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const startTime = Date.now();
  console.log("=== Fast Bulk HTGSports Staging Processor ===\n");

  // Authorize pipeline writes
  await pool.query("SELECT authorize_pipeline_write()");

  // Step 0: Get unprocessed records
  const { rows: staging } = await pool.query(`
    SELECT id, home_team_name, away_team_name, home_score, away_score,
           match_date, match_time, source_platform, source_match_key,
           event_id, event_name, division, raw_data
    FROM staging_games
    WHERE NOT processed AND source_platform = 'htgsports'
    ORDER BY match_date
  `);
  console.log(`Found ${staging.length} unprocessed HTGSports records\n`);
  if (staging.length === 0) { await pool.end(); return; }

  // Step 1: Extract unique team names with metadata
  console.log("Step 1: Resolving teams...");
  const teamMap = new Map(); // key -> team_id
  const uniqueTeams = new Map();

  for (const row of staging) {
    // Parse birth_year and gender from division or team name
    const rawData = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
    const division = row.division || rawData?.division || '';
    const birthYear = extractBirthYear(division, row.home_team_name);
    const gender = extractGender(division, row.home_team_name);

    const homeKey = `${row.home_team_name}||${birthYear}||${gender}`;
    const awayKey = `${row.away_team_name}||${birthYear}||${gender}`;

    if (!uniqueTeams.has(homeKey)) {
      uniqueTeams.set(homeKey, { name: row.home_team_name, birth_year: birthYear, gender: gender });
    }
    if (!uniqueTeams.has(awayKey)) {
      uniqueTeams.set(awayKey, { name: row.away_team_name, birth_year: birthYear, gender: gender });
    }
  }
  console.log(`  ${uniqueTeams.size} unique team/year/gender combinations`);

  // Bulk find existing teams
  const teamNames = [...new Set([...uniqueTeams.values()].map(t => t.name))];
  const { rows: existingTeams } = await pool.query(`
    SELECT id, display_name, birth_year, gender
    FROM teams_v2
    WHERE display_name = ANY($1)
  `, [teamNames]);

  // Build lookup: name+birth_year+gender -> id
  for (const t of existingTeams) {
    const key = `${t.display_name}||${t.birth_year}||${t.gender}`;
    teamMap.set(key, t.id);
  }
  console.log(`  ${existingTeams.length} existing teams found in DB`);

  // Create missing teams in bulk
  const missingTeams = [];
  for (const [key, team] of uniqueTeams) {
    if (!teamMap.has(key)) {
      missingTeams.push(team);
    }
  }
  console.log(`  ${missingTeams.length} new teams to create`);

  if (missingTeams.length > 0) {
    const BATCH = 500;
    let created = 0;
    for (let i = 0; i < missingTeams.length; i += BATCH) {
      const batch = missingTeams.slice(i, i + BATCH);
      const values = [];
      const placeholders = batch.map((t, idx) => {
        const offset = idx * 5;
        values.push(t.name, t.name, t.birth_year, t.gender, 'unknown');
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, 1500, 'htgsports')`;
      });

      const { rows: inserted } = await pool.query(`
        INSERT INTO teams_v2 (display_name, canonical_name, birth_year, gender, state, elo_rating, source_platform)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (canonical_name, birth_year, gender, state) DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id, display_name, birth_year, gender
      `, values);

      for (const t of inserted) {
        const key = `${t.display_name}||${t.birth_year}||${t.gender}`;
        teamMap.set(key, t.id);
      }
      created += inserted.length;
    }
    console.log(`  Created/resolved ${created} teams`);
  }

  // Step 2: Resolve events (tournaments for HTGSports)
  console.log("\nStep 2: Resolving tournaments...");
  const eventMap = new Map(); // source_event_id -> tournament_id
  const uniqueEvents = new Map();

  for (const row of staging) {
    if (!row.event_id) continue;
    if (!uniqueEvents.has(row.event_id)) {
      uniqueEvents.set(row.event_id, {
        source_event_id: row.event_id,
        name: row.event_name || row.event_id,
      });
    }
  }

  // Find existing tournaments
  const eventIds = [...uniqueEvents.keys()];
  if (eventIds.length > 0) {
    const { rows: existingEvents } = await pool.query(`
      SELECT id, source_event_id FROM tournaments
      WHERE source_event_id = ANY($1)
    `, [eventIds]);

    for (const e of existingEvents) {
      eventMap.set(e.source_event_id, e.id);
    }
    console.log(`  ${existingEvents.length} existing tournaments found`);

    // Create missing tournaments
    const missingEvents = [];
    for (const [eventId, event] of uniqueEvents) {
      if (!eventMap.has(eventId)) {
        missingEvents.push(event);
      }
    }

    if (missingEvents.length > 0) {
      for (const event of missingEvents) {
        // Check if a tournament already exists with this name (case insensitive)
        const { rows: existing } = await pool.query(`
          SELECT id FROM tournaments WHERE source_event_id = $1 AND source_platform = 'htgsports' LIMIT 1
        `, [event.source_event_id]);

        if (existing.length > 0) {
          eventMap.set(event.source_event_id, existing[0].id);
        } else {
          // Get date range from staging data for this event
          const { rows: dateRange } = await pool.query(`
            SELECT MIN(match_date) as min_date, MAX(match_date) as max_date
            FROM staging_games WHERE event_id = $1 AND source_platform = 'htgsports'
          `, [event.source_event_id]);
          const startDate = dateRange[0]?.min_date || '2025-01-01';
          const endDate = dateRange[0]?.max_date || '2025-12-31';

          const { rows } = await pool.query(`
            INSERT INTO tournaments (name, source_event_id, source_platform, start_date, end_date)
            VALUES ($1, $2, 'htgsports', $3, $4)
            RETURNING id
          `, [event.name, event.source_event_id, startDate, endDate]);
          eventMap.set(event.source_event_id, rows[0].id);
        }
      }
      console.log(`  Created/found ${missingEvents.length} tournaments`);
    }
  }

  // Step 3: Bulk insert matches
  console.log("\nStep 3: Inserting matches...");
  const MATCH_BATCH = 500;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const processedStagingIds = [];

  for (let i = 0; i < staging.length; i += MATCH_BATCH) {
    const batch = staging.slice(i, i + MATCH_BATCH);
    const values = [];
    const placeholders = [];
    const batchStagingIds = [];

    for (const row of batch) {
      const rawData = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
      const division = row.division || rawData?.division || '';
      const birthYear = extractBirthYear(division, row.home_team_name);
      const gender = extractGender(division, row.home_team_name);

      const homeKey = `${row.home_team_name}||${birthYear}||${gender}`;
      const awayKey = `${row.away_team_name}||${birthYear}||${gender}`;
      const homeTeamId = teamMap.get(homeKey);
      const awayTeamId = teamMap.get(awayKey);

      if (!homeTeamId || !awayTeamId) {
        totalFailed++;
        // Still mark as processed to avoid reprocessing
        batchStagingIds.push(row.id);
        continue;
      }
      if (homeTeamId === awayTeamId) {
        totalSkipped++;
        batchStagingIds.push(row.id);
        continue;
      }

      const tournamentId = eventMap.get(row.event_id) || null;
      const offset = values.length;
      values.push(
        row.match_date,
        row.match_time,
        homeTeamId,
        awayTeamId,
        row.home_score,
        row.away_score,
        null, // league_id
        tournamentId,
        'htgsports',
        row.source_match_key
      );
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`);
      batchStagingIds.push(row.id);
    }

    if (placeholders.length > 0) {
      try {
        const result = await pool.query(`
          INSERT INTO matches_v2 (match_date, match_time, home_team_id, away_team_id, home_score, away_score, league_id, tournament_id, source_platform, source_match_key)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (match_date, home_team_id, away_team_id) DO UPDATE SET
            home_score = COALESCE(EXCLUDED.home_score, matches_v2.home_score),
            away_score = COALESCE(EXCLUDED.away_score, matches_v2.away_score),
            tournament_id = COALESCE(EXCLUDED.tournament_id, matches_v2.tournament_id),
            source_match_key = COALESCE(EXCLUDED.source_match_key, matches_v2.source_match_key)
          WHERE matches_v2.deleted_at IS NULL
        `, values);
        totalInserted += result.rowCount;
      } catch (err) {
        console.error(`  Batch insert error: ${err.message}`);
        totalFailed += placeholders.length;
      }
    }

    processedStagingIds.push(...batchStagingIds);
  }
  console.log(`  Inserted/updated: ${totalInserted}`);
  console.log(`  Skipped (same team): ${totalSkipped}`);
  console.log(`  Failed (no team ID): ${totalFailed}`);

  // Step 4: Mark staging as processed
  console.log("\nStep 4: Marking staging records as processed...");
  const MARK_BATCH = 1000;
  for (let i = 0; i < processedStagingIds.length; i += MARK_BATCH) {
    const batch = processedStagingIds.slice(i, i + MARK_BATCH);
    await pool.query(`UPDATE staging_games SET processed = true WHERE id = ANY($1::uuid[])`, [batch]);
  }
  console.log(`  Marked ${processedStagingIds.length} as processed`);

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== DONE in ${elapsed}s ===`);
  console.log(`  Records processed: ${staging.length}`);
  console.log(`  Matches inserted/updated: ${totalInserted}`);
  console.log(`  Rate: ${(staging.length / (elapsed)).toFixed(0)} records/sec`);

  await pool.end();
}

function extractBirthYear(division, teamName) {
  // Try division first: "U11 Boys Blue (2014) 9v9" -> 2014
  let m = division.match(/\b(20[01]\d)\b/);
  if (m) return parseInt(m[1]);
  // Try team name
  m = teamName.match(/\b(20[01]\d)\b/);
  if (m) return parseInt(m[1]);
  // Try U-age: "U-11" -> calculate from current year
  m = division.match(/U-?(\d{1,2})\b/i);
  if (m) {
    const age = parseInt(m[1]);
    if (age >= 8 && age <= 19) return 2026 - age;
  }
  return null;
}

function extractGender(division, teamName) {
  const text = (division + ' ' + teamName).toLowerCase();
  if (/\bgirls?\b|\bgu\d|\bfemale/i.test(text)) return 'F';
  if (/\bboys?\b|\bbu\d|\bmale/i.test(text)) return 'M';
  return null;
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
