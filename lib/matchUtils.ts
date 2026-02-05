/**
 * matchUtils.ts — Shared match display utilities
 *
 * Single source of truth for match status determination and event type badges.
 * All match-related display logic lives here — no local duplicates in page files.
 */

/** Minimal match shape for status determination */
type MatchForStatus = {
  home_score: number | null;
  away_score: number | null;
  match_date: string | null;
};

/**
 * Determine actual match status from data.
 * V2 schema has no status field — derive from scores + date.
 */
export function getMatchStatus(
  match: MatchForStatus,
): "completed" | "upcoming" | "live" {
  const hasScore = match.home_score !== null && match.away_score !== null;

  // If we have scores, match is completed
  if (hasScore) return "completed";

  // Check date
  if (match.match_date) {
    const matchDate = new Date(match.match_date);
    const now = new Date();
    if (matchDate > now) return "upcoming";
    // Past date without scores = completed (no scores recorded)
    return "completed";
  }

  return "upcoming";
}

/**
 * Get event type badge — universal icon convention for league vs tournament.
 */
export function getEventTypeBadge(
  eventType: string | null,
): { emoji: string; label: string } | null {
  if (!eventType) return null;
  const type = eventType.toLowerCase();
  if (type === "league") return { emoji: "\u26BD", label: "League Match" };
  if (type === "tournament") return { emoji: "\uD83C\uDFC6", label: "Tournament" };
  return null;
}
