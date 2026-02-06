import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
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
import { getLeaguesList, LeagueListItem } from "../../lib/leagues";

// ============================================================
// CONSTANTS
// ============================================================

const US_STATES = [
  "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL",
  "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA",
  "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE",
  "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
];

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function LeaguesTab() {
  const [leagues, setLeagues] = useState<LeagueListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);

  // Type-ahead state picker
  const [stateSearchQuery, setStateSearchQuery] = useState("");
  const [showStateSuggestions, setShowStateSuggestions] = useState(false);
  const stateInputRef = useRef<TextInput>(null);

  const requestIdRef = useRef(0);

  // ============================================================
  // DATA LOADING
  // ============================================================

  const loadLeagues = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;
    try {
      setError(null);
      setLoading(true);

      const data = await getLeaguesList({
        states: selectedStates.length > 0 ? selectedStates : undefined,
        search: searchQuery.trim() || undefined,
      });

      if (currentRequestId !== requestIdRef.current) return;
      setLeagues(data);
    } catch (err: any) {
      if (currentRequestId !== requestIdRef.current) return;
      console.error("Error loading leagues:", err);
      setError(err.message || "Failed to load leagues");
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [selectedStates, searchQuery]);

  // Debounced load on filter/search change
  useEffect(() => {
    const timer = setTimeout(() => {
      loadLeagues();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadLeagues]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLeagues();
    setRefreshing(false);
  };

  // ============================================================
  // STATE FILTER HELPERS
  // ============================================================

  const filteredStates = useMemo(() => {
    if (!stateSearchQuery.trim()) return [];
    const query = stateSearchQuery.toUpperCase().trim();
    return US_STATES.filter(
      (state) => state.includes(query) && !selectedStates.includes(state)
    ).slice(0, 5);
  }, [stateSearchQuery, selectedStates]);

  const addState = useCallback((state: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedStates((prev) => [...prev, state]);
    setStateSearchQuery("");
    setShowStateSuggestions(false);
  }, []);

  const removeState = useCallback((state: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedStates((prev) => prev.filter((s) => s !== state));
  }, []);

  const hasFilters = selectedStates.length > 0 || searchQuery.length > 0;

  const clearFilters = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedStates([]);
    setSearchQuery("");
  }, []);

  // ============================================================
  // RENDER FUNCTIONS
  // ============================================================

  const renderLeague = useCallback(({ item }: { item: LeagueListItem }) => {
    const meta = [item.state, item.region].filter(Boolean).join(" \u00B7 ");

    return (
      <TouchableOpacity
        style={styles.leagueItem}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push({
            pathname: "/league/[eventId]",
            params: { eventId: item.id },
          });
        }}
        activeOpacity={0.7}
      >
        <Text style={styles.leagueName}>{item.name}</Text>
        {meta ? <Text style={styles.leagueMeta}>{meta}</Text> : null}
        <Text style={styles.leagueStats}>
          {item.teamCount.toLocaleString()} teams {"\u00B7"} {item.matchCount.toLocaleString()} matches
        </Text>
      </TouchableOpacity>
    );
  }, []);

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="football-outline" size={48} color="#374151" />
        <Text style={styles.emptyText}>
          {hasFilters ? "No leagues match filters" : "No leagues"}
        </Text>
        {hasFilters && (
          <TouchableOpacity
            style={styles.clearFiltersButton}
            onPress={clearFilters}
          >
            <Text style={styles.clearFiltersButtonText}>Clear Filters</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ============================================================
  // MAIN RENDER
  // ============================================================

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Fixed Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Leagues</Text>
        <Text style={styles.subtitle}>
          {loading
            ? "Loading..."
            : `${leagues.length} league${leagues.length !== 1 ? "s" : ""} this season`}
        </Text>
      </View>

      {/* Filters + Search */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.filterSection}>
          {/* State Filter - Type-ahead with horizontal suggestions */}
          <Text style={styles.sectionHeader}>State</Text>
          <View style={styles.stateRow}>
            {/* Selected state chips */}
            {selectedStates.map((state) => (
              <TouchableOpacity
                key={state}
                style={styles.stateChip}
                onPress={() => removeState(state)}
              >
                <Text style={styles.stateChipText}>{state}</Text>
                <Ionicons name="close" size={14} color="#3B82F6" />
              </TouchableOpacity>
            ))}

            {/* Type-ahead input */}
            <TextInput
              ref={stateInputRef}
              style={styles.stateInput}
              placeholder={selectedStates.length === 0 ? "All" : "+"}
              placeholderTextColor="#6B7280"
              value={stateSearchQuery}
              onChangeText={(text) => {
                setStateSearchQuery(text.toUpperCase());
                setShowStateSuggestions(text.length > 0);
              }}
              onFocus={() => setShowStateSuggestions(stateSearchQuery.length > 0)}
              onBlur={() => {
                setTimeout(() => setShowStateSuggestions(false), 150);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={2}
            />

            {/* Horizontal scrollable suggestions */}
            {showStateSuggestions && filteredStates.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.stateSuggestionsScroll}
                contentContainerStyle={styles.stateSuggestionsContent}
                keyboardShouldPersistTaps="handled"
              >
                {filteredStates.map((state) => (
                  <TouchableOpacity
                    key={state}
                    style={styles.stateSuggestionChip}
                    onPress={() => addState(state)}
                  >
                    <Text style={styles.stateSuggestionText}>{state}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color="#9ca3af" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search leagues..."
              placeholderTextColor="#6b7280"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={20} color="#6b7280" />
              </TouchableOpacity>
            )}
          </View>

          {/* Results Header */}
          <View style={styles.resultsHeader}>
            <Text style={styles.resultsText}>
              {loading
                ? "Loading..."
                : `${leagues.length} league${leagues.length !== 1 ? "s" : ""}`}
            </Text>
            {hasFilters && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={clearFilters}
              >
                <Ionicons name="close-circle" size={16} color="#EF4444" />
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableWithoutFeedback>

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading leagues...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={48} color="#EF4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={loadLeagues}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={leagues}
          renderItem={renderLeague}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          bounces={true}
          alwaysBounceVertical={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
            />
          }
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
        />
      )}
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

  filterSection: {
    backgroundColor: "#000",
    paddingHorizontal: 16,
  },
  sectionHeader: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 4,
  },

  // Type-ahead State Picker
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 12,
    gap: 8,
    rowGap: 8,
  },
  stateChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    borderRadius: 16,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
    flexShrink: 0,
  },
  stateChipText: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "600",
  },
  stateInput: {
    backgroundColor: "#1F2937",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    color: "#fff",
    fontSize: 14,
    width: 50,
    textAlign: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    flexShrink: 0,
  },
  stateSuggestionsScroll: {
    flexShrink: 1,
    flexGrow: 1,
  },
  stateSuggestionsContent: {
    gap: 6,
    paddingRight: 8,
  },
  stateSuggestionChip: {
    backgroundColor: "#374151",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  stateSuggestionText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },

  // Search
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
    backgroundColor: "#1F2937",
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 16,
  },

  // Results Header
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  resultsText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
    marginRight: 12,
  },
  clearButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    gap: 4,
  },
  clearButtonText: {
    color: "#EF4444",
    fontWeight: "600",
    fontSize: 13,
  },

  // League Cards
  listContent: { paddingBottom: 24 },
  leagueItem: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#111",
    marginBottom: 10,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  leagueName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  leagueMeta: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 4,
  },
  leagueStats: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 4,
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
    backgroundColor: "#374151",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4b5563",
  },
  clearFiltersButtonText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
  },
});
