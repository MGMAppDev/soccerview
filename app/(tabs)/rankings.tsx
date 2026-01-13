import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
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

const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList<TeamRankRow>,
);

export default function RankingsTab() {
  const [mode, setMode] = useState<"national" | "state">("national");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [genderFilter, setGenderFilter] = useState<string>("");
  const [ageGroupFilter, setAgeGroupFilter] = useState<string>("");
  const [rankings, setRankings] = useState<TeamRankRow[]>([]);
  const [allStates, setAllStates] = useState<string[]>([]);
  const [allGenders, setAllGenders] = useState<string[]>([]);
  const [allAgeGroups, setAllAgeGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [scrollY] = useState(new Animated.Value(0));

  const filtersOpacity = scrollY.interpolate({
    inputRange: [0, 150],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  // Fetch all unique filter values on mount
  useEffect(() => {
    void fetchFilterOptions();
  }, []);

  useEffect(() => {
    void fetchRankings();
  }, [mode, stateFilter, genderFilter, ageGroupFilter]);

  const fetchFilterOptions = async () => {
    try {
      // Fetch all unique states
      const { data: stateData } = await supabase
        .from("team_elo")
        .select("state")
        .not("state", "is", null);

      const states = [
        ...new Set((stateData || []).map((r) => r.state).filter(isValidValue)),
      ].sort();
      setAllStates(states as string[]);

      // Fetch all unique genders
      const { data: genderData } = await supabase
        .from("team_elo")
        .select("gender")
        .not("gender", "is", null);

      const genders = [
        ...new Set(
          (genderData || []).map((r) => r.gender).filter(isValidValue),
        ),
      ].sort();
      setAllGenders(genders as string[]);

      // Fetch all unique age groups
      const { data: ageData } = await supabase
        .from("team_elo")
        .select("age_group")
        .not("age_group", "is", null);

      const ages = [
        ...new Set(
          (ageData || []).map((r) => r.age_group).filter(isValidValue),
        ),
      ].sort((a, b) => {
        const numA = parseInt(a?.replace(/\D/g, "") || "0", 10);
        const numB = parseInt(b?.replace(/\D/g, "") || "0", 10);
        return numA - numB;
      });
      setAllAgeGroups(ages as string[]);
    } catch (err) {
      console.error("Error fetching filter options:", err);
    }
  };

  const fetchRankings = async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase.from("team_elo").select("*");

      if (mode === "state" && stateFilter)
        query = query.eq("state", stateFilter);
      if (genderFilter) query = query.eq("gender", genderFilter);
      if (ageGroupFilter) query = query.eq("age_group", ageGroupFilter);

      const { data, error } = await query
        .order("elo_rating", { ascending: false })
        .limit(500);

      if (error) throw error;

      const rankedData = (data || []).map((team, index) => ({
        ...team,
        rank: index + 1,
      }));

      setRankings(rankedData as TeamRankRow[]);
    } catch (err: any) {
      console.error("Error fetching rankings:", err);
      setError(err.message || "Failed to load rankings");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRankings();
    setRefreshing(false);
  };

  const filteredRankings = useMemo(() => {
    if (!searchQuery) return rankings;
    return rankings.filter((team) =>
      team.team_name?.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [rankings, searchQuery]);

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
    stateFilter !== "" || genderFilter !== "" || ageGroupFilter !== "";

  const renderTeamItem = ({ item }: { item: TeamRankRow }) => {
    const details = getTeamDetails(item);
    const record = `${item.wins ?? 0}-${item.losses ?? 0}-${item.draws ?? 0}`;

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
          <Text style={styles.rating}>
            {item.elo_rating?.toFixed(0) ?? "—"}
          </Text>
          <Text style={styles.ratingLabel}>ELO</Text>
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
        >
          {renderChip("🌎 National", mode === "national", () =>
            handleModeChange("national"),
          )}
          {renderChip("📍 State", mode === "state", () =>
            handleModeChange("state"),
          )}
        </ScrollView>

        {/* State Filter (only when State mode) */}
        {mode === "state" && allStates.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>State</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
            >
              {allStates.map((state) => (
                <View key={state}>
                  {renderChip(state, stateFilter === state, () =>
                    setStateFilter(stateFilter === state ? "" : state),
                  )}
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {/* Gender Filter */}
        <Text style={styles.sectionHeader}>Gender</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
        >
          {allGenders.map((gender) => (
            <View key={gender}>
              {renderChip(gender, genderFilter === gender, () =>
                setGenderFilter(genderFilter === gender ? "" : gender),
              )}
            </View>
          ))}
        </ScrollView>

        {/* Age Group Filter */}
        <Text style={styles.sectionHeader}>Age Group</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
        >
          {allAgeGroups.map((age) => (
            <View key={age}>
              {renderChip(age, ageGroupFilter === age, () =>
                setAgeGroupFilter(ageGroupFilter === age ? "" : age),
              )}
            </View>
          ))}
        </ScrollView>

        {hasFilters && (
          <TouchableOpacity style={styles.clearChip} onPress={clearFilters}>
            <Ionicons
              name="close"
              size={14}
              color="#fff"
              style={{ marginRight: 4 }}
            />
            <Text style={styles.chipText}>Clear Filters</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Results count */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsText}>
          {filteredRankings.length.toLocaleString()} teams ranked
        </Text>
      </View>
    </Animated.View>
  );

  // Empty state component
  const EmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="trophy-outline" size={48} color="#374151" />
      <Text style={styles.noDataText}>
        {hasFilters || searchQuery
          ? "No teams match your filters"
          : "No rankings available"}
      </Text>
      {(hasFilters || searchQuery) && (
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
        <AnimatedFlatList
          data={filteredRankings}
          renderItem={renderTeamItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={EmptyComponent}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
            />
          }
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true },
          )}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          initialNumToRender={20}
          maxToRenderPerBatch={30}
        />
      )}
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
});
