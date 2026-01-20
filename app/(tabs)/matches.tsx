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
// TYPES - Updated for match_results table
// ============================================================

type MatchRow = {
  id: string;
  event_id: string | null;
  event_name: string | null;
  match_date: string | null;
  match_time: string | null;
  home_team_name: string | null;
  home_team_id: string | null;
  home_score: number | null;
  away_team_name: string | null;
  away_team_id: string | null;
  away_score: number | null;
  status: string | null;
  location: string | null;
  source_type: string | null;
  source_platform: string | null;
  age_group: string | null;
  gender: string | null;
};

type TimeFilter = "all" | "today" | "week" | "month";

// ============================================================
// CONSTANTS
// ============================================================

const PAGE_SIZE = 50;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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

// Note: Removed source badges to avoid platform branding

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function MatchesTab() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [dropdownVisible, setDropdownVisible] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch matches with pagination
  const fetchMatches = async (reset: boolean = false) => {
    try {
      setError(null);
      const currentOffset = reset ? 0 : offset;

      // Build query for match_results table
      let query = supabase
        .from("match_results")
        .select(
          "id, event_id, event_name, match_date, match_time, home_team_name, home_team_id, home_score, away_team_name, away_team_id, away_score, status, location, source_type, source_platform, age_group, gender",
          { count: "exact" },
        )
        .order("match_date", { ascending: false })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      // Apply time filter server-side for better performance
      if (timeFilter === "today") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        query = query.gte("match_date", today.toISOString().split("T")[0]);
        query = query.lt("match_date", tomorrow.toISOString().split("T")[0]);
      } else if (timeFilter === "week") {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        query = query.gte("match_date", weekAgo.toISOString().split("T")[0]);
      } else if (timeFilter === "month") {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        query = query.gte("match_date", monthAgo.toISOString().split("T")[0]);
      }

      // Apply search filter
      if (debouncedSearch.trim()) {
        const searchTerm = `%${debouncedSearch.trim()}%`;
        query = query.or(
          `home_team_name.ilike.${searchTerm},away_team_name.ilike.${searchTerm},location.ilike.${searchTerm},event_name.ilike.${searchTerm}`,
        );
      }

      const { data, error: queryError, count } = await query;

      if (queryError) throw queryError;

      const newMatches = (data || []) as MatchRow[];

      if (reset) {
        setMatches(newMatches);
        setOffset(PAGE_SIZE);
      } else {
        setMatches((prev) => [...prev, ...newMatches]);
        setOffset(currentOffset + PAGE_SIZE);
      }

      setTotalCount(count || 0);
      setHasMore(newMatches.length === PAGE_SIZE);
    } catch (err: any) {
      console.error("Error fetching matches:", err);
      setError(err.message || "Failed to load matches");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Initial load & reload when filters change
  useEffect(() => {
    setLoading(true);
    setOffset(0);
    fetchMatches(true);
  }, [timeFilter, debouncedSearch]);

  // Refresh
  const onRefresh = async () => {
    setRefreshing(true);
    setOffset(0);
    await fetchMatches(true);
    setRefreshing(false);
  };

  // Load more
  const loadMoreMatches = () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    fetchMatches(false);
  };

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

  // Render match card
  const renderMatch = useCallback(({ item }: { item: MatchRow }) => {
    const dateStr = formatDate(item.match_date);
    const hasScore = item.home_score !== null && item.away_score !== null;
    const isScheduled = item.status === "scheduled";

    // Build location string
    const locationParts: string[] = [];
    if (dateStr) locationParts.push(dateStr);
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
        {/* Top row: Date/Location + Source Badge */}
        <View style={styles.matchTopRow}>
          {locationStr ? (
            <Text style={styles.locationText} numberOfLines={1}>
              {locationStr}
            </Text>
          ) : null}
        </View>

        {/* Event name if available - filter out "GotSport" branding */}
        {item.event_name && item.event_name !== "GotSport" && (
          <Text style={styles.eventName} numberOfLines={1}>
            {item.event_name}
          </Text>
        )}

        {/* Main content row: Teams + Score */}
        <View style={styles.matchContent}>
          {/* Teams column */}
          <View style={styles.teamsContainer}>
            <Text style={styles.homeTeam} numberOfLines={1}>
              {item.home_team_name ?? "Home Team"}
            </Text>
            <Text style={styles.awayTeam} numberOfLines={1}>
              vs {item.away_team_name ?? "Away Team"}
            </Text>
          </View>

          {/* Score column */}
          <View style={styles.scoreContainer}>
            {hasScore ? (
              <Text style={styles.scoreText}>
                {item.home_score} - {item.away_score}
              </Text>
            ) : isScheduled ? (
              <Text style={styles.scheduledText}>TBD</Text>
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

  // Render footer (loading more indicator)
  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text style={styles.footerText}>Loading more...</Text>
      </View>
    );
  };

  // Render empty state
  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="football-outline" size={48} color="#374151" />
        <Text style={styles.emptyText}>No matches found</Text>
        {(searchQuery || timeFilter !== "all") && (
          <TouchableOpacity
            style={styles.clearFiltersButton}
            onPress={() => {
              setSearchQuery("");
              setTimeFilter("all");
            }}
          >
            <Text style={styles.clearFiltersText}>Clear Filters</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // Error state
  if (error && matches.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color="#374151" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              fetchMatches(true);
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

      {/* Filters Section */}
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
          {matches.length.toLocaleString()} of {totalCount.toLocaleString()}{" "}
          matches
        </Text>
      </View>

      {/* Main Content */}
      {loading && matches.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading matches...</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          renderItem={renderMatch}
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
          onEndReached={loadMoreMatches}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          removeClippedSubviews={Platform.OS === "android"}
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

// ============================================================
// STYLES
// ============================================================

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
  listContent: { paddingBottom: 24, paddingHorizontal: 16, flexGrow: 1 },

  // Match Card
  matchCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  matchTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  locationText: {
    color: "#6b7280",
    fontSize: 12,
    flex: 1,
  },
  eventName: {
    color: "#9ca3af",
    fontSize: 11,
    marginBottom: 8,
    fontStyle: "italic",
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
  scheduledText: {
    color: "#f59e0b",
    fontSize: 14,
    fontWeight: "600",
  },
  pendingText: {
    color: "#6b7280",
    fontSize: 18,
    fontWeight: "bold",
  },

  // Footer
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
  emptyText: { color: "#6b7280", fontSize: 16, marginTop: 16 },
  clearFiltersButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#1F2937",
    borderRadius: 8,
  },
  clearFiltersText: { color: "#3B82F6", fontSize: 14, fontWeight: "600" },

  // Modal
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
