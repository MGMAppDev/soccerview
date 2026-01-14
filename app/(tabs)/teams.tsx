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

export default function TeamsTab() {
  const [teams, setTeams] = useState<TeamEloRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state - use refs to prevent focus loss
  const [searchQuery, setSearchQuery] = useState("");
  const [stateSearch, setStateSearch] = useState("");
  const searchInputRef = useRef<TextInput>(null);
  const stateInputRef = useRef<TextInput>(null);

  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [selectedAges, setSelectedAges] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);

  // Info modal state
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  useEffect(() => {
    void fetchTeams();
  }, []);

  // Helper to check if a value is valid (not null, empty, or "??")
  const isValidValue = (v: string | null | undefined): v is string => {
    return !!v && v.trim().length > 0 && v.trim() !== "??";
  };

  // Compute unique values client-side from fetched teams
  const uniqueGenders = useMemo(() => {
    const values = teams.map((t) => t.gender?.trim()).filter(isValidValue);
    return [...new Set(values)].sort();
  }, [teams]);

  const uniqueAges = useMemo(() => {
    const values = teams.map((t) => t.age_group?.trim()).filter(isValidValue);
    // Sort age groups numerically (U8, U9, U10, U11, etc.)
    return [...new Set(values)].sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return numA - numB;
    });
  }, [teams]);

  const uniqueStates = useMemo(() => {
    const values = teams.map((t) => t.state?.trim()).filter(isValidValue);
    return [...new Set(values)].sort();
  }, [teams]);

  const fetchTeams = async () => {
    try {
      setError(null);

      // Query team_elo table - NO LIMIT to get all teams
      const { data, error } = await supabase
        .from("team_elo")
        .select(
          "id, team_name, elo_rating, matches_played, wins, losses, draws, state, gender, age_group",
        )
        .order("team_name", { ascending: true });

      if (error) throw error;

      setTeams((data as TeamEloRow[]) || []);
    } catch (err) {
      console.error("Error fetching teams:", err);
      setError("Failed to load teams. Pull to refresh.");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTeams();
    setRefreshing(false);
  };

  const toggleChip = (
    item: string,
    selected: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item],
    );
  };

  const clearFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedGenders([]);
    setSelectedAges([]);
    setSelectedStates([]);
    setSearchQuery("");
    setStateSearch("");
  };

  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      const nameMatch =
        !searchQuery ||
        (team.team_name?.toLowerCase().includes(searchQuery.toLowerCase()) ??
          false);

      const genderMatch =
        selectedGenders.length === 0 ||
        (team.gender && selectedGenders.includes(team.gender));

      const ageMatch =
        selectedAges.length === 0 ||
        (team.age_group && selectedAges.includes(team.age_group));

      const stateMatchChip =
        selectedStates.length === 0 ||
        (team.state && selectedStates.includes(team.state));

      const stateMatchSearch =
        !stateSearch ||
        (team.state?.toLowerCase().includes(stateSearch.toLowerCase()) ??
          false);

      return (
        nameMatch &&
        genderMatch &&
        ageMatch &&
        stateMatchChip &&
        stateMatchSearch
      );
    });
  }, [
    teams,
    searchQuery,
    stateSearch,
    selectedGenders,
    selectedAges,
    selectedStates,
  ]);

  const hasFilters =
    selectedGenders.length > 0 ||
    selectedAges.length > 0 ||
    selectedStates.length > 0 ||
    searchQuery.length > 0 ||
    stateSearch.length > 0;

  // Build display string for team metadata
  const getTeamMeta = (team: TeamEloRow): string => {
    const parts: string[] = [];
    if (isValidValue(team.state)) parts.push(team.state);
    if (isValidValue(team.gender)) parts.push(team.gender);
    if (isValidValue(team.age_group)) parts.push(team.age_group);
    return parts.length > 0 ? parts.join(" · ") : "";
  };

  const renderTeam = ({ item }: { item: TeamEloRow }) => {
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
              {item.team_name ?? "Unknown Team"}
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
          <Ionicons
            name="chevron-forward"
            size={18}
            color="#4b5563"
            style={styles.chevron}
          />
        </View>
      </TouchableOpacity>
    );
  };

  const renderGenderChips = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipScroll}
      keyboardShouldPersistTaps="handled"
    >
      {uniqueGenders.map((item) => (
        <TouchableOpacity
          key={item}
          style={[
            styles.baseChip,
            selectedGenders.includes(item) && styles.selectedChip,
          ]}
          onPress={() => toggleChip(item, selectedGenders, setSelectedGenders)}
        >
          <Text style={styles.chipText}>{item}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderAgeChips = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipScroll}
      keyboardShouldPersistTaps="handled"
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
  );

  const renderStateChips = () => {
    const filteredStates = stateSearch
      ? uniqueStates.filter((s) =>
          s.toLowerCase().includes(stateSearch.toLowerCase()),
        )
      : uniqueStates;

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        keyboardShouldPersistTaps="handled"
      >
        {filteredStates.map((item) => (
          <TouchableOpacity
            key={item}
            style={[
              styles.baseChip,
              selectedStates.includes(item) && styles.selectedChip,
            ]}
            onPress={() => toggleChip(item, selectedStates, setSelectedStates)}
          >
            <Text style={styles.chipText}>{item}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  const ListHeader = () => (
    <View>
      <View style={styles.filtersContainer}>
        {/* Search teams */}
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={18}
            color="#6b7280"
            style={styles.searchIcon}
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

        {/* Gender filter */}
        <Text style={styles.sectionHeader}>Gender</Text>
        {uniqueGenders.length > 0 ? (
          renderGenderChips()
        ) : (
          <Text style={styles.noOptionsText}>No gender data available</Text>
        )}

        {/* Age group filter */}
        <Text style={styles.sectionHeader}>Age Group</Text>
        {uniqueAges.length > 0 ? (
          renderAgeChips()
        ) : (
          <Text style={styles.noOptionsText}>No age group data available</Text>
        )}

        {/* State filter with search */}
        <Text style={styles.sectionHeader}>State</Text>
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={18}
            color="#6b7280"
            style={styles.searchIcon}
          />
          <TextInput
            ref={stateInputRef}
            style={styles.searchInput}
            placeholder="Search states..."
            placeholderTextColor="#6b7280"
            value={stateSearch}
            onChangeText={setStateSearch}
            autoCorrect={false}
            autoCapitalize="characters"
            returnKeyType="search"
            blurOnSubmit={false}
          />
          {stateSearch.length > 0 && (
            <TouchableOpacity onPress={() => setStateSearch("")}>
              <Ionicons name="close-circle" size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
        </View>
        {uniqueStates.length > 0 ? (
          renderStateChips()
        ) : (
          <Text style={styles.noOptionsText}>No state data available</Text>
        )}

        {/* Clear Filters */}
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
          {filteredTeams.length.toLocaleString()}{" "}
          {filteredTeams.length === 1 ? "team" : "teams"} found
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
      <Ionicons name="people-outline" size={48} color="#374151" />
      <Text style={styles.emptyText}>
        {hasFilters ? "No teams match your filters" : "No teams available"}
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
            onPress={() => {
              setLoading(true);
              void fetchTeams();
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
      {/* Static Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Teams</Text>
        <Text style={styles.subtitle}>Browse youth soccer teams</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading teams...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTeams}
          renderItem={renderTeam}
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
          windowSize={10}
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
              losing decreases it. The amount gained/lost depends on opponent
              strength.
            </Text>

            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>Letter Grades</Text>
              {"\n"}A+ (1650+) - Elite{"\n"}
              A/A- (1550-1649) - Excellent{"\n"}
              B+/B/B- (1475-1549) - Above Average{"\n"}
              C+/C/C- (1400-1474) - Average{"\n"}
              D+/D/D- (below 1400) - Developing
            </Text>

            <Text style={styles.modalText}>
              <Text style={styles.modalBold}>Data Period</Text>
              {"\n"}Rankings are based on the current season's results. Teams
              are re-evaluated after each match.
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
  },
  selectedChip: {
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
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
  chipText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  noOptionsText: {
    color: "#6b7280",
    fontSize: 14,
    marginBottom: 12,
    fontStyle: "italic",
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
  searchIcon: {
    marginRight: 8,
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
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#111",
    marginBottom: 10,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  teamRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  teamInfo: {
    flex: 1,
    marginRight: 12,
  },
  teamName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  teamMeta: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 4,
  },
  recordText: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 4,
  },
  eloContainer: {
    alignItems: "center",
    minWidth: 60,
  },
  eloGrade: {
    fontSize: 24,
    fontWeight: "bold",
  },
  eloRating: {
    color: "#6b7280",
    fontSize: 12,
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
  emptyText: {
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
