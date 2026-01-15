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
};

// Pagination helper - fetches ALL rows bypassing 1000 limit
async function fetchAllTeams(): Promise<TeamEloRow[]> {
  const allRows: TeamEloRow[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("team_elo")
      .select(
        "id, team_name, elo_rating, matches_played, wins, losses, draws, state, gender, age_group",
      )
      .order("team_name", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("Error fetching teams:", error);
      break;
    }

    if (data && data.length > 0) {
      allRows.push(...(data as TeamEloRow[]));
      offset += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  console.log(`Fetched ${allRows.length} total teams`);
  return allRows;
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

function isValidValue(v: string | null | undefined): v is string {
  return !!v && v.trim().length > 0 && v.trim() !== "??";
}

// Normalize age groups: "U09" → "U9", "U08" → "U8", etc.
function normalizeAgeGroup(age: string | null | undefined): string | null {
  if (!age) return null;
  const trimmed = age.trim();
  const match = trimmed.match(/^(U)0*(\d+)$/i);
  if (match) {
    return `U${parseInt(match[2], 10)}`;
  }
  return trimmed;
}

export default function TeamsTab() {
  const [teams, setTeams] = useState<TeamEloRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [stateSearch, setStateSearch] = useState("");

  // Multi-select filters
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [selectedAges, setSelectedAges] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);

  const [infoModalVisible, setInfoModalVisible] = useState(false);

  useEffect(() => {
    loadTeams();
  }, []);

  const loadTeams = async () => {
    try {
      setError(null);
      const data = await fetchAllTeams();
      setTeams(data);
    } catch (err) {
      console.error("Error:", err);
      setError("Failed to load teams");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTeams();
    setRefreshing(false);
  };

  // Extract unique filter values from ALL teams
  const uniqueGenders = useMemo(() => {
    const values = teams.map((t) => t.gender?.trim()).filter(isValidValue);
    return [...new Set(values)].sort();
  }, [teams]);

  // Normalize age groups to avoid duplicates (U9 vs U09)
  const uniqueAges = useMemo(() => {
    const normalizedValues = teams
      .map((t) => normalizeAgeGroup(t.age_group))
      .filter(isValidValue);
    return [...new Set(normalizedValues)].sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return numA - numB;
    });
  }, [teams]);

  const uniqueStates = useMemo(() => {
    const values = teams.map((t) => t.state?.trim()).filter(isValidValue);
    return [...new Set(values)].sort();
  }, [teams]);

  // Filter teams
  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      if (
        searchQuery &&
        !team.team_name?.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }

      if (selectedGenders.length > 0) {
        if (
          !isValidValue(team.gender) ||
          !selectedGenders.includes(team.gender)
        ) {
          return false;
        }
      }

      if (selectedAges.length > 0) {
        const normalizedTeamAge = normalizeAgeGroup(team.age_group);
        if (!normalizedTeamAge || !selectedAges.includes(normalizedTeamAge)) {
          return false;
        }
      }

      if (selectedStates.length > 0) {
        if (!isValidValue(team.state) || !selectedStates.includes(team.state)) {
          return false;
        }
      }

      if (
        stateSearch &&
        !team.state?.toLowerCase().includes(stateSearch.toLowerCase())
      ) {
        return false;
      }

      return true;
    });
  }, [
    teams,
    searchQuery,
    stateSearch,
    selectedGenders,
    selectedAges,
    selectedStates,
  ]);

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
    setStateSearch("");
  }, []);

  const hasFilters =
    selectedGenders.length > 0 ||
    selectedAges.length > 0 ||
    selectedStates.length > 0 ||
    searchQuery.length > 0 ||
    stateSearch.length > 0;

  const getTeamMeta = useCallback((team: TeamEloRow): string => {
    const parts: string[] = [];
    if (isValidValue(team.state)) parts.push(team.state);
    if (isValidValue(team.gender)) parts.push(team.gender);
    const normalizedAge = normalizeAgeGroup(team.age_group);
    if (normalizedAge) parts.push(normalizedAge);
    return parts.join(" · ");
  }, []);

  const renderTeam = useCallback(
    ({ item }: { item: TeamEloRow }) => {
      const meta = getTeamMeta(item);
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
          <View style={styles.teamRow}>
            <View style={styles.teamInfo}>
              <Text style={styles.teamName} numberOfLines={1}>
                {item.team_name ?? "Unknown"}
              </Text>
              {meta ? <Text style={styles.teamMeta}>{meta}</Text> : null}
              <Text style={styles.recordText}>
                {record} ({item.matches_played ?? 0} games)
              </Text>
            </View>
            <View style={styles.eloContainer}>
              <Text style={[styles.eloGrade, { color }]}>{grade}</Text>
              <Text style={styles.eloRating}>{elo}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#4b5563" />
          </View>
        </TouchableOpacity>
      );
    },
    [getTeamMeta],
  );

  const SearchHeader = useMemo(
    () => (
      <View style={styles.filtersContainer}>
        {/* Team Search */}
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

        {/* Gender */}
        <Text style={styles.sectionHeader}>Gender</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          keyboardShouldPersistTaps="always"
        >
          {uniqueGenders.map((item) => (
            <TouchableOpacity
              key={item}
              style={[
                styles.baseChip,
                selectedGenders.includes(item) && styles.selectedChip,
              ]}
              onPress={() =>
                toggleChip(item, selectedGenders, setSelectedGenders)
              }
            >
              <Text style={styles.chipText}>{item}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Age Groups */}
        <Text style={styles.sectionHeader}>Age Group</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          keyboardShouldPersistTaps="always"
        >
          {uniqueAges.map((item) => (
            <TouchableOpacity
              key={item}
              style={[
                styles.baseChip,
                selectedAges.includes(item) && styles.selectedChip,
              ]}
              onPress={() => toggleChip(item, selectedAges, setSelectedAges)}
            >
              <Text style={styles.chipText}>{item}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* States */}
        <Text style={styles.sectionHeader}>State</Text>
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={18}
            color="#6b7280"
            style={{ marginRight: 8 }}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Filter states..."
            placeholderTextColor="#6b7280"
            value={stateSearch}
            onChangeText={setStateSearch}
            autoCorrect={false}
            autoCapitalize="characters"
            returnKeyType="search"
          />
          {stateSearch.length > 0 && (
            <TouchableOpacity onPress={() => setStateSearch("")}>
              <Ionicons name="close-circle" size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          keyboardShouldPersistTaps="always"
        >
          {(stateSearch
            ? uniqueStates.filter((s) =>
                s.toLowerCase().includes(stateSearch.toLowerCase()),
              )
            : uniqueStates
          ).map((item) => (
            <TouchableOpacity
              key={item}
              style={[
                styles.baseChip,
                selectedStates.includes(item) && styles.selectedChip,
              ]}
              onPress={() =>
                toggleChip(item, selectedStates, setSelectedStates)
              }
            >
              <Text style={styles.chipText}>{item}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Clear Filters - FIXED: Neutral gray without red hue */}
        {hasFilters && (
          <TouchableOpacity style={styles.clearChip} onPress={clearFilters}>
            <Ionicons
              name="close"
              size={16}
              color="#9ca3af"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.clearChipText}>Clear Filters</Text>
          </TouchableOpacity>
        )}

        <View style={styles.resultsHeader}>
          <Text style={styles.resultsText}>
            {filteredTeams.length.toLocaleString()} of{" "}
            {teams.length.toLocaleString()} teams
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
      stateSearch,
      selectedGenders,
      selectedAges,
      selectedStates,
      uniqueGenders,
      uniqueAges,
      uniqueStates,
      hasFilters,
      filteredTeams.length,
      teams.length,
      toggleChip,
      clearFilters,
    ],
  );

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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.header}>
          <Text style={styles.title}>Teams</Text>
          <Text style={styles.subtitle}>Browse youth soccer teams</Text>
        </View>
      </TouchableWithoutFeedback>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading all teams...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTeams}
          renderItem={renderTeam}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={SearchHeader}
          ListEmptyComponent={
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
                  <Text style={styles.clearFiltersButtonText}>
                    Clear Filters
                  </Text>
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
          getItemLayout={(_, index) => ({
            length: 90,
            offset: 90 * index,
            index,
          })}
        />
      )}

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
              <Text style={styles.modalBold}>Season</Text>
              {"\n"}
              August 1st through July 31st (typical youth soccer calendar)
            </Text>
            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>Filter Note</Text>
              {"\n"}
              Some teams have incomplete data. Filtering by gender/age/state
              only shows teams with that data.
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

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
  // FIXED: Clear Filters chip - clean neutral gray styling
  clearChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#27272a",
    alignSelf: "flex-start",
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#3f3f46",
  },
  clearChipText: {
    color: "#a1a1aa",
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
  eloContainer: { alignItems: "center", minWidth: 60 },
  eloGrade: { fontSize: 24, fontWeight: "bold" },
  eloRating: { color: "#6b7280", fontSize: 12, marginTop: 2 },
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
  // FIXED: Clear Filters button in empty state - matching neutral gray
  clearFiltersButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#27272a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3f3f46",
  },
  clearFiltersButtonText: {
    color: "#a1a1aa",
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
