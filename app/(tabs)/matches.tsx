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
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type MatchRow = {
  id: string;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  match_date: string | null;
  location: string | null;
  state: string | null;
};

type TimeFilter = "all" | "today" | "week" | "month";

// Pagination helper - fetches ALL rows bypassing Supabase's 1000 limit
async function fetchAllMatches(): Promise<MatchRow[]> {
  const allRows: MatchRow[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id, home_team, away_team, home_score, away_score, match_date, location, state",
      )
      .order("match_date", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("Error fetching matches:", error);
      throw error;
    }

    if (data && data.length > 0) {
      allRows.push(...(data as MatchRow[]));
      offset += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  console.log(`Matches: Fetched ${allRows.length} total matches`);
  return allRows;
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function isWithinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false;
  const matchDate = new Date(dateStr);
  const now = new Date();
  const diff = Math.abs(now.getTime() - matchDate.getTime());
  return diff <= days * 24 * 60 * 60 * 1000;
}

export default function MatchesTab() {
  const [allMatches, setAllMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [dropdownVisible, setDropdownVisible] = useState(false);

  useEffect(() => {
    loadMatches();
  }, []);

  const loadMatches = async () => {
    try {
      setError(null);
      const data = await fetchAllMatches();
      setAllMatches(data);
    } catch (err: any) {
      console.error("Error:", err);
      setError(err.message || "Failed to load matches");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMatches();
    setRefreshing(false);
  };

  // Filter matches client-side
  const filteredMatches = useMemo(() => {
    let filtered = allMatches;

    // Time filter
    if (timeFilter === "today") {
      filtered = filtered.filter((m) => isWithinDays(m.match_date, 1));
    } else if (timeFilter === "week") {
      filtered = filtered.filter((m) => isWithinDays(m.match_date, 7));
    } else if (timeFilter === "month") {
      filtered = filtered.filter((m) => isWithinDays(m.match_date, 30));
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.home_team?.toLowerCase().includes(q) ||
          m.away_team?.toLowerCase().includes(q) ||
          m.location?.toLowerCase().includes(q) ||
          m.state?.toLowerCase().includes(q),
      );
    }

    return filtered;
  }, [allMatches, timeFilter, searchQuery]);

  const getTimeFilterLabel = (): string => {
    switch (timeFilter) {
      case "today":
        return "Today";
      case "week":
        return "This Week";
      case "month":
        return "This Month";
      default:
        return "All Matches";
    }
  };

  const renderMatch = useCallback(({ item }: { item: MatchRow }) => {
    const dateStr = formatDate(item.match_date);
    const hasScore = item.home_score !== null && item.away_score !== null;
    const locationParts: string[] = [];
    if (dateStr) locationParts.push(dateStr);
    if (item.state) locationParts.push(item.state);
    if (item.location) locationParts.push(item.location);
    const locationStr = locationParts.join(" · ");

    return (
      <TouchableOpacity
        style={styles.matchCard}
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/match/${item.id}`);
        }}
      >
        {/* Top row: Date/Location */}
        {locationStr ? (
          <Text style={styles.locationText} numberOfLines={1}>
            {locationStr}
          </Text>
        ) : null}

        {/* Main content row: Teams + Score */}
        <View style={styles.matchContent}>
          {/* Teams column */}
          <View style={styles.teamsContainer}>
            <Text style={styles.homeTeam} numberOfLines={1}>
              {item.home_team ?? "Home Team"}
            </Text>
            <Text style={styles.awayTeam} numberOfLines={1}>
              vs {item.away_team ?? "Away Team"}
            </Text>
          </View>

          {/* Score column */}
          <View style={styles.scoreContainer}>
            {hasScore ? (
              <Text style={styles.scoreText}>
                {item.home_score} - {item.away_score}
              </Text>
            ) : (
              <Text style={styles.pendingText}>—</Text>
            )}
          </View>

          {/* Chevron */}
          <Ionicons name="chevron-forward" size={18} color="#4b5563" />
        </View>
      </TouchableOpacity>
    );
  }, []);

  const ListHeader = useMemo(
    () => (
      <View style={styles.filtersContainer}>
        {/* Time Filter Dropdown */}
        <TouchableOpacity
          style={styles.dropdownButton}
          onPress={() => setDropdownVisible(true)}
        >
          <Ionicons name="calendar" size={18} color="#3B82F6" />
          <Text style={styles.dropdownButtonText}>{getTimeFilterLabel()}</Text>
          <Ionicons name="chevron-down" size={18} color="#6b7280" />
        </TouchableOpacity>

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
            placeholder="Search matches..."
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

        <Text style={styles.resultsText}>
          {filteredMatches.length.toLocaleString()} of{" "}
          {allMatches.length.toLocaleString()} matches found
        </Text>
      </View>
    ),
    [searchQuery, timeFilter, filteredMatches.length, allMatches.length],
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
              loadMatches();
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
          <Text style={styles.title}>Matches</Text>
          <Text style={styles.subtitle}>Browse game results and schedules</Text>
        </View>
      </TouchableWithoutFeedback>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading all matches...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredMatches}
          renderItem={renderMatch}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="football-outline" size={48} color="#374151" />
              <Text style={styles.emptyText}>No matches found</Text>
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
            length: 100,
            offset: 100 * index,
            index,
          })}
        />
      )}

      {/* Time Filter Modal */}
      <Modal
        visible={dropdownVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDropdownVisible(false)}
        >
          <View style={styles.dropdownContent}>
            <Text style={styles.dropdownTitle}>Select Time Range</Text>
            {(["all", "today", "week", "month"] as TimeFilter[]).map(
              (filter) => (
                <TouchableOpacity
                  key={filter}
                  style={[
                    styles.dropdownOption,
                    timeFilter === filter && styles.dropdownOptionSelected,
                  ]}
                  onPress={() => {
                    setTimeFilter(filter);
                    setDropdownVisible(false);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownOptionText,
                      timeFilter === filter &&
                        styles.dropdownOptionTextSelected,
                    ]}
                  >
                    {filter === "all"
                      ? "All Matches"
                      : filter === "today"
                        ? "Today"
                        : filter === "week"
                          ? "This Week"
                          : "This Month"}
                  </Text>
                  {timeFilter === filter && (
                    <Ionicons name="checkmark" size={20} color="#3B82F6" />
                  )}
                </TouchableOpacity>
              ),
            )}
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
  dropdownButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1F2937",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
    alignSelf: "flex-start",
  },
  dropdownButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
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
  resultsText: { color: "#9ca3af", fontSize: 14, marginBottom: 12 },
  listContent: { paddingBottom: 24, flexGrow: 1 },
  matchCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    marginBottom: 10,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  locationText: {
    color: "#6b7280",
    fontSize: 12,
    marginBottom: 8,
  },
  matchContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  teamsContainer: {
    flex: 1,
    marginRight: 12,
  },
  homeTeam: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  awayTeam: {
    color: "#9ca3af",
    fontSize: 14,
  },
  scoreContainer: {
    minWidth: 60,
    alignItems: "center",
    marginRight: 8,
  },
  scoreText: {
    color: "#3B82F6",
    fontSize: 18,
    fontWeight: "bold",
  },
  pendingText: {
    color: "#6b7280",
    fontSize: 18,
    fontWeight: "bold",
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  dropdownContent: {
    backgroundColor: "#1F2937",
    borderRadius: 16,
    padding: 16,
  },
  dropdownTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
    textAlign: "center",
  },
  dropdownOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  dropdownOptionSelected: { backgroundColor: "rgba(59,130,246,0.15)" },
  dropdownOptionText: { color: "#d1d5db", fontSize: 16 },
  dropdownOptionTextSelected: { color: "#3B82F6", fontWeight: "600" },
});
