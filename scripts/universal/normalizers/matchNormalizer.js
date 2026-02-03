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

// Run tests if executed directly
if (process.argv[1].includes('matchNormalizer')) {
  runTests();
}
