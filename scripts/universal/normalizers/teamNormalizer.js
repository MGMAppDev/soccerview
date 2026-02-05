/**
 * Team Normalizer
 * Standardizes team names from any source to canonical format.
 *
 * Performance: Designed for bulk operations - pure functions, no DB calls
 * Target: <1ms per team name
 *
 * ADAPTIVE LEARNING: Supports learned patterns for better club extraction.
 * Call initializeLearnedPatterns() before bulk operations to enable.
 */

// Current season year for age group calculations
// Default fallback; callers should call initializeSeasonYear() with DB value
let SEASON_YEAR = 2026;

/**
 * Initialize season year from database value.
 * Call this once before bulk processing.
 * Falls back to default (2026) if not called.
 */
export function initializeSeasonYear(year) {
  if (year && year >= 2020 && year <= 2040) {
    SEASON_YEAR = year;
  }
}

// ===========================================
// ADAPTIVE LEARNING INTEGRATION
// ===========================================

// Module-level cache for learned patterns (loaded async, used sync)
let learnedClubPrefixes = null;
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
    learnedClubPrefixes = await getLearnedPatterns('team_club_prefix', 'all');
    adaptiveLearningInitialized = true;
    // console.log(`📚 teamNormalizer: Loaded ${learnedClubPrefixes?.length || 0} learned club prefixes`);
  } catch (e) {
    // Graceful fallback - learned patterns are enhancement, not requirement
    learnedClubPrefixes = [];
    adaptiveLearningInitialized = true;
  }
}

/**
 * Reset learned patterns (for testing)
 */
export function resetLearnedPatterns() {
  learnedClubPrefixes = null;
  adaptiveLearningInitialized = false;
}

/**
 * Normalize a team name to canonical format
 *
 * @param {Object} input - { raw_name, source_platform }
 * @returns {Object} Normalized team data
 */
export function normalizeTeam(input) {
  const { raw_name, source_platform } = input;

  if (!raw_name || typeof raw_name !== 'string') {
    return {
      canonical_name: null,
      club_name: null,
      birth_year: null,
      gender: null,
      age_group: null,
      normalized: false,
      transformations: [],
      error: 'Invalid or empty team name',
    };
  }

  const transformations = [];
  let name = raw_name.trim();

  // Step 1: Remove duplicate club prefix (e.g., "KC Fusion KC Fusion" → "KC Fusion")
  name = removeDuplicatePrefix(name, transformations);

  // Step 2: Extract and remove age/gender suffix (e.g., "(U11 Boys)")
  const suffixData = extractSuffix(name, transformations);
  name = suffixData.name;

  // Step 3: Extract birth year from name
  const birthYearData = extractBirthYear(name, transformations);

  // Step 4: Extract gender
  const genderData = extractGender(name, suffixData, transformations);

  // Step 5: Normalize whitespace
  name = normalizeWhitespace(name, transformations);

  // Step 6: Extract club name (prefix before team identifier)
  const clubName = extractClubName(name);

  // Calculate birth year and age group
  let birthYear = birthYearData.birthYear;
  let ageGroup = null;

  if (birthYear) {
    // Calculate age group from birth year
    ageGroup = `U${SEASON_YEAR - birthYear}`;
  } else if (suffixData.ageGroup) {
    // Calculate birth year from suffix's age group
    const ageMatch = suffixData.ageGroup.match(/U(\d+)/i);
    if (ageMatch) {
      const age = parseInt(ageMatch[1], 10);
      if (age >= 7 && age <= 19) {
        birthYear = SEASON_YEAR - age;
        ageGroup = suffixData.ageGroup;
        transformations.push('extracted_birth_year_from_suffix');
      }
    }
  }

  return {
    canonical_name: name.toLowerCase().replace(/\s+/g, ' ').trim(),
    display_name: name,
    club_name: clubName,
    birth_year: birthYear,
    gender: genderData.gender,
    age_group: ageGroup,
    normalized: true,
    transformations,
  };
}

/**
 * Remove duplicate club prefix
 * "KC Fusion KC Fusion 15B Gold" → "KC Fusion 15B Gold"
 */
function removeDuplicatePrefix(name, transformations) {
  // Find repeated word patterns at start
  const words = name.split(/\s+/);

  if (words.length >= 4) {
    // Check for 2-word duplicate prefix
    if (words[0].toLowerCase() === words[2].toLowerCase() &&
        words[1].toLowerCase() === words[3].toLowerCase()) {
      transformations.push('removed_duplicate_prefix');
      return words.slice(2).join(' ');
    }
  }

  if (words.length >= 2) {
    // Check for 1-word duplicate prefix
    if (words[0].toLowerCase() === words[1].toLowerCase()) {
      transformations.push('removed_duplicate_prefix');
      return words.slice(1).join(' ');
    }
  }

  return name;
}

/**
 * Extract and remove suffix like "(U11 Boys)" or "(U12 Girls)"
 */
function extractSuffix(name, transformations) {
  const suffixMatch = name.match(/\s*\(([^)]+)\)\s*$/);

  if (suffixMatch) {
    const suffix = suffixMatch[1];
    const cleanName = name.replace(suffixMatch[0], '').trim();

    // Extract age group from suffix
    const ageMatch = suffix.match(/U(\d+)/i);
    const ageGroup = ageMatch ? `U${ageMatch[1]}` : null;

    // Extract gender from suffix
    let gender = null;
    if (/boys/i.test(suffix)) gender = 'M';
    else if (/girls/i.test(suffix)) gender = 'F';

    transformations.push('extracted_suffix');

    return { name: cleanName, ageGroup, gender };
  }

  return { name, ageGroup: null, gender: null };
}

/**
 * Extract birth year from team name
 * Patterns: "15B" → 2015, "2014B" → 2014, "2015" → 2015, "Pre-NAL 15" → 2015
 */
function extractBirthYear(name, transformations) {
  // Priority 1: Full 4-digit year (e.g., "2015", "2014B", "2014 B")
  // Match year possibly followed by B/G or space
  const fullYearMatch = name.match(/\b(20[01]\d)(?:[BG\s]|$)/i);
  if (fullYearMatch) {
    const year = parseInt(fullYearMatch[1], 10);
    if (year >= 2007 && year <= 2019) {
      transformations.push('extracted_birth_year_4digit');
      return { birthYear: year };
    }
  }

  // Priority 2: 2-digit year with gender code (e.g., "15B", "14G", "B15", "G14")
  const twoDigitPatterns = [
    /\b(\d{2})[BG]\b/i,  // 15B, 14G
    /\b[BG](\d{2})\b/i,  // B15, G14
  ];

  for (const pattern of twoDigitPatterns) {
    const match = name.match(pattern);
    if (match) {
      const twoDigit = parseInt(match[1], 10);
      const year = twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
      if (year >= 2007 && year <= 2019) {
        transformations.push('extracted_birth_year_2digit');
        return { birthYear: year };
      }
    }
  }

  // Priority 3: Standalone 2-digit year at end of name (e.g., "Pre-NAL 15", "Academy 14")
  // This handles team names that end with just the birth year without B/G suffix
  const trailingYearMatch = name.match(/\b(\d{2})\s*$/);
  if (trailingYearMatch) {
    const twoDigit = parseInt(trailingYearMatch[1], 10);
    const year = twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
    if (year >= 2007 && year <= 2019) {
      transformations.push('extracted_birth_year_trailing');
      return { birthYear: year };
    }
  }

  // Priority 4: 2-digit year preceded by team type indicators (e.g., "Pre-NAL 15 Blue", "Academy 14 Gold")
  // Handles cases where birth year is followed by color/division name
  const midNameYearMatch = name.match(/(?:Pre-?(?:NAL|Academy|ECNL|MLS|Elite)|Academy|Elite|Select|Premier)\s+(\d{2})(?:\s|$)/i);
  if (midNameYearMatch) {
    const twoDigit = parseInt(midNameYearMatch[1], 10);
    const year = twoDigit <= 30 ? 2000 + twoDigit : 1900 + twoDigit;
    if (year >= 2007 && year <= 2019) {
      transformations.push('extracted_birth_year_after_indicator');
      return { birthYear: year };
    }
  }

  // Priority 5: Age group only (e.g., "U12" → 2026 - 12 = 2014)
  const ageMatch = name.match(/\bU[-\s]?(\d+)\b/i);
  if (ageMatch) {
    const age = parseInt(ageMatch[1], 10);
    if (age >= 7 && age <= 19) {
      transformations.push('extracted_birth_year_from_age');
      return { birthYear: SEASON_YEAR - age };
    }
  }

  return { birthYear: null };
}

/**
 * Extract gender from team name
 */
function extractGender(name, suffixData, transformations) {
  // Already extracted from suffix
  if (suffixData.gender) {
    return { gender: suffixData.gender };
  }

  const lowerName = name.toLowerCase();

  // Check for explicit gender words
  if (lowerName.includes('boys') || lowerName.includes(' b ')) {
    transformations.push('extracted_gender');
    return { gender: 'M' };
  }
  if (lowerName.includes('girls') || lowerName.includes(' g ')) {
    transformations.push('extracted_gender');
    return { gender: 'F' };
  }

  // Check for gender code (B/G followed by or preceding numbers)
  if (/\b\d+b\b/i.test(name) || /\bb\d+\b/i.test(name)) {
    transformations.push('extracted_gender');
    return { gender: 'M' };
  }
  if (/\b\d+g\b/i.test(name) || /\bg\d+\b/i.test(name)) {
    transformations.push('extracted_gender');
    return { gender: 'F' };
  }

  return { gender: null };
}

/**
 * Normalize whitespace
 */
function normalizeWhitespace(name, transformations) {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (cleaned !== name) {
    transformations.push('normalized_whitespace');
  }
  return cleaned;
}

/**
 * Extract club name from team name
 * "Sporting Blue Valley SPORTING BV Pre-NAL 15" → "Sporting Blue Valley"
 *
 * ADAPTIVE LEARNING: Checks learned prefixes first for higher accuracy.
 * Learned prefixes come from successful team creations/merges.
 */
function extractClubName(name) {
  // ADAPTIVE LEARNING: Check learned prefixes first (higher accuracy)
  if (learnedClubPrefixes && learnedClubPrefixes.length > 0) {
    const lowerName = name.toLowerCase();
    for (const pattern of learnedClubPrefixes) {
      const prefix = pattern.pattern_data?.prefix;
      if (prefix && lowerName.startsWith(prefix.toLowerCase() + ' ')) {
        // Found a known club prefix - return it properly cased
        const prefixLen = prefix.length;
        // Use the original casing from the name if possible
        return name.substring(0, prefixLen).split(/\s+/).map(w =>
          w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        ).join(' ');
      }
    }
  }

  // Fall back to rule-based extraction
  const words = name.split(/\s+/);

  // Find where team-specific info starts (year, age group, etc.)
  let cutoffIndex = words.length;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Check for year pattern (2014, 2015, etc.)
    if (/^20[01]\d$/.test(word)) {
      cutoffIndex = i;
      break;
    }

    // Check for age-year pattern (14B, 15G, B14, G15)
    if (/^\d{2}[BG]$/i.test(word) || /^[BG]\d{2}$/i.test(word)) {
      cutoffIndex = i;
      break;
    }

    // Check for U-age pattern (U12, U-14)
    if (/^U-?\d+$/i.test(word)) {
      cutoffIndex = i;
      break;
    }

    // Check if current word is all caps and different from previous (likely abbreviation)
    if (i > 0 && word === word.toUpperCase() && word.length <= 4 && /^[A-Z]+$/.test(word)) {
      // This might be an abbreviation like "SPORTING BV" - check if previous words are title case
      const prevWord = words[i - 1];
      if (prevWord !== prevWord.toUpperCase() && prevWord !== prevWord.toLowerCase()) {
        // Previous word was title case, so this is likely start of team-specific part
        cutoffIndex = i;
        break;
      }
    }
  }

  // Take words up to cutoff
  const clubWords = words.slice(0, Math.min(cutoffIndex, 4)); // Max 4 words for club name

  if (clubWords.length === 0) {
    return null;
  }

  // Title case the club name
  return clubWords.map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

/**
 * Bulk normalize multiple team names
 * Optimized for performance - pure function, no DB calls
 *
 * @param {Array} teams - Array of { raw_name, source_platform }
 * @returns {Array} Array of normalized team data
 */
export function normalizeTeamsBulk(teams) {
  return teams.map(normalizeTeam);
}

// ============================================
// STATE INFERENCE FROM TEAM NAME
// ============================================

// US state name → abbreviation, sorted longest-first for correct matching
const STATE_NAMES_SORTED = [
  ['west virginia', 'WV'], ['south carolina', 'SC'], ['south dakota', 'SD'],
  ['north carolina', 'NC'], ['north dakota', 'ND'], ['new hampshire', 'NH'],
  ['new jersey', 'NJ'], ['new mexico', 'NM'], ['new york', 'NY'],
  ['rhode island', 'RI'],
  ['alabama', 'AL'], ['alaska', 'AK'], ['arizona', 'AZ'], ['arkansas', 'AR'],
  ['california', 'CA'], ['colorado', 'CO'], ['connecticut', 'CT'], ['delaware', 'DE'],
  ['florida', 'FL'], ['georgia', 'GA'], ['hawaii', 'HI'], ['idaho', 'ID'],
  ['illinois', 'IL'], ['indiana', 'IN'], ['iowa', 'IA'], ['kansas', 'KS'],
  ['kentucky', 'KY'], ['louisiana', 'LA'], ['maine', 'ME'], ['maryland', 'MD'],
  ['massachusetts', 'MA'], ['michigan', 'MI'], ['minnesota', 'MN'], ['mississippi', 'MS'],
  ['missouri', 'MO'], ['montana', 'MT'], ['nebraska', 'NE'], ['nevada', 'NV'],
  ['ohio', 'OH'], ['oklahoma', 'OK'], ['oregon', 'OR'], ['pennsylvania', 'PA'],
  ['tennessee', 'TN'], ['texas', 'TX'], ['utah', 'UT'], ['vermont', 'VT'],
  ['virginia', 'VA'], ['washington', 'WA'], ['wisconsin', 'WI'], ['wyoming', 'WY'],
];

/**
 * Infer US state abbreviation from a team name.
 * Returns null if no unambiguous state name found.
 *
 * Ambiguity rules:
 * - "Kansas City" → null (could be KS or MO)
 * - "Washington" alone → null (state vs DC vs city)
 * - "West Virginia" matches before "Virginia" (longest-first)
 */
export function inferStateFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();

  for (const [stateName, abbrev] of STATE_NAMES_SORTED) {
    const regex = new RegExp(`\\b${stateName}\\b`, 'i');
    if (!regex.test(lower)) continue;

    // Ambiguity checks
    if (stateName === 'kansas' && /\bkansas\s+city\b/i.test(lower)) continue;
    if (stateName === 'washington' && !/\bwashington\s+state\b/i.test(lower)) continue;

    return abbrev;
  }
  return null;
}

// ============================================
// UNIT TESTS
// ============================================

export function runTests() {
  console.log('Running teamNormalizer tests...\n');

  const tests = [
    {
      name: 'Duplicate prefix removal',
      input: { raw_name: 'KC Fusion KC Fusion 15B Gold (U11 Boys)', source_platform: 'gotsport' },
      expect: { canonical_name: 'kc fusion 15b gold', birth_year: 2015, gender: 'M' },
    },
    {
      name: 'Complex team name',
      input: { raw_name: 'Sporting Blue Valley SPORTING BV Pre-NAL 15 (U11 Boys)', source_platform: 'gotsport' },
      expect: { birth_year: 2015, gender: 'M' },
    },
    {
      name: 'Birth year from name',
      input: { raw_name: 'Rush 2014B Select', source_platform: 'gotsport' },
      expect: { birth_year: 2014, gender: 'M' },
    },
    {
      name: 'Gender from U-age',
      input: { raw_name: 'Tigers U12 Girls', source_platform: 'gotsport' },
      expect: { birth_year: 2014, gender: 'F' },
    },
    {
      name: '2-digit year pattern',
      input: { raw_name: 'Fusion 15B Gold', source_platform: 'gotsport' },
      expect: { birth_year: 2015, gender: 'M' },
    },
    {
      name: 'Empty input',
      input: { raw_name: '', source_platform: 'gotsport' },
      expect: { normalized: false },
    },
    // NEW: Trailing 2-digit year without B/G suffix
    {
      name: 'Trailing 2-digit year (Pre-NAL 15)',
      input: { raw_name: 'SPORTING BV Pre-NAL 15', source_platform: 'htgsports' },
      expect: { birth_year: 2015 },
    },
    {
      name: 'Trailing 2-digit year (Academy 14)',
      input: { raw_name: 'KC Fusion Academy 14', source_platform: 'htgsports' },
      expect: { birth_year: 2014 },
    },
    {
      name: 'Pre-ECNL-RL pattern',
      input: { raw_name: 'KC Surf Pre-ECNL-RL 14B Foster', source_platform: 'heartland' },
      expect: { birth_year: 2014, gender: 'M' },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = normalizeTeam(test.input);
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
if (process.argv[1]?.includes('teamNormalizer')) {
  runTests();
}
