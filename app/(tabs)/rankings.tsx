import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

// ============================================================
// TYPES
// ============================================================

type TeamRankRow = {
  id: string;
  team_name: string | null;
  state: string | null;
  elo_rating: number | null;
  matches_played: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  gender: string | null;
  age_group: string | null;
  // GotSport official rankings
  national_rank: number | null;
  regional_rank: number | null;
  state_rank: number | null;
  gotsport_points: number | null;
  // Awards
  national_award: string | null;
  regional_award: string | null;
  state_cup_award: string | null;
  // Display rank (computed)
  rank?: number;
};

// Simplified: Only two ranking views (removed "state" mode)
type ViewMode = "leaderboard" | "national";

// ============================================================
// CONSTANTS
// ============================================================

// US STATES ONLY - Alphabetically sorted for filter display
const US_STATES = [
  "AK",
  "AL",
  "AR",
  "AZ",
  "CA",
  "CO",
  "CT",
  "DC",
  "DE",
  "FL",
  "GA",
  "HI",
  "IA",
  "ID",
  "IL",
  "IN",
  "KS",
  "KY",
  "LA",
  "MA",
  "MD",
  "ME",
  "MI",
  "MN",
  "MO",
  "MS",
  "MT",
  "NC",
  "ND",
  "NE",
  "NH",
  "NJ",
  "NM",
  "NV",
  "NY",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VA",
  "VT",
  "WA",
  "WI",
  "WV",
  "WY",
];

const US_STATES_SET = new Set(US_STATES);

// Valid age groups - ALWAYS show U8 through U19
const ALL_AGE_GROUPS = [
  "U8",
  "U9",
  "U10",
  "U11",
  "U12",
  "U13",
  "U14",
  "U15",
  "U16",
  "U17",
  "U18",
  "U19",
];

const PAGE_SIZE = 50;

// ============================================================
// DATA FETCHING - Optimized for 100k+ teams
// ============================================================

type FetchParams = {
  mode: ViewMode;
  states: string[];
  genders: string[];
  ages: string[];
  searchQuery: string;
  offset: number;
};

async function fetchTeams(
  params: FetchParams,
): Promise<{ teams: TeamRankRow[]; hasMore: boolean }> {
  const { mode, states, genders, ages, searchQuery, offset } = params;

  let query = supabase
    .from("team_elo")
    .select(
      "id, team_name, state, elo_rating, matches_played, wins, losses, draws, gender, age_group, national_rank, regional_rank, state_rank, gotsport_points, national_award, regional_award, state_cup_award",
    );

  // LEADERBOARD MODE: Only teams with official rankings, sorted by national_rank
  if (mode === "leaderboard") {
    query = query.not("national_rank", "is", null);
    query = query.order("national_rank", { ascending: true });
  } else {
    // NATIONAL MODE: All teams sorted by ELO (Power Rating)
    query = query.order("elo_rating", { ascending: false });
  }

  // Apply filters server-side
  if (states.length > 0) {
    query = query.in("state", states);
  }
  if (genders.length > 0) {
    query = query.in("gender", genders);
  }
  if (ages.length > 0) {
    // Handle age group normalization - search for both U9 and U09 formats
    const agePatterns = ages.flatMap((age) => {
      const num = age.replace(/\D/g, "");
      return [`U${num}`, `U0${num}`];
    });
    query = query.in("age_group", [...new Set(agePatterns)]);
  }
  if (searchQuery.trim()) {
    query = query.ilike("team_name", `%${searchQuery.trim()}%`);
  }

  // Paginate
  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching teams:", error);
    throw error;
  }

  return {
    teams: (data || []) as TeamRankRow[],
    hasMore: (data?.length || 0) === PAGE_SIZE,
  };
}

// Fetch filter options (states, genders) - reliable per-state check
async function fetchFilterOptions(): Promise<{
  states: string[];
  genders: string[];
  totalWithRank: number;
}> {
  // Check each US state to see if it has teams
  // This is more reliable than trying to get distinct from 115k rows
  const stateChecks = await Promise.all(
    US_STATES.map(async (state) => {
      const { count } = await supabase
        .from("team_elo")
        .select("id", { count: "exact", head: true })
        .eq("state", state);
      return { state, hasTeams: (count || 0) > 0 };
    }),
  );

  const statesWithTeams: string[] = [];
  for (const check of stateChecks) {
    if (check.hasTeams) {
      statesWithTeams.push(check.state);
    }
  }

  // Get distinct genders (only 2 values, so simple query works)
  const { data: genderData } = await supabase
    .from("team_elo")
    .select("gender")
    .not("gender", "is", null)
    .limit(100);

  const gendersRaw = (genderData || [])
    .map((r) => r.gender)
    .filter(Boolean) as string[];
  const genders = [...new Set(gendersRaw)].sort();

  // Count teams with national rank
  const { count } = await supabase
    .from("team_elo")
    .select("id", { count: "exact", head: true })
    .not("national_rank", "is", null);

  return {
    states: statesWithTeams.sort(),
    genders,
    totalWithRank: count || 0,
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function normalizeAgeGroup(age: string | null | undefined): string | null {
  if (!age) return null;
  const trimmed = age.trim();
  const match = trimmed.match(/^(U)0*(\d+)$/i);
  if (match) {
    return `U${parseInt(match[2], 10)}`;
  }
  return trimmed;
}

function getEloGrade(elo: number): { grade: string; color: string } {
  if (elo >= 1650) return { grade: "A+", color: "#22c55e" };
  if (elo >= 1600) return { grade: "A", color: "#22c55e" };
  if (elo >= 1550) return { grade: "A-", color: "#4ade80" };
  if (elo >= 1525) return { grade: "B+", color: "#3B82F6" };
  if (elo >= 1500) return { grade: "B", color: "#3B82F6" };
  if (elo >= 1475) return { grade: "B-", color: "#60a5fa" };
  if (elo >= 1450) return { grade: "C+", color: "#f59e0b" };
  if (elo >= 1425) return { grade: "C", color: "#f59e0b" };
  if (elo >= 1400) return { grade: "C-", color: "#fbbf24" };
  if (elo >= 1375) return { grade: "D+", color: "#ef4444" };
  if (elo >= 1350) return { grade: "D", color: "#ef4444" };
  return { grade: "D-", color: "#dc2626" };
}

function getMedalEmoji(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

function getMedalColor(rank: number | undefined): string {
  if (rank === 1) return "#FFD700";
  if (rank === 2) return "#C0C0C0";
  if (rank === 3) return "#CD7F32";
  if (rank && rank <= 10) return "#10b981";
  if (rank && rank <= 25) return "#3B82F6";
  if (rank && rank <= 100) return "#8b5cf6";
  return "#9ca3af";
}

function getAwardBadges(team: TeamRankRow): string {
  const badges: string[] = [];
  if (team.national_award) badges.push("🏆");
  if (team.regional_award) badges.push("🥇");
  if (team.state_cup_award) badges.push("🏅");
  return badges.join(" ");
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function RankingsTab() {
  const [mode, setMode] = useState<ViewMode>("leaderboard");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [selectedAges, setSelectedAges] = useState<string[]>([]);

  const [teams, setTeams] = useState<TeamRankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  // Filter options (loaded once)
  const [allStates, setAllStates] = useState<string[]>([]);
  const [allGenders, setAllGenders] = useState<string[]>([]);
  const [teamsWithNationalRank, setTeamsWithNationalRank] = useState(0);
  const [loadingFilters, setLoadingFilters] = useState(true);

  // Load filter options once on mount
  useEffect(() => {
    loadFilterOptions();
  }, []);

  // Load teams when filters change
  useEffect(() => {
    loadTeams(true);
  }, [mode, selectedStates, selectedGenders, selectedAges]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadTeams(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadFilterOptions = async () => {
    try {
      setLoadingFilters(true);
      const options = await fetchFilterOptions();
      setAllStates(options.states);
      setAllGenders(options.genders);
      setTeamsWithNationalRank(options.totalWithRank);
    } catch (err) {
      console.error("Error loading filter options:", err);
      // Fallback to full state list
      setAllStates(US_STATES);
    } finally {
      setLoadingFilters(false);
    }
  };

  const loadTeams = async (reset: boolean = false) => {
    try {
      setError(null);
      if (reset) {
        setLoading(true);
        setOffset(0);
      } else {
        setLoadingMore(true);
      }

      const newOffset = reset ? 0 : offset;
      const result = await fetchTeams({
        mode,
        states: selectedStates,
        genders: selectedGenders,
        ages: selectedAges,
        searchQuery,
        offset: newOffset,
      });

      if (reset) {
        setTeams(result.teams);
      } else {
        setTeams((prev) => [...prev, ...result.teams]);
      }
      setHasMore(result.hasMore);
      setOffset(newOffset + PAGE_SIZE);
    } catch (err: any) {
      console.error("Error:", err);
      setError(err.message || "Failed to load rankings");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMoreTeams = () => {
    if (!loadingMore && hasMore && !loading) {
      loadTeams(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTeams(true);
    setRefreshing(false);
  };

  const toggleSelection = useCallback(
    (
      item: string,
      selected: string[],
      setSelected: React.Dispatch<React.SetStateAction<string[]>>,
    ) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelected((prev) =>
        prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item],
      );
    },
    [],
  );

  const clearAllFilters = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedStates([]);
    setSelectedGenders([]);
    setSelectedAges([]);
    setSearchQuery("");
  }, []);

  const hasActiveFilters =
    selectedStates.length > 0 ||
    selectedGenders.length > 0 ||
    selectedAges.length > 0 ||
    searchQuery.length > 0;

  // Add rank numbers to teams for display
  const rankedTeams: (TeamRankRow & { rank?: number })[] = useMemo(() => {
    return teams.map((team, index) => ({
      ...team,
      rank:
        mode === "leaderboard"
          ? (team.national_rank ?? undefined)
          : offset - PAGE_SIZE + index + 1,
    }));
  }, [teams, mode, offset]);

  // ============================================================
  // RENDER FUNCTIONS
  // ============================================================

  const renderChip = (
    label: string,
    selected: boolean,
    onPress: () => void,
    isLeaderboard?: boolean,
  ) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      style={[
        styles.baseChip,
        isLeaderboard && styles.leaderboardChip,
        selected &&
          (isLeaderboard
            ? styles.leaderboardChipSelected
            : styles.selectedChip),
      ]}
    >
      <Text
        style={[
          styles.chipText,
          selected && isLeaderboard && styles.leaderboardChipText,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderLeaderboardItem = ({
    item,
  }: {
    item: TeamRankRow & { rank?: number };
  }) => {
    const rank = item.national_rank || item.rank || 0;
    const medal = getMedalEmoji(rank);
    const badgeColor = getMedalColor(rank);
    const gradeInfo = getEloGrade(item.elo_rating || 1500);
    const awards = getAwardBadges(item);
    const isTopThree = rank <= 3;
    const isTopTen = rank <= 10;

    return (
      <TouchableOpacity
        style={[
          styles.leaderboardItem,
          isTopThree && styles.leaderboardItemTopThree,
          !isTopThree && isTopTen && styles.leaderboardItemTopTen,
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push({
            pathname: "/team/[id]",
            params: { id: item.id },
          });
        }}
        activeOpacity={0.7}
      >
        {/* Rank Badge */}
        <View
          style={[
            styles.leaderboardRankBadge,
            { backgroundColor: `${badgeColor}20` },
          ]}
        >
          {medal ? (
            <Text style={styles.medalEmoji}>{medal}</Text>
          ) : (
            <Text style={[styles.leaderboardRank, { color: badgeColor }]}>
              {rank}
            </Text>
          )}
        </View>

        {/* Team Info */}
        <View style={styles.leaderboardInfo}>
          <View style={styles.leaderboardNameRow}>
            <Text style={styles.leaderboardName} numberOfLines={2}>
              {item.team_name || "Unknown"}
            </Text>
            {awards ? <Text style={styles.awardBadges}>{awards}</Text> : null}
          </View>
          <Text style={styles.leaderboardDetails}>
            {normalizeAgeGroup(item.age_group)} {item.gender} • {item.state}
          </Text>
          <View style={styles.leaderboardStats}>
            <Text style={styles.leaderboardRecord}>
              {item.wins || 0}W-{item.losses || 0}L-{item.draws || 0}D
            </Text>
            {item.gotsport_points && (
              <Text style={styles.leaderboardPoints}>
                {item.gotsport_points.toLocaleString()} pts
              </Text>
            )}
          </View>
        </View>

        {/* ELO Grade */}
        <View style={styles.leaderboardRating}>
          <Text style={[styles.leaderboardGrade, { color: gradeInfo.color }]}>
            {gradeInfo.grade}
          </Text>
          <Text style={styles.leaderboardElo}>
            {Math.round(item.elo_rating || 1500)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderTeamItem = useCallback(
    ({ item }: { item: TeamRankRow & { rank?: number } }) => {
      return renderLeaderboardItem({ item });
    },
    [mode],
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text style={styles.footerText}>Loading more...</Text>
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="trophy-outline" size={48} color="#374151" />
        <Text style={styles.noDataText}>
          {hasActiveFilters ? "No teams match filters" : "No ranked teams"}
        </Text>
        {hasActiveFilters && (
          <TouchableOpacity
            style={styles.clearFiltersButton}
            onPress={clearAllFilters}
          >
            <Text style={styles.clearFiltersText}>Clear Filters</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ============================================================
  // MAIN RENDER
  // ============================================================

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Rankings</Text>
      </View>

      {/* Filters */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.filtersContainer}>
          {/* View Mode Selection - Only Official Rank and Power Rating */}
          <Text style={styles.sectionHeader}>View</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipScrollContent}
          >
            {renderChip(
              "🏆 Official Rank",
              mode === "leaderboard",
              () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMode("leaderboard");
              },
              true,
            )}
            {renderChip("⚡ Power Rating", mode === "national", () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setMode("national");
            })}
          </ScrollView>

          {/* Gender Filter */}
          <Text style={styles.sectionHeader}>Gender</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipScrollContent}
          >
            {allGenders.map((g) =>
              renderChip(g, selectedGenders.includes(g), () =>
                toggleSelection(g, selectedGenders, setSelectedGenders),
              ),
            )}
          </ScrollView>

          {/* Age Group Filter - ALWAYS show U8-U19 */}
          <Text style={styles.sectionHeader}>Age Group</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipScrollContent}
          >
            {ALL_AGE_GROUPS.map((age) =>
              renderChip(age, selectedAges.includes(age), () =>
                toggleSelection(age, selectedAges, setSelectedAges),
              ),
            )}
          </ScrollView>

          {/* State Filter - NEW: Consistent with Teams tab */}
          <Text style={styles.sectionHeader}>State</Text>
          {loadingFilters ? (
            <View style={styles.chipScroll}>
              <ActivityIndicator size="small" color="#3B82F6" />
              <Text style={styles.loadingChipsText}>Loading states...</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipScrollContent}
            >
              {/* "All" chip - selected when no states are filtered */}
              {renderChip("All", selectedStates.length === 0, () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedStates([]);
              })}
              {allStates.map((st) =>
                renderChip(st, selectedStates.includes(st), () =>
                  toggleSelection(st, selectedStates, setSelectedStates),
                ),
              )}
            </ScrollView>
          )}

          {/* Clear Filters */}
          {hasActiveFilters && (
            <TouchableOpacity
              style={styles.clearChip}
              onPress={clearAllFilters}
            >
              <Ionicons name="close-circle" size={16} color="#9ca3af" />
              <Text
                style={[styles.chipText, { marginLeft: 6, color: "#9ca3af" }]}
              >
                Clear filters
              </Text>
            </TouchableOpacity>
          )}

          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color="#9ca3af" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search teams..."
              placeholderTextColor="#6b7280"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={20} color="#6b7280" />
              </TouchableOpacity>
            )}
          </View>

          {/* Results Header - Show actual count */}
          <View style={styles.resultsHeader}>
            <Text style={styles.resultsText}>
              {loading
                ? "Loading..."
                : `${teams.length.toLocaleString()}${hasMore ? "+" : ""} teams`}
            </Text>
            <TouchableOpacity
              style={styles.infoButton}
              onPress={() => setInfoModalVisible(true)}
            >
              <Ionicons
                name="information-circle-outline"
                size={18}
                color="#3B82F6"
              />
              <Text style={styles.infoButtonText}>How rankings work</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading rankings...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={48} color="#EF4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => loadTeams(true)}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rankedTeams}
          keyExtractor={(item) => item.id}
          renderItem={renderTeamItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
            />
          }
          onEndReached={loadMoreTeams}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Info Modal - Session 10 scrollable pattern */}
      <Modal
        visible={infoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          {/* Tap-to-dismiss background */}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setInfoModalVisible(false)}
            activeOpacity={1}
          />
          {/* Modal content */}
          <View
            style={[
              styles.modalContent,
              { height: Dimensions.get("window").height * 0.7 },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>How Rankings Work</Text>
              <TouchableOpacity onPress={() => setInfoModalVisible(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} bounces={true}>
              <View style={{ padding: 20, paddingTop: 0 }}>
                {/* Official Rank Section */}
                <View style={styles.helpSection}>
                  <Text style={styles.helpSectionTitle}>
                    🏆 Official Rank (GotSport)
                  </Text>
                  <Text style={styles.helpSectionDesc}>
                    Official national rankings from GotSport based on tournament
                    performance. These rankings are used by tournament directors
                    for seeding decisions.
                  </Text>
                  <View style={styles.helpBulletList}>
                    <Text style={styles.helpBullet}>
                      • Points earned from sanctioned tournaments
                    </Text>
                    <Text style={styles.helpBullet}>
                      • Updated after each event
                    </Text>
                    <Text style={styles.helpBullet}>
                      • Gold/silver/bronze medals for top 3
                    </Text>
                  </View>
                </View>

                {/* Power Rating Section */}
                <View style={styles.helpSection}>
                  <Text style={styles.helpSectionTitle}>
                    ⚡ Power Rating (ELO)
                  </Text>
                  <Text style={styles.helpSectionDesc}>
                    SoccerView's computed strength rating based on match
                    results. Teams start at 1500 ELO and gain/lose points based
                    on wins and losses.
                  </Text>
                  <View style={styles.gradeGuide}>
                    <Text style={styles.gradeGuideTitle}>Letter Grades:</Text>
                    <Text style={[styles.gradeItem, { color: "#22c55e" }]}>
                      A+ (1650+) Elite
                    </Text>
                    <Text style={[styles.gradeItem, { color: "#4ade80" }]}>
                      A/A- (1550-1649) Excellent
                    </Text>
                    <Text style={[styles.gradeItem, { color: "#3B82F6" }]}>
                      B+/B/B- (1475-1549) Above Average
                    </Text>
                    <Text style={[styles.gradeItem, { color: "#f59e0b" }]}>
                      C+/C/C- (1400-1474) Average
                    </Text>
                    <Text style={[styles.gradeItem, { color: "#ef4444" }]}>
                      D+/D/D- (below 1400) Developing
                    </Text>
                  </View>
                </View>

                {/* Championship Badges */}
                <View style={styles.helpSection}>
                  <Text style={styles.helpSectionTitle}>
                    🏆 Championship Badges
                  </Text>
                  <Text style={styles.helpSectionDesc}>
                    Teams with championship awards display badges:
                  </Text>
                  <View style={styles.helpBulletList}>
                    <Text style={styles.helpBullet}>🏆 National Champion</Text>
                    <Text style={styles.helpBullet}>🥇 Regional Winner</Text>
                    <Text style={styles.helpBullet}>🏅 State Cup Winner</Text>
                  </View>
                </View>

                {/* Multi-Select */}
                <View style={styles.helpSection}>
                  <Text style={styles.helpSectionTitle}>Multi-Select</Text>
                  <Text style={styles.helpSectionDesc}>
                    Select multiple genders, ages, or states to compare across
                    categories.
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { color: "#fff", fontSize: 32, fontWeight: "bold" },
  filtersContainer: { paddingHorizontal: 16, paddingTop: 8 },
  sectionHeader: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 4,
  },
  chipScroll: { flexDirection: "row", marginBottom: 12 },
  chipScrollContent: { paddingRight: 16 },
  loadingChipsText: { color: "#9ca3af", fontSize: 14, marginLeft: 8 },
  baseChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "#1F2937",
  },
  selectedChip: { backgroundColor: "#3B82F6", borderColor: "#3B82F6" },

  // Leaderboard chip - special gold styling
  leaderboardChip: {
    borderColor: "#f59e0b",
  },
  leaderboardChipSelected: {
    backgroundColor: "#f59e0b",
    borderColor: "#f59e0b",
  },
  leaderboardChipText: {
    color: "#000",
  },

  chipText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  clearChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#374151",
    alignSelf: "flex-start",
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#4b5563",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
    backgroundColor: "#1F2937",
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 16,
  },

  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  resultsText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
    marginRight: 12,
  },
  infoButton: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  infoButtonText: { color: "#3B82F6", fontSize: 12, marginLeft: 4 },
  listContent: { paddingBottom: 24, flexGrow: 1 },

  // Leaderboard item (premium styling)
  leaderboardItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    marginBottom: 10,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  leaderboardItemTopThree: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  leaderboardItemTopTen: {
    backgroundColor: "rgba(16, 185, 129, 0.05)",
    borderColor: "rgba(16, 185, 129, 0.2)",
  },
  leaderboardRankBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  leaderboardRank: {
    fontSize: 16,
    fontWeight: "bold",
  },
  medalEmoji: {
    fontSize: 24,
  },
  leaderboardInfo: {
    flex: 1,
    marginLeft: 12,
  },
  leaderboardNameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    flexWrap: "wrap",
  },
  leaderboardName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
    lineHeight: 20,
  },
  awardBadges: {
    fontSize: 12,
  },
  leaderboardDetails: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 2,
  },
  leaderboardStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  leaderboardRecord: {
    color: "#6b7280",
    fontSize: 12,
  },
  leaderboardPoints: {
    color: "#f59e0b",
    fontSize: 12,
    fontWeight: "600",
  },
  leaderboardRating: {
    alignItems: "center",
    minWidth: 44,
  },
  leaderboardGrade: {
    fontSize: 18,
    fontWeight: "bold",
  },
  leaderboardElo: {
    color: "#6b7280",
    fontSize: 10,
    marginTop: 2,
  },

  // Footer loader
  footerLoader: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 16,
    gap: 8,
  },
  footerText: {
    color: "#9ca3af",
    fontSize: 14,
  },

  // States
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#9ca3af", fontSize: 14, marginTop: 12 },
  errorText: {
    color: "#EF4444",
    fontSize: 16,
    marginTop: 12,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#3B82F6",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  noDataText: { color: "#6b7280", fontSize: 16, marginTop: 16 },
  clearFiltersButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#1F2937",
    borderRadius: 8,
  },
  clearFiltersText: { color: "#3B82F6", fontSize: 14, fontWeight: "600" },

  // FIXED: Modal with proper scrollable content (Session 10 pattern)
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  modalContent: {
    backgroundColor: "#1F2937",
    borderRadius: 20,
    width: "100%",
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },

  // Help sections (consistent with other modals)
  helpSection: { marginBottom: 24 },
  helpSectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  helpSectionDesc: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  helpBulletList: { gap: 6 },
  helpBullet: { color: "#d1d5db", fontSize: 13 },
  gradeGuide: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  gradeGuideTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  gradeItem: { fontSize: 12, marginBottom: 4 },
});
