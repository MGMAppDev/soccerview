/**
 * Club Normalizer
 * Extracts and normalizes club names from team names.
 *
 * Performance: Pure functions for bulk processing
 * Target: <1ms per club name
 */

// Common club name patterns to detect abbreviations
const ABBREVIATION_PATTERNS = [
  { full: 'Sporting Blue Valley', abbrev: 'SBV' },
  { full: 'Sporting Blue Valley', abbrev: 'Sporting BV' },
  { full: 'Kansas City', abbrev: 'KC' },
  { full: 'Football Club', abbrev: 'FC' },
  { full: 'Soccer Club', abbrev: 'SC' },
  { full: 'Soccer Association', abbrev: 'SA' },
  { full: 'Youth Soccer', abbrev: 'YS' },
];

// Primary patterns that always indicate end of club name
const PRIMARY_IDENTIFIER_PATTERNS = [
  /^20[01]\d[BG]?$/i,  // 2014, 2015, 2014B, 2015G
  /^\d{2}[BG]$/i,      // 14B, 15G
  /^[BG]\d{2}$/i,      // B14, G15
  /^U-?\d+$/i,         // U12, U-14
  /^Pre-?/i,           // Pre-ECNL, Pre-NAL
];

// Secondary patterns that only trigger after a primary pattern or at position > 3
// (colors and tier names are often part of club names)
const SECONDARY_IDENTIFIER_PATTERNS = [
  /^Gold$/i,
  /^Silver$/i,
  /^Blue$/i,
  /^Red$/i,
  /^White$/i,
  /^Black$/i,
  /^Select$/i,
  /^Elite$/i,
  /^Premier$/i,
  /^Academy$/i,
];

/**
 * Normalize club name from team name
 *
 * @param {Object} input - { team_name, state }
 * @returns {Object} Normalized club data
 */
export function normalizeClub(input) {
  const { team_name, state } = input;

  if (!team_name || typeof team_name !== 'string') {
    return {
      club_name: null,
      normalized_name: null,
      state: state || null,
      aliases: [],
      normalized: false,
      error: 'Invalid or empty team name',
    };
  }

  const name = team_name.trim();

  // Extract club name
  const clubName = extractClubName(name);

  // Generate normalized name
  const normalizedName = clubName ? clubName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim() : null;

  // Generate aliases
  const aliases = generateAliases(clubName);

  return {
    club_name: clubName,
    normalized_name: normalizedName,
    state: state || null,
    aliases,
    normalized: true,
  };
}

/**
 * Extract club name from team name
 * "Sporting Blue Valley SPORTING BV Pre-NAL 15" → "Sporting Blue Valley"
 */
function extractClubName(teamName) {
  const words = teamName.split(/\s+/);

  if (words.length === 0) {
    return null;
  }

  // Find where club name ends (where team-specific info starts)
  let cutoffIndex = words.length;
  let foundPrimaryPattern = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Check primary patterns (always indicate end of club name)
    for (const pattern of PRIMARY_IDENTIFIER_PATTERNS) {
      if (pattern.test(word)) {
        cutoffIndex = i;
        foundPrimaryPattern = true;
        break;
      }
    }

    if (cutoffIndex < words.length) break;

    // Check secondary patterns only at position > 3 (colors can be part of club names early on)
    if (i >= 4) {
      for (const pattern of SECONDARY_IDENTIFIER_PATTERNS) {
        if (pattern.test(word)) {
          cutoffIndex = i;
          break;
        }
      }

      if (cutoffIndex < words.length) break;
    }

    // Check for ALL CAPS word after normal title-case words
    // e.g., "Sporting Blue Valley SPORTING" - SPORTING is start of team-specific part
    if (i >= 2 && word === word.toUpperCase() && /^[A-Z]{2,}$/.test(word)) {
      // Check if previous words were title case (not all caps)
      const prevWords = words.slice(0, i);
      const allTitleCase = prevWords.every(w => w !== w.toUpperCase() || w.length <= 2);
      if (allTitleCase) {
        cutoffIndex = i;
        break;
      }
    }
  }

  // Handle special cases
  if (cutoffIndex === 0) {
    // First word was identifier - use first 2-3 words as club name
    cutoffIndex = Math.min(3, words.length);
  }

  // Extract club name words
  const clubWords = words.slice(0, cutoffIndex);

  // Filter out pure abbreviations at the end
  while (clubWords.length > 1) {
    const lastWord = clubWords[clubWords.length - 1];
    if (lastWord === lastWord.toUpperCase() && /^[A-Z]{2,4}$/.test(lastWord)) {
      clubWords.pop();
    } else {
      break;
    }
  }

  if (clubWords.length === 0) {
    return null;
  }

  // Title case the club name
  const clubName = clubWords.map(word => {
    // Keep short abbreviations (FC, SC) as is
    if (/^[A-Z]{2,3}$/.test(word)) {
      return word;
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');

  return clubName;
}

/**
 * Generate aliases for a club name
 */
function generateAliases(clubName) {
  if (!clubName) return [];

  const aliases = [];
  const lowerName = clubName.toLowerCase();

  // Check known abbreviation patterns
  for (const { full, abbrev } of ABBREVIATION_PATTERNS) {
    if (lowerName === full.toLowerCase()) {
      aliases.push(abbrev);
    }
    if (lowerName === abbrev.toLowerCase()) {
      aliases.push(full);
    }
  }

  // Generate common abbreviations
  const words = clubName.split(/\s+/);

  // Initials abbreviation (e.g., "Sporting Blue Valley" → "SBV")
  if (words.length >= 2) {
    const initials = words.map(w => w.charAt(0).toUpperCase()).join('');
    if (initials.length >= 2 && initials.length <= 5) {
      aliases.push(initials);
    }
  }

  // First word + abbreviation (e.g., "Sporting Blue Valley" → "Sporting BV")
  if (words.length >= 3) {
    const abbrevWords = words.slice(1).map(w => w.charAt(0).toUpperCase()).join('');
    if (abbrevWords.length >= 2) {
      aliases.push(`${words[0]} ${abbrevWords}`);
    }
  }

  // Remove duplicates
  return [...new Set(aliases)];
}

/**
 * Normalize club with registry lookup
 *
 * @param {Object} input - Club input data
 * @param {Object} dbClient - PostgreSQL client for registry lookup
 * @returns {Object} Normalized club data with canonical resolution
 */
export async function normalizeClubWithRegistry(input, dbClient) {
  const { team_name } = input;

  if (!team_name || !dbClient) {
    return normalizeClub(input);
  }

  // First extract club name
  const clubName = extractClubName(team_name);

  if (!clubName) {
    return normalizeClub(input);
  }

  // Check canonical registry
  const { rows } = await dbClient.query(
    `SELECT * FROM resolve_canonical_club($1)`,
    [clubName]
  );

  if (rows.length > 0) {
    const canonical = rows[0];
    return {
      club_name: canonical.canonical_name,
      canonical_id: canonical.canonical_id,
      club_id: canonical.club_id,
      normalized: true,
      from_registry: true,
    };
  }

  // Fall back to rule-based normalization
  return normalizeClub(input);
}

/**
 * Bulk normalize multiple clubs
 *
 * @param {Array} clubs - Array of { team_name, state }
 * @returns {Array} Array of normalized club data
 */
export function normalizeClubsBulk(clubs) {
  return clubs.map(normalizeClub);
}

// ============================================
// UNIT TESTS
// ============================================

export function runTests() {
  console.log('Running clubNormalizer tests...\n');

  const tests = [
    {
      name: 'Basic club extraction',
      input: { team_name: 'Sporting Blue Valley SPORTING BV Pre-NAL 15', state: 'KS' },
      expect: { club_name: 'Sporting Blue Valley', state: 'KS' },
    },
    {
      name: 'KC Fusion extraction',
      input: { team_name: 'KC Fusion 15B Gold', state: 'KS' },
      expect: { club_name: 'KC Fusion' },
    },
    {
      name: 'Rush team extraction',
      input: { team_name: 'Rush 2014B Select', state: 'TX' },
      expect: { club_name: 'Rush', state: 'TX' },
    },
    {
      name: 'FC abbreviation',
      input: { team_name: 'FC Dallas Youth Pre 16G', state: 'TX' },
      expect: { club_name: 'FC Dallas Youth' },
    },
    {
      name: 'Simple team name',
      input: { team_name: 'Tigers U12 Girls', state: 'MO' },
      expect: { club_name: 'Tigers' },
    },
    {
      name: 'Empty input',
      input: { team_name: '', state: 'KS' },
      expect: { normalized: false },
    },
    {
      name: 'Alias generation',
      input: { team_name: 'Sporting Blue Valley 2015B', state: 'KS' },
      expectAliases: ['SBV', 'Sporting BV'],
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = normalizeClub(test.input);
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

    if (test.expectAliases) {
      for (const alias of test.expectAliases) {
        if (!result.aliases.includes(alias)) {
          console.log(`❌ FAIL: ${test.name}`);
          console.log(`   Expected alias: ${alias}`);
          console.log(`   Got aliases: ${result.aliases.join(', ')}`);
          testPassed = false;
          break;
        }
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
if (process.argv[1]?.includes('clubNormalizer')) {
  runTests();
}
