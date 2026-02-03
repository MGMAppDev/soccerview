/**
 * Adaptive Learning Engine v1.0
 * ==============================
 *
 * FUTURE-PROOFING: Learns patterns from data to improve over time.
 *
 * Learning Types:
 * 1. Team Name Patterns - Learn club prefixes, suffixes, birth year formats
 * 2. Event Patterns - Learn naming conventions for leagues vs tournaments
 * 3. Match Key Patterns - Learn source-specific key formats
 * 4. Success Metrics - Track what works for each source
 *
 * Storage: learned_patterns table in database
 *
 * @version 1.0.0
 * @date January 2026
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===========================================
// CIRCUIT BREAKER FOR PATTERN STORAGE
// Prevents cascading failures when Supabase has issues
// ===========================================

const circuitBreaker = {
  failures: 0,
  lastFailure: null,
  isOpen: false,
  FAILURE_THRESHOLD: 5,     // Open circuit after 5 failures
  RESET_TIMEOUT: 60000,     // Try again after 1 minute
  errorLogged: false,       // Only log circuit open once
};

function checkCircuitBreaker() {
  if (!circuitBreaker.isOpen) return true;

  // Check if enough time has passed to try again
  const timeSinceFailure = Date.now() - circuitBreaker.lastFailure;
  if (timeSinceFailure >= circuitBreaker.RESET_TIMEOUT) {
    circuitBreaker.isOpen = false;
    circuitBreaker.failures = 0;
    circuitBreaker.errorLogged = false;
    console.log('🔄 Adaptive learning circuit breaker reset - resuming pattern storage');
    return true;
  }

  return false;
}

function recordCircuitFailure() {
  circuitBreaker.failures++;
  circuitBreaker.lastFailure = Date.now();

  if (circuitBreaker.failures >= circuitBreaker.FAILURE_THRESHOLD && !circuitBreaker.isOpen) {
    circuitBreaker.isOpen = true;
    if (!circuitBreaker.errorLogged) {
      console.log('⚠️ Adaptive learning circuit breaker OPEN - skipping pattern storage for 60s');
      circuitBreaker.errorLogged = true;
    }
  }
}

// ===========================================
// PATTERN STORAGE
// ===========================================

/**
 * Store a learned pattern in the database
 * Uses circuit breaker to prevent cascading failures
 *
 * @param {string} patternType - 'team_name' | 'event_name' | 'match_key' | 'selector'
 * @param {string} source - Adapter ID (gotsport, htgsports, heartland, etc.)
 * @param {object} pattern - The learned pattern data
 * @param {number} confidence - 0.0 to 1.0
 */
async function storeLearnedPattern(patternType, source, pattern, confidence) {
  // Check circuit breaker - skip if open
  if (!checkCircuitBreaker()) {
    return; // Silently skip when circuit is open
  }

  try {
    const { error } = await supabase
      .from("learned_patterns")
      .upsert({
        pattern_type: patternType,
        source: source,
        pattern_data: pattern,
        confidence: confidence,
        learned_at: new Date().toISOString(),
        usage_count: 1,
      }, {
        onConflict: "pattern_type,source,pattern_data",
      });

    if (error) {
      recordCircuitFailure();
      // Only log first few failures to avoid spam
      if (circuitBreaker.failures <= 3) {
        console.error("Failed to store pattern:", error.message);
      }
    } else {
      // Success - reset failure count
      circuitBreaker.failures = 0;
    }
  } catch (err) {
    recordCircuitFailure();
    if (circuitBreaker.failures <= 3) {
      console.error("Failed to store pattern:", err.message);
    }
  }
}

/**
 * Retrieve learned patterns for a source
 * @param {string} patternType
 * @param {string} source - Use 'all' to get patterns from all sources
 * @returns {Promise<Array>}
 */
async function getLearnedPatterns(patternType, source) {
  let query = supabase
    .from("learned_patterns")
    .select("*")
    .eq("pattern_type", patternType)
    .gte("confidence", 0.3) // Only return patterns with reasonable confidence
    .order("confidence", { ascending: false });

  // Filter by source unless 'all' is specified
  if (source && source !== 'all') {
    query = query.eq("source", source);
  }

  const { data, error } = await query;

  return error ? [] : data;
}

// ===========================================
// TEAM NAME PATTERN LEARNING
// ===========================================

/**
 * Learn team naming patterns from successful team creations
 *
 * Patterns learned:
 * - Club name prefixes (e.g., "FC ", "SC ", "United ")
 * - Birth year formats (e.g., "2013", "B2013", "U11")
 * - Gender indicators (e.g., "Boys", "Girls", " B ", " G ")
 * - Color/level suffixes (e.g., "Blue", "White", "Premier")
 */
async function learnTeamNamePatterns(source, teamNames) {
  const patterns = {
    clubPrefixes: new Map(),    // e.g., "Sporting" -> 45 occurrences
    birthYearFormats: new Map(), // e.g., "2013" -> 120, "U11" -> 80
    genderIndicators: new Map(), // e.g., "Boys" -> 100, " B " -> 50
    suffixes: new Map(),        // e.g., "Blue" -> 30, "Premier" -> 20
  };

  for (const name of teamNames) {
    // Learn club prefixes (first word)
    const firstWord = name.split(/\s+/)[0];
    if (firstWord.length >= 3) {
      patterns.clubPrefixes.set(firstWord, (patterns.clubPrefixes.get(firstWord) || 0) + 1);
    }

    // Learn birth year formats
    const yearMatch = name.match(/\b(20[0-2]\d)\b/);
    if (yearMatch) {
      patterns.birthYearFormats.set("YYYY", (patterns.birthYearFormats.get("YYYY") || 0) + 1);
    }
    const uMatch = name.match(/U-?(\d{1,2})/i);
    if (uMatch) {
      patterns.birthYearFormats.set("U##", (patterns.birthYearFormats.get("U##") || 0) + 1);
    }

    // Learn gender indicators
    if (/\bboys\b/i.test(name)) patterns.genderIndicators.set("Boys", (patterns.genderIndicators.get("Boys") || 0) + 1);
    if (/\bgirls\b/i.test(name)) patterns.genderIndicators.set("Girls", (patterns.genderIndicators.get("Girls") || 0) + 1);
    if (/\s[BG]\s/i.test(name)) patterns.genderIndicators.set("Letter", (patterns.genderIndicators.get("Letter") || 0) + 1);

    // Learn color/level suffixes
    const colorMatch = name.match(/\b(Blue|White|Black|Red|Gold|Silver|Premier|Elite|Academy)\b/i);
    if (colorMatch) {
      patterns.suffixes.set(colorMatch[1], (patterns.suffixes.get(colorMatch[1]) || 0) + 1);
    }
  }

  // Store most common patterns with confidence based on frequency
  const totalTeams = teamNames.length;

  for (const [prefix, count] of patterns.clubPrefixes) {
    if (count >= 5) { // Minimum threshold
      await storeLearnedPattern("team_club_prefix", source, { prefix }, count / totalTeams);
    }
  }

  console.log(`📚 Learned ${patterns.clubPrefixes.size} club prefixes from ${totalTeams} teams`);
  return patterns;
}

// ===========================================
// EVENT PATTERN LEARNING
// ===========================================

/**
 * Learn event naming patterns to distinguish leagues vs tournaments
 */
async function learnEventPatterns(source, events) {
  const leagueIndicators = [];
  const tournamentIndicators = [];

  for (const event of events) {
    const name = event.name.toLowerCase();
    const isLeague = event.type === "league";

    // Extract keywords
    const keywords = name.split(/\s+/).filter(w => w.length >= 3);

    if (isLeague) {
      // Words that appear in leagues
      if (name.includes("league")) leagueIndicators.push("league");
      if (name.includes("premier")) leagueIndicators.push("premier");
      if (name.includes("recreational")) leagueIndicators.push("recreational");
      if (name.includes("development")) leagueIndicators.push("development");
      if (/fall|spring|winter|summer/i.test(name)) leagueIndicators.push("season_word");
    } else {
      // Words that appear in tournaments
      if (name.includes("cup")) tournamentIndicators.push("cup");
      if (name.includes("classic")) tournamentIndicators.push("classic");
      if (name.includes("invitational")) tournamentIndicators.push("invitational");
      if (name.includes("tournament")) tournamentIndicators.push("tournament");
      if (name.includes("showcase")) tournamentIndicators.push("showcase");
    }
  }

  // Store learned patterns
  const leagueCounts = {};
  leagueIndicators.forEach(w => leagueCounts[w] = (leagueCounts[w] || 0) + 1);

  const tournamentCounts = {};
  tournamentIndicators.forEach(w => tournamentCounts[w] = (tournamentCounts[w] || 0) + 1);

  await storeLearnedPattern("event_league_keywords", source, leagueCounts, 0.9);
  await storeLearnedPattern("event_tournament_keywords", source, tournamentCounts, 0.9);

  console.log(`📚 Learned event patterns: ${Object.keys(leagueCounts).length} league, ${Object.keys(tournamentCounts).length} tournament keywords`);
}

// ===========================================
// APPLY LEARNED PATTERNS
// ===========================================

/**
 * Use learned patterns to classify an event as league or tournament
 */
async function classifyEvent(source, eventName) {
  const leaguePatterns = await getLearnedPatterns("event_league_keywords", source);
  const tournamentPatterns = await getLearnedPatterns("event_tournament_keywords", source);

  const nameLower = eventName.toLowerCase();

  let leagueScore = 0;
  let tournamentScore = 0;

  // Check league keywords
  for (const pattern of leaguePatterns) {
    for (const [keyword, count] of Object.entries(pattern.pattern_data)) {
      if (nameLower.includes(keyword)) {
        leagueScore += count * pattern.confidence;
      }
    }
  }

  // Check tournament keywords
  for (const pattern of tournamentPatterns) {
    for (const [keyword, count] of Object.entries(pattern.pattern_data)) {
      if (nameLower.includes(keyword)) {
        tournamentScore += count * pattern.confidence;
      }
    }
  }

  return {
    type: leagueScore > tournamentScore ? "league" : "tournament",
    confidence: Math.abs(leagueScore - tournamentScore) / (leagueScore + tournamentScore + 1),
    leagueScore,
    tournamentScore,
  };
}

/**
 * Use learned patterns to extract club name from team name
 */
async function extractClubName(source, teamName) {
  const prefixPatterns = await getLearnedPatterns("team_club_prefix", source);

  // Try each known prefix
  for (const pattern of prefixPatterns) {
    const prefix = pattern.pattern_data.prefix;
    if (teamName.startsWith(prefix + " ")) {
      // Found a known club prefix
      return {
        clubName: prefix,
        confidence: pattern.confidence,
        method: "learned_prefix",
      };
    }
  }

  // Fallback: use first word before birth year/gender
  const match = teamName.match(/^(.+?)\s+(?:20\d{2}|U-?\d{1,2}|Boys|Girls)/i);
  if (match) {
    return {
      clubName: match[1].trim(),
      confidence: 0.5,
      method: "regex_fallback",
    };
  }

  return { clubName: teamName, confidence: 0.1, method: "full_name" };
}

// ===========================================
// FEEDBACK LOOP
// ===========================================

/**
 * Record successful operations to improve confidence
 * Uses upsert to create pattern if it doesn't exist yet
 */
async function recordSuccess(patternType, source, patternData) {
  try {
    // First try to update existing pattern
    const { data: existing } = await supabase
      .from("learned_patterns")
      .select("id, usage_count, confidence")
      .eq("pattern_type", patternType)
      .eq("source", source)
      .contains("pattern_data", patternData)
      .limit(1)
      .single();

    if (existing) {
      // Update existing pattern
      const { error } = await supabase
        .from("learned_patterns")
        .update({
          usage_count: (existing.usage_count || 0) + 1,
          confidence: Math.min((existing.confidence || 0.5) + 0.01, 1.0),
          last_success: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (error) console.error("Failed to update success:", error.message);
    } else {
      // Create new pattern with initial success
      await storeLearnedPattern(patternType, source, patternData, 0.6);
    }
  } catch (err) {
    // Silently ignore - feedback is non-critical
  }
}

/**
 * Record failures to decrease confidence
 * Only updates existing patterns (doesn't create on failure)
 */
async function recordFailure(patternType, source, patternData) {
  try {
    // Find existing pattern
    const { data: existing } = await supabase
      .from("learned_patterns")
      .select("id, failure_count, confidence")
      .eq("pattern_type", patternType)
      .eq("source", source)
      .contains("pattern_data", patternData)
      .limit(1)
      .single();

    if (existing) {
      const { error } = await supabase
        .from("learned_patterns")
        .update({
          failure_count: (existing.failure_count || 0) + 1,
          confidence: Math.max((existing.confidence || 0.5) - 0.05, 0.0),
          last_failure: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (error) console.error("Failed to record failure:", error.message);
    }
    // If pattern doesn't exist, we don't create it on failure
  } catch (err) {
    // Silently ignore - feedback is non-critical
  }
}

// ===========================================
// EXPORTS
// ===========================================

export {
  storeLearnedPattern,
  getLearnedPatterns,
  learnTeamNamePatterns,
  learnEventPatterns,
  classifyEvent,
  extractClubName,
  recordSuccess,
  recordFailure,
};

// ===========================================
// CLI INTERFACE
// ===========================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--learn-teams")) {
    const source = args[args.indexOf("--source") + 1] || "all";

    // Get recent teams
    const { data: teams } = await supabase
      .from("teams_v2")
      .select("display_name")
      .limit(10000);

    if (teams) {
      await learnTeamNamePatterns(source, teams.map(t => t.display_name));
    }
  }

  if (args.includes("--learn-events")) {
    const source = args[args.indexOf("--source") + 1] || "all";

    // Get events
    const { data: leagues } = await supabase.from("leagues").select("name").limit(500);
    const { data: tournaments } = await supabase.from("tournaments").select("name").limit(500);

    const events = [
      ...(leagues || []).map(l => ({ name: l.name, type: "league" })),
      ...(tournaments || []).map(t => ({ name: t.name, type: "tournament" })),
    ];

    await learnEventPatterns(source, events);
  }

  if (args.includes("--classify")) {
    const eventName = args[args.indexOf("--classify") + 1];
    const source = args[args.indexOf("--source") + 1] || "all";

    const result = await classifyEvent(source, eventName);
    console.log("Classification:", result);
  }

  console.log("✅ Done");
}

// Run if called directly
if (process.argv[1].includes("adaptiveLearning")) {
  main().catch(console.error);
}
