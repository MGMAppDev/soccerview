/**
 * Fast Bulk Staging Processor (UNIVERSAL)
 * Works for ANY source platform. Uses direct SQL bulk operations.
 * Replaces row-by-row DQE promote step with bulk processing.
 *
 * Usage:
 *   node scripts/maintenance/fastProcessStaging.cjs [--source htgsports] [--limit 1000] [--dry-run]
 */
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Season year - default fallback, updated from DB at startup
let SEASON_YEAR = 2026;

// US state inference from team names (synced with teamNormalizer.js)
const STATE_NAMES_SORTED = [
  ['west virginia', 'WV'], ['south carolina', 'SC'], ['south dakota', 'SD'],
  ['north carolina', 'NC'], ['north dakota', 'ND'], ['new hampshire', 'NH'],
  ['new jersey', 'NJ'], ['new mexico', 'NM'], ['new york', 'NY'],
  ['rhode island', 'RI'],
  ['alabama', 'AL'], ['alaska', 'AK'], ['arizona', 'AZ'], ['arkansas', 'AR'],
  ['california', 'CA'], ['colorado', 'CO'], ['connecticut', 'CT'], ['delaware', 'DE'],
  ['florida', 'FL'], ['georgia', 'GA'], ['hawaii', 'HI'], ['idaho', 'ID'],
  ['illinois', 'IL'], ['indiana', 'IN'], ['iowa', 'IA'], ['kansas', 'KS'],
  ['kentucky', 'KY'], ['louisiana', 'LA'], ['maine', 'ME'], ['maryland', 'MD'],
  ['massachusetts', 'MA'], ['michigan', 'MI'], ['minnesota', 'MN'], ['mississippi', 'MS'],
  ['missouri', 'MO'], ['montana', 'MT'], ['nebraska', 'NE'], ['nevada', 'NV'],
  ['ohio', 'OH'], ['oklahoma', 'OK'], ['oregon', 'OR'], ['pennsylvania', 'PA'],
  ['tennessee', 'TN'], ['texas', 'TX'], ['utah', 'UT'], ['vermont', 'VT'],
  ['virginia', 'VA'], ['washington', 'WA'], ['wisconsin', 'WI'], ['wyoming', 'WY'],
];

function inferStateFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [stateName, abbrev] of STATE_NAMES_SORTED) {
    const regex = new RegExp(`\\b${stateName}\\b`, 'i');
    if (!regex.test(lower)) continue;
    if (stateName === 'kansas' && /\bkansas\s+city\b/i.test(lower)) continue;
    if (stateName === 'washington' && !/\bwashington\s+state\b/i.test(lower)) continue;
    return abbrev;
  }
  return null;
}

async function main() {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const sourceFilter = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
  const dryRun = args.includes('--dry-run');

  console.log("=== Fast Bulk Staging Processor (Universal) ===");
  console.log(`Source: ${sourceFilter || 'all'} | Limit: ${limit || 'none'} | Dry run: ${dryRun}\n`);

  // Use dedicated client for pipeline auth (session variables are per-connection)
  const client = await pool.connect();
  try {
    await client.query("SELECT authorize_pipeline_write()");

    // Load season year from database (dynamic, not hardcoded)
    const { rows: seasonRows } = await client.query('SELECT year FROM seasons WHERE is_current = true LIMIT 1');
    SEASON_YEAR = seasonRows[0]?.year || new Date().getFullYear();
    console.log(`Season year: ${SEASON_YEAR} (from database)\n`);

    // Step 0: Fetch unprocessed records
    let query = `
      SELECT id, home_team_name, away_team_name, home_score, away_score,
             match_date, match_time, source_platform, source_match_key,
             event_id, event_name, division, raw_data
      FROM staging_games
      WHERE NOT processed
    `;
    const params = [];
    if (sourceFilter) {
      params.push(sourceFilter);
      query += ` AND source_platform = $${params.length}`;
    }
    query += ` ORDER BY match_date`;
    if (limit) {
      params.push(limit);
      query += ` LIMIT $${params.length}`;
    }

    const { rows: staging } = await client.query(query, params);
    console.log(`Found ${staging.length} unprocessed records\n`);
    if (staging.length === 0) { client.release(); await pool.end(); return; }

    // Step 1: Resolve teams
    console.log("Step 1: Resolving teams...");
    const teamMap = new Map(); // key -> team_id
    const uniqueTeams = new Map();
    const rowTeamKeys = new Map(); // staging_id -> { homeKey, awayKey }

    for (const row of staging) {
      const division = row.division || '';
      const birthYear = extractBirthYear(division, row.home_team_name);
      const gender = extractGender(division, row.home_team_name);

      const homeKey = makeTeamKey(row.home_team_name, birthYear, gender);
      const awayKey = makeTeamKey(row.away_team_name, birthYear, gender);

      rowTeamKeys.set(row.id, { homeKey, awayKey, birthYear, gender });

      if (!uniqueTeams.has(homeKey)) {
        uniqueTeams.set(homeKey, { name: row.home_team_name, birth_year: birthYear, gender });
      }
      if (!uniqueTeams.has(awayKey)) {
        uniqueTeams.set(awayKey, { name: row.away_team_name, birth_year: birthYear, gender });
      }
    }
    console.log(`  ${uniqueTeams.size} unique team combinations`);

    // Bulk find existing teams by display_name + birth_year + gender
    const teamNames = [...new Set([...uniqueTeams.values()].map(t => t.name))];
    const { rows: existingTeams } = await client.query(`
      SELECT id, display_name, birth_year, gender
      FROM teams_v2
      WHERE display_name = ANY($1)
    `, [teamNames]);

    for (const t of existingTeams) {
      const key = makeTeamKey(t.display_name, t.birth_year, t.gender);
      teamMap.set(key, t.id);
    }
    console.log(`  ${existingTeams.length} existing teams found`);

    // Create missing teams
    const missingTeams = [];
    for (const [key, team] of uniqueTeams) {
      if (!teamMap.has(key)) {
        missingTeams.push({ key, ...team });
      }
    }
    console.log(`  ${missingTeams.length} new teams to create`);

    if (!dryRun && missingTeams.length > 0) {
      const BATCH = 200;
      let created = 0;
      for (let i = 0; i < missingTeams.length; i += BATCH) {
        const batch = missingTeams.slice(i, i + BATCH);
        const vals = [];
        const phs = batch.map((t, idx) => {
          const o = idx * 5;
          vals.push(t.name, t.name, t.birth_year, t.gender, inferStateFromName(t.name) || 'unknown');
          return `($${o+1}, $${o+2}, $${o+3}::int, $${o+4}::gender_type, $${o+5}, 1500)`;
        });

        const { rows: ins } = await client.query(`
          INSERT INTO teams_v2 (display_name, canonical_name, birth_year, gender, state, elo_rating)
          VALUES ${phs.join(', ')}
          ON CONFLICT (canonical_name, birth_year, gender, state) DO UPDATE SET display_name = EXCLUDED.display_name
          RETURNING id, display_name, birth_year, gender
        `, vals);

        for (const t of ins) {
          teamMap.set(makeTeamKey(t.display_name, t.birth_year, t.gender), t.id);
        }
        created += ins.length;
      }
      console.log(`  Created ${created} new teams`);
    }

    // Debug: Check resolution rate
    let resolved = 0, unresolved = 0;
    for (const [key] of uniqueTeams) {
      if (teamMap.has(key)) resolved++; else unresolved++;
    }
    console.log(`  Resolution: ${resolved} resolved, ${unresolved} unresolved`);
    if (unresolved > 0) {
      // Show some examples
      let shown = 0;
      for (const [key, team] of uniqueTeams) {
        if (!teamMap.has(key) && shown < 5) {
          console.log(`    UNRESOLVED: "${team.name}" by=${team.birth_year} g=${team.gender} key="${key}"`);
          shown++;
        }
      }
    }

    // Step 2: Resolve events
    console.log("\nStep 2: Resolving events...");
    const eventMap = new Map();
    const uniqueEvents = new Map();

    for (const row of staging) {
      if (!row.event_id || uniqueEvents.has(row.event_id)) continue;
      uniqueEvents.set(row.event_id, {
        id: row.event_id,
        name: row.event_name || row.event_id,
        platform: row.source_platform,
      });
    }

    if (uniqueEvents.size > 0) {
      const evIds = [...uniqueEvents.keys()];
      // Check both tournaments and leagues
      const { rows: existTournaments } = await client.query(
        `SELECT id, source_event_id FROM tournaments WHERE source_event_id = ANY($1)`, [evIds]
      );
      for (const e of existTournaments) eventMap.set(e.source_event_id, { tournament_id: e.id, league_id: null });

      const { rows: existLeagues } = await client.query(
        `SELECT id, source_event_id FROM leagues WHERE source_event_id = ANY($1)`, [evIds]
      );
      for (const e of existLeagues) {
        if (!eventMap.has(e.source_event_id)) {
          eventMap.set(e.source_event_id, { tournament_id: null, league_id: e.id });
        }
      }

      console.log(`  ${eventMap.size} existing events found (${existTournaments.length} tournaments, ${existLeagues.length} leagues)`);

      // Create missing as tournaments
      if (!dryRun) {
        let createdEvents = 0;
        for (const [evId, ev] of uniqueEvents) {
          if (eventMap.has(evId)) continue;
          const { rows: dateRange } = await client.query(
            `SELECT MIN(match_date) as sd, MAX(match_date) as ed FROM staging_games WHERE event_id = $1`, [evId]
          );
          const { rows } = await client.query(`
            INSERT INTO tournaments (name, source_event_id, source_platform, start_date, end_date)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
          `, [ev.name, evId, ev.platform, dateRange[0]?.sd || '2025-01-01', dateRange[0]?.ed || '2025-12-31']);
          eventMap.set(evId, { tournament_id: rows[0].id, league_id: null });
          createdEvents++;
        }
        if (createdEvents > 0) console.log(`  Created ${createdEvents} new tournaments`);
      }
    }

    // Step 3: Insert matches
    console.log("\nStep 3: Inserting matches...");
    const MATCH_BATCH = 200;
    let totalInserted = 0, totalSkipped = 0, totalFailed = 0;
    const successIds = [];
    const failedIds = [];

    for (let i = 0; i < staging.length; i += MATCH_BATCH) {
      const batch = staging.slice(i, i + MATCH_BATCH);
      const matchRecords = [];
      const batchSuccessIds = [];
      const seen = new Set(); // Deduplicate within batch

      for (const row of batch) {
        const keys = rowTeamKeys.get(row.id);
        if (!keys) { totalFailed++; failedIds.push(row.id); continue; }

        const homeTeamId = teamMap.get(keys.homeKey);
        const awayTeamId = teamMap.get(keys.awayKey);

        if (!homeTeamId || !awayTeamId) {
          totalFailed++;
          failedIds.push(row.id);
          continue;
        }
        if (homeTeamId === awayTeamId) {
          totalSkipped++;
          batchSuccessIds.push(row.id);
          continue;
        }

        // Deduplicate: same date + home + away within batch (includes reverse check)
        const dedup = `${row.match_date}|${homeTeamId}|${awayTeamId}`;
        const reverseDedup = `${row.match_date}|${awayTeamId}|${homeTeamId}`;
        if (seen.has(dedup) || seen.has(reverseDedup)) {
          totalSkipped++;
          batchSuccessIds.push(row.id);
          continue;
        }
        seen.add(dedup);
        seen.add(reverseDedup); // Block reverse form from this batch

        const eventInfo = eventMap.get(row.event_id) || { tournament_id: null, league_id: null };
        matchRecords.push({
          stagingId: row.id,
          match_date: row.match_date,
          match_time: row.match_time,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          home_score: row.home_score,
          away_score: row.away_score,
          league_id: eventInfo.league_id,
          tournament_id: eventInfo.tournament_id,
          source_platform: row.source_platform,
          source_match_key: row.source_match_key,
        });
        batchSuccessIds.push(row.id);
      }

      // Session 88: Pre-insert reverse match check (bulk DB query)
      if (matchRecords.length > 0 && !dryRun) {
        const reverseDates = matchRecords.map(m => m.match_date);
        const reverseHomeIds = matchRecords.map(m => m.away_team_id); // swapped
        const reverseAwayIds = matchRecords.map(m => m.home_team_id); // swapped
        const { rows: existingReverse } = await client.query(`
          SELECT match_date::text, home_team_id, away_team_id
          FROM matches_v2
          WHERE deleted_at IS NULL
            AND (match_date, home_team_id, away_team_id) IN (
              SELECT d::date, h::uuid, a::uuid
              FROM unnest($1::text[], $2::uuid[], $3::uuid[]) AS t(d, h, a)
            )
        `, [reverseDates, reverseHomeIds, reverseAwayIds]);

        if (existingReverse.length > 0) {
          const reverseSet = new Set(existingReverse.map(r =>
            `${r.match_date}|${r.home_team_id}|${r.away_team_id}`
          ));
          const beforeLen = matchRecords.length;
          const filtered = matchRecords.filter(m => {
            const key = `${m.match_date}|${m.away_team_id}|${m.home_team_id}`;
            return !reverseSet.has(key);
          });
          const reverseSkipped = beforeLen - filtered.length;
          if (reverseSkipped > 0) {
            totalSkipped += reverseSkipped;
            console.log(`  Skipped ${reverseSkipped} reverse matches in batch`);
          }
          matchRecords.splice(0, matchRecords.length, ...filtered);
        }
      }

      if (matchRecords.length > 0 && !dryRun) {
        const vals = [];
        const phs = matchRecords.map((m, idx) => {
          const o = idx * 10;
          vals.push(m.match_date, m.match_time, m.home_team_id, m.away_team_id,
            m.home_score, m.away_score, m.league_id, m.tournament_id,
            m.source_platform, m.source_match_key);
          return `($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7}, $${o+8}, $${o+9}, $${o+10})`;
        });

        try {
          const result = await client.query(`
            INSERT INTO matches_v2 (match_date, match_time, home_team_id, away_team_id,
              home_score, away_score, league_id, tournament_id, source_platform, source_match_key)
            VALUES ${phs.join(', ')}
            ON CONFLICT (match_date, home_team_id, away_team_id) DO UPDATE SET
              home_score = COALESCE(EXCLUDED.home_score, matches_v2.home_score),
              away_score = COALESCE(EXCLUDED.away_score, matches_v2.away_score),
              tournament_id = COALESCE(EXCLUDED.tournament_id, matches_v2.tournament_id),
              source_match_key = COALESCE(EXCLUDED.source_match_key, matches_v2.source_match_key)
            WHERE matches_v2.deleted_at IS NULL
          `, vals);
          totalInserted += result.rowCount;
          successIds.push(...batchSuccessIds);
        } catch (err) {
          console.error(`  Batch ${Math.floor(i/MATCH_BATCH)+1} error: ${err.message.substring(0, 200)}`);
          failedIds.push(...batchSuccessIds);
          totalFailed += matchRecords.length;
        }
      } else {
        successIds.push(...batchSuccessIds);
      }

      // Progress
      if ((i + MATCH_BATCH) % 2000 === 0 || i + MATCH_BATCH >= staging.length) {
        console.log(`  Progress: ${Math.min(i + MATCH_BATCH, staging.length)}/${staging.length} (${totalInserted} inserted)`);
      }
    }

    console.log(`  Inserted/updated: ${totalInserted}`);
    console.log(`  Skipped (dupes/same-team): ${totalSkipped}`);
    console.log(`  Failed: ${totalFailed}`);

    // Step 4: Mark as processed (only successes)
    if (!dryRun && successIds.length > 0) {
      console.log(`\nStep 4: Marking ${successIds.length} as processed...`);
      for (let i = 0; i < successIds.length; i += 1000) {
        const batch = successIds.slice(i, i + 1000);
        await client.query(`UPDATE staging_games SET processed = true, processed_at = NOW() WHERE id = ANY($1::uuid[])`, [batch]);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=== COMPLETE in ${elapsed}s ===`);
    console.log(`  Total: ${staging.length} | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Failed: ${totalFailed}`);
    console.log(`  Rate: ${(staging.length / elapsed).toFixed(0)} records/sec`);

  } finally {
    client.release();
    await pool.end();
  }
}

function makeTeamKey(name, birthYear, gender) {
  return `${(name || '').trim()}||${birthYear || 'null'}||${gender || 'null'}`;
}

function extractBirthYear(division, teamName) {
  // Try explicit year: "(2014)" or "2014"
  let m = (division || '').match(/\b(20[01]\d)\b/);
  if (m) return parseInt(m[1]);
  m = (teamName || '').match(/\b(20[01]\d)\b/);
  if (m) return parseInt(m[1]);
  // Try U-age: "U-11" -> calculate
  m = (division || '').match(/U-?(\d{1,2})\b/i);
  if (m) {
    const age = parseInt(m[1]);
    if (age >= 8 && age <= 19) return SEASON_YEAR - age;
  }
  return null;
}

function extractGender(division, teamName) {
  const text = ((division || '') + ' ' + (teamName || '')).toLowerCase();
  if (/\bgirls?\b|\bgu\d|\bfemale/i.test(text)) return 'F';
  if (/\bboys?\b|\bbu\d|\bmale/i.test(text)) return 'M';
  return null;
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
