import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { TeamListSkeleton } from "../../components/SkeletonLoader";
import {
  AppRankingsRow,
  GenderType,
  GENDER_DISPLAY,
  GENDER_FROM_DISPLAY,
} from "../../lib/supabase.types";

// ============================================================
// TYPES
// ============================================================

// UI-facing type with display-friendly values
type TeamEloRow = {
  id: string;
  team_name: string | null;
  elo_rating: number | null;
  matches_played: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  state: string | null;
  gender: string | null;        // Display format: 'Boys' or 'Girls'
  age_group: string | null;
  national_rank: number | null;
  gotsport_points: number | null;
};

// ============================================================
// DATA TRANSFORMATION
// Transform new schema to legacy format for UI compatibility
// ============================================================

function transformAppRankingsRow(row: AppRankingsRow): TeamEloRow {
  return {
    id: row.id,
    team_name: row.display_name,
    elo_rating: row.elo_rating,
    matches_played: row.matches_played,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    state: row.state,
    gender: GENDER_DISPLAY[row.gender] ?? row.gender, // 'M' -> 'Boys', 'F' -> 'Girls'
    age_group: row.age_group,
    national_rank: row.national_rank,
    gotsport_points: row.gotsport_points,
  };
}

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

const ALL_AGE_GROUPS = [
  "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18", "U19",
];

const PAGE_SIZE = 50;

// Collapsible header configuration
const DEFAULT_FILTER_HEIGHT = 260; // Initial height before measurement
const SCROLL_THRESHOLD = 10; // Minimum scroll to trigger show/hide

// World-class spring configuration (like Twitter/X)
const SPRING_CONFIG = {
  damping: 20,
  stiffness: 90,
  mass: 0.8,
  overshootClamping: false,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
};

// ============================================================
// DATA FETCHING - USING NEW MATERIALIZED VIEWS (Phase 3)
// ============================================================

type FetchParams = {
  states: string[];
  genders: string[];   // Display values: ['Boys', 'Girls']
  ages: string[];      // Age groups: ['U11', 'U12', ...]
  searchQuery: string;
  offset: number;
  signal?: AbortSignal; // For cancelling in-flight requests
};

async function fetchTeams(
  params: FetchParams,
): Promise<{ teams: TeamEloRow[]; hasMore: boolean }> {
  const { states, genders, ages, searchQuery, offset, signal } = params;

  // Query from new materialized view: app_rankings
  let query = supabase
    .from("app_rankings")
    .select(
      "id, name, display_name, club_name, birth_year, gender, age_group, state, elo_rating, national_rank, state_rank, gotsport_rank, gotsport_points, matches_played, wins, losses, draws, has_matches",
    )
    // Only show teams with actual match history (use pre-computed flag)
    .eq("has_matches", true)
    .order("display_name", { ascending: true });

  if (states.length > 0) {
    query = query.in("state", states);
  }

  // Convert display genders ('Boys', 'Girls') to database enum ('M', 'F')
  if (genders.length > 0) {
    const dbGenders = genders
      .map(g => GENDER_FROM_DISPLAY[g])
      .filter((g): g is GenderType => g !== null && g !== undefined);
    if (dbGenders.length > 0) {
      query = query.in("gender", dbGenders);
    }
  }

  // Age groups are already normalized in the view (e.g., 'U11')
  if (ages.length > 0) {
    query = query.in("age_group", ages);
  }

  // Search on display_name (full team name for display)
  if (searchQuery.trim()) {
    query = query.ilike("display_name", `%${searchQuery.trim()}%`);
  }

  query = query.range(offset, offset + PAGE_SIZE - 1);

  // Add abort signal to cancel request if user triggers new query
  if (signal) {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query;

  if (error) {
    // Don't log abort errors - they're expected when cancelling
    if (error.message?.toLowerCase().includes('abort') || error.code === '20') {
      throw error;
    }
    console.error("Error fetching teams:", error);
    throw error;
  }

  // Transform new schema data to legacy format for UI compatibility
  const teams = (data || []).map(row => transformAppRankingsRow(row as AppRankingsRow));

  return {
    teams,
    hasMore: (data?.length || 0) === PAGE_SIZE,
  };
}

// Cached count for teams with match history (updated periodically)
// This provides instant display while avoiding slow count queries
const CACHED_TEAMS_WITH_MATCHES = 94206; // From CLAUDE.md Session 48 - teams_v2 with ELO

async function fetchFilterOptions(): Promise<{
  states: string[];
  genders: string[];
  totalTeams: number;
}> {
  // Display genders (UI uses 'Boys'/'Girls', database uses 'M'/'F')
  const genders = ["Boys", "Girls"];

  // Use "estimated" count which uses pg_class statistics - instant but approximate
  // Falls back to cached value if query fails
  try {
    const { count, error } = await supabase
      .from("app_rankings")
      .select("id", { count: "estimated", head: true })
      .eq("has_matches", true);

    if (error || count === null) {
      console.warn("Teams count query failed, using cached value:", error?.message);
      return {
        states: US_STATES,
        genders,
        totalTeams: CACHED_TEAMS_WITH_MATCHES,
      };
    }

    return {
      states: US_STATES,
      genders,
      totalTeams: count,
    };
  } catch (err) {
    console.warn("Teams count query exception, using cached value:", err);
    return {
      states: US_STATES,
      genders,
      totalTeams: CACHED_TEAMS_WITH_MATCHES,
    };
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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

function normalizeAgeGroup(age: string | null | undefined): string | null {
  if (!age) return null;
  const trimmed = age.trim();
  const match = trimmed.match(/^(U)0*(\d+)$/i);
  if (match) {
    return `U${parseInt(match[2], 10)}`;
  }
  return trimmed;
}

function cleanTeamName(name: string | null): string {
  if (!name) return "Unknown Team";
  return name.replace(/^[\*\s]+|[\*\s]+$/g, '').trim() || "Unknown Team";
}

// ============================================================
// FLATLIST (regular, not animated - for RefreshControl compatibility)
// ============================================================

// Using regular FlatList for proper RefreshControl support
// Header animation is on Animated.View, not the list itself

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function TeamsTab() {
  const [teams, setTeams] = useState<TeamEloRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [selectedAges, setSelectedAges] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);

  const [allStates, setAllStates] = useState<string[]>([]);
  const [allGenders, setAllGenders] = useState<string[]>([]);
  const [totalTeams, setTotalTeams] = useState(CACHED_TEAMS_WITH_MATCHES);
  const [loadingFilters, setLoadingFilters] = useState(true);

  // Type-ahead state picker
  const [stateSearchQuery, setStateSearchQuery] = useState("");
  const [showStateSuggestions, setShowStateSuggestions] = useState(false);
  const stateInputRef = useRef<TextInput>(null);

  // Track which input triggered keyboard (for selective collapse)
  const searchBarFocusedRef = useRef(false);

  // Request ID to cancel stale requests (prevents race conditions and timeouts)
  const requestIdRef = useRef(0);

  // CRITICAL: Loading lock to prevent multiple simultaneous queries (avoids DB timeout)
  const isQueryInFlight = useRef(false);

  // AbortController to cancel in-flight HTTP requests when new ones start
  const abortControllerRef = useRef<AbortController | null>(null);

  const [infoModalVisible, setInfoModalVisible] = useState(false);

  // ============================================================
  // COLLAPSIBLE FILTER ANIMATION (Twitter/X style)
  // ============================================================

  // Measured height of filter content (updates dynamically via onLayout)
  // - measuredHeightRef: for JS thread (scroll/keyboard handlers)
  // - maxHeightShared: for UI thread (opacity calculation in useAnimatedStyle)
  const measuredHeightRef = useRef(DEFAULT_FILTER_HEIGHT);
  const maxHeightShared = useSharedValue(DEFAULT_FILTER_HEIGHT);
  const filterHeight = useSharedValue(DEFAULT_FILTER_HEIGHT);
  const [filtersVisible, setFiltersVisible] = useState(true);

  // Measure actual filter content height - this is the key to dynamic sizing!
  const handleFilterContentLayout = useCallback((event: any) => {
    const height = event.nativeEvent.layout.height;
    // Only update if height changed significantly (avoid micro-adjustments)
    if (height > 0 && Math.abs(height - measuredHeightRef.current) > 2) {
      measuredHeightRef.current = height;
      maxHeightShared.value = height; // Update shared value for UI thread
      // Update animation target if filters are currently visible
      if (filtersVisible) {
        filterHeight.value = withSpring(height, SPRING_CONFIG);
      }
    }
  }, [filtersVisible]);

  // ============================================================
  // SELECTIVE KEYBOARD COLLAPSE
  // Only collapse filters when SEARCH BAR is focused (need to see results)
  // Do NOT collapse when STATE INPUT is focused (need to see state input)
  // ============================================================

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, () => {
      // Only collapse if SEARCH BAR triggered the keyboard
      if (searchBarFocusedRef.current) {
        filterHeight.value = withSpring(0, SPRING_CONFIG);
        setFiltersVisible(false);
      }
    });

    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      // Restore filters when keyboard hides (if they were collapsed)
      if (searchBarFocusedRef.current) {
        filterHeight.value = withSpring(measuredHeightRef.current, SPRING_CONFIG);
        setFiltersVisible(true);
        searchBarFocusedRef.current = false;
      }
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Regular JS scroll handler (compatible with RefreshControl)
  const lastScrollYRef = useRef(0);
  const isScrollingDownRef = useRef(false);

  const handleScroll = useCallback((event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const diff = currentY - lastScrollYRef.current;

    if (Math.abs(diff) > SCROLL_THRESHOLD) {
      if (diff > 0 && currentY > 50) {
        // Scrolling DOWN - hide filters with spring
        if (!isScrollingDownRef.current) {
          isScrollingDownRef.current = true;
          filterHeight.value = withSpring(0, SPRING_CONFIG);
          setFiltersVisible(false);
        }
      } else if (diff < 0) {
        // Scrolling UP - show filters with spring
        if (isScrollingDownRef.current) {
          isScrollingDownRef.current = false;
          filterHeight.value = withSpring(measuredHeightRef.current, SPRING_CONFIG);
          setFiltersVisible(true);
        }
      }
      lastScrollYRef.current = currentY;
    }

    // Always show when at top
    if (currentY <= 0 && !filtersVisible) {
      isScrollingDownRef.current = false;
      filterHeight.value = withSpring(measuredHeightRef.current, SPRING_CONFIG);
      setFiltersVisible(true);
    }
  }, [filtersVisible]);

  // Animated style - uses shared values for proper UI thread reactivity
  const collapsibleStyle = useAnimatedStyle(() => ({
    height: filterHeight.value,
    opacity: maxHeightShared.value > 0 ? filterHeight.value / maxHeightShared.value : 1,
  }));

  useEffect(() => {
    loadFilterOptions();
  }, []);

  // Debounce ALL filter changes to prevent rapid-fire queries (500ms prevents DB timeout)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadTeams(true);
    }, 500); // Increased debounce to prevent query pileup
    return () => clearTimeout(timer);
  }, [selectedStates, selectedGenders, selectedAges]);

  // Separate debounce for search (longer delay for typing)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadTeams(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadFilterOptions = async () => {
    try {
      setLoadingFilters(true);
      const options = await fetchFilterOptions();
      setAllStates(options.states);
      setAllGenders(options.genders);
      setTotalTeams(options.totalTeams);
    } catch (err) {
      console.error("Error loading filter options:", err);
      setAllStates(US_STATES);
    } finally {
      setLoadingFilters(false);
    }
  };

  const loadTeams = async (reset: boolean = false) => {
    // CRITICAL: Cancel any in-flight request before starting a new one
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Increment request ID to track this specific request
    const currentRequestId = ++requestIdRef.current;
    isQueryInFlight.current = true;

    try {
      setError(null);
      if (reset) {
        setLoading(true);
        setOffset(0);
      } else {
        setLoadingMore(true);
      }

      const newOffset = reset ? 0 : offset;
      const result = await fetchTeams({
        states: selectedStates,
        genders: selectedGenders,
        ages: selectedAges,
        searchQuery,
        offset: newOffset,
        signal, // Pass abort signal to cancel request
      });

      // Ignore stale responses - only update state if this is still the latest request
      if (currentRequestId !== requestIdRef.current) {
        return; // A newer request was made, ignore this response
      }

      if (reset) {
        setTeams(result.teams);
      } else {
        setTeams((prev) => [...prev, ...result.teams]);
      }
      setHasMore(result.hasMore);
      setOffset(newOffset + PAGE_SIZE);
    } catch (err: any) {
      // Ignore abort errors (user triggered new query) and stale requests
      if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort') || err.code === '20') {
        return; // Request was cancelled, this is expected
      }
      if (currentRequestId !== requestIdRef.current) {
        return;
      }
      // Only show error if it's not a timeout from a cancelled request
      if (err.code === '57014') {
        console.warn("Query timeout - request may have been superseded");
        return; // Silently swallow timeout errors
      }
      console.error("Error:", err);
      setError(err.message || "Failed to load teams");
    } finally {
      isQueryInFlight.current = false;
      // Only clear loading state if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const loadMoreTeams = () => {
    if (!loadingMore && hasMore && !loading) {
      loadTeams(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    // Reset header to visible on refresh
    filterHeight.value = withSpring(measuredHeightRef.current, SPRING_CONFIG);
    lastScrollYRef.current = 0;
    isScrollingDownRef.current = false;
    setFiltersVisible(true);
    await loadTeams(true);
    setRefreshing(false);
  };

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
  }, []);

  const hasFilters =
    selectedGenders.length > 0 ||
    selectedAges.length > 0 ||
    selectedStates.length > 0 ||
    searchQuery.length > 0;

  // Filter states based on type-ahead search
  const filteredStates = useMemo(() => {
    if (!stateSearchQuery.trim()) return [];
    const query = stateSearchQuery.toUpperCase().trim();
    return US_STATES.filter(
      (state) =>
        state.includes(query) && !selectedStates.includes(state)
    ).slice(0, 5); // Max 5 suggestions
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

  const getTeamMeta = useCallback((team: TeamEloRow): string => {
    const parts: string[] = [];
    if (isValidValue(team.state)) parts.push(team.state);
    if (isValidValue(team.gender)) parts.push(team.gender);
    const normalizedAge = normalizeAgeGroup(team.age_group);
    if (normalizedAge) parts.push(normalizedAge);
    return parts.join(" · ");
  }, []);

  // ============================================================
  // RENDER FUNCTIONS
  // ============================================================

  const renderChip = (
    label: string,
    selected: boolean,
    onPress: () => void,
  ) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      style={[styles.baseChip, selected && styles.selectedChip]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );

  const renderTeam = useCallback(
    ({ item }: { item: TeamEloRow }) => {
      const meta = getTeamMeta(item);
      const record = `${item.wins ?? 0}-${item.losses ?? 0}-${item.draws ?? 0}`;
      const elo = Math.round(item.elo_rating ?? 1500);
      const { grade, color } = getEloGrade(elo);

      return (
        <TouchableOpacity
          style={styles.teamItem}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({
              pathname: "/team/[id]",
              params: { id: item.id },
            });
          }}
          activeOpacity={0.7}
        >
          <View style={styles.teamRow}>
            <View style={styles.teamInfo}>
              <Text style={styles.teamName}>
                {cleanTeamName(item.team_name)}
              </Text>
              {meta ? <Text style={styles.teamMeta}>{meta}</Text> : null}
              <Text style={styles.recordText}>Record: {record}</Text>
              {item.national_rank && (
                <Text style={styles.rankText}>
                  🏆 National Rank #{item.national_rank}
                </Text>
              )}
            </View>
            <View style={styles.eloContainer}>
              <Text style={[styles.eloGrade, { color }]}>{grade}</Text>
              <Text style={styles.eloRating}>{elo}</Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [getTeamMeta],
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text style={styles.footerText}>Loading more teams...</Text>
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return (
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
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingContainer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {/* Fixed Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Teams</Text>
          <Text style={styles.subtitle}>
            {totalTeams.toLocaleString()} teams with match history
          </Text>
        </View>

        {/* Sticky Header with Collapsible Filters */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <Animated.View style={styles.stickyHeaderContainer}>
          {/* Collapsible Filter Section - Spring Animated */}
          <Animated.View style={[styles.collapsibleFilters, collapsibleStyle]}>
            <View style={styles.filterContent} onLayout={handleFilterContentLayout}>
              {/* Gender Filter */}
              <Text style={styles.sectionHeader}>Gender</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipScrollContent}
              >
                {allGenders.map((g) =>
                  renderChip(g, selectedGenders.includes(g), () =>
                    toggleChip(g, selectedGenders, setSelectedGenders),
                  ),
                )}
              </ScrollView>

              {/* Age Group Filter */}
              <Text style={styles.sectionHeader}>Age Group</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipScrollContent}
              >
                {ALL_AGE_GROUPS.map((age) =>
                  renderChip(age, selectedAges.includes(age), () =>
                    toggleChip(age, selectedAges, setSelectedAges),
                  ),
                )}
              </ScrollView>

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

            </View>
          </Animated.View>

          {/* Always-visible Search */}
          <View style={styles.searchSection}>
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color="#9ca3af" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search teams..."
                placeholderTextColor="#6b7280"
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={() => {
                  searchBarFocusedRef.current = true;
                  // Collapse filters immediately (don't rely on keyboard event
                  // in case keyboard is already open from State input)
                  filterHeight.value = withSpring(0, SPRING_CONFIG);
                  setFiltersVisible(false);
                }}
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
                  : `${teams.length.toLocaleString()}${hasMore ? "+" : ""} teams`}
              </Text>
              {/* Clear Filters - always visible when filters active */}
              {hasFilters && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={clearFilters}
                >
                  <Ionicons name="close-circle" size={16} color="#EF4444" />
                  <Text style={styles.clearButtonText}>Clear</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.infoButton}
                onPress={() => setInfoModalVisible(true)}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color="#3B82F6"
                />
                <Text style={styles.infoButtonText}>How ratings work</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </TouchableWithoutFeedback>

      {/* Content */}
      {loading ? (
        <TeamListSkeleton count={8} />
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={48} color="#EF4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => loadTeams(true)}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={teams}
          renderItem={renderTeam}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Pull-to-refresh (bounces required for iOS)
          bounces={true}
          alwaysBounceVertical={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
            />
          }
          onEndReached={loadMoreTeams}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
          // Scroll handler (JS callback for RefreshControl compatibility)
          onScroll={handleScroll}
          scrollEventThrottle={16}
          // Performance optimizations
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={10}
          initialNumToRender={10}
          updateCellsBatchingPeriod={50}
        />
      )}
      </KeyboardAvoidingView>

      {/* Info Modal - Comprehensive (matches Rankings tab) */}
      <Modal
        visible={infoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setInfoModalVisible(false)}
            activeOpacity={1}
          />
          <View
            style={[
              styles.modalContent,
              { height: Dimensions.get("window").height * 0.7 },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>How Rankings Work</Text>
              <TouchableOpacity 
                style={styles.modalCloseButton}
                onPress={() => setInfoModalVisible(false)}
              >
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView 
              style={{ flex: 1 }} 
              bounces={true}
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 20 }}
            >
              <View>
                {/* GotSport Rankings Section */}
                <View style={styles.helpSection}>
                  <Text style={styles.helpSectionTitle}>
                    🏆 GotSport Rankings
                  </Text>
                  <Text style={styles.helpSectionDesc}>
                    The industry-standard national rankings from GotSport, used by
                    tournament directors for bracket seeding since 1999.
                  </Text>
                  <View style={styles.helpBulletList}>
                    <Text style={styles.helpBullet}>
                      • Points earned from sanctioned tournaments
                    </Text>
                    <Text style={styles.helpBullet}>
                      • National and State rankings
                    </Text>
                    <Text style={styles.helpBullet}>
                      • Gold/Amber colored elements
                    </Text>
                    <Text style={styles.helpBullet}>
                      • Gold/silver/bronze medals for top 3
                    </Text>
                  </View>
                </View>

                {/* SoccerView Power Rating Section */}
                <View style={styles.helpSection}>
                  <View style={styles.helpSectionTitleRow}>
                    <Image
                      source={require("../../assets/images/icon.png")}
                      style={styles.helpSectionLogo}
                    />
                    <Text style={styles.helpSectionTitle}>
                      SoccerView Power Rating
                    </Text>
                  </View>
                  <Text style={styles.helpSectionDesc}>
                    SoccerView's proprietary strength rating computed using
                    the ELO algorithm. Includes our own National and State
                    rankings based on ELO scores.
                  </Text>
                  <View style={styles.helpBulletList}>
                    <Text style={styles.helpBullet}>
                      • Real-time strength indicator
                    </Text>
                    <Text style={styles.helpBullet}>
                      • SoccerView National & State ranks
                    </Text>
                    <Text style={styles.helpBullet}>
                      • Blue colored elements
                    </Text>
                  </View>
                  <View style={styles.gradeGuide}>
                    <Text style={styles.gradeGuideTitle}>Letter Grades:</Text>
                    <Text style={[styles.gradeItem, { color: "#22c55e" }]}>
                      A+ (1650+) Elite
                    </Text>
                    <Text style={[styles.gradeItem, { color: "#4ade80" }]}>
                      A/A- (1550-1649) Excellent
                    </Text>
                    <Text style={[styles.gradeItem, { color: "#3B82F6" }]}>
                      B+/B/B- (1475-1549) Above Average
                    </Text>
                    <Text style={[styles.gradeItem, { color: "#f59e0b" }]}>
                      C+/C/C- (1400-1474) Average
                    </Text>
                    <Text style={[styles.gradeItem, { color: "#ef4444" }]}>
                      D+/D/D- (below 1400) Developing
                    </Text>
                  </View>
                </View>

                {/* Comparing Systems */}
                <View style={styles.helpSection}>
                  <Text style={styles.helpSectionTitle}>
                    🔍 Comparing the Systems
                  </Text>
                  <Text style={styles.helpSectionDesc}>
                    Teams often rank differently in each system!
                  </Text>
                  <View style={styles.helpBulletList}>
                    <Text style={styles.helpBullet}>
                      • GotSport: Points from sanctioned events (tournaments + leagues)
                    </Text>
                    <Text style={styles.helpBullet}>
                      • SoccerView: All match results, weighted by opponent strength
                    </Text>
                  </View>
                </View>

                {/* Championship Badges */}
                <View style={styles.helpSection}>
                  <Text style={styles.helpSectionTitle}>
                    🏆 Championship Badges
                  </Text>
                  <Text style={styles.helpSectionDesc}>
                    Teams with championship awards display badges:
                  </Text>
                  <View style={styles.helpBulletList}>
                    <Text style={styles.helpBullet}>🏆 National Champion</Text>
                    <Text style={styles.helpBullet}>🥇 Regional Winner</Text>
                    <Text style={styles.helpBullet}>🏅 State Cup Winner</Text>
                  </View>
                </View>

                {/* Multi-Select */}
                <View style={styles.helpSection}>
                  <Text style={styles.helpSectionTitle}>Multi-Select Filters</Text>
                  <Text style={styles.helpSectionDesc}>
                    Select multiple genders, ages, or states to compare across
                    categories.
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  keyboardAvoidingContainer: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { color: "#fff", fontSize: 32, fontWeight: "bold" },
  subtitle: { color: "#9ca3af", fontSize: 16, marginTop: 4 },

  stickyHeaderContainer: {
    backgroundColor: "#000",
    paddingHorizontal: 16,
  },
  
  collapsibleFilters: {
    overflow: "hidden",
  },
  filterContent: {
    paddingTop: 8,
  },
  
  sectionHeader: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 4,
  },
  chipScroll: { flexDirection: "row", marginBottom: 12 },
  chipScrollContent: { paddingRight: 16 },
  loadingChipsText: { color: "#9ca3af", fontSize: 14, marginLeft: 8 },
  
  searchSection: {
    paddingTop: 0,
    paddingBottom: 4,
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
  selectedChip: { backgroundColor: "#3B82F6", borderColor: "#3B82F6" },

  // Type-ahead State Picker (always visible, wraps to multiple rows)
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
  // Horizontal scrollable suggestions
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

  clearButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    marginRight: 12,
    gap: 4,
  },
  clearButtonText: {
    color: "#EF4444",
    fontWeight: "600",
    fontSize: 13,
  },
  chipText: { color: "#fff", fontWeight: "600", fontSize: 14 },
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
  infoButton: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  infoButtonText: { color: "#3B82F6", fontSize: 12, marginLeft: 4 },
  
  listContent: { paddingBottom: 24 },
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
  rankText: { color: "#f59e0b", fontSize: 12, marginTop: 4, fontWeight: "600" },
  eloContainer: { alignItems: "center", minWidth: 60 },
  eloGrade: { fontSize: 24, fontWeight: "bold" },
  eloRating: { color: "#6b7280", fontSize: 12, marginTop: 2 },

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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  modalContent: {
    backgroundColor: "#1F2937",
    borderRadius: 20,
    width: "100%",
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  modalCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Help sections
  helpSection: { marginBottom: 24 },
  helpSectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  helpSectionLogo: {
    width: 20,
    height: 20,
    borderRadius: 4,
    marginRight: 8,
  },
  helpSectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  helpSectionDesc: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
    flexShrink: 1,
  },
  helpBulletList: { gap: 6 },
  helpBullet: { color: "#d1d5db", fontSize: 13 },
  gradeGuide: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  gradeGuideTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  gradeItem: { fontSize: 12, marginBottom: 4 },
});
