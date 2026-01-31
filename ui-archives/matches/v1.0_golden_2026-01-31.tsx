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
import { MatchCard, MatchCardData } from "../../components/MatchCard";
import { MatchListSkeleton } from "../../components/SkeletonLoader";
import { supabase } from "../../lib/supabase";
import {
  AppMatchesFeedRow,
  GENDER_DISPLAY,
} from "../../lib/supabase.types";

// ============================================================
// TYPES - Legacy format for UI compatibility
// ============================================================

// UI-facing type compatible with MatchCard component
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
// DATA TRANSFORMATION
// Transform new schema to legacy format for UI compatibility
// ============================================================

function transformMatchFeedRow(row: AppMatchesFeedRow): MatchRow {
  return {
    id: row.id,
    event_id: row.event?.id ?? null,
    event_name: row.event?.name ?? null,
    match_date: row.match_date,
    match_time: row.match_time,
    home_team_name: row.home_team?.display_name ?? null,
    home_team_id: row.home_team?.id ?? null,
    home_score: row.home_score,
    away_team_name: row.away_team?.display_name ?? null,
    away_team_id: row.away_team?.id ?? null,
    away_score: row.away_score,
    status: null, // Not in new schema
    location: row.venue?.name ?? null,
    source_type: row.event?.type ?? null,
    source_platform: null, // Not in new view
    age_group: row.age_group,
    gender: GENDER_DISPLAY[row.gender] ?? row.gender, // 'M' -> 'Boys', 'F' -> 'Girls'
  };
}

// ============================================================
// CONSTANTS
// ============================================================

const PAGE_SIZE = 50;

// Note: Match card rendering uses shared MatchCard component from components/MatchCard.tsx

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

  // Fetch matches with pagination - USING NEW MATERIALIZED VIEW (Phase 3)
  const fetchMatches = async (reset: boolean = false) => {
    try {
      setError(null);
      const currentOffset = reset ? 0 : offset;

      // Get total count via estimated count on first load only
      if (reset && totalCount === 0) {
        const { count } = await supabase
          .from("app_matches_feed")
          .select("id", { count: "estimated", head: true });
        setTotalCount(count || 0);
      }

      // Build query for app_matches_feed materialized view
      // All team/event data is embedded as JSONB - no joins needed!
      let query = supabase
        .from("app_matches_feed")
        .select(
          "id, match_date, match_time, home_score, away_score, home_team, away_team, event, venue, gender, birth_year, age_group, state",
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

      // Apply search filter - search in embedded JSONB fields
      // Note: JSONB text search requires different syntax
      if (debouncedSearch.trim()) {
        const searchTerm = debouncedSearch.trim().toLowerCase();
        // For JSONB fields, we need to use contains or text search
        // Simplified: search on state for now (native column)
        // TODO: Add full-text search on materialized view if needed
        query = query.or(
          `state.ilike.%${searchTerm}%,age_group.ilike.%${searchTerm}%`,
        );
      }

      const { data, error: queryError } = await query;

      if (queryError) throw queryError;

      // Transform from new schema to legacy format for MatchCard compatibility
      const newMatches = (data || []).map(row => transformMatchFeedRow(row as AppMatchesFeedRow));

      if (reset) {
        setMatches(newMatches);
        setOffset(PAGE_SIZE);
      } else {
        setMatches((prev) => [...prev, ...newMatches]);
        setOffset(currentOffset + PAGE_SIZE);
      }

      // Determine hasMore based on whether we got a full page
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

  // Use shared MatchCard component for consistent display across all tabs
  const renderMatch = ({ item }: { item: MatchRow }) => {
    return <MatchCard match={item as MatchCardData} />;
  };

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
        <MatchListSkeleton count={8} />
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
          // Performance optimizations for smooth scrolling
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={10}
          initialNumToRender={10}
          updateCellsBatchingPeriod={50}
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

  // Match Card - styled to match Home tab
  matchCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  matchHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  dateBadge: {
    backgroundColor: "rgba(59, 130, 246, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dateBadgeText: {
    color: "#3B82F6",
    fontSize: 12,
    fontWeight: "700",
  },
  divisionText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "500",
  },
  eventName: {
    color: "#9ca3af",
    fontSize: 11,
    marginBottom: 8,
    fontStyle: "italic",
  },
  matchTeamsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  matchTeamsContainer: {
    flex: 1,
    marginRight: 12,
  },
  teamName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  vsText: {
    color: "#6b7280",
    fontSize: 12,
    marginVertical: 2,
  },
  scoreText: {
    color: "#3B82F6",
    fontSize: 20,
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
