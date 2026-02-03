/**
 * FAST Bulk Processor for Staging Games
 * Uses direct PostgreSQL for maximum speed
 * Processes 5000+ records per batch
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BATCH_SIZE = 5000;

// Simple team cache
const teamCache = new Map();

/**
 * Parse birth year from team name
 */
function extractBirthYear(name, seasonYear = 2026) {
  if (!name) return null;

  // 4-digit year
  const fullYear = name.match(/\b(20[01]\d)\b/);
  if (fullYear) {
    const year = parseInt(fullYear[1]);
    if (year >= 2007 && year <= 2019) return year;
  }

  // 2-digit pattern (B14, G15, 14B, 15G)
  const twoDigit = name.match(/[BG](\d{2})(?![0-9])/i) || name.match(/(\d{2})[BG](?![0-9])/i);
  if (twoDigit) {
    const year = 2000 + parseInt(twoDigit[1]);
    if (year >= 2007 && year <= 2019) return year;
  }

  // Age group (U12 = 2026 - 12 = 2014)
  const ageGroup = name.match(/\bU[-\s]?(\d+)\b/i);
  if (ageGroup) {
    const age = parseInt(ageGroup[1]);
    if (age >= 7 && age <= 19) return seasonYear - age;
  }

  return null;
}

/**
 * Parse gender from team name
 */
function extractGender(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes('boys') || /\bb\d/i.test(name) || /\d+b\b/i.test(name)) return 'M';
  if (lower.includes('girls') || /\bg\d/i.test(name) || /\d+g\b/i.test(name)) return 'F';
  return null;
}

/**
 * Find or create team - uses cache and bulk operations
 */
async function findOrCreateTeam(client, teamName, sourcePlatform) {
  if (!teamName) return null;

  const cacheKey = teamName.toLowerCase().trim();
  if (teamCache.has(cacheKey)) return teamCache.get(cacheKey);

  const canonicalName = teamName.toLowerCase().replace(/\s+/g, ' ').trim();
  const birthYear = extractBirthYear(teamName);
  const gender = extractGender(teamName);

  // Try to find existing team
  let query = `SELECT id FROM teams_v2 WHERE canonical_name = $1`;
  const params = [canonicalName];

  if (birthYear) {
    query += ` AND birth_year = $2`;
    params.push(birthYear);
  }
  query += ` LIMIT 1`;

  const { rows } = await client.query(query, params);

  if (rows.length > 0) {
    teamCache.set(cacheKey, rows[0].id);
    return rows[0].id;
  }

  // Create new team
  const state = sourcePlatform === 'heartland' || sourcePlatform === 'htgsports' ? 'KS' : 'XX';

  // Gender must be 'M', 'F', or NULL (enum doesn't allow 'U')
  const validGender = gender === 'M' || gender === 'F' ? gender : null;

  // Use simpler upsert - just try insert, catch duplicate
  try {
    const { rows: created } = await client.query(`
      INSERT INTO teams_v2 (canonical_name, display_name, birth_year, gender, state, elo_rating, matches_played, wins, losses, draws)
      VALUES ($1, $2, $3, $4, $5, 1500, 0, 0, 0, 0)
      RETURNING id
    `, [canonicalName, teamName.trim(), birthYear, validGender, state]);

    const id = created[0]?.id;
    if (id) teamCache.set(cacheKey, id);
    return id;
  } catch (err) {
    // Likely duplicate - try to find it
    if (err.code === '23505') {
      const { rows: found } = await client.query(
        `SELECT id FROM teams_v2 WHERE canonical_name = $1 LIMIT 1`,
        [canonicalName]
      );
      if (found.length > 0) {
        teamCache.set(cacheKey, found[0].id);
        return found[0].id;
      }
    }
    return null;
  }
}

/**
 * Find or create event
 */
const eventCache = new Map();

async function findOrCreateEvent(client, eventId, eventName, sourcePlatform) {
  if (!eventId && !eventName) return { leagueId: null, tournamentId: null };

  const cacheKey = `${eventId || eventName}`;
  if (eventCache.has(cacheKey)) return eventCache.get(cacheKey);

  const isLeague = eventName?.toLowerCase().includes('league');
  const table = isLeague ? 'leagues' : 'tournaments';

  // Find existing
  let query = `SELECT id FROM ${table} WHERE `;
  if (eventId) {
    query += `source_event_id = $1`;
  } else {
    query += `LOWER(name) = LOWER($1)`;
  }
  query += ` LIMIT 1`;

  const { rows } = await client.query(query, [eventId || eventName]);

  if (rows.length > 0) {
    const result = isLeague
      ? { leagueId: rows[0].id, tournamentId: null }
      : { leagueId: null, tournamentId: rows[0].id };
    eventCache.set(cacheKey, result);
    return result;
  }

  // Create new
  let insertQuery;
  if (isLeague) {
    insertQuery = `
      INSERT INTO leagues (name, source_event_id, source_platform)
      VALUES ($1, $2, $3)
      ON CONFLICT (source_event_id) WHERE source_event_id IS NOT NULL
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
  } else {
    insertQuery = `
      INSERT INTO tournaments (name, source_event_id, source_platform, start_date, end_date)
      VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE)
      ON CONFLICT (source_event_id) WHERE source_event_id IS NOT NULL
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
  }

  const { rows: created } = await client.query(insertQuery, [
    eventName || `Event ${eventId}`,
    eventId,
    sourcePlatform
  ]);

  const result = isLeague
    ? { leagueId: created[0]?.id, tournamentId: null }
    : { leagueId: null, tournamentId: created[0]?.id };
  eventCache.set(cacheKey, result);
  return result;
}

async function processBatch(client, games) {
  let inserted = 0;
  let skipped = 0;

  for (const game of games) {
    // Validate
    if (!game.home_team_name || !game.away_team_name || !game.match_date) {
      skipped++;
      await client.query(
        `UPDATE staging_games SET processed = true, processed_at = NOW(), error_message = 'Missing required fields' WHERE id = $1`,
        [game.id]
      );
      continue;
    }

    // Get teams
    const homeTeamId = await findOrCreateTeam(client, game.home_team_name, game.source_platform);
    const awayTeamId = await findOrCreateTeam(client, game.away_team_name, game.source_platform);

    if (!homeTeamId || !awayTeamId) {
      skipped++;
      await client.query(
        `UPDATE staging_games SET processed = true, processed_at = NOW(), error_message = 'Failed to resolve teams' WHERE id = $1`,
        [game.id]
      );
      continue;
    }

    if (homeTeamId === awayTeamId) {
      skipped++;
      await client.query(
        `UPDATE staging_games SET processed = true, processed_at = NOW(), error_message = 'Same team for home and away' WHERE id = $1`,
        [game.id]
      );
      continue;
    }

    // Get event
    const { leagueId, tournamentId } = await findOrCreateEvent(
      client, game.event_id, game.event_name, game.source_platform
    );

    // Insert match
    try {
      await client.query(`
        INSERT INTO matches_v2 (
          match_date, match_time, home_team_id, away_team_id, home_score, away_score,
          league_id, tournament_id, source_platform, source_match_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (source_match_key) DO UPDATE SET
          home_score = EXCLUDED.home_score,
          away_score = EXCLUDED.away_score,
          match_date = EXCLUDED.match_date
      `, [
        game.match_date,
        game.match_time,
        homeTeamId,
        awayTeamId,
        game.home_score ?? 0,
        game.away_score ?? 0,
        leagueId,
        tournamentId,
        game.source_platform,
        game.source_match_key
      ]);

      inserted++;
    } catch (err) {
      skipped++;
      await client.query(
        `UPDATE staging_games SET processed = true, processed_at = NOW(), error_message = $2 WHERE id = $1`,
        [game.id, err.message.substring(0, 200)]
      );
      continue;
    }

    // Mark processed
    await client.query(
      `UPDATE staging_games SET processed = true, processed_at = NOW() WHERE id = $1`,
      [game.id]
    );
  }

  return { inserted, skipped };
}

async function main() {
  console.log('🚀 FAST BULK PROCESSOR');
  console.log('======================\n');

  const startTime = Date.now();
  let totalInserted = 0;
  let totalSkipped = 0;
  let iteration = 0;

  const client = await pool.connect();

  try {
    while (true) {
      // Get batch
      const { rows: games } = await client.query(`
        SELECT * FROM staging_games
        WHERE processed = false
        ORDER BY scraped_at ASC
        LIMIT $1
      `, [BATCH_SIZE]);

      if (games.length === 0) {
        console.log('\n✅ All staging records processed!');
        break;
      }

      iteration++;
      console.log(`\n📦 Batch ${iteration}: Processing ${games.length} records...`);

      const { inserted, skipped } = await processBatch(client, games);

      totalInserted += inserted;
      totalSkipped += skipped;

      console.log(`   ✓ Inserted: ${inserted}, Skipped: ${skipped}`);
      console.log(`   Running total: ${totalInserted} inserted, ${totalSkipped} skipped`);

      // Check remaining
      const { rows: remaining } = await client.query(
        `SELECT COUNT(*) as count FROM staging_games WHERE processed = false`
      );
      console.log(`   Remaining: ${remaining[0].count}`);

      // Safety limit
      if (iteration > 20) {
        console.log('\n⚠️ Reached iteration limit');
        break;
      }
    }
  } finally {
    client.release();
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  console.log('\n' + '='.repeat(50));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(50));
  console.log(`   Total inserted: ${totalInserted}`);
  console.log(`   Total skipped: ${totalSkipped}`);
  console.log(`   Iterations: ${iteration}`);
  console.log(`   Runtime: ${elapsed}s (${Math.round(elapsed/60)}m)`);
  console.log(`   Speed: ${Math.round(totalInserted / (elapsed/60))} matches/min`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
