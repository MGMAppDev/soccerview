import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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

type TeamEloRow = {
  id: string;
  team_name: string | null;
  elo_rating: number | null;
  matches_played: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  state: string | null;
  gender: string | null;
  age_group: string | null;
  national_rank: number | null;
  gotsport_points: number | null;
};

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
  states: string[];
  genders: string[];
  ages: string[];
  searchQuery: string;
  offset: number;
};

async function fetchTeams(
  params: FetchParams,
): Promise<{ teams: TeamEloRow[]; hasMore: boolean }> {
  const { states, genders, ages, searchQuery, offset } = params;

  let query = supabase
    .from("team_elo")
    .select(
      "id, team_name, elo_rating, matches_played, wins, losses, draws, state, gender, age_group, national_rank, gotsport_points",
    )
    .order("team_name", { ascending: true });

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
    teams: (data || []) as TeamEloRow[],
    hasMore: (data?.length || 0) === PAGE_SIZE,
  };
}

// Fetch filter options - FIXED: Get actual distinct states from database
async function fetchFilterOptions(): Promise<{
  states: string[];
  genders: string[];
  totalTeams: number;
}> {
  // Get distinct states using a smarter approach
  // Query one team per state by sampling across the dataset
  const statesWithTeams: string[] = [];

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

  // Get total count
  const { count } = await supabase
    .from("team_elo")
    .select("id", { count: "exact", head: true });

  return {
    states: statesWithTeams.sort(),
    genders,
    totalTeams: count || 0,
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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

function isValidValue(v: string | null | undefined): v is string {
  return !!v && v.trim().length > 0 && v.trim() !== "??";
}

function normalizeAgeGroup(age: string | null | undefined): string | null {
  if (!age) return null;
  const trimmed = age.trim();
  const match = trimmed.match(/^(U)0*(\d+)$/i);
  if (match) {
    return `U${parseInt(match[2], 10)}`;
  }
  return trimmed;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function TeamsTab() {
  const [teams, setTeams] = useState<TeamEloRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Multi-select filters
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [selectedAges, setSelectedAges] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);

  // Filter options (loaded once)
  const [allStates, setAllStates] = useState<string[]>([]);
  const [allGenders, setAllGenders] = useState<string[]>([]);
  const [totalTeams, setTotalTeams] = useState(0);
  const [loadingFilters, setLoadingFilters] = useState(true);

  const [infoModalVisible, setInfoModalVisible] = useState(false);

  // Load filter options once on mount
  useEffect(() => {
    loadFilterOptions();
  }, []);

  // Load teams when filters change
  useEffect(() => {
    loadTeams(true);
  }, [selectedStates, selectedGenders, selectedAges]);

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
      setTotalTeams(options.totalTeams);
    } catch (err) {
      console.error("Error loading filter options:", err);
      // Fallback: show all US states even if check fails
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
      setError(err.message || "Failed to load teams");
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

  const toggleChip = useCallback(
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

  const clearFilters = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedGenders([]);
    setSelectedAges([]);
    setSelectedStates([]);
    setSearchQuery("");
  }, []);

  const hasFilters =
    selectedGenders.length > 0 ||
    selectedAges.length > 0 ||
    selectedStates.length > 0 ||
    searchQuery.length > 0;

  const getTeamMeta = useCallback((team: TeamEloRow): string => {
    const parts: string[] = [];
    if (isValidValue(team.state)) parts.push(team.state);
    if (isValidValue(team.gender)) parts.push(team.gender);
    const normalizedAge = normalizeAgeGroup(team.age_group);
    if (normalizedAge) parts.push(normalizedAge);
    return parts.join(" · ");
  }, []);

  // ============================================================
  // RENDER FUNCTIONS
  // ============================================================

  const renderChip = (
    label: string,
    selected: boolean,
    onPress: () => void,
  ) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      style={[styles.baseChip, selected && styles.selectedChip]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );

  const renderTeam = useCallback(
    ({ item }: { item: TeamEloRow }) => {
      const meta = getTeamMeta(item);
      const record = `${item.wins ?? 0}-${item.losses ?? 0}-${item.draws ?? 0}`;
      const elo = Math.round(item.elo_rating ?? 1500);
      const { grade, color } = getEloGrade(elo);

      return (
        <TouchableOpacity
          style={styles.teamItem}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({
              pathname: "/team/[id]",
              params: { id: item.id },
            });
          }}
          activeOpacity={0.7}
        >
          <View style={styles.teamRow}>
            <View style={styles.teamInfo}>
              <Text style={styles.teamName} numberOfLines={1}>
                {item.team_name || "Unknown Team"}
              </Text>
              {meta ? <Text style={styles.teamMeta}>{meta}</Text> : null}
              <Text style={styles.recordText}>Record: {record}</Text>
              {item.national_rank && (
                <Text style={styles.rankText}>
                  🏆 National Rank #{item.national_rank}
                </Text>
              )}
            </View>
            <View style={styles.eloContainer}>
              <Text style={[styles.eloGrade, { color }]}>{grade}</Text>
              <Text style={styles.eloRating}>{elo}</Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [getTeamMeta],
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text style={styles.footerText}>Loading more teams...</Text>
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="people-outline" size={48} color="#374151" />
        <Text style={styles.emptyText}>
          {hasFilters ? "No teams match filters" : "No teams"}
        </Text>
        {hasFilters && (
          <TouchableOpacity
            style={styles.clearFiltersButton}
            onPress={clearFilters}
          >
            <Text style={styles.clearFiltersButtonText}>Clear Filters</Text>
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
        <Text style={styles.title}>Teams</Text>
        <Text style={styles.subtitle}>
          {totalTeams.toLocaleString()} teams nationwide
        </Text>
      </View>

      {/* Filters - CONSISTENT ORDER: Gender → Age Group → State */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.filtersContainer}>
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
                toggleChip(g, selectedGenders, setSelectedGenders),
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
                toggleChip(age, selectedAges, setSelectedAges),
              ),
            )}
          </ScrollView>

          {/* State Filter - MOVED: Now after Age Group for consistency */}
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
                  toggleChip(st, selectedStates, setSelectedStates),
                ),
              )}
            </ScrollView>
          )}

          {/* Clear Filters */}
          {hasFilters && (
            <TouchableOpacity style={styles.clearChip} onPress={clearFilters}>
              <Ionicons name="close-circle" size={16} color="#9ca3af" />
              <Text style={styles.clearChipText}> Clear filters</Text>
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
              <Text style={styles.infoButtonText}>How ratings work</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading teams...</Text>
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
          data={teams}
          renderItem={renderTeam}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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

      {/* Info Modal */}
      <Modal
        visible={infoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setInfoModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>How Ratings Work</Text>
              <TouchableOpacity onPress={() => setInfoModalVisible(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>ELO Rating System</Text>
              {"\n"}
              Teams start at 1500 ELO. Winning increases rating, losing
              decreases it.
            </Text>
            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>Letter Grades</Text>
              {"\n"}
              A+ (1650+) Elite | A/A- (1550-1649) Excellent{"\n"}
              B+/B/B- (1475-1549) Above Average{"\n"}
              C+/C/C- (1400-1474) Average{"\n"}
              D+/D/D- (below 1400) Developing
            </Text>
            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>🏆 National Rank</Text>
              {"\n"}
              Official GotSport ranking based on tournament performance.
            </Text>
            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>Season</Text>
              {"\n"}
              August 1st through July 31st (typical youth soccer calendar)
            </Text>
          </View>
        </TouchableOpacity>
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
  subtitle: { color: "#9ca3af", fontSize: 16, marginTop: 4 },
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
  clearChipText: {
    color: "#9ca3af",
    fontWeight: "600",
    fontSize: 14,
  },
  chipText: { color: "#fff", fontWeight: "600", fontSize: 14 },
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
  teamItem: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#111",
    marginBottom: 10,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  teamRow: { flexDirection: "row", alignItems: "center" },
  teamInfo: { flex: 1, marginRight: 12 },
  teamName: { color: "#fff", fontSize: 16, fontWeight: "600" },
  teamMeta: { color: "#9ca3af", fontSize: 13, marginTop: 4 },
  recordText: { color: "#6b7280", fontSize: 12, marginTop: 4 },
  rankText: { color: "#f59e0b", fontSize: 12, marginTop: 4, fontWeight: "600" },
  eloContainer: { alignItems: "center", minWidth: 60 },
  eloGrade: { fontSize: 24, fontWeight: "bold" },
  eloRating: { color: "#6b7280", fontSize: 12, marginTop: 2 },

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
  emptyText: { color: "#6b7280", fontSize: 16, marginTop: 16 },
  clearFiltersButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#374151",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4b5563",
  },
  clearFiltersButtonText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  modalContent: {
    backgroundColor: "#1F2937",
    borderRadius: 16,
    padding: 20,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  modalText: {
    color: "#d1d5db",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
  },
  modalBold: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
