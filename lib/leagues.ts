/**
 * League Standings - Supabase Queries
 *
 * This module provides all database queries for the League Standings feature.
 * Created: January 22, 2026 (Day 37.4)
 * Updated: January 28, 2026 (Phase 3) - Added support for new materialized views
 * Updated: January 28, 2026 (Session 53) - Use season year for age calculations
 */

import { supabase } from './supabase';
import {
  AppLeagueStandingsRow,
  GENDER_DISPLAY,
  getCurrentSeasonYearSync,
  ageGroupToBirthYear,
  calculateAgeGroup,
} from './supabase.types';

// Types
export interface LeagueInfo {
  eventId: string;           // Changed from event_id for consistency
  eventName: string;         // Changed from event_name
  sourceType: 'league' | 'tournament' | string;  // Changed from source_type
  matchCount?: number;       // Optional - may not always be available
  teamCount?: number;        // Optional
  region?: string | null;
  state?: string | null;
  season?: string | null;
  // Legacy aliases for backward compatibility
  event_id?: string;
  event_name?: string;
  source_type?: 'league' | 'tournament' | string;
  match_count?: number;
  team_count?: number;
}

export interface LeagueTeam {
  id: string;
  name: string;
  club_name: string | null;
  age_group: string | null;
  gender: string | null;
  elo_rating: number | null;
  elo_national_rank: number | null;
  elo_state_rank: number | null;
  league_rank: number;
  wins: number;
  losses: number;
  draws: number;
  goals_for: number;
  goals_against: number;
}

export interface LeagueMatch {
  id: string;
  match_date: string;
  match_time: string | null;
  home_team_id: string;
  home_team_name: string;
  home_score: number | null;
  away_team_id: string;
  away_team_name: string;
  away_score: number | null;
  status: string;
  age_group: string | null;
  gender: string | null;
}

/**
 * Points Table Team - Traditional soccer standings
 */
export interface LeaguePointsTableTeam {
  id: string;
  name: string;
  club_name: string | null;
  age_group: string | null;
  gender: string | null;
  position: number;              // Rank in table (1-N)
  games_played: number;          // GP
  wins: number;                  // W
  draws: number;                 // D
  losses: number;                // L
  goals_for: number;             // GF
  goals_against: number;         // GA
  goal_difference: number;       // GD = GF - GA
  points: number;                // Pts (Win=3, Draw=1, Loss=0)
  form: FormResult[];            // Last 5 matches: ['W', 'D', 'L', 'W', 'W']

  // Optional: Link to Power Rating
  elo_rating?: number;
  elo_national_rank?: number;
}

/**
 * Form Result - Win/Draw/Loss
 */
export type FormResult = 'W' | 'D' | 'L';

/**
 * Head-to-Head Stats - For future tiebreaker implementation
 */
export interface HeadToHeadStats {
  team1_wins: number;
  team2_wins: number;
  draws: number;
  team1_goals: number;
  team2_goals: number;
  matches: {
    id: string;
    date: string;
    team1_score: number;
    team2_score: number;
    result: 'W' | 'D' | 'L';  // From team1 perspective
  }[];
}

/**
 * Get league/tournament info by event_id
 *
 * Uses v2 leagues and tournaments tables.
 * Per No Fallback Policy: v2 schema is THE architecture.
 */
export async function getLeagueInfo(eventId: string): Promise<LeagueInfo | null> {
  // Try leagues table first
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('id, name, season_id, state, region')
    .eq('id', eventId)
    .single();

  if (!leagueError && league) {
    // Session 91: Get current season boundaries for scoping
    const { data: season } = await supabase
      .from('seasons')
      .select('start_date, end_date')
      .eq('is_current', true)
      .single();

    // Get real counts from data (Session 91: replace null placeholders)
    // Team count from materialized view (already season-scoped after migration 091)
    const { count: teamCount } = await supabase
      .from('app_league_standings')
      .select('team_id', { count: 'exact', head: true })
      .eq('league_id', eventId);

    // Match count scoped to current season
    let matchQuery = supabase
      .from('matches_v2')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', eventId)
      .is('deleted_at', null)
      .not('home_score', 'is', null);

    if (season) {
      matchQuery = matchQuery
        .gte('match_date', season.start_date)
        .lte('match_date', season.end_date);
    }

    const { count: matchCount } = await matchQuery;

    return {
      eventId: league.id,
      eventName: league.name,
      sourceType: 'league',
      matchCount: matchCount ?? 0,
      teamCount: teamCount ?? 0,
      region: league.region,
      state: league.state,
      season: league.season_id,
      event_id: league.id,
      event_name: league.name,
      source_type: 'league',
      match_count: matchCount ?? 0,
      team_count: teamCount ?? 0,
    };
  }

  // Try tournaments table
  const { data: tournament, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, name, season_id, state, region')
    .eq('id', eventId)
    .single();

  if (!tournamentError && tournament) {
    return {
      eventId: tournament.id,
      eventName: tournament.name,
      sourceType: 'tournament',
      matchCount: null,
      teamCount: null,
      region: tournament.region,
      state: tournament.state,
      season: tournament.season_id,
      event_id: tournament.id,
      event_name: tournament.name,
      source_type: 'tournament',
      match_count: null,
      team_count: null,
    };
  }

  console.error('Event not found in leagues or tournaments:', eventId);
  return null;
}

/**
 * Get points-based league standings (traditional soccer table)
 *
 * Uses pre-computed app_league_standings materialized view.
 * Per No Fallback Policy: v2 schema is THE architecture.
 *
 * @param eventId - Event ID (league_id) to get standings for
 * @param filters - Optional filters (age group, gender)
 * @returns Array of teams with points table stats, sorted by position
 */
export async function getLeaguePointsTable(
  eventId: string,
  filters?: { ageGroup?: string; gender?: string; division?: string }
): Promise<LeaguePointsTableTeam[]> {
  try {
    let query = supabase
      .from('app_league_standings')
      .select('*')
      .eq('league_id', eventId)
      .order('position', { ascending: true })
      .limit(100);

    // Apply filters
    if (filters?.ageGroup && filters.ageGroup !== 'All') {
      query = query.eq('age_group', filters.ageGroup);
    }
    if (filters?.gender && filters.gender !== 'All') {
      const dbGender = filters.gender === 'Boys' ? 'M' : filters.gender === 'Girls' ? 'F' : filters.gender;
      query = query.eq('gender', dbGender);
    }
    if (filters?.division && filters.division !== 'All') {
      query = query.eq('division', filters.division);
    }

    const { data: viewData, error: viewError } = await query;

    if (viewError) {
      console.error('[Leagues] Error fetching standings:', viewError);
      return [];
    }

    if (!viewData || viewData.length === 0) {
      console.log('[Leagues] No standings data for league:', eventId);
      return [];
    }

    const pointsTable: LeaguePointsTableTeam[] = viewData.map((row: AppLeagueStandingsRow) => ({
      id: row.team_id,
      name: row.display_name || row.team_name,
      club_name: null,
      age_group: row.age_group,
      gender: GENDER_DISPLAY[row.gender] ?? row.gender,
      position: row.position,
      games_played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      goals_for: row.goals_for,
      goals_against: row.goals_against,
      goal_difference: row.goal_difference,
      points: row.points,
      form: row.form || [],
      elo_rating: row.elo_rating ?? undefined,
      elo_national_rank: row.national_rank ?? undefined,
    }));

    // Session 91: Re-rank sequentially after filtering (view positions may have gaps)
    pointsTable.forEach((team, index) => {
      team.position = index + 1;
    });

    return pointsTable;

  } catch (error) {
    console.error('Unexpected error in getLeaguePointsTable:', error);
    return [];
  }
}

/**
 * Get recent form (last 5 matches) for teams in an event
 * Returns form as array of W/D/L in chronological order (oldest → newest)
 *
 * NOTE: For league standings, use app_league_standings view which has form pre-computed.
 * This function is kept for other use cases.
 *
 * Uses v2 matches_v2 table.
 * Per No Fallback Policy: v2 schema is THE architecture.
 */
export async function getTeamsForm(
  eventId: string,
  teamIds: string[]
): Promise<Map<string, FormResult[]>> {
  const formMap = new Map<string, FormResult[]>();

  if (teamIds.length === 0) return formMap;

  // Skip for large leagues - query is expensive
  if (teamIds.length > 50) {
    console.log(`Skipping form calculation for ${teamIds.length} teams (too many)`);
    return formMap;
  }

  try {
    // Get matches from v2 table
    const { data: matches, error } = await supabase
      .from('matches_v2')
      .select('id, home_team_id, away_team_id, home_score, away_score, match_date')
      .eq('league_id', eventId)
      .is('deleted_at', null)  // Session 91: Principle 33 compliance
      .or(`home_team_id.in.(${teamIds.join(',')}),away_team_id.in.(${teamIds.join(',')})`)
      .not('home_score', 'is', null)
      .not('away_score', 'is', null)
      .order('match_date', { ascending: true })
      .limit(1000);

    if (error) {
      console.error('Error fetching form data:', error);
      return formMap;
    }

    if (!matches) return formMap;

    // Group matches by team
    const teamMatches: Record<string, Array<{ date: string; result: FormResult }>> = {};

    matches.forEach(match => {
      const homeId = match.home_team_id;
      const awayId = match.away_team_id;
      const homeScore = match.home_score!;
      const awayScore = match.away_score!;
      const date = match.match_date;

      // Process home team
      if (homeId && teamIds.includes(homeId)) {
        if (!teamMatches[homeId]) teamMatches[homeId] = [];

        let result: FormResult;
        if (homeScore > awayScore) result = 'W';
        else if (homeScore === awayScore) result = 'D';
        else result = 'L';

        teamMatches[homeId].push({ date, result });
      }

      // Process away team
      if (awayId && teamIds.includes(awayId)) {
        if (!teamMatches[awayId]) teamMatches[awayId] = [];

        let result: FormResult;
        if (awayScore > homeScore) result = 'W';
        else if (awayScore === homeScore) result = 'D';
        else result = 'L';

        teamMatches[awayId].push({ date, result });
      }
    });

    // Extract last 5 matches for each team
    teamIds.forEach(teamId => {
      const matches = teamMatches[teamId] || [];
      matches.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const last5 = matches.slice(-5);
      const form = last5.map(m => m.result);
      formMap.set(teamId, form);
    });

    return formMap;

  } catch (error) {
    console.error('Unexpected error in getTeamsForm:', error);
    return formMap;
  }
}

/**
 * Get teams in a league with their ELO ratings and W-L-D record (Power Ratings mode)
 *
 * Uses v2 app_league_standings view, sorted by ELO rating.
 * Per No Fallback Policy: v2 schema is THE architecture.
 */
export async function getLeagueStandings(
  eventId: string,
  filters?: { ageGroup?: string; gender?: string; division?: string }
): Promise<LeagueTeam[]> {
  try {
    let query = supabase
      .from('app_league_standings')
      .select('*')
      .eq('league_id', eventId)
      .limit(100);

    // Apply filters
    if (filters?.ageGroup && filters.ageGroup !== 'All') {
      query = query.eq('age_group', filters.ageGroup);
    }
    if (filters?.gender && filters.gender !== 'All') {
      const dbGender = filters.gender === 'Boys' ? 'M' : filters.gender === 'Girls' ? 'F' : filters.gender;
      query = query.eq('gender', dbGender);
    }
    if (filters?.division && filters.division !== 'All') {
      query = query.eq('division', filters.division);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching league standings:', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Transform to LeagueTeam format and sort by ELO
    const leagueTeams: LeagueTeam[] = data.map((row: AppLeagueStandingsRow) => ({
      id: row.team_id,
      name: row.display_name || row.team_name,
      club_name: null,
      age_group: row.age_group,
      gender: GENDER_DISPLAY[row.gender] ?? row.gender,
      elo_rating: row.elo_rating ?? null,
      elo_national_rank: row.national_rank ?? null,
      elo_state_rank: null,
      league_rank: 0,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      goals_for: row.goals_for,
      goals_against: row.goals_against,
    }));

    // Sort by ELO rating (descending), nulls last
    leagueTeams.sort((a, b) => {
      if (a.elo_rating === null && b.elo_rating === null) return 0;
      if (a.elo_rating === null) return 1;
      if (b.elo_rating === null) return -1;
      return b.elo_rating - a.elo_rating;
    });

    // Assign league ranks by ELO
    leagueTeams.forEach((team, index) => {
      team.league_rank = index + 1;
    });

    return leagueTeams;

  } catch (error) {
    console.error('Error in getLeagueStandings:', error);
    return [];
  }
}

/**
 * Get matches in a league/tournament
 *
 * Uses v2 matches_v2 table.
 * Per No Fallback Policy: v2 schema is THE architecture.
 */
export async function getLeagueMatches(
  eventId: string,
  filters?: { ageGroup?: string; gender?: string; division?: string; upcoming?: boolean }
): Promise<LeagueMatch[]> {
  try {
    const hasAgeFilter = filters?.ageGroup && filters.ageGroup !== 'All';
    const hasGenderFilter = filters?.gender && filters.gender !== 'All';
    const hasDivisionFilter = filters?.division && filters.division !== 'All';
    const hasFilters = hasAgeFilter || hasGenderFilter;

    // Convert age group to birth year for DB-level filtering
    const birthYear = hasAgeFilter ? ageGroupToBirthYear(filters!.ageGroup!) : null;
    const dbGender = hasGenderFilter
      ? (filters!.gender === 'Boys' ? 'M' : filters!.gender === 'Girls' ? 'F' : filters!.gender)
      : null;

    // Session 91: Get current season boundaries for date scoping
    const { data: season } = await supabase
      .from('seasons')
      .select('start_date, end_date')
      .eq('is_current', true)
      .single();

    // Session 91: Use !inner on home_team FK when filtering — converts LEFT JOIN to INNER JOIN
    // In youth soccer, both teams share the same age group + gender, so filtering
    // by home_team is sufficient. This avoids URL length issues from .or().in() with 200+ UUIDs.
    const homeTeamJoin = hasFilters
      ? 'home_team:teams_v2!matches_v2_home_team_id_fkey!inner(display_name, birth_year, gender)'
      : 'home_team:teams_v2!matches_v2_home_team_id_fkey(display_name, birth_year, gender)';

    let query = supabase
      .from('matches_v2')
      .select(`
        id,
        match_date,
        match_time,
        home_team_id,
        away_team_id,
        home_score,
        away_score,
        ${homeTeamJoin},
        away_team:teams_v2!matches_v2_away_team_id_fkey(display_name)
      `)
      .eq('league_id', eventId)
      .is('deleted_at', null)  // Principle 33 compliance
      .order('match_date', { ascending: false })
      .limit(50);

    // Season scoping (same pattern as recalculate_elo_v2.js)
    if (season) {
      query = query
        .gte('match_date', season.start_date)
        .lte('match_date', season.end_date);
    }

    if (filters?.upcoming) {
      query = query.is('home_score', null);
    }

    // Apply age/gender filters via PostgREST embedded resource filtering
    if (birthYear !== null) {
      query = query.eq('home_team.birth_year', birthYear);
    }
    if (dbGender) {
      query = query.eq('home_team.gender', dbGender);
    }
    // Division filter: direct column on matches_v2
    if (hasDivisionFilter) {
      query = query.eq('division', filters!.division!);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching league matches:', error);
      return [];
    }

    // Transform to LeagueMatch format
    const matches: LeagueMatch[] = (data || []).map((m: any) => ({
      id: m.id,
      match_date: m.match_date,
      match_time: m.match_time,
      home_team_id: m.home_team_id,
      home_team_name: m.home_team?.display_name || 'Unknown',
      home_score: m.home_score,
      away_team_id: m.away_team_id,
      away_team_name: m.away_team?.display_name || 'Unknown',
      away_score: m.away_score,
      status: m.home_score !== null ? 'completed' : 'scheduled',
      age_group: m.home_team?.birth_year ? calculateAgeGroup(m.home_team.birth_year) : null,
      gender: m.home_team?.gender === 'M' ? 'Boys' : m.home_team?.gender === 'F' ? 'Girls' : m.home_team?.gender,
    }));

    return matches;

  } catch (error) {
    console.error('Error in getLeagueMatches:', error);
    return [];
  }
}

/**
 * Get unique age groups in a league
 *
 * Uses v2 app_league_standings view.
 * Per No Fallback Policy: v2 schema is THE architecture.
 */
// Valid competitive age groups (U8 through U19)
const VALID_AGE_GROUPS = new Set([
  'U8', 'U9', 'U10', 'U11', 'U12', 'U13',
  'U14', 'U15', 'U16', 'U17', 'U18', 'U19',
]);

export async function getLeagueAgeGroups(eventId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('app_league_standings')
    .select('age_group')
    .eq('league_id', eventId)
    .limit(500);

  if (error) {
    console.error('Error fetching age groups:', error);
    return [];
  }

  // Session 91: Filter to valid U8-U19 range, sort numerically
  const ageGroups = [...new Set(data?.map(m => m.age_group).filter(Boolean) || [])]
    .filter(ag => VALID_AGE_GROUPS.has(ag))
    .sort((a, b) => {
      const numA = parseInt(a.replace('U', ''), 10);
      const numB = parseInt(b.replace('U', ''), 10);
      return numA - numB;
    });
  return ageGroups;
}

/**
 * Get unique divisions/tiers for a league, scoped to selected age group + gender.
 *
 * Returns sorted array of non-null division names.
 * Returns empty array when no divisions exist (UI should hide division filter).
 */
export async function getLeagueDivisions(
  eventId: string,
  filters?: { ageGroup?: string; gender?: string }
): Promise<string[]> {
  let query = supabase
    .from('app_league_standings')
    .select('division')
    .eq('league_id', eventId)
    .not('division', 'is', null)
    .limit(500);

  if (filters?.ageGroup && filters.ageGroup !== 'All') {
    query = query.eq('age_group', filters.ageGroup);
  }
  if (filters?.gender && filters.gender !== 'All') {
    const dbGender = filters.gender === 'Boys' ? 'M' : filters.gender === 'Girls' ? 'F' : filters.gender;
    query = query.eq('gender', dbGender);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching divisions:', error);
    return [];
  }

  // Deduplicate and sort
  const divisions = [...new Set(data?.map(d => d.division).filter(Boolean) || [])]
    .sort((a, b) => {
      // Sort "Division N" numerically, then alphabetical for named tiers
      const numA = a.match(/^Division (\d+)$/)?.[1];
      const numB = b.match(/^Division (\d+)$/)?.[1];
      if (numA && numB) return parseInt(numA) - parseInt(numB);
      if (numA) return -1;  // Numbered divisions first
      if (numB) return 1;
      return a.localeCompare(b);
    });

  return divisions;
}

/**
 * Get ONLY actual LEAGUES that a team participates in (NOT tournaments)
 * This powers the "View League Standings" button on Team Detail
 *
 * Uses v2 matches_v2 and leagues tables.
 * Per No Fallback Policy: v2 schema is THE architecture.
 */
export async function getTeamLeagues(teamId: string): Promise<LeagueInfo[]> {
  // Get league IDs from matches where this team played
  const { data: homeMatches } = await supabase
    .from('matches_v2')
    .select('league_id')
    .eq('home_team_id', teamId)
    .is('deleted_at', null)  // Session 91: Principle 33 compliance
    .not('league_id', 'is', null);

  const { data: awayMatches } = await supabase
    .from('matches_v2')
    .select('league_id')
    .eq('away_team_id', teamId)
    .is('deleted_at', null)  // Session 91: Principle 33 compliance
    .not('league_id', 'is', null);

  const leagueIds = [
    ...new Set([
      ...(homeMatches?.map(m => m.league_id) || []),
      ...(awayMatches?.map(m => m.league_id) || [])
    ])
  ].filter(Boolean);

  if (leagueIds.length === 0) return [];

  // Get league info from v2 leagues table
  const { data: leagues, error } = await supabase
    .from('leagues')
    .select('id, name, season_id, state, region, source_event_id')
    .in('id', leagueIds)
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching team leagues:', error);
    return [];
  }

  // Transform to LeagueInfo format
  return (leagues || []).map(l => ({
    eventId: l.id,
    eventName: l.name,
    sourceType: 'league' as const,
    matchCount: null,
    region: l.region,
    state: l.state,
    season: l.season_id,
    // Legacy aliases
    event_id: l.id,
    event_name: l.name,
    source_type: 'league',
    match_count: null,
  }));
}

/**
 * Search leagues and tournaments by name
 *
 * Uses v2 leagues and tournaments tables.
 * Per No Fallback Policy: v2 schema is THE architecture.
 */
export async function searchLeagues(
  searchTerm: string,
  filters?: { type?: 'league' | 'tournament' | 'all' }
): Promise<LeagueInfo[]> {
  const results: LeagueInfo[] = [];

  // Search leagues if type is 'league' or 'all'
  if (!filters?.type || filters.type === 'all' || filters.type === 'league') {
    const { data: leagues, error: leaguesError } = await supabase
      .from('leagues')
      .select('id, name, season_id, state, region')
      .ilike('name', `%${searchTerm}%`)
      .limit(25);

    if (leaguesError) {
      console.error('Error searching leagues:', leaguesError);
    } else {
      results.push(...(leagues || []).map(l => ({
        eventId: l.id,
        eventName: l.name,
        sourceType: 'league' as const,
        matchCount: null,
        region: l.region,
        state: l.state,
        season: l.season_id,
        event_id: l.id,
        event_name: l.name,
        source_type: 'league',
        match_count: null,
      })));
    }
  }

  // Search tournaments if type is 'tournament' or 'all'
  if (!filters?.type || filters.type === 'all' || filters.type === 'tournament') {
    const { data: tournaments, error: tournamentsError } = await supabase
      .from('tournaments')
      .select('id, name, season_id, state, region')
      .ilike('name', `%${searchTerm}%`)
      .limit(25);

    if (tournamentsError) {
      console.error('Error searching tournaments:', tournamentsError);
    } else {
      results.push(...(tournaments || []).map(t => ({
        eventId: t.id,
        eventName: t.name,
        sourceType: 'tournament' as const,
        matchCount: null,
        region: t.region,
        state: t.state,
        season: t.season_id,
        event_id: t.id,
        event_name: t.name,
        source_type: 'tournament',
        match_count: null,
      })));
    }
  }

  // Sort alphabetically by name
  return results.sort((a, b) => (a.eventName || '').localeCompare(b.eventName || ''));
}

// ============================================================
// LEAGUES TAB - Browse/Search Leagues
// ============================================================

/**
 * League list item for the Leagues tab
 */
export interface LeagueListItem {
  id: string;
  name: string;
  state: string | null;
  region: string | null;
  teamCount: number;
  matchCount: number;
}

/**
 * Get all leagues with current-season team/match counts
 *
 * Uses leagues table + app_league_standings view (season-scoped).
 * Only returns leagues that have current-season standings data.
 * Per No Fallback Policy: v2 schema is THE architecture.
 */
export async function getLeaguesList(filters?: {
  states?: string[];
  search?: string;
}): Promise<LeagueListItem[]> {
  // 1. Fetch leagues (280 rows — small enough for one query)
  let query = supabase
    .from('leagues')
    .select('id, name, state, region')
    .order('name');

  if (filters?.states && filters.states.length > 0) {
    query = query.in('state', filters.states);
  }
  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`);
  }

  const { data: leagues, error } = await query;
  if (error || !leagues) return [];

  // 2. Get per-league stats from season-scoped standings view (single query)
  // Each row = one team in one league. played = that team's games played.
  // teamCount = count of rows per league, matchCount = SUM(played) / 2 per league
  // (each match is counted once for each team → total played = 2 × matches)
  const { data: standings } = await supabase
    .from('app_league_standings')
    .select('league_id, played')
    .limit(50000);

  const leagueStats = new Map<string, { teamCount: number; totalPlayed: number }>();
  for (const row of standings || []) {
    const existing = leagueStats.get(row.league_id);
    if (existing) {
      existing.teamCount++;
      existing.totalPlayed += row.played || 0;
    } else {
      leagueStats.set(row.league_id, { teamCount: 1, totalPlayed: row.played || 0 });
    }
  }

  // 3. Merge and return — only leagues with current-season data
  return leagues
    .map(l => {
      const stats = leagueStats.get(l.id);
      return {
        id: l.id,
        name: l.name,
        state: l.state,
        region: l.region,
        teamCount: stats?.teamCount || 0,
        matchCount: stats ? Math.round(stats.totalPlayed / 2) : 0,
      };
    })
    .filter(l => l.teamCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
