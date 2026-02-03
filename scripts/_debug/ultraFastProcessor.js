/**
 * ULTRA-FAST Bulk Processor - Direct PostgreSQL with Bulk Operations
 * Optimized for maximum speed using bulk INSERT and minimal round-trips
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,  // Connection pool size
});

const BATCH_SIZE = 2000;  // Process 2000 at a time

async function main() {
  console.log('⚡ ULTRA-FAST BULK PROCESSOR');
  console.log('============================\n');

  const startTime = Date.now();
  const client = await pool.connect();

  try {
    // Get initial count
    const { rows: [{ count: initialCount }] } = await client.query(
      `SELECT COUNT(*) as count FROM staging_games WHERE processed = false`
    );
    console.log(`📊 Initial unprocessed: ${initialCount}\n`);

    if (parseInt(initialCount) === 0) {
      console.log('✅ No records to process!');
      return;
    }

    let totalProcessed = 0;
    let totalMatches = 0;
    let iteration = 0;

    while (true) {
      iteration++;
      const batchStart = Date.now();

      // STEP 1: Fetch batch of unprocessed games
      const { rows: games } = await client.query(`
        SELECT id, match_date, match_time, home_team_name, away_team_name,
               home_score, away_score, event_name, event_id, source_platform, source_match_key
        FROM staging_games
        WHERE processed = false
        ORDER BY scraped_at ASC
        LIMIT $1
      `, [BATCH_SIZE]);

      if (games.length === 0) {
        console.log('\n✅ All records processed!');
        break;
      }

      console.log(`\n📦 Batch ${iteration}: ${games.length} records...`);

      // STEP 2: Bulk resolve teams - get all unique team names
      const uniqueHomeTeams = [...new Set(games.map(g => g.home_team_name).filter(Boolean))];
      const uniqueAwayTeams = [...new Set(games.map(g => g.away_team_name).filter(Boolean))];
      const allTeamNames = [...new Set([...uniqueHomeTeams, ...uniqueAwayTeams])];

      // Bulk find existing teams
      const teamMap = new Map();
      if (allTeamNames.length > 0) {
        const { rows: existingTeams } = await client.query(`
          SELECT id, canonical_name FROM teams_v2
          WHERE canonical_name = ANY($1::text[])
        `, [allTeamNames.map(n => n.toLowerCase().replace(/\s+/g, ' ').trim())]);

        existingTeams.forEach(t => teamMap.set(t.canonical_name, t.id));
      }

      // Bulk create missing teams
      const missingTeams = allTeamNames.filter(n => !teamMap.has(n.toLowerCase().replace(/\s+/g, ' ').trim()));
      if (missingTeams.length > 0) {
        const teamValues = missingTeams.map(name => {
          const canonical = name.toLowerCase().replace(/\s+/g, ' ').trim();
          const birthYear = extractBirthYear(name);
          const gender = extractGender(name);
          return `('${canonical.replace(/'/g, "''")}', '${name.replace(/'/g, "''")}', ${birthYear || 'NULL'}, ${gender ? `'${gender}'` : 'NULL'}, 'XX', 1500, 0, 0, 0, 0)`;
        }).join(',\n');

        try {
          const { rows: newTeams } = await client.query(`
            INSERT INTO teams_v2 (canonical_name, display_name, birth_year, gender, state, elo_rating, matches_played, wins, losses, draws)
            VALUES ${teamValues}
            ON CONFLICT (canonical_name, COALESCE(birth_year, 0), COALESCE(gender::text, ''), COALESCE(state, ''))
            DO UPDATE SET display_name = EXCLUDED.display_name
            RETURNING id, canonical_name
          `);
          newTeams.forEach(t => teamMap.set(t.canonical_name, t.id));
        } catch (err) {
          // Fallback: insert one by one for problematic entries
          for (const name of missingTeams) {
            const canonical = name.toLowerCase().replace(/\s+/g, ' ').trim();
            if (!teamMap.has(canonical)) {
              try {
                const { rows } = await client.query(`
                  INSERT INTO teams_v2 (canonical_name, display_name, birth_year, gender, state, elo_rating, matches_played, wins, losses, draws)
                  VALUES ($1, $2, $3, $4, 'XX', 1500, 0, 0, 0, 0)
                  RETURNING id
                `, [canonical, name, extractBirthYear(name), extractGender(name)]);
                if (rows[0]) teamMap.set(canonical, rows[0].id);
              } catch (e) {
                // Try to find existing
                const { rows: found } = await client.query(
                  `SELECT id FROM teams_v2 WHERE canonical_name = $1 LIMIT 1`,
                  [canonical]
                );
                if (found[0]) teamMap.set(canonical, found[0].id);
              }
            }
          }
        }
      }

      // STEP 3: Bulk resolve events
      const uniqueEvents = [...new Set(games.map(g => g.event_id || g.event_name).filter(Boolean))];
      const eventMap = new Map();

      // Find existing events (check both leagues and tournaments)
      if (uniqueEvents.length > 0) {
        const { rows: existingLeagues } = await client.query(`
          SELECT id, source_event_id, name FROM leagues
          WHERE source_event_id = ANY($1::text[]) OR LOWER(name) = ANY($2::text[])
        `, [uniqueEvents, uniqueEvents.map(e => e?.toLowerCase())]);

        existingLeagues.forEach(e => {
          eventMap.set(e.source_event_id || e.name.toLowerCase(), { leagueId: e.id, tournamentId: null });
        });

        const { rows: existingTournaments } = await client.query(`
          SELECT id, source_event_id, name FROM tournaments
          WHERE source_event_id = ANY($1::text[]) OR LOWER(name) = ANY($2::text[])
        `, [uniqueEvents, uniqueEvents.map(e => e?.toLowerCase())]);

        existingTournaments.forEach(e => {
          if (!eventMap.has(e.source_event_id || e.name.toLowerCase())) {
            eventMap.set(e.source_event_id || e.name.toLowerCase(), { leagueId: null, tournamentId: e.id });
          }
        });
      }

      // Create missing events (as tournaments by default)
      const missingEvents = uniqueEvents.filter(e => !eventMap.has(e) && !eventMap.has(e?.toLowerCase()));
      for (const eventKey of missingEvents) {
        const eventName = games.find(g => g.event_id === eventKey || g.event_name === eventKey)?.event_name || eventKey;
        const isLeague = eventName?.toLowerCase().includes('league');

        try {
          if (isLeague) {
            const { rows } = await client.query(`
              INSERT INTO leagues (name, source_event_id, source_platform)
              VALUES ($1, $2, 'gotsport')
              ON CONFLICT DO NOTHING
              RETURNING id
            `, [eventName, eventKey !== eventName ? eventKey : null]);
            if (rows[0]) eventMap.set(eventKey, { leagueId: rows[0].id, tournamentId: null });
          } else {
            const { rows } = await client.query(`
              INSERT INTO tournaments (name, source_event_id, source_platform, start_date, end_date)
              VALUES ($1, $2, 'gotsport', CURRENT_DATE, CURRENT_DATE)
              ON CONFLICT DO NOTHING
              RETURNING id
            `, [eventName, eventKey !== eventName ? eventKey : null]);
            if (rows[0]) eventMap.set(eventKey, { leagueId: null, tournamentId: rows[0].id });
          }
        } catch (err) {
          // Ignore - event creation failed
        }
      }

      // STEP 4: Build and insert matches
      const validMatches = [];
      const invalidIds = [];

      for (const game of games) {
        const homeCanonical = game.home_team_name?.toLowerCase().replace(/\s+/g, ' ').trim();
        const awayCanonical = game.away_team_name?.toLowerCase().replace(/\s+/g, ' ').trim();

        const homeTeamId = teamMap.get(homeCanonical);
        const awayTeamId = teamMap.get(awayCanonical);

        if (!homeTeamId || !awayTeamId || !game.match_date) {
          invalidIds.push(game.id);
          continue;
        }

        if (homeTeamId === awayTeamId) {
          invalidIds.push(game.id);
          continue;
        }

        const eventKey = game.event_id || game.event_name;
        const event = eventMap.get(eventKey) || eventMap.get(eventKey?.toLowerCase()) || { leagueId: null, tournamentId: null };

        validMatches.push({
          match_date: game.match_date,
          match_time: game.match_time,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          home_score: game.home_score ?? 0,
          away_score: game.away_score ?? 0,
          league_id: event.leagueId,
          tournament_id: event.tournamentId,
          source_platform: game.source_platform,
          source_match_key: game.source_match_key,
          staging_id: game.id,
        });
      }

      // Bulk insert matches
      let insertedCount = 0;
      if (validMatches.length > 0) {
        const MATCH_BATCH = 500;
        for (let i = 0; i < validMatches.length; i += MATCH_BATCH) {
          const batch = validMatches.slice(i, i + MATCH_BATCH);

          const values = batch.map((m, idx) => {
            const base = idx * 10;
            return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10})`;
          }).join(', ');

          const params = batch.flatMap(m => [
            m.match_date, m.match_time, m.home_team_id, m.away_team_id,
            m.home_score, m.away_score, m.league_id, m.tournament_id,
            m.source_platform, m.source_match_key
          ]);

          try {
            const { rowCount } = await client.query(`
              INSERT INTO matches_v2 (match_date, match_time, home_team_id, away_team_id, home_score, away_score, league_id, tournament_id, source_platform, source_match_key)
              VALUES ${values}
              ON CONFLICT (source_match_key) DO UPDATE SET
                home_score = EXCLUDED.home_score,
                away_score = EXCLUDED.away_score,
                match_date = EXCLUDED.match_date
            `, params);
            insertedCount += rowCount;
          } catch (err) {
            console.log(`   ⚠️ Batch insert error: ${err.message.substring(0, 50)}`);
          }

          // Mark as processed
          const stagingIds = batch.map(m => m.staging_id);
          await client.query(`
            UPDATE staging_games SET processed = true, processed_at = NOW()
            WHERE id = ANY($1::uuid[])
          `, [stagingIds]);
        }
      }

      // Mark invalid as processed with error
      if (invalidIds.length > 0) {
        await client.query(`
          UPDATE staging_games SET processed = true, processed_at = NOW(), error_message = 'Validation failed'
          WHERE id = ANY($1::uuid[])
        `, [invalidIds]);
      }

      totalProcessed += games.length;
      totalMatches += insertedCount;

      const batchTime = Math.round((Date.now() - batchStart) / 1000);
      const remaining = parseInt(initialCount) - totalProcessed;
      console.log(`   ✓ Inserted ${insertedCount} matches (${invalidIds.length} invalid) in ${batchTime}s`);
      console.log(`   📊 Progress: ${totalProcessed}/${initialCount} (${Math.round(totalProcessed/parseInt(initialCount)*100)}%) | Remaining: ${remaining}`);

      // Safety limit
      if (iteration > 50) break;
    }

    // Final stats
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log('\n' + '='.repeat(50));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(50));
    console.log(`   Total processed: ${totalProcessed}`);
    console.log(`   Total matches inserted: ${totalMatches}`);
    console.log(`   Runtime: ${elapsed}s (${Math.round(elapsed/60)}m)`);
    console.log(`   Speed: ${Math.round(totalMatches / (elapsed/60))} matches/min`);

    // Check remaining
    const { rows: [{ count: remaining }] } = await client.query(
      `SELECT COUNT(*) as count FROM staging_games WHERE processed = false`
    );
    console.log(`   Remaining unprocessed: ${remaining}`);

  } finally {
    client.release();
    await pool.end();
  }
}

function extractBirthYear(name) {
  if (!name) return null;
  const fullYear = name.match(/\b(20[01]\d)\b/);
  if (fullYear) {
    const year = parseInt(fullYear[1]);
    if (year >= 2007 && year <= 2019) return year;
  }
  const twoDigit = name.match(/[BG](\d{2})(?![0-9])/i) || name.match(/(\d{2})[BG](?![0-9])/i);
  if (twoDigit) {
    const year = 2000 + parseInt(twoDigit[1]);
    if (year >= 2007 && year <= 2019) return year;
  }
  const ageGroup = name.match(/\bU[-\s]?(\d+)\b/i);
  if (ageGroup) {
    const age = parseInt(ageGroup[1]);
    if (age >= 7 && age <= 19) return 2026 - age;
  }
  return null;
}

function extractGender(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes('boys') || /\bb\d/i.test(name) || /\d+b\b/i.test(name)) return 'M';
  if (lower.includes('girls') || /\bg\d/i.test(name) || /\d+g\b/i.test(name)) return 'F';
  return null;
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
