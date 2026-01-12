import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
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

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<TeamEloRow>);

export default function TeamsTab() {
  const [teams, setTeams] = useState<TeamEloRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [tempSearchQuery, setTempSearchQuery] = useState("");
  const [stateSearch, setStateSearch] = useState("");
  const [tempStateSearch, setTempStateSearch] = useState("");

  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [selectedAges, setSelectedAges] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);

  const [scrollY] = useState(new Animated.Value(0));

  // Fade filters as user scrolls down
  const filtersOpacity = scrollY.interpolate({
    inputRange: [0, 150],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  useEffect(() => {
    void fetchTeams();
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      setSearchQuery(tempSearchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [tempSearchQuery]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setStateSearch(tempStateSearch);
    }, 300);
    return () => clearTimeout(handler);
  }, [tempStateSearch]);

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
    // Sort age groups numerically (U9, U10, U11, etc.)
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
      setLoading(true);
      setError(null);

      // Query team_elo table (has all 4,224 ranked teams)
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
    setTempSearchQuery("");
    setSearchQuery("");
    setTempStateSearch("");
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

    return (
      <TouchableOpacity
        style={styles.teamItem}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          // Future: navigate to team detail
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
            <Text style={styles.eloRating}>{elo}</Text>
            <Text style={styles.eloLabel}>ELO</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderGenderChips = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipScroll}
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

  const hasFilters =
    selectedGenders.length > 0 ||
    selectedAges.length > 0 ||
    selectedStates.length > 0 ||
    searchQuery !== "" ||
    stateSearch !== "";

  // ListHeaderComponent: contains all filters (scrolls with list)
  const ListHeader = () => (
    <Animated.View style={{ opacity: filtersOpacity }}>
      {/* Filters Section */}
      <View style={styles.filtersContainer}>
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search teams..."
            placeholderTextColor="#9ca3af"
            value={tempSearchQuery}
            onChangeText={setTempSearchQuery}
          />
        </View>

        <Text style={styles.sectionHeader}>Gender</Text>
        {uniqueGenders.length > 0 ? (
          renderGenderChips()
        ) : (
          <Text style={styles.noOptionsText}>No genders available</Text>
        )}

        <Text style={styles.sectionHeader}>Age Group</Text>
        {uniqueAges.length > 0 ? (
          renderAgeChips()
        ) : (
          <Text style={styles.noOptionsText}>No age groups available</Text>
        )}

        <Text style={styles.sectionHeader}>State</Text>
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search states..."
            placeholderTextColor="#9ca3af"
            value={tempStateSearch}
            onChangeText={setTempStateSearch}
          />
        </View>
        {uniqueStates.length > 0 ? (
          renderStateChips()
        ) : (
          <Text style={styles.noOptionsText}>No states available</Text>
        )}

        {hasFilters && (
          <TouchableOpacity style={styles.clearChip} onPress={clearFilters}>
            <Text style={styles.chipText}>Clear Filters</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Results count */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsText}>
          {filteredTeams.length.toLocaleString()}{" "}
          {filteredTeams.length === 1 ? "team" : "teams"} found
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
            onPress={() => void fetchTeams()}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Static Header - does NOT animate/shrink */}
      <View style={styles.header}>
        <Text style={styles.title}>Teams</Text>
        <Text style={styles.subtitle}>Browse youth soccer teams</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      ) : (
        <AnimatedFlatList
          data={filteredTeams}
          renderItem={renderTeam}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={styles.listContent}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true },
          )}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          initialNumToRender={20}
          maxToRenderPerBatch={30}
          windowSize={10}
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
  },
  selectedChip: {
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
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
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
    backgroundColor: "#1F2937",
  },
  searchInput: {
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
  eloRating: {
    color: "#3B82F6",
    fontSize: 20,
    fontWeight: "bold",
  },
  eloLabel: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 2,
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
});
