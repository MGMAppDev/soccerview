/**
 * cleanTeamName.cjs — Single Source of Truth for duplicate prefix removal.
 *
 * ARCHITECTURE: This file IS the algorithm. All consumers import from here:
 *   - teamNormalizer.js (ESM: import from CJS)
 *   - fastProcessStaging.cjs (CJS: require)
 *   - processStandings.cjs (CJS: require)
 *
 * N-word sliding window: handles any prefix length (1-word through 5-word clubs).
 * Unicode-safe: normalizes diacritics before comparison (Barça = Barca, Atlético = Atletico).
 *
 * Examples:
 *   "Rush Rush Pre-ECNL"                           → "Rush Pre-ECNL"           (1-word)
 *   "Kansas Rush Kansas Rush Pre-ECNL 14B"         → "Kansas Rush Pre-ECNL 14B" (2-word)
 *   "Sporting Blue Valley Sporting Blue Valley Acad"→ "Sporting Blue Valley Acad" (3-word)
 *   "Barca Academy Barça Academy 2013 Blau"         → "Barça Academy 2013 Blau"  (diacritics)
 *
 * Performance: <1ms per name. Pure string operation, no DB calls.
 */

/**
 * Strip diacritical marks for comparison: Barça → barca, Atlético → atletico, München → munchen.
 * Uses Unicode NFD decomposition to separate base chars from combining marks, then strips marks.
 */
function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Remove duplicate club prefix from a team name.
 * Uses a sliding-window approach: tries longest feasible prefix first,
 * then works down to 1-word. Diacritic-insensitive comparison.
 *
 * @param {string} name - Raw team name
 * @returns {string} Cleaned team name (unchanged if no duplicate found)
 */
function removeDuplicatePrefix(name) {
  if (!name || typeof name !== 'string') return name;
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);
  // Max prefix = half the words (since it must repeat)
  const maxPrefix = Math.floor(words.length / 2);
  // Pre-compute stripped words for diacritic-insensitive comparison
  const stripped = words.map(stripDiacritics);
  // Try longest prefix first (up to 5 words), work down to 1
  for (let len = Math.min(maxPrefix, 5); len >= 1; len--) {
    let match = true;
    for (let i = 0; i < len; i++) {
      if (stripped[i] !== stripped[i + len]) {
        match = false;
        break;
      }
    }
    if (match) return words.slice(len).join(' ');
  }
  return trimmed;
}

module.exports = { removeDuplicatePrefix };
