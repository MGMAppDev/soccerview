/**
 * League Standings Screen
 * 
 * Displays all teams in a league/tournament ranked by SoccerView Power Rating.
 * Includes W-L-D record, filters by age group/gender, and matches tab.
 * 
 * Route: app/league/[eventId].tsx
 * Created: January 22, 2026 (Day 37.4)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getLeagueInfo,
  getLeagueStandings,
  getLeaguePointsTable,
  getLeagueMatches,
  getLeagueAgeGroups,
  getLeagueDivisions,
  LeagueInfo,
  LeagueTeam,
  LeaguePointsTableTeam,
  LeagueMatch,
  FormResult,
} from '@/lib/leagues';

// Colors matching SoccerView design system
const COLORS = {
  primary: '#3B82F6',
  gold: '#F59E0B',
  background: '#000000',
  card: '#1C1C1E',
  cardBorder: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  success: '#22C55E',
  error: '#EF4444',
};

type TabType = 'standings' | 'matches';
type StandingsViewType = 'points' | 'power'; // Points Table vs Power Ratings

export default function LeagueStandingsScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();

  // State
  const [loading, setLoading] = useState(true);
  const [filterLoading, setFilterLoading] = useState(false); // Session 91: Inline loader for filter changes
  const [refreshing, setRefreshing] = useState(false);
  const [leagueInfo, setLeagueInfo] = useState<LeagueInfo | null>(null);
  const [standings, setStandings] = useState<LeagueTeam[]>([]);
  const [pointsTable, setPointsTable] = useState<LeaguePointsTableTeam[]>([]);
  const [matches, setMatches] = useState<LeagueMatch[]>([]);
  const [ageGroups, setAgeGroups] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('standings');
  const [standingsView, setStandingsView] = useState<StandingsViewType>('points'); // Default to Points Table

  // Filters
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('All');
  const [selectedGender, setSelectedGender] = useState('All');
  const [divisions, setDivisions] = useState<string[]>([]);
  const [selectedDivision, setSelectedDivision] = useState('All');

  // Clear all filters
  const clearAllFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedGender('All');
    setSelectedAgeGroup('All');
    setSelectedDivision('All');
  };
  const hasActiveFilters = selectedGender !== 'All' || selectedAgeGroup !== 'All' || selectedDivision !== 'All';

  // Session 91: Split loading — static data (once) vs filter-dependent data (on change)
  // Pattern from Rankings tab (rankings.tsx:491-593)

  // Load static data ONCE on mount (league info + age groups don't change with filters)
  const loadStaticData = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [info, ages] = await Promise.all([
        getLeagueInfo(eventId),
        getLeagueAgeGroups(eventId),
      ]);
      setLeagueInfo(info);
      setAgeGroups(['All', ...ages]);
    } catch (error) {
      console.error('Error loading static league data:', error);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  // Load filter-dependent data (standings + matches — changes with age/gender/division filter)
  const loadFilteredData = useCallback(async (isRefresh = false) => {
    if (!eventId) return;
    if (!isRefresh) setFilterLoading(true);
    try {
      const filters = {
        ageGroup: selectedAgeGroup,
        gender: selectedGender,
        division: selectedDivision,
      };

      // Fetch divisions for current age+gender (parallel with standings data)
      const [pointsData, standingsData, matchesData, divisionData] = await Promise.all([
        getLeaguePointsTable(eventId, filters),
        getLeagueStandings(eventId, filters),
        getLeagueMatches(eventId, filters),
        getLeagueDivisions(eventId, {
          ageGroup: selectedAgeGroup,
          gender: selectedGender,
        }),
      ]);
      setPointsTable(pointsData);
      setStandings(standingsData);
      setMatches(matchesData);
      setDivisions(divisionData);

      // Reset division selection if previous selection is no longer valid
      if (selectedDivision !== 'All' && !divisionData.includes(selectedDivision)) {
        setSelectedDivision('All');
      }
    } catch (error) {
      console.error('Error loading filtered league data:', error);
    } finally {
      setFilterLoading(false);
      setRefreshing(false);
    }
  }, [eventId, selectedAgeGroup, selectedGender, selectedDivision]);

  // Mount: load static data once
  useEffect(() => {
    loadStaticData();
  }, [loadStaticData]);

  // Filter changes: 300ms debounce (proven pattern from rankings.tsx:491-498)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadFilteredData();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadFilteredData]);

  // Refresh handler — reloads everything
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadStaticData();
    loadFilteredData(true);
  }, [loadStaticData, loadFilteredData]);

  // Tab change
  const handleTabChange = (tab: TabType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
  };

  // Standings view toggle (Points Table vs Power Ratings)
  const handleStandingsViewChange = (view: StandingsViewType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStandingsView(view);
  };

  // Navigate to team
  const handleTeamPress = (teamId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/team/${teamId}`);
  };

  // Navigate to match
  const handleMatchPress = (matchId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/match/${matchId}`);
  };

  // Render form badge
  const renderFormBadge = (result: FormResult) => {
    const badge = {
      W: { icon: 'checkmark-circle', color: COLORS.success },
      D: { icon: 'remove-circle', color: COLORS.textSecondary },
      L: { icon: 'close-circle', color: COLORS.error },
    }[result];

    return (
      <Ionicons
        name={badge.icon as any}
        size={16}
        color={badge.color}
        style={{ marginRight: 4 }}
      />
    );
  };

  // Render points table row (traditional standings)
  const renderPointsTableRow = (team: LeaguePointsTableTeam) => {
    const isTopThree = team.position <= 3;
    const rankColor = team.position === 1 ? '#FFD700' :
                      team.position === 2 ? '#C0C0C0' :
                      team.position === 3 ? '#CD7F32' : COLORS.textSecondary;

    return (
      <TouchableOpacity
        key={`${team.id}-${team.position}`}
        style={[styles.pointsTableRow, isTopThree && styles.topThreeCard]}
        onPress={() => handleTeamPress(team.id)}
        activeOpacity={0.7}
      >
        {/* Position */}
        <View style={styles.rankContainer}>
          {isTopThree && (
            <Ionicons name="trophy" size={16} color={rankColor} style={styles.trophyIcon} />
          )}
          <Text style={[styles.rankText, { color: rankColor }]}>#{team.position}</Text>
        </View>

        {/* Team Info */}
        <View style={styles.teamInfo}>
          <Text style={styles.teamName}>{team.name}</Text>
          {team.club_name && (
            <Text style={styles.clubName}>{team.club_name}</Text>
          )}

          {/* Stats Row */}
          <View style={styles.pointsStatsRow}>
            <Text style={styles.pointsStatsText}>
              {team.games_played} GP ·
              <Text style={{ color: COLORS.success }}> {team.wins}W</Text>-
              <Text style={{ color: COLORS.textSecondary }}>{team.draws}D</Text>-
              <Text style={{ color: COLORS.error }}>{team.losses}L</Text> ·
              <Text style={{ color: team.goal_difference >= 0 ? COLORS.success : COLORS.error }}>
                {' '}{team.goal_difference >= 0 ? '+' : ''}{team.goal_difference} GD
              </Text>
            </Text>
          </View>

          {/* Form Badges — last 5 match results */}
          {team.form.length > 0 && (
            <View style={styles.formContainer}>
              {team.form.map((result, index) => (
                <View key={`form-${index}`}>{renderFormBadge(result)}</View>
              ))}
            </View>
          )}
        </View>

        {/* Points */}
        <View style={styles.pointsContainer}>
          <Text style={styles.pointsValue}>{team.points}</Text>
          <Text style={styles.pointsLabel}>pts</Text>
        </View>

        <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
      </TouchableOpacity>
    );
  };

  // Render team card (power ratings)
  const renderTeamCard = (team: LeagueTeam) => {
    const isTopThree = team.league_rank <= 3;
    const rankColor = team.league_rank === 1 ? '#FFD700' :
                      team.league_rank === 2 ? '#C0C0C0' :
                      team.league_rank === 3 ? '#CD7F32' : COLORS.textSecondary;

    return (
      <TouchableOpacity
        key={`${team.id}-${team.league_rank}`}
        style={[styles.teamCard, isTopThree && styles.topThreeCard]}
        onPress={() => handleTeamPress(team.id)}
        activeOpacity={0.7}
      >
        <View style={styles.rankContainer}>
          {isTopThree && (
            <Ionicons name="trophy" size={16} color={rankColor} style={styles.trophyIcon} />
          )}
          <Text style={[styles.rankText, { color: rankColor }]}>#{team.league_rank}</Text>
        </View>

        <View style={styles.teamInfo}>
          <Text style={styles.teamName}>{team.name}</Text>
          {team.club_name && (
            <Text style={styles.clubName}>{team.club_name}</Text>
          )}
        </View>

        <View style={styles.statsContainer}>
          {/* Power Rating */}
          <View style={styles.ratingBox}>
            <Ionicons name="flash" size={12} color={COLORS.primary} />
            <Text style={styles.ratingText}>
              {team.elo_rating ? Math.round(team.elo_rating) : '-'}
            </Text>
          </View>

          {/* W-L-D — consistent format with Points Table */}
          <Text style={styles.recordText}>
            <Text style={{ color: COLORS.success }}>{team.wins}W</Text>
            <Text style={styles.recordSeparator}>-</Text>
            <Text style={{ color: COLORS.error }}>{team.losses}L</Text>
            <Text style={styles.recordSeparator}>-</Text>
            <Text style={{ color: COLORS.textSecondary }}>{team.draws}D</Text>
          </Text>

          {/* National Rank */}
          {team.elo_national_rank && (
            <Text style={styles.nationalRank}>#{team.elo_national_rank} nat'l</Text>
          )}
        </View>

        <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
      </TouchableOpacity>
    );
  };

  // Render match card - Standard style matching Home/Matches tabs
  const renderMatchCard = (match: LeagueMatch) => {
    const hasScore = match.home_score !== null && match.away_score !== null;

    // Format date badge
    const dateBadge = match.match_date
      ? new Date(match.match_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';

    // Build division text (age_group + gender)
    const divisionParts: string[] = [];
    if (match.age_group) divisionParts.push(match.age_group);
    if (match.gender) divisionParts.push(match.gender);
    const divisionStr = divisionParts.join(' · ');

    return (
      <TouchableOpacity
        key={match.id}
        style={styles.standardMatchCard}
        onPress={() => handleMatchPress(match.id)}
        activeOpacity={0.7}
      >
        {/* Header row: Date badge + Division */}
        <View style={styles.matchHeaderRow}>
          {dateBadge ? (
            <View style={styles.dateBadge}>
              <Text style={styles.dateBadgeText}>{dateBadge}</Text>
            </View>
          ) : null}
          {divisionStr ? (
            <Text style={styles.divisionText}>{divisionStr}</Text>
          ) : null}
          {!hasScore && (
            <View style={styles.upcomingBadge}>
              <Text style={styles.upcomingText}>Upcoming</Text>
            </View>
          )}
        </View>

        {/* Main content row: Teams + Score */}
        <View style={styles.matchTeamsRowStandard}>
          {/* Teams column - vertical layout */}
          <View style={styles.matchTeamsContainer}>
            <Text style={styles.matchTeamNameStandard}>
              {match.home_team_name ?? 'Home Team'}
            </Text>
            <Text style={styles.matchVsText}>vs</Text>
            <Text style={styles.matchTeamNameStandard}>
              {match.away_team_name ?? 'Away Team'}
            </Text>
          </View>

          {/* Score */}
          {hasScore && (
            <Text style={styles.matchScoreDisplay}>
              {match.home_score} - {match.away_score}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Loading state
  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading standings...</Text>
      </SafeAreaView>
    );
  }

  const isLeague = leagueInfo?.source_type === 'league';
  const badgeColor = isLeague ? COLORS.primary : COLORS.gold;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      
      {/* Custom Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Standings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={[styles.typeBadge, { backgroundColor: badgeColor }]}>
              <Ionicons 
                name={isLeague ? "football-outline" : "trophy-outline"} 
                size={12} 
                color="#000" 
              />
              <Text style={styles.typeBadgeText}>
                {isLeague ? 'League' : 'Tournament'}
              </Text>
            </View>
          </View>

          <Text style={styles.leagueName}>{leagueInfo?.event_name || 'Unknown Event'}</Text>

          {/* Explanatory text — updates with active standings view */}
          <Text style={styles.leagueExplanation}>
            {standingsView === 'points'
              ? 'Teams ranked by points within this league. W-L-D reflects league play only.'
              : 'Teams ranked by SoccerView Power Rating within this league.'}
          </Text>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{leagueInfo?.team_count || pointsTable.length || 0}</Text>
              <Text style={styles.statLabel}>Teams</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{leagueInfo?.match_count || 0}</Text>
              <Text style={styles.statLabel}>Matches</Text>
            </View>
          </View>
        </View>

        {/* Tabs - Clear labels showing what each contains */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'standings' && styles.activeTab]}
            onPress={() => handleTabChange('standings')}
          >
            <Ionicons
              name="podium-outline"
              size={16}
              color={activeTab === 'standings' ? '#000' : COLORS.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.tabText, activeTab === 'standings' && styles.activeTabText]}>
              Standings
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'matches' && styles.activeTab]}
            onPress={() => handleTabChange('matches')}
          >
            <Ionicons
              name="football-outline"
              size={16}
              color={activeTab === 'matches' ? '#000' : COLORS.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.tabText, activeTab === 'matches' && styles.activeTabText]}>
              Match Results
            </Text>
          </TouchableOpacity>
        </View>

        {/* Standings View Toggle - Only shown when on standings tab */}
        {activeTab === 'standings' && (
          <View style={styles.standingsViewToggle}>
            <TouchableOpacity
              style={[styles.viewToggleButton, standingsView === 'points' && styles.viewToggleActive]}
              onPress={() => handleStandingsViewChange('points')}
            >
              <Ionicons
                name="list-outline"
                size={14}
                color={standingsView === 'points' ? '#000' : COLORS.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.viewToggleText, standingsView === 'points' && styles.viewToggleTextActive]}>
                Points Table
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewToggleButton, standingsView === 'power' && styles.viewToggleActive]}
              onPress={() => handleStandingsViewChange('power')}
            >
              <Ionicons
                name="flash-outline"
                size={14}
                color={standingsView === 'power' ? '#000' : COLORS.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.viewToggleText, standingsView === 'power' && styles.viewToggleTextActive]}>
                Power Ratings
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Filter Section — Vertically stacked rows with labels */}
        <View style={styles.filterSection}>
          {/* Gender Row */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel} numberOfLines={1}>Gender</Text>
            <View style={styles.chipRowContent}>
              {['All', 'Boys', 'Girls'].map(gender => (
                <TouchableOpacity
                  key={`gender-${gender}`}
                  activeOpacity={0.7}
                  style={[
                    styles.filterChip,
                    selectedGender === gender && styles.filterChipActive
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedGender(gender);
                    setSelectedDivision('All');
                  }}
                >
                  <Text style={[
                    styles.filterChipText,
                    selectedGender === gender && styles.filterChipTextActive
                  ]}>
                    {gender}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Age Group Row */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel} numberOfLines={1}>Age</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled={true} contentContainerStyle={styles.chipScrollContent}>
              {ageGroups.map(age => (
                <TouchableOpacity
                  key={`age-${age}`}
                  activeOpacity={0.7}
                  style={[
                    styles.filterChip,
                    selectedAgeGroup === age && styles.filterChipActive
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedAgeGroup(age);
                    setSelectedDivision('All');
                  }}
                >
                  <Text style={[
                    styles.filterChipText,
                    selectedAgeGroup === age && styles.filterChipTextActive
                  ]}>
                    {age}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Division Row — only shown when divisions exist */}
          {divisions.length > 0 && (
            <View style={styles.filterRow}>
              <Text style={[styles.filterLabel, { color: COLORS.gold }]} numberOfLines={1}>Div</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled={true} contentContainerStyle={styles.chipScrollContent}>
                {['All', ...divisions].map(div => (
                  <TouchableOpacity
                    key={`div-${div}`}
                    activeOpacity={0.7}
                    style={[
                      styles.filterChip,
                      selectedDivision === div && styles.filterChipDivisionActive
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedDivision(div);
                    }}
                  >
                    <Text style={[
                      styles.filterChipText,
                      selectedDivision === div && styles.filterChipTextActive
                    ]}>
                      {div}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Results Bar — team count + active filter context + clear button */}
          <View style={styles.resultsBar}>
            <Text style={styles.resultsText}>
              {filterLoading ? 'Loading...' : `${pointsTable.length} teams${
                selectedGender !== 'All' || selectedAgeGroup !== 'All' || selectedDivision !== 'All'
                  ? ` · ${selectedAgeGroup !== 'All' ? selectedAgeGroup + ' ' : ''}${selectedGender !== 'All' ? selectedGender : ''}${selectedDivision !== 'All' ? ' · ' + selectedDivision : ''}`
                  : ''
              }`}
            </Text>
            {hasActiveFilters && (
              <TouchableOpacity style={styles.clearButton} onPress={clearAllFilters}>
                <Ionicons name="close-circle" size={16} color="#EF4444" />
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Session 91: Inline loading indicator for filter changes */}
        {filterLoading && (
          <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 8 }} />
        )}

        {/* Content */}
        {activeTab === 'standings' ? (
          <View style={styles.standingsList}>
            {/* Show note for large leagues */}
            {(leagueInfo?.team_count || 0) > 100 && (
              <Text style={styles.limitNote}>
                Showing top 100 teams{standingsView === 'points' ? ' by points' : ' by power rating'}
              </Text>
            )}
            {standingsView === 'points' ? (
              // Points Table View
              pointsTable.length > 0 ? (
                pointsTable.map(renderPointsTableRow)
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="list-outline" size={48} color={COLORS.textSecondary} />
                  <Text style={styles.emptyStateText}>No standings available</Text>
                  <Text style={styles.emptyStateSubtext}>
                    No completed matches found for this event
                  </Text>
                </View>
              )
            ) : (
              // Power Ratings View
              standings.length > 0 ? (
                standings.map(renderTeamCard)
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="flash-outline" size={48} color={COLORS.textSecondary} />
                  <Text style={styles.emptyStateText}>No teams found</Text>
                  <Text style={styles.emptyStateSubtext}>
                    Try adjusting your filters
                  </Text>
                </View>
              )
            )}
          </View>
        ) : (
          <View style={styles.matchesList}>
            {/* Show note for large leagues */}
            {(leagueInfo?.match_count || 0) > 50 && matches.length > 0 && (
              <Text style={styles.limitNote}>
                Showing 50 most recent matches
              </Text>
            )}
            {matches.length > 0 ? (
              matches.map(renderMatchCard)
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="football-outline" size={48} color={COLORS.textSecondary} />
                <Text style={styles.emptyStateText}>No matches found</Text>
              </View>
            )}
          </View>
        )}
        
        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    color: COLORS.textSecondary,
    marginTop: 12,
    fontSize: 14,
  },

  // Header Bar
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },

  // Header
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  typeBadgeText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
  leagueName: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  leagueExplanation: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.cardBorder,
    marginHorizontal: 24,
  },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.card,
  },
  activeTab: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#000',
  },

  // Filters — vertically stacked rows with labels
  filterSection: {
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  filterLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    width: 62,
    flexShrink: 0,
  },
  chipRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipScrollContent: {
    paddingRight: 16,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: '#1F2937',
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipDivisionActive: {
    backgroundColor: COLORS.gold,
    borderColor: COLORS.gold,
  },
  filterChipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#000',
  },
  resultsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
  },
  resultsText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    gap: 4,
  },
  clearButtonText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },

  // Standings View Toggle
  standingsViewToggle: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  viewToggleButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  viewToggleActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  viewToggleText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  viewToggleTextActive: {
    color: '#000',
  },

  // Team Card & Points Table Row
  standingsList: {
    padding: 16,
  },
  limitNote: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 12,
  },
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginBottom: 8,
  },
  pointsTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginBottom: 8,
  },
  topThreeCard: {
    borderColor: COLORS.primary,
    borderWidth: 1.5,
  },
  rankContainer: {
    width: 50,
    alignItems: 'center',
  },
  trophyIcon: {
    marginBottom: 2,
  },
  rankText: {
    fontSize: 16,
    fontWeight: '700',
  },
  teamInfo: {
    flex: 1,
    marginRight: 12,
  },
  teamName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  clubName: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  statsContainer: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  ratingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  recordText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  recordSeparator: {
    color: COLORS.textSecondary,
  },
  nationalRank: {
    color: COLORS.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },

  // Points Table Specific Styles
  pointsStatsRow: {
    marginTop: 4,
  },
  pointsStatsText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  formContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  pointsContainer: {
    alignItems: 'center',
    marginRight: 8,
    minWidth: 40,
  },
  pointsValue: {
    color: COLORS.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  pointsLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },

  // Match Card - Legacy (kept for reference)
  matchesList: {
    padding: 16,
  },
  matchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginBottom: 8,
  },
  matchDate: {
    width: 50,
    alignItems: 'center',
  },
  matchDateText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  matchTeams: {
    flex: 1,
    marginLeft: 12,
  },
  matchTeamRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  matchTeamName: {
    color: COLORS.text,
    fontSize: 14,
    flex: 1,
  },
  matchScore: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 12,
    width: 30,
    textAlign: 'right',
  },
  winnerText: {
    color: COLORS.success,
    fontWeight: '700',
  },
  upcomingBadge: {
    backgroundColor: COLORS.primary + '30',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  upcomingText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '600',
  },

  // Standard Match Card - Matching Home/Matches tabs
  standardMatchCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  matchHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  dateBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dateBadgeText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  divisionText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  matchTeamsRowStandard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  matchTeamsContainer: {
    flex: 1,
    marginRight: 12,
  },
  matchTeamNameStandard: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  matchVsText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginVertical: 2,
  },
  matchScoreDisplay: {
    color: COLORS.primary,
    fontSize: 20,
    fontWeight: 'bold',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptyStateSubtext: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
});
