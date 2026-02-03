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
    return {
      eventId: league.id,
      eventName: league.name,
      sourceType: 'league',
      matchCount: null,
      teamCount: null,
      region: league.region,
      state: league.state,
      season: league.season_id,
      event_id: league.id,
      event_name: league.name,
      source_type: 'league',
      match_count: null,
      team_count: null,
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
  filters?: { ageGroup?: string; gender?: string }
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
  filters?: { ageGroup?: string; gender?: string }
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
  filters?: { ageGroup?: string; gender?: string; upcoming?: boolean }
): Promise<LeagueMatch[]> {
  try {
    // Note: birth_year and gender are on teams_v2, not matches_v2
    // We get them via the joined home_team relation
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
        home_team:teams_v2!matches_v2_home_team_id_fkey(display_name, birth_year, gender),
        away_team:teams_v2!matches_v2_away_team_id_fkey(display_name)
      `)
      .eq('league_id', eventId)
      .limit(50);

    // Note: Filters by age_group/gender would need a subquery or post-filtering
    // For now, we filter after fetching since matches don't have these columns directly
    if (filters?.upcoming) {
      query = query.is('home_score', null);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching league matches:', error);
      return [];
    }

    // Transform to LeagueMatch format
    let matches: LeagueMatch[] = (data || []).map((m: any) => ({
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
      // Get birth_year/gender from home team
      age_group: m.home_team?.birth_year ? calculateAgeGroup(m.home_team.birth_year) : null,
      gender: m.home_team?.gender === 'M' ? 'Boys' : m.home_team?.gender === 'F' ? 'Girls' : m.home_team?.gender,
    }));

    // Apply filters post-fetch (since these columns aren't on matches_v2)
    if (filters?.ageGroup && filters.ageGroup !== 'All') {
      matches = matches.filter(m => m.age_group === filters.ageGroup);
    }
    if (filters?.gender && filters.gender !== 'All') {
      matches = matches.filter(m => m.gender === filters.gender);
    }

    // Sort by date (most recent first)
    matches.sort((a, b) => {
      const dateA = a.match_date ? new Date(a.match_date).getTime() : 0;
      const dateB = b.match_date ? new Date(b.match_date).getTime() : 0;
      return dateB - dateA;
    });

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

  const ageGroups = [...new Set(data?.map(m => m.age_group).filter(Boolean) || [])];
  return ageGroups.sort();
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
    .not('league_id', 'is', null);

  const { data: awayMatches } = await supabase
    .from('matches_v2')
    .select('league_id')
    .eq('away_team_id', teamId)
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
