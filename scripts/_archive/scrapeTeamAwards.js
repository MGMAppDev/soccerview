/**
 * Team-Centric GotSport Scraper
 *
 * Fetches match awards/results for teams using their GotSport ranking ID.
 * This discovers events and match outcomes for all 115,814 teams in our database.
 *
 * API Endpoints:
 * - https://system.gotsport.com/api/v1/ranking_team_awards?team_id={gotsport_team_id}
 * - https://system.gotsport.com/api/v1/team_ranking_data/team_details?team_id={gotsport_team_id}
 *
 * Usage:
 *   node scripts/scrapeTeamAwards.js --batch 1000 --offset 0
 *   node scripts/scrapeTeamAwards.js --team-id 91961  # Single team test
 *   node scripts/scrapeTeamAwards.js --discover-events  # Extract unique event IDs
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name, defaultValue = null) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : defaultValue;
};
const hasFlag = (name) => args.includes(`--${name}`);

const BATCH_SIZE = parseInt(getArg("batch", "100"));
const OFFSET = parseInt(getArg("offset", "0"));
const SINGLE_TEAM_ID = getArg("team-id");
const DISCOVER_EVENTS = hasFlag("discover-events");
const DRY_RUN = hasFlag("dry-run");
const DELAY_MS = parseInt(getArg("delay", "200")); // Delay between API calls

/**
 * Fetch team awards from GotSport API
 */
async function fetchTeamAwards(gotsportRankingId) {
  const url = `https://system.gotsport.com/api/v1/ranking_team_awards?team_id=${gotsportRankingId}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.error(`❌ HTTP ${response.status} for team ${gotsportRankingId}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(
      `❌ Error fetching team ${gotsportRankingId}:`,
      error.message,
    );
    return null;
  }
}

/**
 * Fetch team details from GotSport API
 */
async function fetchTeamDetails(gotsportRankingId) {
  const url = `https://system.gotsport.com/api/v1/team_ranking_data/team_details?team_id=${gotsportRankingId}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    return null;
  }
}

/**
 * Extract scheduled match from team details next_match field
 */
function extractScheduledMatch(details) {
  if (!details || !details.next_match) return null;

  const match = details.next_match;

  return {
    match_id: match.id,
    event_id: match.homeTeam?.event_id || match.awayTeam?.event_id,
    match_date: match.match_date,
    match_time: match.start,
    home_team_name: match.homeTeam?.full_name,
    home_team_gotsport_team_id: match.homeTeam?.team_id,
    away_team_name: match.awayTeam?.full_name,
    away_team_gotsport_team_id: match.awayTeam?.team_id,
    venue_name: match.venue?.name,
    venue_id: match.venue?.id,
    status: "scheduled",
    source_platform: "gotsport_team_details",
  };
}

/**
 * Extract match data from awards response
 */
function extractMatchData(awards, teamId, teamName) {
  const matches = [];
  const events = new Set();

  if (!awards || !awards.current) return { matches, events: [] };

  for (const award of awards.current) {
    // Track event IDs for discovery
    if (award.event && award.event.id) {
      events.add(
        JSON.stringify({
          event_id: award.event.id,
          event_name: award.event.name,
          is_league: award.event.league,
          is_tournament: award.event.tournament,
          city: award.event.city,
          state: award.event.state,
        }),
      );
    }

    // Extract match outcomes
    if (award.award_type && award.award_type.startsWith("MATCH_")) {
      const outcome = award.award_type.replace("MATCH_", "").toLowerCase(); // win, draw, loss

      matches.push({
        team_id: teamId,
        team_name: teamName,
        gotsport_team_id: award.id,
        match_date: award.match_date,
        outcome: outcome, // 'win', 'draw', 'loss'
        bonus_points: award.bonus_points,
        event_id: award.event?.id,
        event_name: award.event?.name,
        is_league: award.event?.league || false,
        is_tournament: award.event?.tournament || false,
        source_platform: "gotsport_awards",
      });
    }
  }

  return {
    matches,
    events: Array.from(events).map((e) => JSON.parse(e)),
  };
}

/**
 * Get teams from database with gotsport_team_id
 */
async function getTeamsWithRankingId(limit, offset) {
  const { data, error, count } = await supabase
    .from("team_elo")
    .select("id, team_name, gotsport_team_id, age_group, gender, state", {
      count: "exact",
    })
    .not("gotsport_team_id", "is", null)
    .order("gotsport_team_id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("❌ Error fetching teams:", error.message);
    return { teams: [], total: 0 };
  }

  return { teams: data, total: count };
}

/**
 * Save discovered events to event_registry
 */
async function saveDiscoveredEvents(events) {
  if (events.length === 0) return 0;

  const eventRows = events.map((e) => ({
    event_id: e.event_id,
    event_name: e.event_name,
    source_platform: "gotsport",
    source_type: e.is_tournament ? "tournament" : "league",
    state: e.state,
    scrape_status: "discovered",
    priority: e.is_league ? "high" : "medium",
  }));

  const { data, error } = await supabase
    .from("event_registry")
    .upsert(eventRows, { onConflict: "event_id", ignoreDuplicates: true });

  if (error) {
    console.error("❌ Error saving events:", error.message);
    return 0;
  }

  return eventRows.length;
}

/**
 * Save team match outcomes to a new table
 */
async function saveTeamMatchOutcomes(outcomes) {
  if (outcomes.length === 0) return 0;

  // For now, just log - we can create a table for this later
  console.log(`📊 Would save ${outcomes.length} match outcomes`);
  return outcomes.length;
}

/**
 * Save scheduled matches to match_results table
 */
async function saveScheduledMatches(matches) {
  if (matches.length === 0) return 0;

  const matchRows = matches.map((m) => ({
    event_id: m.event_id?.toString(),
    match_number: m.match_id?.toString(),
    match_date: m.match_date,
    home_team_name: m.home_team_name,
    away_team_name: m.away_team_name,
    home_score: null,
    away_score: null,
    status: "scheduled",
    location: m.venue_name,
    source_platform: "gotsport",
    source_type: "scheduled",
  }));

  const { data, error } = await supabase
    .from("match_results")
    .upsert(matchRows, {
      onConflict: "event_id,match_number",
      ignoreDuplicates: false,
    });

  if (error) {
    console.error("❌ Error saving scheduled matches:", error.message);
    return 0;
  }

  return matchRows.length;
}

/**
 * Process a single team
 */
async function processTeam(team) {
  console.log(
    `\n🔍 Processing: ${team.team_name} (ID: ${team.gotsport_team_id})`,
  );

  // Fetch awards AND details in parallel
  const [awards, details] = await Promise.all([
    fetchTeamAwards(team.gotsport_team_id),
    fetchTeamDetails(team.gotsport_team_id),
  ]);

  if (!awards && !details) {
    return { matches: 0, events: 0, scheduled: 0, error: true };
  }

  // Extract past match data
  const { matches, events } = extractMatchData(awards, team.id, team.team_name);

  // Extract scheduled match
  const scheduledMatch = extractScheduledMatch(details);

  console.log(
    `   ✅ Found ${matches.length} past matches, ${events.length} unique events`,
  );
  if (scheduledMatch) {
    console.log(
      `   📅 Next match: ${scheduledMatch.match_date} vs ${scheduledMatch.away_team_name || scheduledMatch.home_team_name}`,
    );
  }

  // Show sample events
  if (events.length > 0 && !DRY_RUN) {
    console.log(
      `   📋 Events: ${events
        .slice(0, 3)
        .map((e) => e.event_name)
        .join(", ")}${events.length > 3 ? "..." : ""}`,
    );
  }

  return {
    matches: matches.length,
    events,
    scheduled: scheduledMatch ? 1 : 0,
    scheduledMatch,
    error: false,
  };
}

/**
 * Main execution
 */
async function main() {
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log("🏆 TEAM-CENTRIC GOTSPORT SCRAPER");
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log(`📊 Batch size: ${BATCH_SIZE}, Offset: ${OFFSET}`);
  console.log(`⏱️  Delay between requests: ${DELAY_MS}ms`);
  console.log(`${DRY_RUN ? "🧪 DRY RUN MODE" : "💾 LIVE MODE"}`);
  console.log(
    "───────────────────────────────────────────────────────────────\n",
  );

  // Single team test mode
  if (SINGLE_TEAM_ID) {
    console.log(`🔬 Testing single team: ${SINGLE_TEAM_ID}\n`);

    const awards = await fetchTeamAwards(SINGLE_TEAM_ID);
    const details = await fetchTeamDetails(SINGLE_TEAM_ID);

    console.log("\n📋 TEAM DETAILS:");
    if (details) {
      console.log(`   Name: ${details.name}`);
      console.log(`   Club: ${details.club_name}`);
      console.log(`   State: ${details.state}`);
      console.log(`   Age: U${details.age}`);
      console.log(`   Gender: ${details.gender === "m" ? "Boys" : "Girls"}`);
      if (details.rankings_data) {
        console.log(
          `   National Rank: #${details.rankings_data.national_rank}`,
        );
        console.log(`   Total Points: ${details.rankings_data.total_points}`);
        console.log(
          `   W/L/D: ${details.rankings_data.total_wins}-${details.rankings_data.total_losses}-${details.rankings_data.total_draws}`,
        );
      }
      if (details.next_match) {
        console.log(`   Next Match: ${JSON.stringify(details.next_match)}`);
      }
    }

    console.log("\n📊 MATCH AWARDS:");
    if (awards && awards.current) {
      console.log(`   Total awards: ${awards.current.length}`);

      // Count match outcomes
      const wins = awards.current.filter(
        (a) => a.award_type === "MATCH_WIN",
      ).length;
      const draws = awards.current.filter(
        (a) => a.award_type === "MATCH_DRAW",
      ).length;
      const losses = awards.current.filter(
        (a) => a.award_type === "MATCH_LOSS",
      ).length;
      const placements = awards.current.filter((a) =>
        a.award_type?.includes("PLACE"),
      ).length;

      console.log(`   Match Wins: ${wins}`);
      console.log(`   Match Draws: ${draws}`);
      console.log(`   Match Losses: ${losses}`);
      console.log(`   Placements: ${placements}`);

      // Show unique events
      const events = new Map();
      awards.current.forEach((a) => {
        if (a.event && a.event.id) {
          events.set(a.event.id, {
            name: a.event.name,
            type: a.event.league ? "League" : "Tournament",
            state: a.event.state,
          });
        }
      });

      console.log(`\n📋 UNIQUE EVENTS (${events.size}):`);
      for (const [id, event] of events) {
        console.log(`   [${id}] ${event.name} (${event.type}, ${event.state})`);
      }

      // Show sample matches
      console.log("\n📋 RECENT MATCHES (last 5):");
      const recentMatches = awards.current
        .filter((a) => a.award_type?.startsWith("MATCH_"))
        .slice(0, 5);

      for (const match of recentMatches) {
        const outcome = match.award_type.replace("MATCH_", "");
        const date = match.match_date?.split("T")[0] || "Unknown";
        console.log(
          `   ${date}: ${outcome} in ${match.event?.name || "Unknown event"} (+${match.bonus_points} pts)`,
        );
      }
    } else {
      console.log("   No awards data found");
    }

    return;
  }

  // Batch processing mode
  const { teams, total } = await getTeamsWithRankingId(BATCH_SIZE, OFFSET);

  console.log(`📊 Found ${total} teams with GotSport ranking IDs`);
  console.log(`📦 Processing batch: ${OFFSET} to ${OFFSET + teams.length}\n`);

  let totalMatches = 0;
  let totalEvents = 0;
  let totalScheduled = 0;
  let allDiscoveredEvents = new Map();
  let allScheduledMatches = [];
  let processedCount = 0;
  let errorCount = 0;

  for (const team of teams) {
    const result = await processTeam(team);

    if (result.error) {
      errorCount++;
    } else {
      totalMatches += result.matches;
      totalScheduled += result.scheduled;

      // Track unique events
      for (const event of result.events) {
        allDiscoveredEvents.set(event.event_id, event);
      }

      // Track scheduled matches
      if (result.scheduledMatch) {
        allScheduledMatches.push(result.scheduledMatch);
      }
    }

    processedCount++;

    // Progress update every 10 teams
    if (processedCount % 10 === 0) {
      console.log(
        `\n📈 Progress: ${processedCount}/${teams.length} teams, ${allDiscoveredEvents.size} events, ${allScheduledMatches.length} scheduled matches\n`,
      );
    }

    // Delay between requests
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  // Summary
  console.log(
    "\n═══════════════════════════════════════════════════════════════",
  );
  console.log("📊 SUMMARY");
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log(`✅ Teams processed: ${processedCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`🏟️  Total past matches found: ${totalMatches}`);
  console.log(`📅 Scheduled matches found: ${allScheduledMatches.length}`);
  console.log(`📋 Unique events discovered: ${allDiscoveredEvents.size}`);

  // Save discovered events if not dry run
  if (!DRY_RUN && allDiscoveredEvents.size > 0) {
    console.log("\n💾 Saving discovered events to event_registry...");
    const saved = await saveDiscoveredEvents(
      Array.from(allDiscoveredEvents.values()),
    );
    console.log(`✅ Saved ${saved} events`);
  }

  // Save scheduled matches if not dry run
  if (!DRY_RUN && allScheduledMatches.length > 0) {
    console.log("\n💾 Saving scheduled matches to match_results...");
    const saved = await saveScheduledMatches(allScheduledMatches);
    console.log(`✅ Saved ${saved} scheduled matches`);
  }

  // List discovered events
  if (allDiscoveredEvents.size > 0) {
    console.log("\n📋 DISCOVERED EVENTS:");
    const eventsList = Array.from(allDiscoveredEvents.values());
    for (const event of eventsList.slice(0, 20)) {
      const type = event.is_tournament ? "🏆" : "📅";
      console.log(
        `   ${type} [${event.event_id}] ${event.event_name} (${event.state || "Unknown"})`,
      );
    }
    if (eventsList.length > 20) {
      console.log(`   ... and ${eventsList.length - 20} more events`);
    }
  }

  // List scheduled matches
  if (allScheduledMatches.length > 0) {
    console.log("\n📅 UPCOMING SCHEDULED MATCHES:");
    // Sort by date
    const sortedMatches = allScheduledMatches
      .filter((m) => m.match_date)
      .sort((a, b) => new Date(a.match_date) - new Date(b.match_date));

    for (const match of sortedMatches.slice(0, 15)) {
      const date = match.match_date?.split("T")[0] || "TBD";
      console.log(
        `   ${date}: ${match.home_team_name} vs ${match.away_team_name}`,
      );
      if (match.venue_name) {
        console.log(`           📍 ${match.venue_name}`);
      }
    }
    if (sortedMatches.length > 15) {
      console.log(
        `   ... and ${sortedMatches.length - 15} more scheduled matches`,
      );
    }
  }

  console.log(
    "\n═══════════════════════════════════════════════════════════════",
  );
  console.log("✅ COMPLETE");
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );

  // Suggest next steps
  if (allDiscoveredEvents.size > 0) {
    const newEventIds = Array.from(allDiscoveredEvents.keys())
      .slice(0, 10)
      .join(", ");
    console.log(`\n💡 Next: Scrape discovered events with:`);
    console.log(
      `   node scripts/scrapeMatches.js --event-id ${Array.from(allDiscoveredEvents.keys())[0]}`,
    );
  }
}

main().catch(console.error);
