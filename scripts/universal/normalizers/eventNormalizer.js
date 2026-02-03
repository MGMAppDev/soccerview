/**
 * Event Normalizer
 * Standardizes event names and determines event type (league vs tournament).
 *
 * Performance: Pure functions for bulk processing, optional DB lookup for canonical registry
 * Target: <1ms per event name (without DB), <5ms with DB lookup
 *
 * ADAPTIVE LEARNING: Supports learned keywords for better league/tournament classification.
 * Call initializeLearnedPatterns() before bulk operations to enable.
 */

// League keywords (hardcoded baseline)
const LEAGUE_KEYWORDS = ['league', 'season', 'conference', 'division', 'premier', 'recreational'];

// Tournament keywords (hardcoded baseline)
const TOURNAMENT_KEYWORDS = ['cup', 'classic', 'showcase', 'tournament', 'shootout', 'invitational', 'challenge', 'festival'];

// ===========================================
// ADAPTIVE LEARNING INTEGRATION
// ===========================================

// Module-level cache for learned patterns (loaded async, used sync)
let learnedLeagueKeywords = null;
let learnedTournamentKeywords = null;
let adaptiveLearningInitialized = false;

/**
 * Initialize learned patterns from database
 * Call this once before bulk processing for adaptive learning benefits.
 * Non-blocking: falls back gracefully if patterns unavailable.
 */
export async function initializeLearnedPatterns() {
  if (adaptiveLearningInitialized) return; // Already loaded

  try {
    // Dynamic import to avoid circular dependencies
    const { getLearnedPatterns } = await import('../adaptiveLearning.js');

    const [leagues, tournaments] = await Promise.all([
      getLearnedPatterns('event_league_keywords', 'all'),
      getLearnedPatterns('event_tournament_keywords', 'all'),
    ]);

    learnedLeagueKeywords = leagues;
    learnedTournamentKeywords = tournaments;
    adaptiveLearningInitialized = true;
    // console.log(`📚 eventNormalizer: Loaded ${leagues?.length || 0} league, ${tournaments?.length || 0} tournament keyword patterns`);
  } catch (e) {
    // Graceful fallback - learned patterns are enhancement, not requirement
    learnedLeagueKeywords = [];
    learnedTournamentKeywords = [];
    adaptiveLearningInitialized = true;
  }
}

/**
 * Reset learned patterns (for testing)
 */
export function resetLearnedPatterns() {
  learnedLeagueKeywords = null;
  learnedTournamentKeywords = null;
  adaptiveLearningInitialized = false;
}

// State mappings from keywords
const STATE_KEYWORDS = {
  'kansas': 'KS',
  'missouri': 'MO',
  'heartland': 'KS',
  'texas': 'TX',
  'california': 'CA',
  'florida': 'FL',
  'colorado': 'CO',
  'arizona': 'AZ',
  'georgia': 'GA',
  'illinois': 'IL',
  'ohio': 'OH',
  'michigan': 'MI',
  'new york': 'NY',
  'new jersey': 'NJ',
  'pennsylvania': 'PA',
  'virginia': 'VA',
  'north carolina': 'NC',
  'south carolina': 'SC',
  'washington': 'WA',
  'oregon': 'OR',
  'nevada': 'NV',
  'utah': 'UT',
  'oklahoma': 'OK',
  'arkansas': 'AR',
  'louisiana': 'LA',
  'tennessee': 'TN',
  'kentucky': 'KY',
  'indiana': 'IN',
  'minnesota': 'MN',
  'wisconsin': 'WI',
  'iowa': 'IA',
  'nebraska': 'NE',
};

// Region mappings
const REGION_KEYWORDS = {
  'heartland': 'Kansas City',
  'kc': 'Kansas City',
  'kansas city': 'Kansas City',
  'dallas': 'Dallas',
  'houston': 'Houston',
  'austin': 'Austin',
  'san antonio': 'San Antonio',
  'las vegas': 'Las Vegas',
  'vegas': 'Las Vegas',
  'los angeles': 'Los Angeles',
  'san diego': 'San Diego',
  'phoenix': 'Phoenix',
  'denver': 'Denver',
  'seattle': 'Seattle',
  'portland': 'Portland',
  'atlanta': 'Atlanta',
  'miami': 'Miami',
  'chicago': 'Chicago',
};

/**
 * Normalize an event name to canonical format
 *
 * @param {Object} input - { raw_name, source_platform, source_event_id, start_date, end_date }
 * @returns {Object} Normalized event data
 */
export function normalizeEvent(input) {
  const { raw_name, source_platform, source_event_id, start_date, end_date } = input;

  if (!raw_name || typeof raw_name !== 'string') {
    return {
      canonical_name: null,
      event_type: null,
      year: null,
      season: null,
      state: null,
      region: null,
      normalized: false,
      error: 'Invalid or empty event name',
    };
  }

  const name = raw_name.trim();
  const lowerName = name.toLowerCase();

  // Determine event type
  const eventType = determineEventType(lowerName, start_date, end_date);

  // Extract year
  const year = extractYear(name);

  // Calculate season
  const season = year ? calculateSeason(year) : null;

  // Extract state
  const state = extractState(lowerName, source_platform);

  // Extract region
  const region = extractRegion(lowerName);

  // Generate canonical name
  const canonicalName = generateCanonicalName(name, eventType, year);

  return {
    canonical_name: canonicalName,
    display_name: name,
    event_type: eventType,
    year,
    season,
    state,
    region,
    source_event_id,
    source_platform,
    normalized: true,
  };
}

/**
 * Determine if event is a league or tournament
 *
 * ADAPTIVE LEARNING: Checks learned keyword patterns first for higher accuracy.
 * Falls back to hardcoded keywords if learned patterns unavailable or inconclusive.
 */
function determineEventType(lowerName, startDate, endDate) {
  // ADAPTIVE LEARNING: Check learned patterns first (higher accuracy)
  if ((learnedLeagueKeywords && learnedLeagueKeywords.length > 0) ||
      (learnedTournamentKeywords && learnedTournamentKeywords.length > 0)) {
    let leagueScore = 0;
    let tournamentScore = 0;

    // Score based on learned league keywords
    for (const pattern of learnedLeagueKeywords || []) {
      for (const [keyword, count] of Object.entries(pattern.pattern_data || {})) {
        if (lowerName.includes(keyword.toLowerCase())) {
          leagueScore += (count || 1) * (pattern.confidence || 0.5);
        }
      }
    }

    // Score based on learned tournament keywords
    for (const pattern of learnedTournamentKeywords || []) {
      for (const [keyword, count] of Object.entries(pattern.pattern_data || {})) {
        if (lowerName.includes(keyword.toLowerCase())) {
          tournamentScore += (count || 1) * (pattern.confidence || 0.5);
        }
      }
    }

    // If learned patterns have strong signal (score > 1), use them
    if (leagueScore > 1 || tournamentScore > 1) {
      if (leagueScore > tournamentScore) return 'league';
      if (tournamentScore > leagueScore) return 'tournament';
    }
  }

  // Fall back to hardcoded keywords (baseline)
  for (const keyword of LEAGUE_KEYWORDS) {
    if (lowerName.includes(keyword)) {
      return 'league';
    }
  }

  for (const keyword of TOURNAMENT_KEYWORDS) {
    if (lowerName.includes(keyword)) {
      return 'tournament';
    }
  }

  // Check date range if available
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = (end - start) / (1000 * 60 * 60 * 24);

    // Single weekend = tournament, multi-month = league
    if (daysDiff <= 4) {
      return 'tournament';
    } else if (daysDiff > 30) {
      return 'league';
    }
  }

  // Default to tournament (more common)
  return 'tournament';
}

/**
 * Extract year from event name
 */
function extractYear(name) {
  // Try 4-digit year first
  const yearMatch = name.match(/\b(202[0-9])\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }

  // Try season format (25-26)
  const seasonMatch = name.match(/\b(\d{2})-(\d{2})\b/);
  if (seasonMatch) {
    const year1 = parseInt(seasonMatch[1], 10);
    return year1 < 50 ? 2000 + year1 : 1900 + year1;
  }

  // Try "Fall 2025", "Spring 2026"
  const seasonWordMatch = name.match(/(fall|spring|winter|summer)\s*(202\d)/i);
  if (seasonWordMatch) {
    return parseInt(seasonWordMatch[2], 10);
  }

  return null;
}

/**
 * Calculate season string from year
 * Soccer seasons run Aug 1 - Jul 31
 */
function calculateSeason(year) {
  return `${year - 1}-${String(year).slice(-2)}`;
}

/**
 * Extract state from event name or source platform
 */
function extractState(lowerName, sourcePlatform) {
  // Check keywords
  for (const [keyword, state] of Object.entries(STATE_KEYWORDS)) {
    if (lowerName.includes(keyword)) {
      return state;
    }
  }

  // Infer from source platform
  if (sourcePlatform === 'heartland' || sourcePlatform === 'htgsports') {
    return 'KS';
  }

  return null;
}

/**
 * Extract region from event name
 */
function extractRegion(lowerName) {
  for (const [keyword, region] of Object.entries(REGION_KEYWORDS)) {
    if (lowerName.includes(keyword)) {
      return region;
    }
  }
  return null;
}

/**
 * Generate canonical name
 */
function generateCanonicalName(name, eventType, year) {
  // Clean up name
  let canonical = name.trim();

  // Normalize common variations
  if (eventType === 'league') {
    // "Soccer League" → "Premier League" for Heartland
    if (/heartland.*soccer\s*league/i.test(canonical)) {
      canonical = canonical.replace(/soccer\s*league/i, 'Premier League');
    }
  }

  // Remove extra whitespace
  canonical = canonical.replace(/\s+/g, ' ').trim();

  return canonical;
}

/**
 * Normalize event with canonical registry lookup
 * Uses database to check for existing canonical mappings
 *
 * @param {Object} input - Event input data
 * @param {Object} dbClient - PostgreSQL client for registry lookup
 * @returns {Object} Normalized event data with canonical resolution
 */
export async function normalizeEventWithRegistry(input, dbClient) {
  const { raw_name } = input;

  if (!raw_name || !dbClient) {
    return normalizeEvent(input);
  }

  // Check canonical registry first
  const { rows } = await dbClient.query(
    `SELECT * FROM resolve_canonical_event($1)`,
    [raw_name]
  );

  if (rows.length > 0) {
    const canonical = rows[0];
    return {
      canonical_name: canonical.canonical_name,
      canonical_id: canonical.canonical_id,
      event_type: canonical.event_type,
      league_id: canonical.league_id,
      tournament_id: canonical.tournament_id,
      normalized: true,
      from_registry: true,
    };
  }

  // Fall back to rule-based normalization
  return normalizeEvent(input);
}

/**
 * Bulk normalize multiple events
 *
 * @param {Array} events - Array of event input objects
 * @returns {Array} Array of normalized event data
 */
export function normalizeEventsBulk(events) {
  return events.map(normalizeEvent);
}

/**
 * Bulk normalize with registry lookup
 *
 * @param {Array} events - Array of event input objects
 * @param {Object} dbClient - PostgreSQL client
 * @returns {Array} Array of normalized event data
 */
export async function normalizeEventsBulkWithRegistry(events, dbClient) {
  const results = [];

  for (const event of events) {
    const normalized = await normalizeEventWithRegistry(event, dbClient);
    results.push(normalized);
  }

  return results;
}

// ============================================
// UNIT TESTS
// ============================================

export function runTests() {
  console.log('Running eventNormalizer tests...\n');

  const tests = [
    {
      name: 'League detection',
      input: { raw_name: 'Heartland Soccer League 2025', source_platform: 'heartland' },
      expect: { event_type: 'league', year: 2025, state: 'KS' },
    },
    {
      name: 'Tournament detection',
      input: { raw_name: 'Vegas Cup 2026', source_platform: 'gotsport' },
      expect: { event_type: 'tournament', year: 2026, region: 'Las Vegas' },
    },
    {
      name: 'Classic tournament',
      input: { raw_name: 'Dallas Classic 2025', source_platform: 'gotsport' },
      expect: { event_type: 'tournament', year: 2025, region: 'Dallas' },
    },
    {
      name: 'Shootout tournament',
      input: { raw_name: 'Fort Lowell Shootout 2026', source_platform: 'gotsport' },
      expect: { event_type: 'tournament', year: 2026 },
    },
    {
      name: 'Season format year',
      input: { raw_name: 'Premier League 25-26', source_platform: 'gotsport' },
      expect: { event_type: 'league', year: 2025, season: '2024-25' },
    },
    {
      name: 'Empty input',
      input: { raw_name: '', source_platform: 'gotsport' },
      expect: { normalized: false },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = normalizeEvent(test.input);
    let testPassed = true;

    for (const [key, expectedValue] of Object.entries(test.expect)) {
      if (result[key] !== expectedValue) {
        console.log(`❌ FAIL: ${test.name}`);
        console.log(`   Expected ${key}: ${expectedValue}`);
        console.log(`   Got: ${result[key]}`);
        testPassed = false;
        break;
      }
    }

    if (testPassed) {
      console.log(`✅ PASS: ${test.name}`);
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Run tests if executed directly
if (process.argv[1].includes('eventNormalizer')) {
  runTests();
}
