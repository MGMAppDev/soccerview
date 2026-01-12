import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Platform,
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
  team_id: string;
  name: string | null;
  state: string | null;
  rank: number | null;
  rating: number | null;
  gender: string | null;
  age_group: string | null;
  league_id?: string | null;
};

type LeagueRow = {
  id: string;
  name: string | null;
};

// Helper to check if a value is valid (not null, empty, or "??")
function isValidValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0 && v.trim() !== "??";
}

const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList<TeamRankRow>,
);

export default function RankingsTab() {
  const [mode, setMode] = useState<"national" | "state" | "league">("national");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [genderFilter, setGenderFilter] = useState<string>("");
  const [ageGroupFilter, setAgeGroupFilter] = useState<string>("");
  const [leagueModalVisible, setLeagueModalVisible] = useState(false);
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [rankings, setRankings] = useState<TeamRankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [scrollY] = useState(new Animated.Value(0));

  // Fade filters as user scrolls down
  const filtersOpacity = scrollY.interpolate({
    inputRange: [0, 150],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  useEffect(() => {
    void fetchLeagues();
  }, []);

  useEffect(() => {
    void fetchRankings();
  }, [mode, stateFilter, genderFilter, ageGroupFilter, selectedLeague]);

  // Compute unique values from rankings data (filtering out "??")
  const uniqueGenders = useMemo(() => {
    const values = rankings.map((t) => t.gender?.trim()).filter(isValidValue);
    return [...new Set(values)].sort() as string[];
  }, [rankings]);

  const uniqueAges = useMemo(() => {
    const values = rankings
      .map((t) => t.age_group?.trim())
      .filter(isValidValue);
    return [...new Set(values)].sort((a, b) => {
      const numA = parseInt(a?.replace(/\D/g, "") || "0", 10);
      const numB = parseInt(b?.replace(/\D/g, "") || "0", 10);
      return numA - numB;
    }) as string[];
  }, [rankings]);

  const uniqueStates = useMemo(() => {
    const values = rankings.map((t) => t.state?.trim()).filter(isValidValue);
    return [...new Set(values)].sort() as string[];
  }, [rankings]);

  const fetchLeagues = async () => {
    const { data, error } = await supabase
      .from("leagues")
      .select("id, name")
      .order("name");

    if (error) {
      console.error("Error fetching leagues:", error);
      return;
    }

    setLeagues((data as LeagueRow[]) || []);
  };

  const fetchRankings = async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase.from("team_ranks").select("*");

      if (mode === "state" && stateFilter)
        query = query.eq("state", stateFilter);
      if (genderFilter) query = query.eq("gender", genderFilter);
      if (ageGroupFilter) query = query.eq("age_group", ageGroupFilter);
      if (mode === "league" && selectedLeague)
        query = query.eq("league_id", selectedLeague);

      const { data, error } = await query.order("rank", { ascending: true });

      if (error) throw error;

      setRankings((data as TeamRankRow[]) || []);
    } catch (err: any) {
      console.error("Error fetching rankings:", err);
      setError(err.message || "Failed to load rankings");
    } finally {
      setLoading(false);
    }
  };

  const filteredRankings = useMemo(() => {
    if (!searchQuery) return rankings;
    return rankings.filter((team) =>
      team.name?.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [rankings, searchQuery]);

  const handleModeChange = (newMode: "national" | "state" | "league") => {
    setMode(newMode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (newMode !== "state") setStateFilter("");
    if (newMode !== "league") setSelectedLeague(null);
  };

  const handleSelectLeague = (league: LeagueRow) => {
    setSelectedLeague(league.id);
    setLeagueModalVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const clearFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStateFilter("");
    setGenderFilter("");
    setAgeGroupFilter("");
    setSelectedLeague(null);
    setSearchQuery("");
  };

  // Build team details string (filters out "??" values)
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
    selectedLeague !== null;

  const renderTeamItem = ({ item }: { item: TeamRankRow }) => {
    const details = getTeamDetails(item);
    return (
      <TouchableOpacity
        style={styles.teamItem}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/team/${item.team_id}`);
        }}
      >
        <View style={styles.rankContainer}>
          <Text style={styles.rank}>{item.rank ?? "-"}</Text>
        </View>
        <View style={styles.teamInfo}>
          <Text style={styles.teamName}>{item.name ?? "Unknown Team"}</Text>
          {details ? <Text style={styles.teamDetails}>{details}</Text> : null}
        </View>
        <View style={styles.ratingContainer}>
          <Text style={styles.rating}>{item.rating?.toFixed(0) ?? "—"}</Text>
          <Text style={styles.ratingLabel}>ELO</Text>
        </View>
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

  // ListHeaderComponent: contains all filters (scrolls with list)
  const ListHeader = () => (
    <Animated.View style={{ opacity: filtersOpacity }}>
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
          />
        </View>

        {/* View Mode */}
        <Text style={styles.sectionHeader}>View</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
        >
          {renderChip("National", mode === "national", () =>
            handleModeChange("national"),
          )}
          {renderChip("State", mode === "state", () =>
            handleModeChange("state"),
          )}
          {renderChip("League", mode === "league", () =>
            handleModeChange("league"),
          )}
        </ScrollView>

        {/* State Filter (only when State mode) */}
        {mode === "state" && uniqueStates.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>State</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
            >
              {uniqueStates.map((state) => (
                <View key={state}>
                  {renderChip(state, stateFilter === state, () =>
                    setStateFilter(stateFilter === state ? "" : state),
                  )}
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {/* League Selector (only when League mode) */}
        {mode === "league" && (
          <TouchableOpacity
            style={[styles.baseChip, styles.leagueSelector]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setLeagueModalVisible(true);
            }}
          >
            <Text style={styles.chipText}>
              {selectedLeague
                ? (leagues.find((l) => l.id === selectedLeague)?.name ??
                  "Select League")
                : "Select League"}
            </Text>
            <Ionicons
              name="chevron-down"
              size={16}
              color="#fff"
              style={{ marginLeft: 4 }}
            />
          </TouchableOpacity>
        )}

        {/* Gender Filter */}
        {uniqueGenders.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Gender</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
            >
              {uniqueGenders.map((gender) => (
                <View key={gender}>
                  {renderChip(gender, genderFilter === gender, () =>
                    setGenderFilter(genderFilter === gender ? "" : gender),
                  )}
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {/* Age Group Filter */}
        {uniqueAges.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Age Group</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
            >
              {uniqueAges.map((age) => (
                <View key={age}>
                  {renderChip(age, ageGroupFilter === age, () =>
                    setAgeGroupFilter(ageGroupFilter === age ? "" : age),
                  )}
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {/* Clear Filters */}
        {hasFilters && (
          <TouchableOpacity style={styles.clearChip} onPress={clearFilters}>
            <Text style={styles.chipText}>Clear Filters</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Results count */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsText}>
          {filteredRankings.length}{" "}
          {filteredRankings.length === 1 ? "team" : "teams"} ranked
        </Text>
      </View>
    </Animated.View>
  );

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void fetchRankings()}
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
        <Text style={styles.title}>Rankings</Text>
        <Text style={styles.subtitle}>
          Top youth soccer teams across the US
        </Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      ) : (
        <AnimatedFlatList
          data={filteredRankings}
          renderItem={renderTeamItem}
          keyExtractor={(item) => item.team_id}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <Text style={styles.noDataText}>
              No rankings match your filters.
            </Text>
          }
          contentContainerStyle={styles.listContent}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true },
          )}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* League Selection Modal */}
      <Modal
        visible={leagueModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setLeagueModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setLeagueModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select League</Text>
              <TouchableOpacity onPress={() => setLeagueModalVisible(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={leagues}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.leagueRow}
                  onPress={() => handleSelectLeague(item)}
                >
                  <Text style={styles.leagueRowText}>
                    {item.name ?? "Unknown League"}
                  </Text>
                </TouchableOpacity>
              )}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.noDataText}>No leagues available</Text>
              }
            />
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
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#EF4444",
    alignSelf: "flex-start",
    marginTop: 4,
    marginBottom: 8,
  },
  leagueSelector: {
    marginBottom: 12,
    alignSelf: "flex-start",
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#000",
  },
  resultsText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "500",
  },
  listContent: {
    paddingBottom: 24,
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
    color: "#3B82F6",
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
  ratingContainer: {
    alignItems: "flex-end",
  },
  rating: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  ratingLabel: {
    color: "#6b7280",
    fontSize: 11,
    fontWeight: "500",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    color: "#EF4444",
    textAlign: "center",
    fontSize: 16,
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
  noDataText: {
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
    marginTop: 20,
    fontStyle: "italic",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  modalContent: {
    backgroundColor: "#1F2937",
    borderRadius: 16,
    padding: 16,
    maxHeight: "70%",
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
    fontSize: 18,
    fontWeight: "700",
  },
  leagueRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  leagueRowText: {
    color: "#fff",
    fontSize: 15,
  },
});
