/**
 * Universal Data Quality Engine v1.0
 * ==================================
 *
 * The core orchestrator for all data quality operations.
 * Processes staging data through a 4-step pipeline:
 *
 * STEP 1: NORMALIZE  - Standardize data formats via normalizers
 * STEP 2: RESOLVE    - Map to canonical entities via registries
 * STEP 3: DEDUPLICATE - Detect and handle duplicates
 * STEP 4: PROMOTE    - Validate and insert to production
 *
 * Performance: Uses direct PostgreSQL (pg) for bulk operations
 * Target: Process 10,000+ records/minute
 *
 * Usage:
 *   node scripts/universal/dataQualityEngine.js --process-staging
 *   node scripts/universal/dataQualityEngine.js --process-staging --dry-run
 *   node scripts/universal/dataQualityEngine.js --process-staging --limit 1000
 *   node scripts/universal/dataQualityEngine.js --deduplicate-matches
 *   node scripts/universal/dataQualityEngine.js --audit-report
 */

import pg from 'pg';
import 'dotenv/config';

// Import normalizers
import { normalizeTeam, normalizeTeamsBulk, initializeLearnedPatterns as initTeamPatterns, initializeSeasonYear as initSeasonYear, inferStateFromName } from './normalizers/teamNormalizer.js';
import { normalizeEvent, normalizeEventsBulk, initializeLearnedPatterns as initEventPatterns } from './normalizers/eventNormalizer.js';
import { normalizeMatch, normalizeMatchesBulk, extractDivisionTier } from './normalizers/matchNormalizer.js';
import { normalizeClub, normalizeClubsBulk } from './normalizers/clubNormalizer.js';

// Import adaptive learning for feedback loop
import { recordSuccess, recordFailure } from './adaptiveLearning.js';

// Import pipeline authorization for write protection
import { authorizePipelineWrite } from './pipelineAuth.js';

const { Pool } = pg;

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
  BATCH_SIZE: 1000,           // Records per batch for inserts
  FETCH_SIZE: 5000,           // Records per fetch from staging
  DEFAULT_LIMIT: 50000,       // Default max records to process
  MATCH_SIMILARITY_THRESHOLD: 0.85,  // Fuzzy match threshold
  TEAM_SIMILARITY_THRESHOLD: 0.90,   // Team dedup threshold
  AUDIT_BATCH_SIZE: 500,      // Audit log batch size
};

// ===========================================
// DATABASE CONNECTION
// ===========================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,                        // Max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 600000,      // 10 min statement timeout (for view refresh)
});

// Handle pool-level errors to prevent crashes from unhandled events
pool.on('error', (err) => {
  console.error('❌ Pool error (handled):', err.message);
  // Don't exit - let the operation retry or handle gracefully
});

// ===========================================
// STATISTICS TRACKING
// ===========================================

const stats = {
  // Processing counts
  stagingFetched: 0,
  normalized: 0,
  resolved: 0,
  deduplicated: 0,
  promoted: 0,

  // Entity counts
  teamsCreated: 0,
  teamsLinked: 0,
  teamsMerged: 0,
  eventsCreated: 0,
  eventsLinked: 0,
  eventsMerged: 0,
  matchesInserted: 0,
  matchesUpdated: 0,
  matchesSkipped: 0,

  // Quality metrics
  validRecords: 0,
  invalidRecords: 0,
  duplicatesFound: 0,

  // Audit
  auditLogsWritten: 0,

  // Timing
  startTime: null,
  stepTimes: {},

  // Errors
  errors: [],
};

// ===========================================
// AUDIT LOGGING
// ===========================================

const auditBuffer = [];

/**
 * Queue an audit log entry for batch insertion
 * Uses existing audit_log schema: table_name, record_id, action, old_data, new_data, changed_by, changed_at
 */
function logAudit(action, tableName, recordId, details, oldData = null, newData = null) {
  auditBuffer.push({
    action,
    table_name: tableName,
    record_id: recordId,
    old_data: oldData ? JSON.stringify(oldData) : null,
    new_data: newData ? JSON.stringify({ ...details, ...(newData || {}) }) : JSON.stringify(details),
    changed_by: 'dataQualityEngine',
  });

  // Flush if buffer is full
  if (auditBuffer.length >= CONFIG.AUDIT_BATCH_SIZE) {
    return flushAuditLogs();
  }
}

/**
 * Flush audit logs to database
 */
async function flushAuditLogs(client = null) {
  if (auditBuffer.length === 0) return;

  const conn = client || await pool.connect();
  try {
    const logs = auditBuffer.splice(0, auditBuffer.length);

    // Insert logs one by one (audit logs are not performance-critical)
    for (const log of logs) {
      try {
        await conn.query(`
          INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
          VALUES ($1, $2, $3, $4, $5, 'dataQualityEngine', NOW())
        `, [log.table_name, log.record_id, log.action, log.old_data, log.new_data]);
        stats.auditLogsWritten++;
      } catch (err) {
        // Ignore individual audit log failures (record_id might be invalid UUID)
      }
    }
  } catch (error) {
    console.error('⚠️ Failed to flush audit logs:', error.message);
    stats.errors.push({ phase: 'audit', error: error.message });
  } finally {
    if (!client) conn.release();
  }
}

// ===========================================
// VIEW REFRESH WITH RETRY
// ===========================================

/**
 * Refresh materialized views with retry logic and exponential backoff.
 * This is critical for 100% reliability - view refresh can fail due to:
 * - Connection timeouts during long-running refresh
 * - Cloudflare/Supabase rate limiting
 * - Network hiccups
 *
 * Solution: Use a fresh connection for each retry with exponential backoff.
 */
async function refreshViewsWithRetry() {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [5000, 15000, 30000]; // 5s, 15s, 30s

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Use a fresh connection for reliability (not the batch processing client)
    const client = await pool.connect();

    try {
      // Set a statement timeout for this specific operation
      await client.query('SET statement_timeout = 300000'); // 5 minutes

      console.log(`   Attempt ${attempt}/${MAX_RETRIES}...`);
      await client.query('SELECT refresh_app_views()');
      console.log('   ✅ Views refreshed successfully');

      client.release();
      return; // Success - exit

    } catch (error) {
      client.release();

      const isRetryable = error.message.includes('Connection terminated') ||
                          error.message.includes('timeout') ||
                          error.message.includes('ECONNRESET') ||
                          error.code === '57014'; // query_canceled

      if (attempt < MAX_RETRIES && isRetryable) {
        const delay = RETRY_DELAYS[attempt - 1];
        console.log(`   ⚠️ Attempt ${attempt} failed: ${error.message}`);
        console.log(`   🔄 Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Final failure - log but don't crash
        console.error(`   ❌ View refresh failed after ${attempt} attempts: ${error.message}`);
        stats.errors.push({ phase: 'view_refresh', error: error.message });

        // Views will be refreshed by the separate refresh_views_manual.js step in the workflow
        console.log('   ℹ️  Views will be refreshed by the next pipeline step');
        return;
      }
    }
  }
}

// ===========================================
// STEP 1: NORMALIZE
// ===========================================

/**
 * Normalize a batch of staging records using all normalizers
 */
function normalizeRecords(records) {
  const startTime = Date.now();
  const results = [];

  for (const record of records) {
    try {
      // Normalize team names
      const homeTeam = normalizeTeam({
        raw_name: record.home_team_name,
        source_platform: record.source_platform,
      });

      const awayTeam = normalizeTeam({
        raw_name: record.away_team_name,
        source_platform: record.source_platform,
      });

      // Normalize event
      const event = normalizeEvent({
        raw_name: record.event_name,
        source_platform: record.source_platform,
        source_event_id: record.event_id,
      });

      // Normalize match
      const match = normalizeMatch({
        match_date: record.match_date,
        match_time: record.match_time,
        home_score: record.home_score,
        away_score: record.away_score,
        home_team_name: record.home_team_name,
        away_team_name: record.away_team_name,
        source_match_key: record.source_match_key,
        event_id: record.event_id,
        source_platform: record.source_platform,
      });

      // Extract club from home team
      const homeClub = normalizeClub({
        team_name: record.home_team_name,
        state: null,
      });

      const awayClub = normalizeClub({
        team_name: record.away_team_name,
        state: null,
      });

      results.push({
        stagingId: record.id,
        original: record,
        normalized: {
          homeTeam,
          awayTeam,
          event,
          match,
          homeClub,
          awayClub,
        },
        isValid: match.is_valid && homeTeam.normalized && awayTeam.normalized,
        validationErrors: match.validation_errors || [],
      });

      stats.normalized++;
    } catch (error) {
      results.push({
        stagingId: record.id,
        original: record,
        normalized: null,
        isValid: false,
        validationErrors: [`Normalization error: ${error.message}`],
      });
      stats.invalidRecords++;
    }
  }

  stats.stepTimes.normalize = (stats.stepTimes.normalize || 0) + (Date.now() - startTime);
  return results;
}

// ===========================================
// STEP 2: RESOLVE (Canonical Registry Lookups)
// ===========================================

/**
 * Resolve normalized records against canonical registries
 */
async function resolveRecords(normalizedRecords, client) {
  const startTime = Date.now();
  const results = [];

  // Build lookup maps for batch resolution
  const eventNames = new Set();
  const teamKeys = new Set();

  for (const record of normalizedRecords) {
    if (!record.isValid || !record.normalized) continue;

    const { event, homeTeam, awayTeam } = record.normalized;
    if (event?.canonical_name) eventNames.add(event.canonical_name);
    if (event?.display_name) eventNames.add(event.display_name);

    // Create team lookup keys (name + birth_year + gender)
    if (homeTeam?.canonical_name) {
      teamKeys.add(`${homeTeam.canonical_name}|${homeTeam.birth_year || ''}|${homeTeam.gender || ''}`);
    }
    if (awayTeam?.canonical_name) {
      teamKeys.add(`${awayTeam.canonical_name}|${awayTeam.birth_year || ''}|${awayTeam.gender || ''}`);
    }
  }

  // Batch lookup canonical events
  const eventNameArray = [...eventNames];
  const eventMap = new Map();

  if (eventNameArray.length > 0) {
    const { rows: canonicalEvents } = await client.query(`
      SELECT ce.canonical_name, ce.event_type, ce.league_id, ce.tournament_id, ce.aliases
      FROM canonical_events ce
      WHERE ce.canonical_name = ANY($1)
         OR EXISTS (SELECT 1 FROM unnest(ce.aliases) alias WHERE alias = ANY($1))
    `, [eventNameArray]);

    for (const ce of canonicalEvents) {
      eventMap.set(ce.canonical_name.toLowerCase(), ce);
      for (const alias of ce.aliases || []) {
        eventMap.set(alias.toLowerCase(), ce);
      }
    }
  }

  // Batch lookup canonical teams
  const teamMap = new Map();

  if (teamKeys.size > 0) {
    const { rows: canonicalTeams } = await client.query(`
      SELECT ct.canonical_name, ct.birth_year, ct.gender, ct.team_v2_id, ct.aliases
      FROM canonical_teams ct
    `);

    for (const ct of canonicalTeams) {
      const key = `${ct.canonical_name.toLowerCase()}|${ct.birth_year || ''}|${ct.gender || ''}`;
      teamMap.set(key, ct);
      for (const alias of ct.aliases || []) {
        const aliasKey = `${alias.toLowerCase()}|${ct.birth_year || ''}|${ct.gender || ''}`;
        teamMap.set(aliasKey, ct);
      }
    }
  }

  // Resolve each record
  for (const record of normalizedRecords) {
    if (!record.isValid || !record.normalized) {
      results.push(record);
      continue;
    }

    const resolved = { ...record, resolved: {} };
    const { event, homeTeam, awayTeam } = record.normalized;

    // Resolve event
    if (event?.canonical_name) {
      const canonicalEvent = eventMap.get(event.canonical_name.toLowerCase()) ||
                            eventMap.get(event.display_name?.toLowerCase());
      if (canonicalEvent) {
        resolved.resolved.event = {
          canonical_name: canonicalEvent.canonical_name,
          event_type: canonicalEvent.event_type,
          league_id: canonicalEvent.league_id,
          tournament_id: canonicalEvent.tournament_id,
          from_registry: true,
        };
      } else {
        resolved.resolved.event = {
          canonical_name: event.canonical_name,
          event_type: event.event_type,
          from_registry: false,
        };
      }
    }

    // Resolve home team
    if (homeTeam?.canonical_name) {
      const key = `${homeTeam.canonical_name}|${homeTeam.birth_year || ''}|${homeTeam.gender || ''}`;
      const canonicalTeam = teamMap.get(key);
      if (canonicalTeam) {
        resolved.resolved.homeTeam = {
          canonical_name: canonicalTeam.canonical_name,
          team_v2_id: canonicalTeam.team_v2_id,
          from_registry: true,
        };
        // ADAPTIVE LEARNING: Record successful canonical match (fire-and-forget)
        recordSuccess('canonical_match', record.original?.source_platform || 'unknown', {
          name: canonicalTeam.canonical_name,
          birth_year: homeTeam.birth_year,
        }).catch(() => {}); // Non-blocking
      } else {
        resolved.resolved.homeTeam = {
          canonical_name: homeTeam.canonical_name,
          birth_year: homeTeam.birth_year,
          gender: homeTeam.gender,
          from_registry: false,
        };
      }
    }

    // Resolve away team
    if (awayTeam?.canonical_name) {
      const key = `${awayTeam.canonical_name}|${awayTeam.birth_year || ''}|${awayTeam.gender || ''}`;
      const canonicalTeam = teamMap.get(key);
      if (canonicalTeam) {
        resolved.resolved.awayTeam = {
          canonical_name: canonicalTeam.canonical_name,
          team_v2_id: canonicalTeam.team_v2_id,
          from_registry: true,
        };
        // ADAPTIVE LEARNING: Record successful canonical match (fire-and-forget)
        recordSuccess('canonical_match', record.original?.source_platform || 'unknown', {
          name: canonicalTeam.canonical_name,
          birth_year: awayTeam.birth_year,
        }).catch(() => {}); // Non-blocking
      } else {
        resolved.resolved.awayTeam = {
          canonical_name: awayTeam.canonical_name,
          birth_year: awayTeam.birth_year,
          gender: awayTeam.gender,
          from_registry: false,
        };
      }
    }

    results.push(resolved);
    stats.resolved++;
  }

  stats.stepTimes.resolve = (stats.stepTimes.resolve || 0) + (Date.now() - startTime);
  return results;
}

// ===========================================
// STEP 3: DEDUPLICATE
// ===========================================

/**
 * Check for duplicate matches using source_match_key
 */
async function deduplicateMatches(resolvedRecords, client) {
  const startTime = Date.now();
  const results = [];

  // Collect all source_match_keys for batch lookup
  const matchKeys = [];
  for (const record of resolvedRecords) {
    if (!record.isValid || !record.normalized) continue;
    const key = record.normalized.match?.source_match_key;
    if (key) matchKeys.push(key);
  }

  // Batch lookup existing matches
  const existingMatches = new Map();
  if (matchKeys.length > 0) {
    const { rows } = await client.query(`
      SELECT id, source_match_key, home_score, away_score, match_date
      FROM matches_v2
      WHERE source_match_key = ANY($1)
    `, [matchKeys]);

    for (const match of rows) {
      existingMatches.set(match.source_match_key, match);
    }
  }

  // Check each record for duplicates
  for (const record of resolvedRecords) {
    if (!record.isValid || !record.normalized) {
      results.push(record);
      continue;
    }

    const key = record.normalized.match?.source_match_key;
    const existing = existingMatches.get(key);

    if (existing) {
      // Mark as duplicate - will be updated instead of inserted
      record.isDuplicate = true;
      record.existingMatchId = existing.id;
      record.existingMatch = existing;
      stats.duplicatesFound++;

      // ADAPTIVE LEARNING: Record if duplicate wasn't prevented by canonical registry
      // This helps identify cases where the registry should have helped
      const homeFromRegistry = record.resolved?.homeTeam?.from_registry;
      const awayFromRegistry = record.resolved?.awayTeam?.from_registry;
      if (!homeFromRegistry || !awayFromRegistry) {
        // At least one team wasn't resolved from registry - opportunity for improvement
        recordFailure('duplicate_not_prevented', record.original?.source_platform || 'unknown', {
          home_team: record.normalized?.homeTeam?.canonical_name,
          away_team: record.normalized?.awayTeam?.canonical_name,
          match_key: key,
        }).catch(() => {}); // Non-blocking
      }

      // Determine if update is needed (scores changed)
      const newHomeScore = record.normalized.match.home_score;
      const newAwayScore = record.normalized.match.away_score;

      // Update if new data has actual scores and existing has no scores (NULL or 0-0)
      // This handles the case where a scheduled match gets played and we get real scores
      const existingHasNoScores = existing.home_score === null || existing.away_score === null ||
                                  (existing.home_score === 0 && existing.away_score === 0);
      const newHasRealScores = (newHomeScore !== null && newHomeScore > 0) ||
                               (newAwayScore !== null && newAwayScore > 0);

      if (newHasRealScores && existingHasNoScores) {
        record.needsUpdate = true;
      }
    } else {
      record.isDuplicate = false;
    }

    results.push(record);
    stats.deduplicated++;
  }

  stats.stepTimes.deduplicate = (stats.stepTimes.deduplicate || 0) + (Date.now() - startTime);
  return results;
}

// ===========================================
// STEP 4: VALIDATE & PROMOTE
// ===========================================

/**
 * Find or create team in teams_v2
 * UNIVERSAL: Works for any data source via canonical registries + fuzzy matching
 *
 * Resolution priority:
 * 1. Exact canonical_name + birth_year match
 * 2. Suffix match (handles club prefix differences)
 * 3. Token-based fuzzy match (handles word order differences)
 * 4. Create new team if no match found
 */
async function findOrCreateTeam(teamData, originalRecord, client) {
  const { canonical_name, birth_year, gender, display_name } = teamData;

  if (!canonical_name) return null;

  // UNIVERSAL: State comes from staging record, not hardcoded platform mapping
  const inferredState = inferStateFromRecord(originalRecord);

  // SESSION 89 TIER 1: Deterministic source entity map lookup (fastest, 100% accurate)
  const sourceTeamId = originalRecord?.source_home_team_id || originalRecord?.source_away_team_id;
  const sourcePlatform = originalRecord?.source_platform;
  if (sourceTeamId && sourcePlatform) {
    const { rows: sourceMatch } = await client.query(`
      SELECT sv_id FROM source_entity_map
      WHERE entity_type = 'team' AND source_platform = $1 AND source_entity_id = $2
    `, [sourcePlatform, String(sourceTeamId)]);

    if (sourceMatch.length > 0) {
      stats.teamsLinked++;
      return sourceMatch[0].sv_id;
    }
  }

  // STEP 1: Try exact canonical_name + birth_year match
  const { rows: existing } = await client.query(`
    SELECT id, canonical_name, display_name, birth_year, gender
    FROM teams_v2
    WHERE canonical_name ILIKE $1
      AND ($2::integer IS NULL OR birth_year = $2)
    LIMIT 1
  `, [canonical_name, birth_year]);

  if (existing.length > 0) {
    stats.teamsLinked++;
    return existing[0].id;
  }

  // SESSION 89 TIER 2: NULL-tolerant fallback — match by name even when birth_year differs
  // If incoming has birth_year but DB team has NULL (or vice versa), still match
  if (birth_year) {
    const { rows: nullTolerant } = await client.query(`
      SELECT id, canonical_name, display_name, birth_year, gender
      FROM teams_v2
      WHERE canonical_name ILIKE $1
        AND birth_year IS NULL
        AND ($2::text IS NULL OR gender = $2 OR gender IS NULL)
      ORDER BY matches_played DESC
      LIMIT 1
    `, [canonical_name, gender]);

    if (nullTolerant.length > 0) {
      // Update the matched team's birth_year (fill the gap)
      await client.query(
        'UPDATE teams_v2 SET birth_year = $1, gender = COALESCE(gender, $2) WHERE id = $3',
        [birth_year, gender, nullTolerant[0].id]
      );
      stats.teamsLinked++;
      return nullTolerant[0].id;
    }
  }

  // STEP 2: Try fuzzy match - canonical_name as SUFFIX of existing team
  // This handles "sporting bv pre-nal 15" matching "sporting blue valley sporting bv pre-nal 15"
  if (birth_year) {
    const { rows: suffixMatch } = await client.query(`
      SELECT id, canonical_name, display_name, birth_year, gender
      FROM teams_v2
      WHERE canonical_name ILIKE '%' || $1
        AND birth_year = $2
        AND ($3::text IS NULL OR gender = $3 OR gender IS NULL)
      ORDER BY LENGTH(canonical_name) ASC
      LIMIT 1
    `, [canonical_name, birth_year, gender]);

    if (suffixMatch.length > 0) {
      stats.teamsLinked++;
      logAudit('FUZZY_MATCH', 'teams_v2', suffixMatch[0].id, {
        match_type: 'suffix',
        incoming_name: canonical_name,
        matched_name: suffixMatch[0].canonical_name,
        birth_year,
      });
      return suffixMatch[0].id;
    }
  }

  // STEP 3: Try token-based fuzzy match for same birth year
  // Extract key tokens and find teams with same tokens + birth year
  if (birth_year) {
    const keyTokens = extractKeyTokens(canonical_name);
    if (keyTokens.length >= 2) {
      // Build pattern: all key tokens must appear in canonical_name
      const pattern = keyTokens.map(t => `(?=.*${escapeRegex(t)})`).join('');

      const { rows: tokenMatch } = await client.query(`
        SELECT id, canonical_name, display_name, birth_year, gender
        FROM teams_v2
        WHERE canonical_name ~* $1
          AND birth_year = $2
          AND ($3::text IS NULL OR gender = $3 OR gender IS NULL)
        ORDER BY LENGTH(canonical_name) ASC
        LIMIT 1
      `, [pattern, birth_year, gender]);

      if (tokenMatch.length > 0) {
        stats.teamsLinked++;
        logAudit('FUZZY_MATCH', 'teams_v2', tokenMatch[0].id, {
          match_type: 'token',
          incoming_name: canonical_name,
          matched_name: tokenMatch[0].canonical_name,
          tokens: keyTokens,
          birth_year,
        });
        return tokenMatch[0].id;
      }
    }
  }

  // Create new team - use full unique constraint (canonical_name, birth_year, gender, state)
  try {
    const { rows: created } = await client.query(`
      INSERT INTO teams_v2 (
        canonical_name, display_name, birth_year, gender, state,
        elo_rating, matches_played, wins, losses, draws, data_quality_score
      )
      VALUES ($1, $2, $3, $4, $5, 1500, 0, 0, 0, 0, 30)
      ON CONFLICT (canonical_name, birth_year, gender, state)
      DO UPDATE SET display_name = COALESCE(teams_v2.display_name, EXCLUDED.display_name)
      RETURNING id
    `, [canonical_name, display_name || canonical_name, birth_year, gender, inferredState]);

    if (created.length > 0) {
      stats.teamsCreated++;
      logAudit('CREATE', 'teams_v2', created[0].id, {
        canonical_name,
        birth_year,
        gender,
        source_platform: originalRecord?.source_platform,
      });

      // SELF-LEARNING: Add newly created team to canonical_teams registry
      // This prevents future duplicates by establishing this as the canonical version
      try {
        await client.query(`
          INSERT INTO canonical_teams (
            canonical_name, birth_year, gender, state, aliases, team_v2_id
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING
        `, [
          display_name || canonical_name,
          birth_year,
          gender,
          inferredState,
          [], // Empty aliases initially
          created[0].id
        ]);
      } catch (regErr) {
        // Silently ignore registry insert failures - not critical
      }

      // SESSION 89: Register source entity ID for deterministic future lookups
      if (sourceTeamId && sourcePlatform) {
        try {
          await client.query(`
            INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
            VALUES ('team', $1, $2, $3)
            ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
          `, [sourcePlatform, String(sourceTeamId), created[0].id]);
        } catch (_) { /* ignore */ }
      }

      return created[0].id;
    }
  } catch (error) {
    // If insert fails (e.g., constraint violation), try to find again
    const { rows: retry } = await client.query(`
      SELECT id FROM teams_v2
      WHERE canonical_name ILIKE $1 AND birth_year = $2
      LIMIT 1
    `, [canonical_name, birth_year]);

    if (retry.length > 0) {
      stats.teamsLinked++;
      return retry[0].id;
    }

    throw error;
  }

  return null;
}

/**
 * Find or create event in leagues/tournaments
 */
async function findOrCreateEvent(eventData, sourcePlatform, client) {
  if (!eventData) return { league_id: null, tournament_id: null };

  const { canonical_name, event_type, league_id, tournament_id, from_registry } = eventData;

  // If resolved from registry with IDs, use those
  if (from_registry && (league_id || tournament_id)) {
    return { league_id, tournament_id };
  }

  if (!canonical_name) return { league_id: null, tournament_id: null };

  const isLeague = event_type === 'league';
  const tableName = isLeague ? 'leagues' : 'tournaments';
  const entityType = isLeague ? 'league' : 'tournament';

  // SESSION 89 TIER 1: Deterministic source entity map lookup
  if (eventData.source_event_id && sourcePlatform) {
    const { rows: sourceMatch } = await client.query(`
      SELECT sv_id FROM source_entity_map
      WHERE entity_type = $1 AND source_platform = $2 AND source_entity_id = $3
    `, [entityType, sourcePlatform, String(eventData.source_event_id)]);

    if (sourceMatch.length > 0) {
      stats.eventsLinked++;
      return isLeague
        ? { league_id: sourceMatch[0].sv_id, tournament_id: null }
        : { league_id: null, tournament_id: sourceMatch[0].sv_id };
    }
  }

  // Try to find existing by name or source_event_id
  const { rows: existing } = await client.query(`
    SELECT id FROM ${tableName}
    WHERE name ILIKE $1 OR source_event_id = $2
    LIMIT 1
  `, [canonical_name, eventData.source_event_id]);

  if (existing.length > 0) {
    stats.eventsLinked++;
    return isLeague
      ? { league_id: existing[0].id, tournament_id: null }
      : { league_id: null, tournament_id: existing[0].id };
  }

  // Create new event (no unique constraint on source_event_id, so regular insert)
  try {
    if (isLeague) {
      const { rows: created } = await client.query(`
        INSERT INTO leagues (name, source_event_id, source_platform)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [canonical_name, eventData.source_event_id, sourcePlatform]);

      if (created.length > 0) {
        stats.eventsCreated++;
        logAudit('CREATE', 'leagues', created[0].id, { name: canonical_name });

        // SELF-LEARNING: Add newly created league to canonical_events registry
        try {
          await client.query(`
            INSERT INTO canonical_events (
              canonical_name, event_type, aliases, league_id
            )
            VALUES ($1, 'league', $2, $3)
            ON CONFLICT DO NOTHING
          `, [canonical_name, [], created[0].id]);
        } catch (regErr) {
          // Silently ignore registry insert failures
        }

        // SESSION 89: Register source entity ID
        if (eventData.source_event_id && sourcePlatform) {
          try {
            await client.query(`
              INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
              VALUES ('league', $1, $2, $3)
              ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
            `, [sourcePlatform, String(eventData.source_event_id), created[0].id]);
          } catch (_) { /* ignore */ }
        }

        return { league_id: created[0].id, tournament_id: null };
      }
    } else {
      const { rows: created } = await client.query(`
        INSERT INTO tournaments (name, source_event_id, source_platform, start_date, end_date)
        VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE)
        RETURNING id
      `, [canonical_name, eventData.source_event_id, sourcePlatform]);

      if (created.length > 0) {
        stats.eventsCreated++;
        logAudit('CREATE', 'tournaments', created[0].id, { name: canonical_name });

        // SELF-LEARNING: Add newly created tournament to canonical_events registry
        try {
          await client.query(`
            INSERT INTO canonical_events (
              canonical_name, event_type, aliases, tournament_id
            )
            VALUES ($1, 'tournament', $2, $3)
            ON CONFLICT DO NOTHING
          `, [canonical_name, [], created[0].id]);
        } catch (regErr) {
          // Silently ignore registry insert failures
        }

        // SESSION 89: Register source entity ID
        if (eventData.source_event_id && sourcePlatform) {
          try {
            await client.query(`
              INSERT INTO source_entity_map (entity_type, source_platform, source_entity_id, sv_id)
              VALUES ('tournament', $1, $2, $3)
              ON CONFLICT (entity_type, source_platform, source_entity_id) DO NOTHING
            `, [sourcePlatform, String(eventData.source_event_id), created[0].id]);
          } catch (_) { /* ignore */ }
        }

        return { league_id: null, tournament_id: created[0].id };
      }
    }
  } catch (error) {
    // If insert fails (e.g., duplicate name+season_id), try to find again
    const { rows: retry } = await client.query(`
      SELECT id FROM ${tableName}
      WHERE name ILIKE $1 OR source_event_id = $2
      LIMIT 1
    `, [canonical_name, eventData.source_event_id]);

    if (retry.length > 0) {
      stats.eventsLinked++;
      return isLeague
        ? { league_id: retry[0].id, tournament_id: null }
        : { league_id: null, tournament_id: retry[0].id };
    }
    // If still can't find, just log and continue (event not critical)
    console.warn(`   ⚠️ Event creation failed: ${error.message.substring(0, 50)}`);
  }

  return { league_id: null, tournament_id: null };
}

/**
 * Infer state from staging record
 * UNIVERSAL: No source-specific logic. State comes from:
 * 1. staging_games.state field (set by adapter)
 * 2. Default to 'XX' (unknown)
 *
 * Each adapter is responsible for setting state in staging_games if known.
 * See scripts/adapters/_template.js for adapter config pattern.
 */
function inferStateFromRecord(record) {
  // 1. Adapter-provided state (from staging_games.state if it exists)
  if (record?.state && record.state.trim().length === 2) {
    return record.state.trim().toUpperCase();
  }
  // 2. Infer from team name (e.g., "Sporting Iowa" → "IA")
  const nameState = inferStateFromName(record?.home_team) || inferStateFromName(record?.away_team);
  if (nameState) return nameState;
  // 3. Default: unknown state
  return 'unknown';
}

/**
 * Extract key tokens from team name for fuzzy matching
 * Filters out common words and returns distinctive tokens
 */
function extractKeyTokens(name) {
  if (!name) return [];

  // Common words to exclude (too generic for matching)
  const stopWords = new Set([
    'fc', 'sc', 'club', 'soccer', 'academy', 'elite', 'select', 'premier',
    'gold', 'blue', 'red', 'white', 'black', 'green', 'navy', 'united',
    'boys', 'girls', 'b', 'g', 'u11', 'u12', 'u13', 'u14', 'u15', 'u16', 'u17', 'u18',
    'the', 'of', 'and', 'team', 'youth',
  ]);

  // Extract tokens: alphanumeric sequences 2+ chars
  const tokens = name.toLowerCase()
    .match(/[a-z0-9]{2,}/g) || [];

  // Filter to distinctive tokens
  const distinctive = tokens.filter(t => {
    // Keep if not a stop word
    if (stopWords.has(t)) return false;
    // Keep year-like numbers (14, 15, 2014, 2015)
    if (/^\d{2}$/.test(t) || /^20\d{2}$/.test(t)) return true;
    // Keep tokens 3+ chars
    return t.length >= 3;
  });

  return distinctive;
}

/**
 * Escape special regex characters in string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Promote validated records to production tables
 */
async function promoteRecords(records, client, dryRun) {
  const startTime = Date.now();

  let toInsert = [];
  const toUpdate = [];
  const stagingIdsProcessed = [];
  const stagingIdsFailed = [];

  for (const record of records) {
    if (!record.isValid || !record.normalized) {
      stagingIdsFailed.push({
        id: record.stagingId,
        errors: record.validationErrors,
      });
      continue;
    }

    try {
      // UNIVERSAL: Pass original staging record for state inference
      const originalRecord = record.original;
      const sourcePlatform = originalRecord.source_platform;

      // Get or create teams
      const homeTeamData = record.resolved?.homeTeam || record.normalized.homeTeam;
      const awayTeamData = record.resolved?.awayTeam || record.normalized.awayTeam;

      // Check if we have pre-resolved team IDs from canonical registry
      let homeTeamId = homeTeamData?.team_v2_id;
      let awayTeamId = awayTeamData?.team_v2_id;

      // If not resolved from registry, find or create using UNIVERSAL fuzzy matching
      if (!homeTeamId) {
        homeTeamId = await findOrCreateTeam({
          canonical_name: homeTeamData?.canonical_name,
          display_name: record.normalized.homeTeam?.display_name,
          birth_year: record.normalized.homeTeam?.birth_year,
          gender: record.normalized.homeTeam?.gender,
        }, originalRecord, client);
      }

      if (!awayTeamId) {
        awayTeamId = await findOrCreateTeam({
          canonical_name: awayTeamData?.canonical_name,
          display_name: record.normalized.awayTeam?.display_name,
          birth_year: record.normalized.awayTeam?.birth_year,
          gender: record.normalized.awayTeam?.gender,
        }, originalRecord, client);
      }

      if (!homeTeamId || !awayTeamId) {
        stagingIdsFailed.push({
          id: record.stagingId,
          errors: ['Failed to create/find teams'],
        });
        continue;
      }

      // Same team check (fuzzy matching bug protection)
      if (homeTeamId === awayTeamId) {
        stagingIdsFailed.push({
          id: record.stagingId,
          errors: [`Same team matched for home and away: ${record.original.home_team_name} vs ${record.original.away_team_name}`],
        });
        stats.matchesSkipped++;
        continue;
      }

      // Get or create event
      const eventData = record.resolved?.event || record.normalized.event;
      const { league_id, tournament_id } = await findOrCreateEvent(eventData, sourcePlatform, client);

      // Build match record
      // CRITICAL: Keep NULL scores for scheduled matches - app uses NULL to identify
      // upcoming/unplayed matches vs actual 0-0 results. Per CLAUDE.md Principle 6.
      // Extract division tier from staging record (universal normalizer)
      const divisionTier = extractDivisionTier(
        record.original?.division,
        record.original?.raw_data
      );

      const matchRecord = {
        match_date: record.normalized.match.match_date,
        match_time: record.normalized.match.match_time,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        home_score: record.normalized.match.home_score,  // Keep NULL for scheduled
        away_score: record.normalized.match.away_score,  // Keep NULL for scheduled
        league_id,
        tournament_id,
        source_platform: sourcePlatform,
        source_match_key: record.normalized.match.source_match_key,
        division: divisionTier,
      };

      if (record.isDuplicate) {
        if (record.needsUpdate) {
          toUpdate.push({
            id: record.existingMatchId,
            ...matchRecord,
          });
        } else {
          stats.matchesSkipped++;
        }
      } else {
        toInsert.push(matchRecord);
      }

      stagingIdsProcessed.push(record.stagingId);
    } catch (error) {
      stagingIdsFailed.push({
        id: record.stagingId,
        errors: [`Promotion error: ${error.message}`],
      });
      stats.errors.push({ phase: 'promote', stagingId: record.stagingId, error: error.message });
    }
  }

  if (dryRun) {
    console.log(`\n🔍 DRY RUN - Would process:`);
    console.log(`   Insert: ${toInsert.length} matches`);
    console.log(`   Update: ${toUpdate.length} matches`);
    console.log(`   Skip: ${stats.matchesSkipped} (duplicates with same data)`);
    console.log(`   Fail: ${stagingIdsFailed.length} records`);
    return { inserted: 0, updated: 0, failed: stagingIdsFailed.length };
  }

  // Session 88: Pre-insert reverse match check (prevent reverse duplicates)
  if (toInsert.length > 0) {
    const reverseDates = toInsert.map(m => m.match_date);
    const reverseHomeIds = toInsert.map(m => m.away_team_id); // swapped
    const reverseAwayIds = toInsert.map(m => m.home_team_id); // swapped
    try {
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
        const beforeLen = toInsert.length;
        toInsert = toInsert.filter(m => {
          const key = `${m.match_date}|${m.away_team_id}|${m.home_team_id}`;
          return !reverseSet.has(key);
        });
        const skipped = beforeLen - toInsert.length;
        if (skipped > 0) {
          console.log(`   ↩️ Skipped ${skipped} reverse matches (already exist with swapped teams)`);
          stats.matchesSkipped += skipped;
        }
      }
    } catch (err) {
      console.error(`   ⚠️ Reverse match check failed: ${err.message}`);
    }
  }

  // Bulk insert new matches
  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += CONFIG.BATCH_SIZE) {
      const batch = toInsert.slice(i, i + CONFIG.BATCH_SIZE);

      const values = batch.map((_, idx) => {
        const offset = idx * 10;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`;
      }).join(', ');

      const params = batch.flatMap(m => [
        m.match_date,
        m.match_time,
        m.home_team_id,
        m.away_team_id,
        m.home_score,
        m.away_score,
        m.league_id,
        m.tournament_id,
        m.source_match_key,
        m.division,
      ]);

      try {
        // Session 85: Use semantic uniqueness (match_date, home_team_id, away_team_id)
        // This aligns with Universal SoccerView ID Architecture
        //
        // Conflict resolution:
        // - Scores: Prefer actual scores (non-NULL) over scheduled (NULL)
        // - Event links: Keep existing if present, else use new
        // - Source key: Keep existing (first source wins for audit trail)
        const { rowCount } = await client.query(`
          INSERT INTO matches_v2 (
            match_date, match_time, home_team_id, away_team_id,
            home_score, away_score, league_id, tournament_id, source_match_key, division
          )
          VALUES ${values}
          ON CONFLICT (match_date, home_team_id, away_team_id) DO UPDATE SET
            home_score = CASE
              WHEN EXCLUDED.home_score IS NOT NULL THEN EXCLUDED.home_score
              WHEN matches_v2.home_score IS DISTINCT FROM 0 OR matches_v2.away_score IS DISTINCT FROM 0
                THEN matches_v2.home_score
              ELSE EXCLUDED.home_score
            END,
            away_score = CASE
              WHEN EXCLUDED.away_score IS NOT NULL THEN EXCLUDED.away_score
              WHEN matches_v2.home_score IS DISTINCT FROM 0 OR matches_v2.away_score IS DISTINCT FROM 0
                THEN matches_v2.away_score
              ELSE EXCLUDED.away_score
            END,
            league_id = COALESCE(matches_v2.league_id, EXCLUDED.league_id),
            tournament_id = COALESCE(matches_v2.tournament_id, EXCLUDED.tournament_id),
            source_match_key = COALESCE(matches_v2.source_match_key, EXCLUDED.source_match_key),
            division = COALESCE(EXCLUDED.division, matches_v2.division)
        `, params);

        stats.matchesInserted += rowCount;
      } catch (error) {
        console.error(`   ⚠️ Batch insert error: ${error.message}`);
        stats.errors.push({ phase: 'insert', error: error.message });
      }
    }
  }

  // Update existing matches with new scores
  if (toUpdate.length > 0) {
    for (const match of toUpdate) {
      try {
        await client.query(`
          UPDATE matches_v2
          SET home_score = $1, away_score = $2
          WHERE id = $3
        `, [match.home_score, match.away_score, match.id]);

        stats.matchesUpdated++;
        logAudit('UPDATE', 'match', match.id, {
          action: 'score_update',
          new_home_score: match.home_score,
          new_away_score: match.away_score,
        });
      } catch (error) {
        console.error(`   ⚠️ Update error: ${error.message}`);
        stats.errors.push({ phase: 'update', matchId: match.id, error: error.message });
      }
    }
  }

  // Mark staging records as processed
  if (stagingIdsProcessed.length > 0) {
    await client.query(`
      UPDATE staging_games
      SET processed = true, processed_at = NOW()
      WHERE id = ANY($1)
    `, [stagingIdsProcessed]);
  }

  // Mark failed records with error messages
  for (const { id, errors } of stagingIdsFailed) {
    await client.query(`
      UPDATE staging_games
      SET processed = true, processed_at = NOW(), error_message = $1
      WHERE id = $2
    `, [errors.join('; '), id]);
  }

  stats.promoted = stagingIdsProcessed.length;
  stats.invalidRecords += stagingIdsFailed.length;
  stats.stepTimes.promote = (stats.stepTimes.promote || 0) + (Date.now() - startTime);

  return {
    inserted: stats.matchesInserted,
    updated: stats.matchesUpdated,
    failed: stagingIdsFailed.length,
  };
}

// ===========================================
// MAIN PROCESSING PIPELINE
// ===========================================

/**
 * Process all unprocessed staging records
 */
async function processStaging(options = {}) {
  const { limit = CONFIG.DEFAULT_LIMIT, dryRun = false, source = null } = options;

  console.log('\n🚀 UNIVERSAL DATA QUALITY ENGINE v1.0');
  console.log('=====================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}`);
  console.log(`Limit: ${limit}`);
  console.log(`Source filter: ${source || 'all'}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  stats.startTime = Date.now();

  // Initialize season year from database (dynamic, not hardcoded)
  try {
    const { rows: seasonRows } = await pool.query('SELECT year FROM seasons WHERE is_current = true LIMIT 1');
    const seasonYear = seasonRows[0]?.year || new Date().getFullYear();
    initSeasonYear(seasonYear);
    console.log(`📅 Season year: ${seasonYear} (from database)`);
  } catch (e) {
    console.log('   ⚠️ Could not load season year from DB, using default');
  }

  // ADAPTIVE LEARNING: Load learned patterns for normalizers
  // This enables pattern-based improvements from previous processing
  console.log('📚 Loading learned patterns...');
  await Promise.all([
    initTeamPatterns().catch(() => console.log('   ⚠️ Team patterns not available (table may not exist yet)')),
    initEventPatterns().catch(() => console.log('   ⚠️ Event patterns not available (table may not exist yet)')),
  ]);

  // Verify patterns are loaded (Session 79: Phase B2)
  try {
    const { rows: patternCounts } = await pool.query(`
      SELECT pattern_type, COUNT(*) as cnt
      FROM learned_patterns
      GROUP BY pattern_type
      ORDER BY pattern_type
    `);
    const total = patternCounts.reduce((sum, r) => sum + parseInt(r.cnt), 0);
    console.log(`   ✅ Loaded ${total} patterns:`);
    patternCounts.forEach(r => console.log(`      - ${r.pattern_type}: ${r.cnt}`));
    if (total === 0) {
      console.log('   ⚠️  No patterns loaded! Run: node scripts/universal/adaptiveLearning.js --learn-teams --source all');
    }
  } catch (e) {
    console.log('   ⚠️ Could not verify pattern counts:', e.message);
  }
  console.log('');

  const client = await pool.connect();

  try {
    // V2 ARCHITECTURE ENFORCEMENT: Authorize pipeline writes (Session 79)
    // This allows writes to teams_v2 and matches_v2 that are otherwise blocked
    await authorizePipelineWrite(client);

    // Fetch unprocessed staging records
    console.log('📋 Step 0: Fetching unprocessed staging records...');

    // Use DISTINCT ON to deduplicate staging records by source_match_key
    // This handles the issue where scrapers may insert duplicate records
    let query = `
      SELECT DISTINCT ON (source_match_key) *
      FROM staging_games
      WHERE processed = false
      ${source ? 'AND source_platform = $2' : ''}
      ORDER BY source_match_key, scraped_at DESC
      LIMIT $1
    `;

    const params = source ? [limit, source] : [limit];
    const { rows: stagingRecords } = await client.query(query, params);

    stats.stagingFetched = stagingRecords.length;
    console.log(`   Found ${stagingRecords.length} unprocessed records\n`);

    if (stagingRecords.length === 0) {
      console.log('✅ No unprocessed records to process');
      return;
    }

    // Process in batches
    const totalBatches = Math.ceil(stagingRecords.length / CONFIG.FETCH_SIZE);

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const batchStart = batchNum * CONFIG.FETCH_SIZE;
      const batchEnd = Math.min(batchStart + CONFIG.FETCH_SIZE, stagingRecords.length);
      const batch = stagingRecords.slice(batchStart, batchEnd);

      console.log(`\n📦 Processing batch ${batchNum + 1}/${totalBatches} (${batch.length} records)`);

      // STEP 1: Normalize
      console.log('   🔄 Step 1: Normalizing...');
      const normalized = normalizeRecords(batch);
      const validCount = normalized.filter(r => r.isValid).length;
      console.log(`      ✅ ${validCount} valid, ${batch.length - validCount} invalid`);

      // STEP 2: Resolve
      console.log('   🔍 Step 2: Resolving canonical entities...');
      const resolved = await resolveRecords(normalized, client);
      const resolvedFromRegistry = resolved.filter(r => r.resolved?.event?.from_registry).length;
      console.log(`      ✅ ${resolvedFromRegistry} resolved from registry`);

      // STEP 3: Deduplicate
      console.log('   🔎 Step 3: Checking for duplicates...');
      const deduplicated = await deduplicateMatches(resolved, client);
      const duplicates = deduplicated.filter(r => r.isDuplicate).length;
      console.log(`      ✅ ${duplicates} duplicates found`);

      // STEP 4: Promote
      console.log('   💾 Step 4: Promoting to production...');
      const result = await promoteRecords(deduplicated, client, dryRun);
      console.log(`      ✅ Inserted: ${result.inserted}, Updated: ${result.updated}, Failed: ${result.failed}`);

      // Progress update
      const progress = ((batchEnd / stagingRecords.length) * 100).toFixed(1);
      console.log(`   📊 Progress: ${progress}%`);
    }

    // Flush remaining audit logs
    await flushAuditLogs(client);

    // Refresh materialized views if we made changes
    if (!dryRun && (stats.matchesInserted > 0 || stats.matchesUpdated > 0)) {
      console.log('\n🔄 Refreshing materialized views...');
      await refreshViewsWithRetry(client);
    }

  } finally {
    client.release();
  }

  // Print summary
  printSummary();
}

/**
 * Generate audit report of recent quality actions
 */
async function generateAuditReport(options = {}) {
  const { days = 7 } = options;

  console.log(`\n📊 DATA QUALITY AUDIT REPORT (Last ${days} days)`);
  console.log('='.repeat(50));

  const client = await pool.connect();

  try {
    // Summary by action type
    const { rows: actionSummary } = await client.query(`
      SELECT action, COUNT(*) as count
      FROM audit_log
      WHERE changed_at > NOW() - INTERVAL '${days} days'
      GROUP BY action
      ORDER BY count DESC
    `);

    console.log('\nActions by type:');
    if (actionSummary.length === 0) {
      console.log('   (no recent actions)');
    } else {
      for (const row of actionSummary) {
        console.log(`   ${row.action}: ${row.count}`);
      }
    }

    // Summary by table type
    const { rows: tableSummary } = await client.query(`
      SELECT table_name, COUNT(*) as count
      FROM audit_log
      WHERE changed_at > NOW() - INTERVAL '${days} days'
      GROUP BY table_name
      ORDER BY count DESC
    `);

    console.log('\nActions by table:');
    if (tableSummary.length === 0) {
      console.log('   (no recent actions)');
    } else {
      for (const row of tableSummary) {
        console.log(`   ${row.table_name}: ${row.count}`);
      }
    }

    // Staging status
    const { rows: stagingStatus } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE processed = false) as unprocessed,
        COUNT(*) FILTER (WHERE processed = true AND error_message IS NULL) as success,
        COUNT(*) FILTER (WHERE processed = true AND error_message IS NOT NULL) as failed
      FROM staging_games
    `);

    console.log('\nStaging status:');
    console.log(`   Unprocessed: ${stagingStatus[0].unprocessed}`);
    console.log(`   Successful: ${stagingStatus[0].success}`);
    console.log(`   Failed: ${stagingStatus[0].failed}`);

    // Production counts
    const { rows: prodCounts } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM teams_v2) as teams,
        (SELECT COUNT(*) FROM matches_v2) as matches,
        (SELECT COUNT(*) FROM leagues) as leagues,
        (SELECT COUNT(*) FROM tournaments) as tournaments
    `);

    console.log('\nProduction tables:');
    console.log(`   Teams: ${prodCounts[0].teams}`);
    console.log(`   Matches: ${prodCounts[0].matches}`);
    console.log(`   Leagues: ${prodCounts[0].leagues}`);
    console.log(`   Tournaments: ${prodCounts[0].tournaments}`);

    // Canonical registry status
    const { rows: canonicalCounts } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM canonical_events) as events,
        (SELECT COUNT(*) FROM canonical_teams) as teams,
        (SELECT COUNT(*) FROM canonical_clubs) as clubs
    `);

    console.log('\nCanonical registries:');
    console.log(`   Events: ${canonicalCounts[0].events}`);
    console.log(`   Teams: ${canonicalCounts[0].teams}`);
    console.log(`   Clubs: ${canonicalCounts[0].clubs}`);

  } finally {
    client.release();
  }
}

/**
 * Print processing summary
 */
function printSummary() {
  const elapsed = Date.now() - stats.startTime;
  const rate = stats.stagingFetched > 0
    ? Math.round((stats.stagingFetched / elapsed) * 60000)
    : 0;

  console.log('\n' + '='.repeat(50));
  console.log('✅ DATA QUALITY ENGINE COMPLETE');
  console.log('='.repeat(50));

  console.log('\n📊 Processing Summary:');
  console.log(`   Records fetched: ${stats.stagingFetched}`);
  console.log(`   Records normalized: ${stats.normalized}`);
  console.log(`   Records resolved: ${stats.resolved}`);
  console.log(`   Records promoted: ${stats.promoted}`);

  console.log('\n👥 Teams:');
  console.log(`   Created: ${stats.teamsCreated}`);
  console.log(`   Linked: ${stats.teamsLinked}`);

  console.log('\n🏆 Events:');
  console.log(`   Created: ${stats.eventsCreated}`);
  console.log(`   Linked: ${stats.eventsLinked}`);

  console.log('\n⚽ Matches:');
  console.log(`   Inserted: ${stats.matchesInserted}`);
  console.log(`   Updated: ${stats.matchesUpdated}`);
  console.log(`   Skipped: ${stats.matchesSkipped}`);

  console.log('\n📈 Quality:');
  console.log(`   Valid: ${stats.validRecords}`);
  console.log(`   Invalid: ${stats.invalidRecords}`);
  console.log(`   Duplicates found: ${stats.duplicatesFound}`);

  console.log('\n📝 Audit:');
  console.log(`   Logs written: ${stats.auditLogsWritten}`);

  console.log('\n⏱️ Timing:');
  console.log(`   Total: ${Math.round(elapsed / 1000)}s`);
  console.log(`   Rate: ${rate} records/min`);
  if (stats.stepTimes.normalize) console.log(`   Normalize: ${stats.stepTimes.normalize}ms`);
  if (stats.stepTimes.resolve) console.log(`   Resolve: ${stats.stepTimes.resolve}ms`);
  if (stats.stepTimes.deduplicate) console.log(`   Deduplicate: ${stats.stepTimes.deduplicate}ms`);
  if (stats.stepTimes.promote) console.log(`   Promote: ${stats.stepTimes.promote}ms`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️ Errors: ${stats.errors.length}`);
    for (const err of stats.errors.slice(0, 5)) {
      console.log(`   - ${err.phase}: ${err.error}`);
    }
    if (stats.errors.length > 5) {
      console.log(`   ... and ${stats.errors.length - 5} more`);
    }
  }

  console.log(`\nCompleted: ${new Date().toISOString()}`);
}

// ===========================================
// CLI INTERFACE
// ===========================================

async function main() {
  const args = process.argv.slice(2);

  // Parse options
  const options = {
    limit: CONFIG.DEFAULT_LIMIT,
    dryRun: false,
    source: null,
    days: 7,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--source':
        options.source = args[++i];
        break;
      case '--days':
        options.days = parseInt(args[++i], 10);
        break;
    }
  }

  // Determine command
  if (args.includes('--process-staging')) {
    await processStaging(options);
  } else if (args.includes('--deduplicate-matches')) {
    console.log('⚠️ Match deduplication mode not yet implemented (Phase 4)');
  } else if (args.includes('--audit-report')) {
    await generateAuditReport(options);
  } else if (args.includes('--help') || args.length === 0) {
    console.log(`
Universal Data Quality Engine v1.0

Usage:
  node scripts/universal/dataQualityEngine.js [command] [options]

Commands:
  --process-staging     Process unprocessed staging records
  --deduplicate-matches Scan and deduplicate matches (Phase 4)
  --audit-report        Generate audit report

Options:
  --limit <n>           Max records to process (default: ${CONFIG.DEFAULT_LIMIT})
  --dry-run             Validate without inserting
  --source <platform>   Filter by source platform
  --days <n>            Days for audit report (default: 7)
  --help                Show this help

Examples:
  node scripts/universal/dataQualityEngine.js --process-staging
  node scripts/universal/dataQualityEngine.js --process-staging --dry-run --limit 1000
  node scripts/universal/dataQualityEngine.js --audit-report --days 30
`);
  } else {
    console.error('Unknown command. Use --help for usage.');
    process.exit(1);
  }

  // Cleanup
  await pool.end();
}

main().catch(error => {
  console.error('❌ FATAL:', error.message);
  console.error(error.stack);
  process.exit(1);
});
