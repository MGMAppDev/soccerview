import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  // GotSport official rankings (will be populated by scraper)
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

type ViewMode = "leaderboard" | "national" | "state";

// Valid age groups - U8 through U19 only
const VALID_AGE_GROUPS = [
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

// ============================================================
// DATA FETCHING
// ============================================================

async function fetchAllTeams(): Promise<TeamRankRow[]> {
  const allRows: TeamRankRow[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("team_elo")
      .select(
        "id, team_name, state, elo_rating, matches_played, wins, losses, draws, gender, age_group, national_rank, regional_rank, state_rank, gotsport_points, national_award, regional_award, state_cup_award",
      )
      .order("elo_rating", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("Error fetching teams:", error);
      break;
    }

    if (data && data.length > 0) {
      allRows.push(...(data as TeamRankRow[]));
      offset += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  console.log(`Rankings: Fetched ${allRows.length} total teams`);
  return allRows;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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

  const [allTeams, setAllTeams] = useState<TeamRankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  useEffect(() => {
    loadTeams();
  }, []);

  const loadTeams = async () => {
    try {
      setError(null);
      const data = await fetchAllTeams();
      setAllTeams(data);
    } catch (err: any) {
      console.error("Error:", err);
      setError(err.message || "Failed to load rankings");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTeams();
    setRefreshing(false);
  };

  // ============================================================
  // DERIVED DATA
  // ============================================================

  const allStates = useMemo(() => {
    return [
      ...new Set(allTeams.map((t) => t.state).filter(isValidValue)),
    ].sort();
  }, [allTeams]);

  const allGenders = useMemo(() => {
    return [
      ...new Set(allTeams.map((t) => t.gender).filter(isValidValue)),
    ].sort();
  }, [allTeams]);

  // Filter age groups to U9-U19 only
  const allAgeGroups = useMemo(() => {
    const normalizedValues = allTeams
      .map((t) => normalizeAgeGroup(t.age_group))
      .filter(isValidValue);
    const uniqueAges = [...new Set(normalizedValues)];
    // Only include valid age groups (U9-U19)
    return uniqueAges
      .filter((age) => VALID_AGE_GROUPS.includes(age))
      .sort((a, b) => {
        const numA = parseInt(a?.replace(/\D/g, "") || "0", 10);
        const numB = parseInt(b?.replace(/\D/g, "") || "0", 10);
        return numA - numB;
      });
  }, [allTeams]);

  // Count teams with official national rank
  const teamsWithNationalRank = useMemo(() => {
    return allTeams.filter((t) => t.national_rank !== null).length;
  }, [allTeams]);

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

  // ============================================================
  // FILTERED RANKINGS - Different logic per mode
  // ============================================================

  const filteredRankings = useMemo(() => {
    let filtered = allTeams;

    // LEADERBOARD MODE: Only teams with official national_rank, sorted by rank
    if (mode === "leaderboard") {
      filtered = filtered.filter((t) => t.national_rank !== null);
      // Sort by national_rank ascending (1 is best)
      filtered = [...filtered].sort(
        (a, b) => (a.national_rank || 9999) - (b.national_rank || 9999),
      );
    }

    // STATE MODE: Filter by selected states
    if (mode === "state" && selectedStates.length > 0) {
      filtered = filtered.filter(
        (t) => isValidValue(t.state) && selectedStates.includes(t.state),
      );
    }

    // Apply gender filter (all modes)
    if (selectedGenders.length > 0) {
      filtered = filtered.filter(
        (t) => isValidValue(t.gender) && selectedGenders.includes(t.gender),
      );
    }

    // Apply age filter (all modes)
    if (selectedAges.length > 0) {
      filtered = filtered.filter((t) => {
        const normalizedTeamAge = normalizeAgeGroup(t.age_group);
        return normalizedTeamAge && selectedAges.includes(normalizedTeamAge);
      });
    }

    // Apply search filter (all modes)
    if (searchQuery) {
      filtered = filtered.filter((t) =>
        t.team_name?.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    // For non-leaderboard modes, add computed rank based on position
    if (mode !== "leaderboard") {
      return filtered.map((team, index) => ({ ...team, rank: index + 1 }));
    }

    // For leaderboard mode, use the official national_rank
    return filtered;
  }, [
    allTeams,
    mode,
    selectedStates,
    selectedGenders,
    selectedAges,
    searchQuery,
  ]);

  // ============================================================
  // HANDLERS
  // ============================================================

  const handleModeChange = useCallback((newMode: ViewMode) => {
    setMode(newMode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (newMode === "national" || newMode === "leaderboard") {
      setSelectedStates([]);
    }
  }, []);

  const clearFilters = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedStates([]);
    setSelectedGenders([]);
    setSelectedAges([]);
    setSearchQuery("");
  }, []);

  const hasFilters =
    selectedStates.length > 0 ||
    selectedGenders.length > 0 ||
    selectedAges.length > 0 ||
    searchQuery !== "";

  const getTeamDetails = useCallback((item: TeamRankRow): string => {
    const parts: string[] = [];
    if (isValidValue(item.state)) parts.push(item.state);
    if (isValidValue(item.gender)) parts.push(item.gender);
    const normalizedAge = normalizeAgeGroup(item.age_group);
    if (normalizedAge) parts.push(normalizedAge);
    return parts.join(" · ");
  }, []);

  // ============================================================
  // RENDER ITEMS
  // ============================================================

  // Premium leaderboard item with official ranking
  const renderLeaderboardItem = useCallback(
    ({ item }: { item: TeamRankRow }) => {
      const details = getTeamDetails(item);
      const record = `${item.wins ?? 0}-${item.losses ?? 0}-${item.draws ?? 0}`;
      const elo = Math.round(item.elo_rating ?? 1500);
      const { grade, color: eloColor } = getEloGrade(elo);
      const rank = item.national_rank || 0;
      const isTopThree = rank <= 3;
      const isTopTen = rank <= 10;
      const medalEmoji = getMedalEmoji(rank);
      const awards = getAwardBadges(item);

      return (
        <TouchableOpacity
          style={[
            styles.leaderboardItem,
            isTopThree && styles.leaderboardItemTopThree,
            isTopTen && !isTopThree && styles.leaderboardItemTopTen,
          ]}
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(`/team/${item.id}`);
          }}
        >
          {/* Rank Badge */}
          <View
            style={[
              styles.leaderboardRankBadge,
              { backgroundColor: getMedalColor(rank) + "20" },
            ]}
          >
            {isTopThree ? (
              <Text style={styles.medalEmoji}>{medalEmoji}</Text>
            ) : (
              <Text
                style={[styles.leaderboardRank, { color: getMedalColor(rank) }]}
              >
                {rank}
              </Text>
            )}
          </View>

          {/* Team Info */}
          <View style={styles.leaderboardInfo}>
            <View style={styles.leaderboardNameRow}>
              <Text style={styles.leaderboardName} numberOfLines={1}>
                {item.team_name ?? "Unknown"}
              </Text>
              {awards ? <Text style={styles.awardBadges}>{awards}</Text> : null}
            </View>
            <Text style={styles.leaderboardDetails}>{details}</Text>
            <View style={styles.leaderboardStats}>
              <Text style={styles.leaderboardRecord}>{record}</Text>
              {item.gotsport_points ? (
                <Text style={styles.leaderboardPoints}>
                  {Math.round(item.gotsport_points)} pts
                </Text>
              ) : null}
            </View>
          </View>

          {/* ELO Grade */}
          <View style={styles.leaderboardRating}>
            <Text style={[styles.leaderboardGrade, { color: eloColor }]}>
              {grade}
            </Text>
            <Text style={styles.leaderboardElo}>{elo}</Text>
          </View>

          <Ionicons name="chevron-forward" size={18} color="#4b5563" />
        </TouchableOpacity>
      );
    },
    [getTeamDetails],
  );

  // Standard team item (for national/state modes)
  const renderTeamItem = useCallback(
    ({ item }: { item: TeamRankRow }) => {
      const details = getTeamDetails(item);
      const record = `${item.wins ?? 0}-${item.losses ?? 0}-${item.draws ?? 0}`;
      const elo = Math.round(item.elo_rating ?? 1500);
      const { grade, color } = getEloGrade(elo);

      return (
        <TouchableOpacity
          style={styles.teamItem}
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(`/team/${item.id}`);
          }}
        >
          <View style={styles.rankContainer}>
            <Text style={[styles.rank, { color: getMedalColor(item.rank) }]}>
              {item.rank ?? "-"}
            </Text>
          </View>
          <View style={styles.teamInfo}>
            <Text style={styles.teamName} numberOfLines={1}>
              {item.team_name ?? "Unknown"}
            </Text>
            {details ? <Text style={styles.teamDetails}>{details}</Text> : null}
            <Text style={styles.recordText}>
              {record} ({item.matches_played ?? 0} games)
            </Text>
          </View>
          <View style={styles.ratingContainer}>
            <Text style={[styles.ratingGrade, { color }]}>{grade}</Text>
            <Text style={styles.ratingElo}>{elo}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#4b5563" />
        </TouchableOpacity>
      );
    },
    [getTeamDetails],
  );

  // ============================================================
  // LIST HEADER
  // ============================================================

  const ListHeader = useMemo(
    () => (
      <View style={styles.filtersContainer}>
        {/* Search */}
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={18}
            color="#6b7280"
            style={{ marginRight: 8 }}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search teams..."
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
        </View>

        {/* View Mode */}
        <Text style={styles.sectionHeader}>View</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          keyboardShouldPersistTaps="always"
        >
          <TouchableOpacity
            key="leaderboard"
            style={[
              styles.baseChip,
              styles.leaderboardChip,
              mode === "leaderboard" && styles.leaderboardChipSelected,
            ]}
            onPress={() => handleModeChange("leaderboard")}
          >
            <Text
              style={[
                styles.chipText,
                mode === "leaderboard" && styles.leaderboardChipText,
              ]}
            >
              🏆 Leaderboard
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            key="national"
            style={[
              styles.baseChip,
              mode === "national" && styles.selectedChip,
            ]}
            onPress={() => handleModeChange("national")}
          >
            <Text style={styles.chipText}>🌎 National</Text>
          </TouchableOpacity>
          <TouchableOpacity
            key="state"
            style={[styles.baseChip, mode === "state" && styles.selectedChip]}
            onPress={() => handleModeChange("state")}
          >
            <Text style={styles.chipText}>📍 By State</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* State filter (only in state mode) */}
        {mode === "state" && (
          <>
            <Text style={styles.sectionHeader}>States</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              keyboardShouldPersistTaps="always"
            >
              {allStates.map((state) => (
                <TouchableOpacity
                  key={state}
                  style={[
                    styles.baseChip,
                    selectedStates.includes(state) && styles.selectedChip,
                  ]}
                  onPress={() =>
                    toggleSelection(state, selectedStates, setSelectedStates)
                  }
                >
                  <Text style={styles.chipText}>{state}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {/* Gender */}
        <Text style={styles.sectionHeader}>Gender</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          keyboardShouldPersistTaps="always"
        >
          {allGenders.map((gender) => (
            <TouchableOpacity
              key={gender}
              style={[
                styles.baseChip,
                selectedGenders.includes(gender) && styles.selectedChip,
              ]}
              onPress={() =>
                toggleSelection(gender, selectedGenders, setSelectedGenders)
              }
            >
              <Text style={styles.chipText}>{gender}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Age - Filtered to U9-U19 only */}
        <Text style={styles.sectionHeader}>Age Group</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          keyboardShouldPersistTaps="always"
        >
          {allAgeGroups.map((age) => (
            <TouchableOpacity
              key={age}
              style={[
                styles.baseChip,
                selectedAges.includes(age) && styles.selectedChip,
              ]}
              onPress={() =>
                toggleSelection(age, selectedAges, setSelectedAges)
              }
            >
              <Text style={styles.chipText}>{age}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Clear Filters */}
        {hasFilters && (
          <TouchableOpacity
            style={styles.clearChip}
            onPress={clearFilters}
            activeOpacity={0.8}
          >
            <Ionicons
              name="close"
              size={16}
              color="#fff"
              style={{ marginRight: 4 }}
            />
            <Text style={styles.chipText}>Clear Filters</Text>
          </TouchableOpacity>
        )}

        <View style={styles.resultsHeader}>
          <Text style={styles.resultsText}>
            {filteredRankings.length.toLocaleString()}
            {mode !== "leaderboard" &&
              ` of ${allTeams.length.toLocaleString()}`}{" "}
            teams
          </Text>
          <TouchableOpacity
            style={styles.infoButton}
            onPress={() => setInfoModalVisible(true)}
          >
            <Ionicons
              name="information-circle-outline"
              size={20}
              color="#3B82F6"
            />
            <Text style={styles.infoButtonText}>How Rankings Work</Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [
      searchQuery,
      mode,
      allStates,
      allGenders,
      allAgeGroups,
      selectedStates,
      selectedGenders,
      selectedAges,
      hasFilters,
      filteredRankings.length,
      allTeams.length,
      teamsWithNationalRank,
      handleModeChange,
      toggleSelection,
      clearFilters,
    ],
  );

  // ============================================================
  // ERROR STATE
  // ============================================================

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color="#374151" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              loadTeams();
            }}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================
  // MAIN RENDER
  // ============================================================

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.header}>
          <Text style={styles.title}>Rankings</Text>
        </View>
      </TouchableWithoutFeedback>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading all rankings...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRankings}
          renderItem={
            mode === "leaderboard" ? renderLeaderboardItem : renderTeamItem
          }
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="trophy-outline" size={48} color="#374151" />
              <Text style={styles.noDataText}>
                {hasFilters
                  ? "No teams match filters"
                  : mode === "leaderboard"
                    ? "No ranked teams yet"
                    : "No rankings"}
              </Text>
              {hasFilters && (
                <TouchableOpacity
                  style={styles.clearFiltersButton}
                  onPress={clearFilters}
                >
                  <Text style={styles.clearFiltersText}>Clear Filters</Text>
                </TouchableOpacity>
              )}
            </View>
          }
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
          showsVerticalScrollIndicator={false}
          initialNumToRender={20}
          maxToRenderPerBatch={30}
          removeClippedSubviews={true}
          getItemLayout={
            mode !== "leaderboard"
              ? (_, index) => ({
                  length: 85,
                  offset: 85 * index,
                  index,
                })
              : undefined
          }
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
              <Text style={styles.modalTitle}>How Rankings Work</Text>
              <TouchableOpacity onPress={() => setInfoModalVisible(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>🏆 Leaderboard</Text>
              {"\n"}
              Official GotSport national rankings - the same rankings tournament
              directors use for seeding.
            </Text>

            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>ELO Rating System</Text>
              {"\n"}
              Teams start at 1500 ELO. Winning increases rating, losing
              decreases it. Beating stronger teams earns more points.
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
              <Text style={styles.modalBold}>Award Badges</Text>
              {"\n"}
              🏆 National Champion | 🥇 Regional Winner | 🏅 State Cup Winner
            </Text>

            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>Multi-Select</Text>
              {"\n"}
              Select multiple states, genders, or ages to compare across
              categories.
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
  filtersContainer: { paddingHorizontal: 16, paddingTop: 8 },
  sectionHeader: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 4,
  },
  chipScroll: { flexDirection: "row", marginBottom: 12 },
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

  // Standard team item (national/state modes)
  teamItem: {
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
  rankContainer: { width: 40, alignItems: "center" },
  rank: { fontSize: 20, fontWeight: "bold" },
  teamInfo: { flex: 1, marginLeft: 12 },
  teamName: { color: "#fff", fontSize: 16, fontWeight: "600" },
  teamDetails: { color: "#9ca3af", fontSize: 13, marginTop: 2 },
  recordText: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  ratingContainer: { alignItems: "center", minWidth: 50 },
  ratingGrade: { fontSize: 20, fontWeight: "bold" },
  ratingElo: { color: "#6b7280", fontSize: 11, marginTop: 2 },

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
    alignItems: "center",
    gap: 6,
  },
  leaderboardName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
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
