// lib/teamDedup.js

/**
 * @typedef {Object} TeamLike
 * @property {string} id
 * @property {string | null} [canonical_team_id]
 * @property {string | null} [effective_team_id]
 * @property {string | null} [name]
 */

/**
 * Always returns the best team identifier for grouping/joining:
 * 1) effective_team_id (preferred, computed in DB)
 * 2) canonical_team_id (fallback if you didn't select effective_team_id)
 * 3) id (last resort)
 *
 * @param {TeamLike} team
 * @returns {string}
 */
export function getEffectiveTeamId(team) {
  return (
    team.effective_team_id ??
    team.canonical_team_id ??
    team.id
  );
}

/**
 * Normalizes a team name for matching / dedup suggestions.
 * (Used by ingestion tooling / admin scripts, not the UI.)
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeTeamName(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\.\,\-\_\/\\\(\)\[\]\{\}\|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(fc|sc|soccer\s*club|club|u\s*?1?\d|boys|girls|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds a stable canonical matching key.
 *
 * @param {{
 *   name: string,
 *   state?: string | null,
 *   ageGroup?: string | null,
 *   gender?: string | null
 * }} args
 * @returns {string}
 */
export function canonicalKey(args) {
  const base = normalizeTeamName(args.name);
  const s = (args.state ?? "").toLowerCase().trim();
  const a = (args.ageGroup ?? "").toLowerCase().trim();
  const g = (args.gender ?? "").toLowerCase().trim();
  return [base, s, a, g].join("|");
}
