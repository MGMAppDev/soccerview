/**
 * Validation Pipeline v1.0
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
// TEAM PARSING
// ===========================================

function parseTeamMetadata(teamName) {
  if (!teamName) return { birthYear: null, gender: null, displayName: teamName };

  const name = teamName.trim();

  // Parse birth year (4-digit year like 2015, 2016)
  let birthYear = null;
  const yearMatch = name.match(/\b(20[01]\d)\b/);
  if (yearMatch) {
    birthYear = parseInt(yearMatch[1], 10);
  } else {
    // Try U-age format
    const uMatch = name.match(/\bU[-]?(\d+)\b/i);
    if (uMatch) {
      const age = parseInt(uMatch[1], 10);
      const currentYear = new Date().getFullYear();
      birthYear = currentYear - age;
    }
  }

  // Parse gender
  let gender = null;
  const lowerName = name.toLowerCase();
  if (lowerName.includes("boys") || lowerName.includes(" b ") || /\bb\d/i.test(name) || /\d+b\b/i.test(name)) {
    gender = "M";
  } else if (lowerName.includes("girls") || lowerName.includes(" g ") || /\bg\d/i.test(name) || /\d+g\b/i.test(name)) {
    gender = "F";
  }

  // Generate canonical name (lowercase, normalized)
  const canonicalName = name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return {
    birthYear,
    gender,
    displayName: name,
    canonicalName,
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

  const metadata = parseTeamMetadata(teamName);

  // Try to find existing team by canonical name and metadata
  let query = supabase
    .from("teams_v2")
    .select("id, canonical_name, display_name, birth_year, gender")
    .ilike("canonical_name", metadata.canonicalName)
    .limit(1);

  // Add birth_year filter if we have it
  if (metadata.birthYear) {
    query = query.eq("birth_year", metadata.birthYear);
  }

  const { data: existing, error: findError } = await query.maybeSingle();

  if (findError) {
    console.error(`   ⚠️ Team lookup error: ${findError.message}`);
    return null;
  }

  if (existing) {
    stats.teamsLinked++;
    teamCache.set(cacheKey, existing.id);
    return existing.id;
  }

  // Create new team
  const newTeam = {
    canonical_name: metadata.canonicalName,
    display_name: metadata.displayName,
    birth_year: metadata.birthYear,
    gender: metadata.gender,
    birth_year_source: metadata.birthYear ? "parsed" : "unknown",
    gender_source: metadata.gender ? "parsed" : "unknown",
    state: null, // Could be inferred from source_platform
    elo_rating: 1500,
    matches_played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    data_quality_score: 0,
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
    const match = {
      match_date: game.match_date,
      match_time: game.match_time,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      home_score: game.home_score,
      away_score: game.away_score,
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
