/**
 * Match Normalizer
 * Parses and validates match data from various formats.
 *
 * Performance: Pure functions for bulk processing
 * Target: <1ms per match
 */

// Valid date range for matches
const MIN_DATE = new Date('2023-08-01');
const MAX_DATE = new Date('2027-07-31');

/**
 * Normalize match data
 *
 * @param {Object} input - Raw match data
 * @returns {Object} Normalized match data
 */
export function normalizeMatch(input) {
  const {
    match_date,
    match_time,
    home_score,
    away_score,
    home_team_name,
    away_team_name,
    source_match_key,
    event_id,
    source_platform,
  } = input;

  const validationErrors = [];

  // Parse date
  const parsedDate = parseDate(match_date);
  if (!parsedDate.valid) {
    validationErrors.push(parsedDate.error);
  }

  // Parse time
  const parsedTime = parseTime(match_time);

  // Parse scores
  const parsedHomeScore = parseScore(home_score);
  const parsedAwayScore = parseScore(away_score);

  // Validate teams are different
  if (home_team_name && away_team_name) {
    if (home_team_name.toLowerCase().trim() === away_team_name.toLowerCase().trim()) {
      validationErrors.push('Home and away teams are the same');
    }
  } else {
    if (!home_team_name) validationErrors.push('Missing home_team_name');
    if (!away_team_name) validationErrors.push('Missing away_team_name');
  }

  // Validate date range
  if (parsedDate.valid) {
    const matchDate = new Date(parsedDate.date);
    if (matchDate < MIN_DATE || matchDate > MAX_DATE) {
      validationErrors.push(`Date ${parsedDate.date} outside allowed range`);
    }
  }

  // Generate source_match_key if missing
  const generatedKey = source_match_key || generateSourceMatchKey({
    source_platform,
    event_id,
    home_team_name,
    away_team_name,
    match_date: parsedDate.date,
  });

  // Determine if scheduled (future match with no scores)
  const isScheduled = determineIfScheduled(parsedDate.date, parsedHomeScore, parsedAwayScore);

  return {
    match_date: parsedDate.date,
    match_time: parsedTime.time,
    home_score: parsedHomeScore,
    away_score: parsedAwayScore,
    source_match_key: generatedKey,
    is_scheduled: isScheduled,
    is_valid: validationErrors.length === 0,
    validation_errors: validationErrors,
    normalized: true,
  };
}

/**
 * Parse date from various formats
 */
function parseDate(dateInput) {
  if (!dateInput) {
    return { valid: false, date: null, error: 'Missing match_date' };
  }

  let date = null;

  // Already a Date object
  if (dateInput instanceof Date) {
    date = dateInput;
  }
  // ISO format: 2026-01-30
  else if (/^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    date = new Date(dateInput);
  }
  // US format: 01/30/2026 or 1/30/2026
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dateInput)) {
    const [month, day, year] = dateInput.split('/').map(Number);
    date = new Date(year, month - 1, day);
  }
  // Text format: "Jan 30, 2026"
  else if (/[A-Za-z]+\s+\d+,?\s+\d{4}/.test(dateInput)) {
    date = new Date(dateInput);
  }
  // JavaScript toString format: "Sat Jan 30 2026..."
  else if (/^\w{3}\s+\w{3}\s+\d{2}\s+\d{4}/.test(dateInput)) {
    date = new Date(dateInput);
  }
  // Try general parsing
  else {
    date = new Date(dateInput);
  }

  if (!date || isNaN(date.getTime())) {
    return { valid: false, date: null, error: `Invalid date format: ${dateInput}` };
  }

  // Format as ISO date string (YYYY-MM-DD)
  const isoDate = date.toISOString().split('T')[0];

  return { valid: true, date: isoDate };
}

/**
 * Parse time to 24-hour format
 */
function parseTime(timeInput) {
  if (!timeInput) {
    return { time: null };
  }

  let time = timeInput;

  // Already 24-hour format: 15:00 or 15:00:00
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
    const parts = time.split(':');
    const hours = parts[0].padStart(2, '0');
    const minutes = parts[1];
    const seconds = parts[2] || '00';
    return { time: `${hours}:${minutes}:${seconds}` };
  }

  // 12-hour format: 3:00 PM, 3:00PM, 3PM
  const match12Hour = time.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);
  if (match12Hour) {
    let hours = parseInt(match12Hour[1], 10);
    const minutes = match12Hour[2] || '00';
    const period = match12Hour[3].toUpperCase();

    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }

    return { time: `${String(hours).padStart(2, '0')}:${minutes}:00` };
  }

  return { time: null };
}

/**
 * Parse score to integer
 */
function parseScore(scoreInput) {
  if (scoreInput === null || scoreInput === undefined) {
    return null;
  }

  // Already a number
  if (typeof scoreInput === 'number') {
    return scoreInput;
  }

  // String number
  if (typeof scoreInput === 'string') {
    const trimmed = scoreInput.trim();

    // Empty or placeholder values
    if (trimmed === '' || trimmed === '-' || trimmed.toLowerCase() === 'tbd') {
      return null;
    }

    const parsed = parseInt(trimmed, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

/**
 * Generate source_match_key if missing
 */
function generateSourceMatchKey(params) {
  const { source_platform, event_id, home_team_name, away_team_name, match_date } = params;

  if (!source_platform || !match_date) {
    return null;
  }

  // Normalize team names for key
  const homeKey = (home_team_name || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 20);

  const awayKey = (away_team_name || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 20);

  const dateKey = match_date.replace(/-/g, '');

  if (event_id) {
    return `${source_platform}-${event_id}-${homeKey}-${awayKey}-${dateKey}`;
  }

  return `${source_platform}-${homeKey}-${awayKey}-${dateKey}`;
}

/**
 * Determine if match is scheduled (future with no scores)
 */
function determineIfScheduled(matchDate, homeScore, awayScore) {
  if (!matchDate) return false;

  const date = new Date(matchDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isFuture = date > today;
  const noScores = (homeScore === null || homeScore === 0) && (awayScore === null || awayScore === 0);

  return isFuture && noScores;
}

/**
 * Extract competitive division/tier from raw division text.
 * Universal: works for ANY source with zero source-specific logic.
 *
 * Strategy:
 *   1. Check raw_data for explicit subdivision/tier number (any source can provide this)
 *   2. Strip age group patterns (U-11, U11, 2014, etc.)
 *   3. Strip gender patterns (Boys, Girls, Male, Female)
 *   4. Normalize what remains into a clean tier name
 *
 * @param {string} divisionText - The staging_games.division value
 * @param {object} rawData - The staging_games.raw_data JSONB (parsed)
 * @returns {string|null} The tier name (e.g., "Division 3", "Red", "Premier") or null
 */
export function extractDivisionTier(divisionText, rawData) {
  // Priority 1: Check raw_data for explicit subdivision/tier number
  // Generic keys — any source can provide these in raw_data.original
  // Check both camelCase and snake_case variants (sources may use either)
  const subdivNumber =
    rawData?.original?.heartlandSubdivision ||
    rawData?.original?.heartland_subdivision ||
    rawData?.original?.subdivision ||
    rawData?.heartland_subdivision ||
    rawData?.heartlandSubdivision ||
    rawData?.subdivision ||
    rawData?.tier;
  if (subdivNumber && /^\d{1,2}$/.test(String(subdivNumber))) {
    return `Division ${subdivNumber}`;
  }

  if (!divisionText) return null;

  let remaining = divisionText.trim();

  // Strip age group patterns: U-11, U11, U-9, 2014, etc.
  remaining = remaining.replace(/\bU-?\d{1,2}\b/gi, '');
  remaining = remaining.replace(/\b20[01]\d\b/g, '');

  // Strip gender patterns
  remaining = remaining.replace(/\b(boys?|girls?|male|female|coed|co-ed)\b/gi, '');

  // Strip match format indicators: (11v11), (9v9), (7v7), (4v4), ()
  remaining = remaining.replace(/\(\d*v?\d*\)/gi, '');
  // Also strip standalone format: "11v11", "9v9", "7v7"
  remaining = remaining.replace(/\b\d{1,2}v\d{1,2}\b/gi, '');

  // Strip common separators and normalize whitespace
  remaining = remaining.replace(/[-·|\/]/g, ' ').replace(/\s+/g, ' ').trim();

  // If nothing meaningful remains, no tier info
  if (!remaining || remaining.length < 1) return null;

  // Normalize "Division N", "Div N", "Div. N" patterns
  const divMatch = remaining.match(/\b(?:div(?:ision)?\.?)\s*(\d+)\b/i);
  if (divMatch) return `Division ${divMatch[1]}`;

  // Normalize "Flight A", "Group B", "Pool C", "Bracket D" patterns
  const groupMatch = remaining.match(/\b(flight|group|pool|bracket)\s+([A-Za-z0-9]+)\b/i);
  if (groupMatch) {
    const label = groupMatch[1].charAt(0).toUpperCase() + groupMatch[1].slice(1).toLowerCase();
    return `${label} ${groupMatch[2].toUpperCase()}`;
  }

  // Single letter tier: "A", "B", "C", "D" (standalone)
  if (/^[A-Da-d]$/.test(remaining)) {
    return `Division ${remaining.toUpperCase()}`;
  }

  // Alphanumeric tier codes: "A1", "B2", "C1"
  if (/^[A-Da-d]\d$/.test(remaining)) {
    return remaining.toUpperCase();
  }

  // Known tier words (single or compound)
  const KNOWN_TIERS = new Set([
    'premier', 'elite', 'classic', 'championship', 'select', 'academy', 'reserve',
    'platinum', 'gold', 'silver', 'bronze',
    'red', 'blue', 'white', 'green', 'orange', 'black', 'navy', 'gray', 'grey',
    'top', 'first', 'second', 'third',
  ]);

  // Title-case helper that preserves Roman numerals (I, II, III, IV, V, VI, VII, VIII)
  const titleCase = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const fixRomanNumerals = (str) =>
    str.replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii)\b/g, m => m.toUpperCase());

  const words = remaining.toLowerCase().split(/\s+/).filter(w => w.length > 0);

  // Check if ALL remaining words are known tier words
  if (words.length > 0 && words.length <= 3 && words.every(w => KNOWN_TIERS.has(w))) {
    return fixRomanNumerals(words.map(titleCase).join(' '));
  }

  // Check if ANY word is a known tier (for mixed text like "1 Red")
  const tierWords = words.filter(w => KNOWN_TIERS.has(w) || /^\d{1,2}$/.test(w));
  if (tierWords.length > 0 && tierWords.length === words.length) {
    return fixRomanNumerals(tierWords.map(w => {
      if (/^\d+$/.test(w)) return `Division ${w}`;
      return titleCase(w);
    }).join(' '));
  }

  // If remaining is short (1-3 words) and doesn't look like garbage, treat as tier
  if (words.length >= 1 && words.length <= 3 && remaining.length <= 30) {
    return fixRomanNumerals(words.map(titleCase).join(' '));
  }

  return null;
}

/**
 * Bulk normalize multiple matches
 *
 * @param {Array} matches - Array of raw match data
 * @returns {Array} Array of normalized match data
 */
export function normalizeMatchesBulk(matches) {
  return matches.map(normalizeMatch);
}

// ============================================
// UNIT TESTS
// ============================================

export function runTests() {
  console.log('Running matchNormalizer tests...\n');

  const tests = [
    {
      name: 'ISO date format',
      input: { match_date: '2026-01-30', match_time: '15:00', home_score: 3, away_score: 1, home_team_name: 'Team A', away_team_name: 'Team B', source_platform: 'gotsport' },
      expect: { match_date: '2026-01-30', home_score: 3, away_score: 1, is_valid: true },
    },
    {
      name: 'US date format',
      input: { match_date: '01/30/2026', match_time: '3:00 PM', home_score: '2', away_score: '0', home_team_name: 'Team A', away_team_name: 'Team B', source_platform: 'gotsport' },
      expect: { match_date: '2026-01-30', match_time: '15:00:00', home_score: 2, away_score: 0, is_valid: true },
    },
    {
      name: 'Scheduled match (future, no scores)',
      input: { match_date: '2026-03-15', home_score: null, away_score: null, home_team_name: 'Team A', away_team_name: 'Team B', source_platform: 'gotsport' },
      expect: { is_scheduled: true, is_valid: true },
    },
    {
      name: 'TBD scores',
      input: { match_date: '2026-01-30', home_score: 'TBD', away_score: 'TBD', home_team_name: 'Team A', away_team_name: 'Team B', source_platform: 'gotsport' },
      expect: { home_score: null, away_score: null, is_valid: true },
    },
    {
      name: 'Same team validation',
      input: { match_date: '2026-01-30', home_team_name: 'Team A', away_team_name: 'Team A', source_platform: 'gotsport' },
      expect: { is_valid: false },
    },
    {
      name: 'Missing date',
      input: { home_team_name: 'Team A', away_team_name: 'Team B', source_platform: 'gotsport' },
      expect: { is_valid: false },
    },
    {
      name: 'Source match key generation',
      input: { match_date: '2026-01-30', home_team_name: 'Team A', away_team_name: 'Team B', source_platform: 'gotsport', event_id: '12345' },
      expectKey: 'gotsport-12345-teama-teamb-20260130',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = normalizeMatch(test.input);
    let testPassed = true;

    if (test.expect) {
      for (const [key, expectedValue] of Object.entries(test.expect)) {
        if (result[key] !== expectedValue) {
          console.log(`❌ FAIL: ${test.name}`);
          console.log(`   Expected ${key}: ${expectedValue}`);
          console.log(`   Got: ${result[key]}`);
          testPassed = false;
          break;
        }
      }
    }

    if (test.expectKey && result.source_match_key !== test.expectKey) {
      console.log(`❌ FAIL: ${test.name}`);
      console.log(`   Expected source_match_key: ${test.expectKey}`);
      console.log(`   Got: ${result.source_match_key}`);
      testPassed = false;
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

// ============================================
// extractDivisionTier TESTS
// ============================================

export function runDivisionTests() {
  console.log('\nRunning extractDivisionTier tests...\n');

  const tests = [
    { div: 'U-11 Boys', raw: null, expected: null, name: 'Plain age+gender → null' },
    { div: 'U-11 Boys Premier', raw: null, expected: 'Premier', name: 'Appended tier word' },
    { div: 'U-11 Boys Division 1', raw: null, expected: 'Division 1', name: 'Explicit Division N' },
    { div: 'U-11 Boys Div 2', raw: null, expected: 'Division 2', name: 'Abbreviated Div N' },
    { div: 'U-11 Boys Red', raw: null, expected: 'Red', name: 'Color tier (HTGSports)' },
    { div: 'U-09 Girls Elite', raw: null, expected: 'Elite', name: 'Named tier' },
    { div: 'U13 Boys', raw: { original: { heartlandSubdivision: '3' } }, expected: 'Division 3', name: 'Heartland subdivision camelCase' },
    { div: 'U13 Boys', raw: { original: { heartland_subdivision: '5' } }, expected: 'Division 5', name: 'Heartland subdivision snake_case' },
    { div: 'U10 Boys', raw: { heartland_subdivision: '9' }, expected: 'Division 9', name: 'Heartland subdivision top-level snake_case' },
    { div: null, raw: null, expected: null, name: 'Null input → null' },
    { div: 'U13 Boys', raw: null, expected: null, name: 'No tier info → null' },
    { div: 'U-11 Boys - Flight A', raw: null, expected: 'Flight A', name: 'Flight pattern' },
    { div: '2014 Girls Gold', raw: null, expected: 'Gold', name: 'Birth year + color tier' },
    { div: 'U15 Boys A', raw: null, expected: 'Division A', name: 'Single letter → Division A' },
    { div: 'U12 Girls B1', raw: null, expected: 'B1', name: 'Alphanumeric tier code' },
    { div: null, raw: { original: { subdivision: '7' } }, expected: 'Division 7', name: 'Generic subdivision key' },
    { div: 'U-11 Boys White II', raw: null, expected: 'White II', name: 'Roman numeral II preserved' },
    { div: 'U-11 Boys Silver III', raw: null, expected: 'Silver III', name: 'Roman numeral III preserved' },
  ];

  let passed = 0, failed = 0;
  for (const t of tests) {
    const result = extractDivisionTier(t.div, t.raw);
    if (result === t.expected) {
      console.log(`  PASS: ${t.name} → ${JSON.stringify(result)}`);
      passed++;
    } else {
      console.log(`  FAIL: ${t.name}`);
      console.log(`    Expected: ${JSON.stringify(t.expected)}`);
      console.log(`    Got:      ${JSON.stringify(result)}`);
      failed++;
    }
  }

  console.log(`\nDivision tests: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Run tests if executed directly
if (process.argv[1].includes('matchNormalizer')) {
  const matchOk = runTests();
  const divOk = runDivisionTests();
  process.exit(matchOk && divOk ? 0 : 1);
}
