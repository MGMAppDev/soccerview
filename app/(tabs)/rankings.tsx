import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

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
  rank?: number;
};

// Helper to check if a value is valid
function isValidValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0 && v.trim() !== "??";
}

// Convert ELO to letter grade for intuitive display
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

export default function RankingsTab() {
  const [mode, setMode] = useState<"national" | "state">("national");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [genderFilter, setGenderFilter] = useState<string>("");
  const [ageGroupFilter, setAgeGroupFilter] = useState<string>("");
  const [allTeams, setAllTeams] = useState<TeamRankRow[]>([]);
  const [allStates, setAllStates] = useState<string[]>([]);
  const [allGenders, setAllGenders] = useState<string[]>([]);
  const [allAgeGroups, setAllAgeGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  const searchInputRef = useRef<TextInput>(null);

  // Fetch ALL teams once on mount, then filter client-side
  useEffect(() => {
    void fetchAllTeams();
  }, []);

  const fetchAllTeams = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch ALL teams - no limit
      const { data, error } = await supabase
        .from("team_elo")
        .select("*")
        .order("elo_rating", { ascending: false });

      if (error) throw error;

      const teams = (data || []) as TeamRankRow[];
      setAllTeams(teams);

      // Extract unique filter values
      const states = [
        ...new Set(teams.map((t) => t.state).filter(isValidValue)),
      ].sort();
      const genders = [
        ...new Set(teams.map((t) => t.gender).filter(isValidValue)),
      ].sort();
      const ages = [
        ...new Set(teams.map((t) => t.age_group).filter(isValidValue)),
      ].sort((a, b) => {
        const numA = parseInt(a?.replace(/\D/g, "") || "0", 10);
        const numB = parseInt(b?.replace(/\D/g, "") || "0", 10);
        return numA - numB;
      });

      setAllStates(states as string[]);
      setAllGenders(genders as string[]);
      setAllAgeGroups(ages as string[]);
    } catch (err: any) {
      console.error("Error fetching rankings:", err);
      setError(err.message || "Failed to load rankings");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAllTeams();
    setRefreshing(false);
  };

  // Filter and rank teams client-side
  const filteredRankings = useMemo(() => {
    let filtered = allTeams;

    // Apply filters
    if (mode === "state" && stateFilter) {
      filtered = filtered.filter((t) => t.state === stateFilter);
    }
    if (genderFilter) {
      filtered = filtered.filter((t) => t.gender === genderFilter);
    }
    if (ageGroupFilter) {
      filtered = filtered.filter((t) => t.age_group === ageGroupFilter);
    }

    // Apply search
    if (searchQuery) {
      filtered = filtered.filter((t) =>
        t.team_name?.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    // Re-rank after filtering
    return filtered.map((team, index) => ({
      ...team,
      rank: index + 1,
    }));
  }, [allTeams, mode, stateFilter, genderFilter, ageGroupFilter, searchQuery]);

  const handleModeChange = (newMode: "national" | "state") => {
    setMode(newMode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (newMode !== "state") setStateFilter("");
  };

  const clearFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStateFilter("");
    setGenderFilter("");
    setAgeGroupFilter("");
    setSearchQuery("");
  };

  const getTeamDetails = (item: TeamRankRow): string => {
    const parts: string[] = [];
    if (isValidValue(item.state)) parts.push(item.state!);
    if (isValidValue(item.gender)) parts.push(item.gender!);
    if (isValidValue(item.age_group)) parts.push(item.age_group!);
    return parts.join(" · ");
  };

  const hasFilters =
    stateFilter !== "" ||
    genderFilter !== "" ||
    ageGroupFilter !== "" ||
    searchQuery !== "";

  const renderTeamItem = ({ item }: { item: TeamRankRow }) => {
    const details = getTeamDetails(item);
    const record = `${item.wins ?? 0}-${item.losses ?? 0}-${item.draws ?? 0}`;
    const elo = Math.round(item.elo_rating ?? 1500);
    const { grade, color } = getEloGrade(elo);

    // Medal colors for top 3
    const getMedalColor = (rank: number | undefined) => {
      if (rank === 1) return "#FFD700"; // Gold
      if (rank === 2) return "#C0C0C0"; // Silver
      if (rank === 3) return "#CD7F32"; // Bronze
      return "#3B82F6"; // Default blue
    };

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
            {item.team_name ?? "Unknown Team"}
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
        <Ionicons
          name="chevron-forward"
          size={18}
          color="#4b5563"
          style={styles.chevron}
        />
      </TouchableOpacity>
    );
  };

  const renderChip = (
    label: string,
    selected: boolean,
    onPress: () => void,
  ) => (
    <TouchableOpacity
      style={[styles.baseChip, selected && styles.selectedChip]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
    >
      <Text style={[styles.chipText, selected && styles.selectedChipText]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const ListHeader = () => (
    <View>
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
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search teams..."
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            blurOnSubmit={false}
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
          keyboardShouldPersistTaps="handled"
        >
          {renderChip("🌎 National", mode === "national", () =>
            handleModeChange("national"),
          )}
          {renderChip("📍 State", mode === "state", () =>
            handleModeChange("state"),
          )}
        </ScrollView>

        {/* State filter - only show when in state mode */}
        {mode === "state" && (
          <>
            <Text style={styles.sectionHeader}>Select State</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              keyboardShouldPersistTaps="handled"
            >
              {allStates.map((state) =>
                renderChip(state, stateFilter === state, () =>
                  setStateFilter(stateFilter === state ? "" : state),
                ),
              )}
            </ScrollView>
          </>
        )}

        {/* Gender filter */}
        <Text style={styles.sectionHeader}>Gender</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          keyboardShouldPersistTaps="handled"
        >
          {allGenders.map((gender) =>
            renderChip(gender, genderFilter === gender, () =>
              setGenderFilter(genderFilter === gender ? "" : gender),
            ),
          )}
        </ScrollView>

        {/* Age group filter */}
        <Text style={styles.sectionHeader}>Age Group</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          keyboardShouldPersistTaps="handled"
        >
          {allAgeGroups.map((age) =>
            renderChip(age, ageGroupFilter === age, () =>
              setAgeGroupFilter(ageGroupFilter === age ? "" : age),
            ),
          )}
        </ScrollView>

        {/* Clear filters button */}
        {hasFilters && (
          <TouchableOpacity style={styles.clearChip} onPress={clearFilters}>
            <Ionicons
              name="close"
              size={16}
              color="#fff"
              style={{ marginRight: 4 }}
            />
            <Text style={styles.chipText}>Clear Filters</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Results count with info button */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsText}>
          {filteredRankings.length.toLocaleString()} teams ranked
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
  );

  // Empty state component
  const EmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="trophy-outline" size={48} color="#374151" />
      <Text style={styles.noDataText}>
        {hasFilters ? "No teams match your filters" : "No rankings available"}
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
  );

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color="#374151" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void fetchAllTeams()}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Rankings</Text>
        <Text style={styles.subtitle}>
          Top youth soccer teams across the US
        </Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading rankings...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRankings}
          renderItem={renderTeamItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={EmptyComponent}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
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
        />
      )}

      {/* Info Modal */}
      <Modal
        visible={infoModalVisible}
        transparent={true}
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
              <Text style={styles.modalBold}>ELO Rating System</Text>
              {"\n"}Teams start at 1500 ELO. Winning increases your rating,
              losing decreases it. The change depends on opponent strength -
              beating a stronger team earns more points.
            </Text>

            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>Letter Grades</Text>
              {"\n"}A+ (1650+) - Elite teams{"\n"}
              A/A- (1550-1649) - Excellent{"\n"}
              B+/B/B- (1475-1549) - Above Average{"\n"}
              C+/C/C- (1400-1474) - Average{"\n"}
              D+/D/D- (below 1400) - Developing
            </Text>

            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>Ranking Scope</Text>
              {"\n"}National rankings compare all teams. State rankings show
              teams from the selected state. Use filters to compare teams in
              your age group and gender.
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: "#000",
  },
  title: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "bold",
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: 16,
    marginTop: 4,
  },
  filtersContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: "#000",
  },
  sectionHeader: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 4,
  },
  chipScroll: {
    flexDirection: "row",
    marginBottom: 12,
  },
  baseChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "#1F2937",
    flexDirection: "row",
    alignItems: "center",
  },
  selectedChip: {
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
  },
  chipText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  selectedChipText: {
    color: "#fff",
  },
  clearChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#EF4444",
    alignSelf: "flex-start",
    marginTop: 4,
    marginBottom: 8,
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#000",
  },
  resultsText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "500",
  },
  infoButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  infoButtonText: {
    color: "#3B82F6",
    fontSize: 12,
    marginLeft: 4,
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
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
  rankContainer: {
    width: 40,
    alignItems: "center",
  },
  rank: {
    fontSize: 20,
    fontWeight: "bold",
  },
  teamInfo: {
    flex: 1,
    marginLeft: 12,
  },
  teamName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  teamDetails: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 2,
  },
  recordText: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  ratingContainer: {
    alignItems: "center",
    minWidth: 50,
  },
  ratingGrade: {
    fontSize: 20,
    fontWeight: "bold",
  },
  ratingElo: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 2,
  },
  chevron: {
    marginLeft: 8,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 12,
  },
  errorText: {
    color: "#EF4444",
    textAlign: "center",
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
  retryButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  noDataText: {
    color: "#6b7280",
    fontSize: 16,
    textAlign: "center",
    marginTop: 16,
  },
  clearFiltersButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#1F2937",
    borderRadius: 8,
  },
  clearFiltersText: {
    color: "#3B82F6",
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
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  modalText: {
    color: "#d1d5db",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
  },
  modalBold: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});
