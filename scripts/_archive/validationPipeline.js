/**
 * Validation Pipeline v1.1
 * ========================
 *
 * Processes staged data and moves it to production tables.
 * This is the critical component of the V2 three-layer architecture.
 *
 * PIPELINE FLOW:
 * 1. Read unprocessed records from staging_games
 * 2. Validate and transform the data
 * 3. Create/link teams in teams_v2
 * 4. Create/link events in leagues/tournaments
 * 5. Insert validated matches to matches_v2
 * 6. Mark staging records as processed
 * 7. Refresh materialized views
 *
 * Updated: January 28, 2026 (Session 53)
 * - Added dynamic season year from seasons table
 * - Added extractBirthYear with priority-based parsing
 * - Added birth year validation
 *
 * Usage:
 *   node scripts/validationPipeline.js                    # Process all unprocessed
 *   node scripts/validationPipeline.js --limit 1000      # Process max 1000 records
 *   node scripts/validationPipeline.js --source gotsport # Process specific source only
 *   node scripts/validationPipeline.js --dry-run         # Validate without inserting
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
  BATCH_SIZE: 500,
  DEFAULT_LIMIT: 10000,
};

// ===========================================
// SEASON YEAR - SINGLE SOURCE OF TRUTH
// ===========================================

let CURRENT_SEASON_YEAR = null;

/**
 * Get current season year from database (cached)
 * This is the SINGLE SOURCE OF TRUTH for age_group calculations.
 */
async function getSeasonYear() {
  if (CURRENT_SEASON_YEAR !== null) {
    return CURRENT_SEASON_YEAR;
  }

  try {
    const { data, error } = await supabase
      .from('seasons')
      .select('year')
      .eq('is_current', true)
      .single();

    if (!error && data?.year) {
      CURRENT_SEASON_YEAR = data.year;
      console.log(`📅 Season year loaded from DB: ${CURRENT_SEASON_YEAR}`);
      return CURRENT_SEASON_YEAR;
    }
  } catch (e) {
    console.warn('⚠️ Failed to fetch season year from DB, using fallback');
  }

  // Fallback calculation
  const now = new Date();
  const month = now.getMonth(); // 0-indexed (7 = August)
  CURRENT_SEASON_YEAR = month >= 7 ? now.getFullYear() + 1 : now.getFullYear();
  console.log(`📅 Season year (fallback): ${CURRENT_SEASON_YEAR}`);
  return CURRENT_SEASON_YEAR;
}

/**
 * Get birth year validation bounds based on season year
 */
function getBirthYearBounds(seasonYear) {
  return {
    MIN_BIRTH_YEAR: seasonYear - 19,  // U19 = oldest
    MAX_BIRTH_YEAR: seasonYear - 7,   // U7 = youngest
  };
}

// ===========================================
// SUPABASE CLIENT
// ===========================================

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===========================================
// STATS
// ===========================================

const stats = {
  gamesProcessed: 0,
  gamesValid: 0,
  gamesInvalid: 0,
  teamsCreated: 0,
  teamsLinked: 0,
  eventsCreated: 0,
  matchesInserted: 0,
  errors: 0,
  startTime: null,
};

// ===========================================
// TEAM PARSING - BIRTH YEAR EXTRACTION
// ===========================================

/**
 * Extract birth year from team name with priority-based parsing
 *
 * Priority order (highest to lowest):
 * 1. 4-digit year in name: "Sporting 2013B" → 2013
 * 2. 2-digit code after gender: "Rush B14" or "Rush 14G" → 2014
 * 3. Back-calculate from age group: "U12" + season 2026 → 2014
 * 4. Return null (let source data fill in later)
 *
 * @param {string} teamName - The team name to parse
 * @param {number} seasonYear - The current season year for age group conversion
 * @returns {object} { birthYear, birthYearSource }
 */
function extractBirthYear(teamName, seasonYear) {
  if (!teamName) return { birthYear: null, birthYearSource: 'unknown' };

  const name = teamName.trim();

  // Priority 1: Full 4-digit birth year (e.g., "Sporting 2013B", "KC Fusion 2015")
  const fullYearMatch = name.match(/\b(20[01]\d)\b/);
  if (fullYearMatch) {
    const year = parseInt(fullYearMatch[1], 10);
    const bounds = getBirthYearBounds(seasonYear);
    if (year >= bounds.MIN_BIRTH_YEAR && year <= bounds.MAX_BIRTH_YEAR) {
      return { birthYear: year, birthYearSource: 'parsed_4digit' };
    }
  }

  // Priority 2: 2-digit year after gender code (e.g., "B14", "G15", "14B", "15G")
  // Patterns: B2014, G2015, 2014B, 2015G, B14, G14, 14B, 14G
  const twoDigitPatterns = [
    /[BG](\d{2})(?![0-9])/i,      // B14, G15 (not followed by more digits)
    /(\d{2})[BG](?![0-9])/i,      // 14B, 15G (not followed by more digits)
  ];

  for (const pattern of twoDigitPatterns) {
    const match = name.match(pattern);
    if (match) {
      const twoDigit = parseInt(match[1], 10);
      // Convert 2-digit to 4-digit (00-30 = 2000-2030)
      const year = twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
      const bounds = getBirthYearBounds(seasonYear);
      if (year >= bounds.MIN_BIRTH_YEAR && year <= bounds.MAX_BIRTH_YEAR) {
        return { birthYear: year, birthYearSource: 'parsed_2digit' };
      }
    }
  }

  // Priority 3: Back-calculate from age group (e.g., "U12", "U-11", "U 13")
  const ageGroupMatch = name.match(/\bU[-\s]?(\d+)\b/i);
  if (ageGroupMatch) {
    const age = parseInt(ageGroupMatch[1], 10);
    if (age >= 7 && age <= 19) {
      const birthYear = seasonYear - age;
      return { birthYear, birthYearSource: 'parsed_age_group' };
    }
  }

  // Priority 4: No birth year found in name
  return { birthYear: null, birthYearSource: 'unknown' };
}

/**
 * Parse team metadata including birth year, gender, and canonical name
 *
 * @param {string} teamName - The raw team name
 * @param {number} seasonYear - The current season year
 * @returns {object} Team metadata
 */
function parseTeamMetadata(teamName, seasonYear) {
  if (!teamName) return {
    birthYear: null,
    birthYearSource: 'unknown',
    gender: null,
    genderSource: 'unknown',
    displayName: teamName,
    canonicalName: null,
    dataFlags: null,
  };

  const name = teamName.trim();

  // Extract birth year with priority parsing
  const { birthYear, birthYearSource } = extractBirthYear(name, seasonYear);

  // Validate birth year if found
  let dataFlags = null;
  if (birthYear !== null) {
    const bounds = getBirthYearBounds(seasonYear);
    if (birthYear < bounds.MIN_BIRTH_YEAR || birthYear > bounds.MAX_BIRTH_YEAR) {
      dataFlags = { invalid_birth_year: true, extracted_birth_year: birthYear };
    }
  }

  // Parse gender
  let gender = null;
  let genderSource = 'unknown';
  const lowerName = name.toLowerCase();

  // Check for explicit gender words
  if (lowerName.includes("boys") || lowerName.includes(" b ")) {
    gender = "M";
    genderSource = 'parsed_word';
  } else if (lowerName.includes("girls") || lowerName.includes(" g ")) {
    gender = "F";
    genderSource = 'parsed_word';
  }
  // Check for gender code (B/G followed by or preceding numbers)
  else if (/\bb\d/i.test(name) || /\d+b\b/i.test(name)) {
    gender = "M";
    genderSource = 'parsed_code';
  } else if (/\bg\d/i.test(name) || /\d+g\b/i.test(name)) {
    gender = "F";
    genderSource = 'parsed_code';
  }

  // Generate canonical name (lowercase, normalized)
  const canonicalName = name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return {
    birthYear,
    birthYearSource,
    gender,
    genderSource,
    displayName: name,
    canonicalName,
    dataFlags,
  };
}

function calculateDataQualityScore(team) {
  let score = 0;
  if (team.birth_year) score += 30;
  if (team.gender) score += 30;
  if (team.national_rank) score += 20;
  if (team.matches_played > 0) score += 10;
  if (team.elo_rating && team.elo_rating !== 1500) score += 10;
  return score;
}

// ===========================================
// TEAM MATCHING HELPERS
// ===========================================

/**
 * Infer state from source platform.
 * Default to "XX" (unknown) if we can't determine it.
 */
function inferStateFromSource(sourcePlatform) {
  const platformStateMap = {
    'heartland': 'KS',      // Heartland is Kansas-based
    'htgsports': 'KS',      // HTGSports hosts KC-area tournaments
    'gotsport': 'XX',       // GotSport is national - can't infer
    'demosphere': 'XX',
  };
  return platformStateMap[sourcePlatform?.toLowerCase()] || 'XX';
}

/**
 * Extract key identifying parts from a team name for fuzzy matching.
 * E.g., "sporting bv pre-nal 15" -> ["sporting", "bv", "pre", "nal", "15"]
 */
function extractTeamKeyParts(canonicalName) {
  if (!canonicalName) return [];

  // Split on spaces and hyphens, filter short/common words
  const parts = canonicalName
    .toLowerCase()
    .split(/[\s\-]+/)
    .filter(p => p.length >= 2)
    .filter(p => !['fc', 'sc', 'sa', 'u11', 'u12', 'u13', 'u14', 'u15', 'u16', 'u17', 'u18', 'u19', 'boys', 'girls'].includes(p));

  // Keep the most distinctive parts (numbers and longer words)
  const distinctive = parts.filter(p => /\d+/.test(p) || p.length >= 3);

  return distinctive.slice(0, 5); // Max 5 key parts
}

/**
 * Calculate a match score between input name and candidate name.
 * Returns 0-1 score based on how well they match.
 */
function calculateMatchScore(inputCanonical, candidateCanonical, metadata) {
  if (!inputCanonical || !candidateCanonical) return 0;

  let score = 0;

  // Check if input is contained in candidate (or vice versa)
  const inputParts = inputCanonical.split(/[\s\-]+/).filter(p => p.length >= 2);
  const candidateParts = candidateCanonical.split(/[\s\-]+/).filter(p => p.length >= 2);

  // Count matching parts
  let matchingParts = 0;
  for (const part of inputParts) {
    if (candidateParts.some(cp => cp.includes(part) || part.includes(cp))) {
      matchingParts++;
    }
  }

  // Score based on matching parts ratio
  score = matchingParts / Math.max(inputParts.length, 1);

  // Bonus for matching birth year (critical identifier)
  if (metadata.birthYear) {
    if (candidateCanonical.includes(metadata.birthYear.toString())) {
      score += 0.2;
    }
    // Check for age group match (e.g., "13" in name for birth year 2013)
    // Use season year for accurate age calculation
    const seasonYear = CURRENT_SEASON_YEAR || new Date().getFullYear();
    const ageFromBirthYear = (seasonYear - metadata.birthYear).toString();
    if (inputCanonical.includes(ageFromBirthYear) && candidateCanonical.includes(ageFromBirthYear)) {
      score += 0.1;
    }
  }

  // Bonus for number matches (team identifiers like "15", "2015")
  const inputNumbers = inputCanonical.match(/\d+/g) || [];
  const candidateNumbers = candidateCanonical.match(/\d+/g) || [];
  const numberMatches = inputNumbers.filter(n => candidateNumbers.includes(n)).length;
  if (inputNumbers.length > 0) {
    score += (numberMatches / inputNumbers.length) * 0.2;
  }

  return Math.min(score, 1.0); // Cap at 1.0
}

// ===========================================
// TEAM MANAGEMENT
// ===========================================

// Cache for team lookups to avoid repeated queries
const teamCache = new Map();

async function findOrCreateTeam(teamName, sourcePlatform) {
  if (!teamName) return null;

  const cacheKey = `${teamName}::${sourcePlatform}`;
  if (teamCache.has(cacheKey)) {
    return teamCache.get(cacheKey);
  }

  // Get season year (cached after first call)
  const seasonYear = await getSeasonYear();
  const metadata = parseTeamMetadata(teamName, seasonYear);

  // LEVEL 1: Try exact canonical name match
  let query = supabase
    .from("teams_v2")
    .select("id, canonical_name, display_name, birth_year, gender")
    .ilike("canonical_name", metadata.canonicalName)
    .limit(1);

  // Add birth_year filter if we have it
  if (metadata.birthYear) {
    query = query.eq("birth_year", metadata.birthYear);
  }

  let { data: existing, error: findError } = await query.maybeSingle();

  if (findError) {
    console.error(`   ⚠️ Team lookup error: ${findError.message}`);
    return null;
  }

  // LEVEL 2: If no exact match, try fuzzy/substring matching
  // This handles cases like "SPORTING BV Pre-NAL 15" matching "Sporting Blue Valley SPORTING BV Pre-NAL 15"
  if (!existing && metadata.canonicalName) {
    // Extract key identifying parts from the team name
    const keyParts = extractTeamKeyParts(metadata.canonicalName);

    if (keyParts.length > 0) {
      // Build a pattern that matches teams containing all key parts
      const fuzzyPattern = `%${keyParts.join('%')}%`;

      let fuzzyQuery = supabase
        .from("teams_v2")
        .select("id, canonical_name, display_name, birth_year, gender")
        .ilike("canonical_name", fuzzyPattern)
        .limit(5); // Get top candidates

      // Filter by birth_year if available (critical for matching)
      if (metadata.birthYear) {
        fuzzyQuery = fuzzyQuery.eq("birth_year", metadata.birthYear);
      }

      const { data: candidates } = await fuzzyQuery;

      if (candidates && candidates.length > 0) {
        // Score candidates and pick best match
        const scoredCandidates = candidates.map(c => ({
          ...c,
          score: calculateMatchScore(metadata.canonicalName, c.canonical_name, metadata)
        })).sort((a, b) => b.score - a.score);

        // Accept match if score is above threshold (60%)
        if (scoredCandidates[0].score >= 0.6) {
          existing = scoredCandidates[0];
        }
      }
    }
  }

  if (existing) {
    stats.teamsLinked++;
    teamCache.set(cacheKey, existing.id);
    return existing.id;
  }

  // Create new team
  // Infer state from source_platform
  const inferredState = inferStateFromSource(sourcePlatform);

  const newTeam = {
    canonical_name: metadata.canonicalName,
    display_name: metadata.displayName,
    birth_year: metadata.birthYear,
    gender: metadata.gender,
    birth_year_source: metadata.birthYearSource || "unknown",
    gender_source: metadata.genderSource || "unknown",
    state: inferredState, // Infer from source_platform
    elo_rating: 1500,
    matches_played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    data_quality_score: 0,
    data_flags: metadata.dataFlags || null,
  };

  newTeam.data_quality_score = calculateDataQualityScore(newTeam);

  const { data: created, error: createError } = await supabase
    .from("teams_v2")
    .insert(newTeam)
    .select("id")
    .single();

  if (createError) {
    // Could be a duplicate - try to find again
    if (createError.message.includes("duplicate") || createError.message.includes("unique")) {
      const { data: retry } = await query.maybeSingle();
      if (retry) {
        teamCache.set(cacheKey, retry.id);
        return retry.id;
      }
    }
    console.error(`   ⚠️ Team creation error: ${createError.message}`);
    return null;
  }

  stats.teamsCreated++;
  teamCache.set(cacheKey, created.id);
  return created.id;
}

// ===========================================
// EVENT MANAGEMENT
// ===========================================

const eventCache = new Map();

async function findOrCreateEvent(eventId, eventName, eventType, sourcePlatform) {
  if (!eventId && !eventName) return { leagueId: null, tournamentId: null };

  const cacheKey = `${eventId || eventName}::${sourcePlatform}`;
  if (eventCache.has(cacheKey)) {
    return eventCache.get(cacheKey);
  }

  const isLeague = eventType === "league" || (eventName && eventName.toLowerCase().includes("league"));
  const tableName = isLeague ? "leagues" : "tournaments";

  // Try to find existing event
  let findQuery = supabase
    .from(tableName)
    .select("id, name")
    .limit(1);

  if (eventId) {
    findQuery = findQuery.eq("source_event_id", eventId);
  } else {
    findQuery = findQuery.ilike("name", eventName);
  }

  const { data: existing, error: findError } = await findQuery.maybeSingle();

  if (findError && !findError.message.includes("multiple")) {
    console.error(`   ⚠️ Event lookup error: ${findError.message}`);
  }

  if (existing) {
    const result = isLeague
      ? { leagueId: existing.id, tournamentId: null }
      : { leagueId: null, tournamentId: existing.id };
    eventCache.set(cacheKey, result);
    return result;
  }

  // Create new event
  const newEvent = {
    name: eventName || `Unknown Event ${eventId}`,
    source_event_id: eventId,
    source_platform: sourcePlatform,
  };

  // Tournaments require start_date - use today as placeholder
  if (!isLeague) {
    newEvent.start_date = new Date().toISOString().split('T')[0];
    newEvent.end_date = new Date().toISOString().split('T')[0];
  }

  const { data: created, error: createError } = await supabase
    .from(tableName)
    .insert(newEvent)
    .select("id")
    .single();

  if (createError) {
    // Might be duplicate
    if (createError.message.includes("duplicate") || createError.message.includes("unique")) {
      const { data: retry } = await findQuery.maybeSingle();
      if (retry) {
        const result = isLeague
          ? { leagueId: retry.id, tournamentId: null }
          : { leagueId: null, tournamentId: retry.id };
        eventCache.set(cacheKey, result);
        return result;
      }
    }
    console.error(`   ⚠️ Event creation error: ${createError.message}`);
    return { leagueId: null, tournamentId: null };
  }

  stats.eventsCreated++;
  const result = isLeague
    ? { leagueId: created.id, tournamentId: null }
    : { leagueId: null, tournamentId: created.id };
  eventCache.set(cacheKey, result);
  return result;
}

// ===========================================
// VALIDATION
// ===========================================

function validateStagedGame(game) {
  const errors = [];

  // Required fields
  if (!game.home_team_name) errors.push("Missing home_team_name");
  if (!game.away_team_name) errors.push("Missing away_team_name");
  if (!game.match_date) errors.push("Missing match_date");

  // Same team check
  if (game.home_team_name && game.away_team_name &&
      game.home_team_name.toLowerCase() === game.away_team_name.toLowerCase()) {
    errors.push("Home and away team are the same");
  }

  // Valid date check
  if (game.match_date) {
    const date = new Date(game.match_date);
    if (isNaN(date.getTime())) {
      errors.push("Invalid match_date format");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ===========================================
// MAIN PROCESSING
// ===========================================

async function processUnprocessedGames(options = {}) {
  const { limit = CONFIG.DEFAULT_LIMIT, source = null, dryRun = false } = options;

  console.log("\n📋 Fetching unprocessed games from staging...");

  // Build query
  let query = supabase
    .from("staging_games")
    .select("*")
    .eq("processed", false)
    .order("scraped_at", { ascending: true })
    .limit(limit);

  if (source) {
    query = query.eq("source_platform", source);
  }

  const { data: stagedGames, error: fetchError } = await query;

  if (fetchError) {
    console.error("❌ Failed to fetch staged games:", fetchError.message);
    return;
  }

  console.log(`   Found ${stagedGames?.length || 0} unprocessed games\n`);

  if (!stagedGames || stagedGames.length === 0) {
    console.log("✅ No unprocessed games to process");
    return;
  }

  // Process in batches
  const validMatches = [];
  const invalidIds = [];

  for (const game of stagedGames) {
    stats.gamesProcessed++;

    // Validate
    const validation = validateStagedGame(game);

    if (!validation.isValid) {
      stats.gamesInvalid++;
      invalidIds.push({ id: game.id, errors: validation.errors });
      continue;
    }

    stats.gamesValid++;

    // Find or create teams
    const homeTeamId = await findOrCreateTeam(game.home_team_name, game.source_platform);
    const awayTeamId = await findOrCreateTeam(game.away_team_name, game.source_platform);

    if (!homeTeamId || !awayTeamId) {
      stats.gamesInvalid++;
      invalidIds.push({ id: game.id, errors: ["Failed to create/find teams"] });
      continue;
    }

    // Check for same team matched to both home and away (fuzzy matching bug)
    if (homeTeamId === awayTeamId) {
      stats.gamesInvalid++;
      invalidIds.push({
        id: game.id,
        errors: [`Same team matched for home and away: ${game.home_team_name} vs ${game.away_team_name}`]
      });
      continue;
    }

    // Find or create event
    const eventType = game.raw_data?.original?.status === "league" ? "league" :
                      game.event_name?.toLowerCase().includes("league") ? "league" : "tournament";
    const { leagueId, tournamentId } = await findOrCreateEvent(
      game.event_id,
      game.event_name,
      eventType,
      game.source_platform
    );

    // Build match record for matches_v2
    // CRITICAL: Keep NULL scores for scheduled matches - the app uses NULL to identify
    // upcoming/unplayed matches vs actual 0-0 results. Per CLAUDE.md Principle 6:
    // "Scheduled/future matches populate the Upcoming section."
    const match = {
      match_date: game.match_date,
      match_time: game.match_time,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      home_score: game.home_score,  // Keep NULL for scheduled matches
      away_score: game.away_score,  // Keep NULL for scheduled matches
      league_id: leagueId,
      tournament_id: tournamentId,
      venue_id: null, // Could be implemented later
      source_platform: game.source_platform,
      source_match_key: game.source_match_key,
    };

    validMatches.push({ match, stagingId: game.id });

    // Progress update
    if (stats.gamesProcessed % 100 === 0) {
      process.stdout.write(`   Processed ${stats.gamesProcessed}/${stagedGames.length}\r`);
    }
  }

  console.log(`\n   Validation complete: ${stats.gamesValid} valid, ${stats.gamesInvalid} invalid`);

  if (dryRun) {
    console.log("\n🔍 DRY RUN - No data inserted");
    console.log(`   Would insert ${validMatches.length} matches`);
    console.log(`   Would create ${stats.teamsCreated} teams`);
    console.log(`   Would create ${stats.eventsCreated} events`);
    return;
  }

  // Insert valid matches in batches
  if (validMatches.length > 0) {
    console.log(`\n💾 Inserting ${validMatches.length} matches to matches_v2...`);

    for (let i = 0; i < validMatches.length; i += CONFIG.BATCH_SIZE) {
      const batch = validMatches.slice(i, i + CONFIG.BATCH_SIZE);
      const matchesToInsert = batch.map(b => b.match);
      const stagingIds = batch.map(b => b.stagingId);

      try {
        const { data, error } = await supabase
          .from("matches_v2")
          .upsert(matchesToInsert, {
            onConflict: "source_match_key",
            ignoreDuplicates: false,
          })
          .select("id");

        if (error) {
          console.error(`   ❌ Batch insert error: ${error.message}`);
          stats.errors++;
        } else {
          stats.matchesInserted += data?.length || 0;

          // Mark staging records as processed
          await supabase
            .from("staging_games")
            .update({ processed: true, processed_at: new Date().toISOString() })
            .in("id", stagingIds);
        }
      } catch (error) {
        console.error(`   ❌ Insert error: ${error.message}`);
        stats.errors++;
      }

      process.stdout.write(`   Inserted ${Math.min(i + CONFIG.BATCH_SIZE, validMatches.length)}/${validMatches.length}\r`);
    }
    console.log();
  }

  // Mark invalid records with error messages
  if (invalidIds.length > 0) {
    console.log(`\n⚠️ Marking ${invalidIds.length} invalid records...`);
    for (const { id, errors } of invalidIds) {
      await supabase
        .from("staging_games")
        .update({
          processed: true,
          processed_at: new Date().toISOString(),
          error_message: errors.join("; "),
        })
        .eq("id", id);
    }
  }
}

// ===========================================
// PROCESS STAGED EVENTS
// ===========================================

async function processUnprocessedEvents() {
  console.log("\n📋 Processing staged events...");

  const { data: stagedEvents, error } = await supabase
    .from("staging_events")
    .select("*")
    .eq("processed", false)
    .limit(500);

  if (error) {
    console.error("❌ Failed to fetch staged events:", error.message);
    return;
  }

  if (!stagedEvents || stagedEvents.length === 0) {
    console.log("   No unprocessed events");
    return;
  }

  console.log(`   Found ${stagedEvents.length} unprocessed events`);

  for (const event of stagedEvents) {
    await findOrCreateEvent(
      event.source_event_id,
      event.event_name,
      event.event_type || "tournament",
      event.source_platform
    );

    // Mark as processed
    await supabase
      .from("staging_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("id", event.id);
  }

  console.log(`   ✅ Processed ${stagedEvents.length} events`);
}

// ===========================================
// REFRESH VIEWS
// ===========================================

async function refreshMaterializedViews() {
  console.log("\n🔄 Refreshing materialized views...");

  try {
    // Call the refresh function
    const { error } = await supabase.rpc("refresh_app_views");

    if (error) {
      console.error(`   ⚠️ View refresh error: ${error.message}`);
      console.log("   Attempting individual refreshes...");

      // Try individual refreshes
      const views = [
        "app_rankings",
        "app_team_profile",
        "app_matches_feed",
        "app_league_standings",
        "app_upcoming_schedule",
      ];

      for (const view of views) {
        const { error: viewError } = await supabase.rpc("refresh_materialized_view", { view_name: view });
        if (viewError) {
          console.error(`   ⚠️ Failed to refresh ${view}: ${viewError.message}`);
        } else {
          console.log(`   ✅ Refreshed ${view}`);
        }
      }
    } else {
      console.log("   ✅ All views refreshed successfully");
    }
  } catch (error) {
    console.error(`   ❌ View refresh failed: ${error.message}`);
  }
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log("🔄 Validation Pipeline v1.0");
  console.log("===========================");

  // Parse arguments
  const args = process.argv.slice(2);
  const limit = args.includes("--limit")
    ? parseInt(args[args.indexOf("--limit") + 1], 10)
    : CONFIG.DEFAULT_LIMIT;
  const source = args.includes("--source")
    ? args[args.indexOf("--source") + 1]
    : null;
  const dryRun = args.includes("--dry-run");

  console.log(`Limit: ${limit}`);
  console.log(`Source filter: ${source || "all"}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  stats.startTime = Date.now();

  // Process events first (they're referenced by matches)
  await processUnprocessedEvents();

  // Process games
  await processUnprocessedGames({ limit, source, dryRun });

  // Refresh views
  if (!dryRun && stats.matchesInserted > 0) {
    await refreshMaterializedViews();
  }

  // Summary
  const elapsed = Date.now() - stats.startTime;
  console.log("\n" + "=".repeat(50));
  console.log("✅ PIPELINE COMPLETE");
  console.log("=".repeat(50));
  console.log(`   Games processed: ${stats.gamesProcessed}`);
  console.log(`   Games valid: ${stats.gamesValid}`);
  console.log(`   Games invalid: ${stats.gamesInvalid}`);
  console.log(`   Teams created: ${stats.teamsCreated}`);
  console.log(`   Teams linked: ${stats.teamsLinked}`);
  console.log(`   Events created: ${stats.eventsCreated}`);
  console.log(`   Matches inserted: ${stats.matchesInserted}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log(`   Runtime: ${Math.round(elapsed / 1000)}s`);
  console.log(`   Completed: ${new Date().toISOString()}`);
}

main().catch(error => {
  console.error("❌ FATAL:", error.message);
  process.exit(1);
});
