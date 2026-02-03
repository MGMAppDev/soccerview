// ============================================================
// SOCCERVIEW DATABASE TYPES - NEW SCHEMA (Phase 3)
// TypeScript interfaces for materialized views
//
// Updated: January 28, 2026 (Session 53)
// - Added cached season year helper for foolproof age_group calculation
// - Season year is fetched from DB once and cached for the session
// ============================================================

import { supabase } from './supabase';

// ============================================================
// SEASON YEAR - SINGLE SOURCE OF TRUTH
// ============================================================

/**
 * Cached season year (loaded once per app session)
 * Soccer season: Aug 1 of year N to Jul 31 of year N+1
 * Season year = the ending year (e.g., 2025-26 season = 2026)
 */
let CURRENT_SEASON_YEAR: number | null = null;

/**
 * Get current season year from database (cached)
 *
 * This is the SINGLE SOURCE OF TRUTH for age_group calculations.
 * The value is fetched once from the `seasons` table and cached
 * for the lifetime of the app session.
 *
 * @returns Promise<number> The current season year (e.g., 2026)
 */
export async function getCurrentSeasonYear(): Promise<number> {
  if (CURRENT_SEASON_YEAR !== null) {
    return CURRENT_SEASON_YEAR;
  }

  try {
    const { data, error } = await supabase
      .from('seasons')
      .select('year')
      .eq('is_current', true)
      .single();

    if (!error && data?.year) {
      CURRENT_SEASON_YEAR = data.year;
      return CURRENT_SEASON_YEAR;
    }
  } catch (e) {
    console.warn('[supabase.types] Failed to fetch season year from DB, using fallback');
  }

  // Fallback calculation if seasons table unavailable
  CURRENT_SEASON_YEAR = getFallbackSeasonYear();
  return CURRENT_SEASON_YEAR;
}

/**
 * Get current season year synchronously (uses cached value or fallback)
 *
 * Use this when you can't await (e.g., in render functions).
 * Will return fallback value if cache not yet populated.
 *
 * IMPORTANT: Call getCurrentSeasonYear() at app startup to populate cache.
 */
export function getCurrentSeasonYearSync(): number {
  if (CURRENT_SEASON_YEAR !== null) {
    return CURRENT_SEASON_YEAR;
  }
  return getFallbackSeasonYear();
}

/**
 * Fallback calculation if seasons table unavailable
 * If current month >= August, use next year; otherwise use current year
 *
 * Example: January 2026 = season 2026, September 2026 = season 2027
 */
function getFallbackSeasonYear(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed (7 = August)
  return month >= 7 ? year + 1 : year;
}

/**
 * Clear the cached season year (useful for testing or season rollover)
 */
export function clearSeasonYearCache(): void {
  CURRENT_SEASON_YEAR = null;
}

/**
 * Set the cached season year manually (useful for testing)
 */
export function setSeasonYearCache(year: number): void {
  CURRENT_SEASON_YEAR = year;
}

// Gender type matches PostgreSQL enum
export type GenderType = 'M' | 'F';

// Display-friendly gender mapping
export const GENDER_DISPLAY: Record<GenderType, string> = {
  'M': 'Boys',
  'F': 'Girls',
};

// Reverse mapping for filters
export const GENDER_FROM_DISPLAY: Record<string, GenderType> = {
  'Boys': 'M',
  'Girls': 'F',
};

// ============================================================
// APP_RANKINGS VIEW
// Used by: Rankings tab, Teams tab
// ============================================================

export interface AppRankingsRow {
  id: string;
  name: string;            // canonical_name
  display_name: string;    // Full display name
  club_name: string | null;
  birth_year: number;
  gender: GenderType;
  age_group: string;       // e.g., 'U11'
  state: string;
  elo_rating: number;
  // GotSport Rankings (official)
  national_rank: number | null;
  state_rank: number | null;
  gotsport_rank: number | null;
  gotsport_points: number | null;
  // ELO-based Rankings (SoccerView Power Rating)
  elo_national_rank: number | null;  // Rank by ELO nationally
  elo_state_rank: number | null;     // Rank by ELO within state
  // Stats
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  has_matches: boolean;    // true if matches_played > 0
}

// ============================================================
// APP_MATCHES_FEED VIEW
// Used by: Home tab, Matches tab
// ============================================================

export interface EmbeddedTeam {
  id: string;
  name: string;
  display_name: string;
  club_name: string | null;
  elo_rating: number;
  national_rank: number | null;
  state: string;
}

export interface EmbeddedEvent {
  id: string;
  name: string;
  type: 'league' | 'tournament';
}

export interface EmbeddedVenue {
  id: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
}

export interface AppMatchesFeedRow {
  id: string;
  match_date: string;      // ISO date string
  match_time: string | null;
  home_score: number;
  away_score: number;
  home_team: EmbeddedTeam; // JSONB object
  away_team: EmbeddedTeam; // JSONB object
  event: EmbeddedEvent;    // JSONB object
  venue: EmbeddedVenue;    // JSONB object
  gender: GenderType;
  birth_year: number;
  age_group: string;
  state: string;
}

// ============================================================
// APP_TEAM_PROFILE VIEW
// Used by: Team detail page
// ============================================================

export interface RecentMatch {
  id: string;
  match_date: string;
  home_score: number;
  away_score: number;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  league_id: string | null;      // For grouping by league
  tournament_id: string | null;  // For grouping by tournament
  event_name: string | null;
  event_type: 'league' | 'tournament';
}

export interface UpcomingSchedule {
  id: string;
  match_date: string;
  match_time: string | null;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  league_id: string | null;      // For grouping by league
  tournament_id: string | null;  // For grouping by tournament
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  field_name: string | null;
  event_name: string | null;
  event_type: 'league' | 'tournament';
}

export interface RankHistoryEntry {
  snapshot_date: string;
  elo_rating: number;
  national_rank: number | null;
  state_rank: number | null;
}

export interface TeamLeague {
  id: string;
  name: string;
}

export interface AppTeamProfileRow {
  id: string;
  name: string;            // canonical_name
  display_name: string;
  club_name: string | null;
  club_id: string | null;
  club_logo_url: string | null;
  birth_year: number;
  gender: GenderType;
  age_group: string;
  state: string;
  elo_rating: number;
  // GotSport Rankings (official)
  national_rank: number | null;
  state_rank: number | null;
  regional_rank: number | null;
  gotsport_rank: number | null;
  gotsport_points: number | null;
  // ELO-based Rankings (SoccerView Power Rating)
  elo_national_rank: number | null;  // Rank by ELO nationally
  elo_state_rank: number | null;     // Rank by ELO within state
  // Stats
  wins: number;
  losses: number;
  draws: number;
  matches_played: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  known_aliases: string[];

  // Embedded JSONB arrays
  recent_matches: RecentMatch[];      // Last 10 matches
  upcoming_schedule: UpcomingSchedule[]; // Next 10 games
  rank_history: RankHistoryEntry[];   // Last 90 days
  leagues: TeamLeague[];              // Leagues team plays in

  updated_at: string;
}

// ============================================================
// APP_LEAGUE_STANDINGS VIEW
// Used by: League detail page
// ============================================================

export type FormResult = 'W' | 'D' | 'L';

export interface AppLeagueStandingsRow {
  league_id: string;
  league_name: string;
  team_id: string;
  team_name: string;       // canonical_name
  display_name: string;
  elo_rating: number;
  national_rank: number | null;
  gender: GenderType;
  birth_year: number;
  age_group: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  form: FormResult[];      // Array of last 5 results ['W', 'D', 'L', ...]
  position: number;        // Rank in league standings
}

// ============================================================
// APP_UPCOMING_SCHEDULE VIEW
// Used by: Team schedule, venue schedule
// ============================================================

export interface EmbeddedVenueExtended {
  id: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface AppUpcomingScheduleRow {
  id: string;
  match_date: string;
  match_time: string | null;
  home_team: EmbeddedTeam;
  away_team: EmbeddedTeam;
  event: EmbeddedEvent;
  venue: EmbeddedVenueExtended;
  field_name: string | null;
  gender: GenderType;
  birth_year: number;
  age_group: string;
  state: string;
}

// ============================================================
// HELPER FUNCTIONS - AGE GROUP CALCULATIONS
// ============================================================

/**
 * Calculate age group from birth year using GotSport formula
 *
 * Formula: age_group = 'U' + (season_year - birth_year)
 *
 * Example (season 2026):
 *   birth_year 2013 → 2026 - 2013 = 13 → U13
 *   birth_year 2014 → 2026 - 2014 = 12 → U12
 *   birth_year 2015 → 2026 - 2015 = 11 → U11
 *
 * @param birthYear - The player birth year (e.g., 2013)
 * @param seasonYear - Optional: The season year. If not provided, uses cached/fallback.
 * @returns Age group string (e.g., 'U13')
 */
export function calculateAgeGroup(birthYear: number, seasonYear?: number): string {
  const year = seasonYear ?? getCurrentSeasonYearSync();
  const age = year - birthYear;
  return `U${age}`;
}

/**
 * Calculate age group asynchronously (fetches season from DB if needed)
 *
 * Use this when accuracy is critical and you can await.
 *
 * @param birthYear - The player birth year (e.g., 2013)
 * @returns Promise<string> Age group string (e.g., 'U13')
 */
export async function calculateAgeGroupAsync(birthYear: number): Promise<string> {
  const seasonYear = await getCurrentSeasonYear();
  return `U${seasonYear - birthYear}`;
}

/**
 * Parse age group to birth year using GotSport formula
 *
 * Formula: birth_year = season_year - age
 *
 * Example (season 2026):
 *   'U13' → 2026 - 13 = 2013
 *   'U12' → 2026 - 12 = 2014
 *   'U11' → 2026 - 11 = 2015
 *
 * @param ageGroup - The age group string (e.g., 'U13')
 * @param seasonYear - Optional: The season year. If not provided, uses cached/fallback.
 * @returns The birth year, or null if ageGroup is invalid
 */
export function ageGroupToBirthYear(ageGroup: string, seasonYear?: number): number | null {
  const match = ageGroup.match(/^U(\d+)$/i);
  if (!match) return null;
  const age = parseInt(match[1], 10);
  const year = seasonYear ?? getCurrentSeasonYearSync();
  return year - age;
}

/**
 * Parse age group to birth year asynchronously (fetches season from DB if needed)
 *
 * @param ageGroup - The age group string (e.g., 'U13')
 * @returns Promise<number | null> The birth year, or null if ageGroup is invalid
 */
export async function ageGroupToBirthYearAsync(ageGroup: string): Promise<number | null> {
  const match = ageGroup.match(/^U(\d+)$/i);
  if (!match) return null;
  const age = parseInt(match[1], 10);
  const seasonYear = await getCurrentSeasonYear();
  return seasonYear - age;
}

/**
 * Normalize age group format (e.g., 'U09' -> 'U9')
 */
export function normalizeAgeGroup(ageGroup: string | null | undefined): string | null {
  if (!ageGroup) return null;
  const trimmed = ageGroup.trim();
  const match = trimmed.match(/^U0*(\d+)$/i);
  if (match) {
    return `U${parseInt(match[1], 10)}`;
  }
  return trimmed;
}

/**
 * Get display-friendly gender text
 */
export function getGenderDisplay(gender: GenderType): string {
  return GENDER_DISPLAY[gender] || gender;
}

/**
 * Convert display gender to database enum
 */
export function getGenderEnum(displayGender: string): GenderType | null {
  return GENDER_FROM_DISPLAY[displayGender] ?? null;
}
