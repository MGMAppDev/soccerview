import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MatchCard, MatchCardData } from "../../components/MatchCard";
import { supabase } from "../../lib/supabase";
import {
  AppMatchesFeedRow,
  AppRankingsRow,
  GENDER_DISPLAY,
} from "../../lib/supabase.types";

// ============================================================
// TYPES
// ============================================================

// Legacy type for backward compatibility with MatchCard component
type MatchRow = {
  id: string;
  match_date: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  location: string | null;
  age_group: string | null;
  gender: string | null;
  event_name: string | null;
};

// Legacy type for backward compatibility with team cards
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
  national_rank: number | null;
};

type StatsData = {
  totalTeams: number;
  totalMatches: number;
  totalStates: number;
  lastUpdated: string | null;
};

// ============================================================
// DATA TRANSFORMATION HELPERS
// Transform new schema data to legacy format for UI compatibility
// ============================================================

function transformMatchFeedRow(row: AppMatchesFeedRow): MatchRow {
  return {
    id: row.id,
    match_date: row.match_date,
    home_team_name: row.home_team?.display_name ?? null,
    away_team_name: row.away_team?.display_name ?? null,
    home_score: row.home_score,
    away_score: row.away_score,
    location: row.venue?.name ?? null,
    age_group: row.age_group,
    gender: GENDER_DISPLAY[row.gender] ?? row.gender, // 'M' -> 'Boys', 'F' -> 'Girls'
    event_name: row.event?.name ?? null,
  };
}

function transformRankingsRow(row: AppRankingsRow): TeamEloRow {
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
  };
}

// ============================================================
// CONSTANTS
// ============================================================

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const QUERY_TIMEOUT_MS = 10000;

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

function formatDateBadge(isoDate: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function isValidValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0 && v.trim() !== "??";
}

function formatLastUpdated(isoDate: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

// Utility: Promise with timeout
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// Utility: Retry wrapper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = RETRY_ATTEMPTS,
  delayMs: number = RETRY_DELAY_MS
): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      console.warn(`Attempt ${i + 1}/${attempts} failed:`, (err as Error).message);
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

// ============================================================
// DATA FETCHING - USING NEW MATERIALIZED VIEWS (Phase 3)
// ============================================================

async function fetchStats(): Promise<StatsData> {
  console.log("[Home] fetchStats: Starting...");

  // Query stats from new schema views
  // app_rankings for team count, app_matches_feed for match count
  const [teamsResult, matchesResult, lastUpdatedResult] = await Promise.all([
    supabase
      .from("app_rankings")
      .select("id", { count: "estimated", head: true }),
    supabase
      .from("app_matches_feed")
      .select("id", { count: "estimated", head: true }),
    supabase
      .from("app_team_profile")
      .select("updated_at")
      .not("updated_at", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  if (teamsResult.error) {
    console.error("[Home] fetchStats: Team count error:", teamsResult.error);
  }
  if (matchesResult.error) {
    console.error("[Home] fetchStats: Match count error:", matchesResult.error);
  }

  console.log("[Home] fetchStats: Complete -", teamsResult.count, "teams,", matchesResult.count, "matches");

  return {
    totalTeams: teamsResult.count ?? 0,
    totalMatches: matchesResult.count ?? 0,
    totalStates: 50,
    lastUpdated: lastUpdatedResult.data?.updated_at ?? null,
  };
}

async function fetchRecentMatches(): Promise<MatchRow[]> {
  console.log("[Home] fetchRecentMatches: Starting with app_matches_feed...");

  // Query from new materialized view - all team/event data embedded as JSONB
  const { data, error } = await supabase
    .from("app_matches_feed")
    .select("id, match_date, match_time, home_score, away_score, home_team, away_team, event, venue, gender, birth_year, age_group, state")
    .lte("match_date", new Date().toISOString().split('T')[0]) // Only past/current matches (date only)
    .order("match_date", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[Home] fetchRecentMatches: Query error:", error);
    throw new Error(`Failed to fetch matches: ${error.message}`);
  }

  console.log("[Home] fetchRecentMatches: Complete -", data?.length ?? 0, "matches");

  // Transform new schema data to legacy format for MatchCard compatibility
  return (data ?? []).map(row => transformMatchFeedRow(row as AppMatchesFeedRow));
}

async function fetchFeaturedTeams(): Promise<TeamEloRow[]> {
  console.log("[Home] fetchFeaturedTeams: Starting with app_rankings...");

  // Query from new materialized view - pre-sorted by elo_rating
  const { data, error } = await supabase
    .from("app_rankings")
    .select("id, name, display_name, club_name, birth_year, gender, age_group, state, elo_rating, national_rank, state_rank, gotsport_rank, gotsport_points, matches_played, wins, losses, draws, has_matches")
    .eq("has_matches", true) // Only teams with match history
    .order("elo_rating", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[Home] fetchFeaturedTeams: Query error:", error);
    throw new Error(`Failed to fetch teams: ${error.message}`);
  }

  console.log("[Home] fetchFeaturedTeams: Complete -", data?.length ?? 0, "teams");

  // Transform new schema data to legacy format for team card compatibility
  return (data ?? []).map(row => transformRankingsRow(row as AppRankingsRow));
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const isMounted = useRef(true);

  // Data states
  const [stats, setStats] = useState<StatsData>({
    totalTeams: 0,
    totalMatches: 0,
    totalStates: 50,
    lastUpdated: null,
  });
  const [recentMatches, setRecentMatches] = useState<MatchRow[]>([]);
  const [featuredTeams, setFeaturedTeams] = useState<TeamEloRow[]>([]);

  // Loading states - separate for progressive loading
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Error states
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);

  // Track mount state for cleanup
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // ============================================================
  // DATA LOADING - BULLETPROOF WITH RETRY & TIMEOUT
  // ============================================================

  const loadStats = useCallback(async () => {
    if (!isMounted.current) return;
    setLoadingStats(true);
    try {
      const data = await withTimeout(withRetry(fetchStats), QUERY_TIMEOUT_MS);
      if (isMounted.current) setStats(data);
    } catch (err) {
      console.error("[Home] loadStats failed:", err);
      // Non-critical - don't show error, keep default values
    } finally {
      if (isMounted.current) setLoadingStats(false);
    }
  }, []);

  const loadMatches = useCallback(async () => {
    if (!isMounted.current) return;
    setLoadingMatches(true);
    setMatchesError(null);
    try {
      const data = await withTimeout(withRetry(fetchRecentMatches), QUERY_TIMEOUT_MS);
      if (isMounted.current) {
        setRecentMatches(data);
        console.log("[Home] Matches loaded successfully:", data.length);
      }
    } catch (err) {
      console.error("[Home] loadMatches failed after retries:", err);
      if (isMounted.current) setMatchesError("Failed to load matches");
    } finally {
      if (isMounted.current) setLoadingMatches(false);
    }
  }, []);

  const loadTeams = useCallback(async () => {
    if (!isMounted.current) return;
    setLoadingTeams(true);
    setTeamsError(null);
    try {
      const data = await withTimeout(withRetry(fetchFeaturedTeams), QUERY_TIMEOUT_MS);
      if (isMounted.current) {
        setFeaturedTeams(data);
        console.log("[Home] Teams loaded successfully:", data.length);
      }
    } catch (err) {
      console.error("[Home] loadTeams failed after retries:", err);
      if (isMounted.current) setTeamsError("Failed to load teams");
    } finally {
      if (isMounted.current) setLoadingTeams(false);
    }
  }, []);

  const loadAllData = useCallback(async () => {
    console.log("[Home] loadAllData: Starting parallel load...");
    // Load all sections in parallel - each handles its own errors
    await Promise.all([loadStats(), loadMatches(), loadTeams()]);
    console.log("[Home] loadAllData: Complete");
  }, [loadStats, loadMatches, loadTeams]);

  // Initial load
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  }, [loadAllData]);

  // ============================================================
  // HELPER RENDER FUNCTIONS
  // ============================================================

  const getTeamMeta = (item: TeamEloRow): string => {
    const parts: string[] = [];
    if (isValidValue(item.state)) parts.push(item.state!);
    if (isValidValue(item.gender)) parts.push(item.gender!);
    if (isValidValue(item.age_group)) parts.push(item.age_group!);
    return parts.join(" · ");
  };

  const navigateToPredict = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/predict");
  };

  // ============================================================
  // RENDER FUNCTIONS
  // ============================================================

  // Use shared MatchCard component for consistent display across all tabs
  const renderMatch = ({ item }: { item: MatchRow }) => {
    return <MatchCard match={item as MatchCardData} />;
  };

  const renderFeaturedTeam = ({ item }: { item: TeamEloRow }) => {
    const elo = item.elo_rating ?? 1500;
    const { grade, color } = getEloGrade(elo);
    const meta = getTeamMeta(item);
    const record =
      item.wins !== null
        ? `${item.wins}W-${item.losses ?? 0}L-${item.draws ?? 0}D`
        : null;

    return (
      <TouchableOpacity
        style={styles.featuredCard}
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/team/${item.id}`);
        }}
      >
        <Text style={styles.featuredTeamName}>
          {item.team_name ?? "Team"}
        </Text>
        {meta ? <Text style={styles.teamMeta}>{meta}</Text> : null}
        {record && <Text style={styles.recordText}>{record}</Text>}
        {item.national_rank && (
          <Text style={styles.rankBadge}>🏆 #{item.national_rank}</Text>
        )}
        <View style={styles.eloRow}>
          <Text style={[styles.gradeText, { color }]}>{grade}</Text>
          <Text style={styles.ratingText}>{Math.round(elo)} ELO</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // Section renderers with loading/error/data states
  const renderMatchesSection = () => {
    if (loadingMatches && recentMatches.length === 0) {
      return (
        <View style={styles.sectionLoading}>
          <ActivityIndicator size="small" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading matches...</Text>
        </View>
      );
    }

    if (matchesError && recentMatches.length === 0) {
      return (
        <View style={styles.sectionError}>
          <Ionicons name="alert-circle-outline" size={24} color="#EF4444" />
          <Text style={styles.errorText}>{matchesError}</Text>
          <TouchableOpacity style={styles.retrySmall} onPress={loadMatches}>
            <Text style={styles.retrySmallText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (recentMatches.length === 0) {
      return (
        <View style={styles.emptySection}>
          <Ionicons name="football-outline" size={32} color="#374151" />
          <Text style={styles.noDataText}>No recent matches available</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={recentMatches}
        renderItem={renderMatch}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
      />
    );
  };

  const renderTeamsSection = () => {
    if (loadingTeams && featuredTeams.length === 0) {
      return (
        <View style={styles.sectionLoading}>
          <ActivityIndicator size="small" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading teams...</Text>
        </View>
      );
    }

    if (teamsError && featuredTeams.length === 0) {
      return (
        <View style={styles.sectionError}>
          <Ionicons name="alert-circle-outline" size={24} color="#EF4444" />
          <Text style={styles.errorText}>{teamsError}</Text>
          <TouchableOpacity style={styles.retrySmall} onPress={loadTeams}>
            <Text style={styles.retrySmallText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (featuredTeams.length === 0) {
      return (
        <View style={styles.emptySection}>
          <Ionicons name="trophy-outline" size={32} color="#374151" />
          <Text style={styles.noDataText}>No featured teams available</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={featuredTeams}
        renderItem={renderFeaturedTeam}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalListContent}
      />
    );
  };

  // ============================================================
  // MAIN RENDER
  // ============================================================

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: insets.top + 8 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#3B82F6"
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>SoccerView</Text>
      <Text style={styles.subtitle}>
        National & State Youth Club Soccer Rankings
      </Text>
      {stats.lastUpdated && (
        <Text style={styles.lastUpdated}>
          Last Updated: {formatLastUpdated(stats.lastUpdated)}
        </Text>
      )}

      {/* Predict Match CTA */}
      <TouchableOpacity
        style={styles.predictButton}
        activeOpacity={0.8}
        onPress={navigateToPredict}
      >
        <View style={styles.predictIconContainer}>
          <Text style={styles.predictEmoji}>⚔️</Text>
        </View>
        <View style={styles.predictTextContainer}>
          <Text style={styles.predictTitle}>Predict Match</Text>
          <Text style={styles.predictSubtitle}>
            AI-powered predictions • Who would win?
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color="#10b981" />
      </TouchableOpacity>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <TouchableOpacity
          style={styles.statCard}
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/teams");
          }}
        >
          <Ionicons name="people" size={24} color="#3B82F6" />
          <Text style={styles.statText}>
            {loadingStats ? "..." : stats.totalTeams.toLocaleString()} Teams
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#6b7280" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.statCard}
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/matches");
          }}
        >
          <Ionicons name="football" size={24} color="#10b981" />
          <Text style={styles.statText}>
            {loadingStats ? "..." : stats.totalMatches.toLocaleString()} Matches
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#6b7280" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.statCard}
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/rankings");
          }}
        >
          <Ionicons name="location" size={24} color="#f59e0b" />
          <Text style={styles.statText}>
            {stats.totalStates} States Covered
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#6b7280" />
        </TouchableOpacity>
      </View>

      {/* Latest Matches Section */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionHeader}>Latest Matches</Text>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/matches");
          }}
        >
          <Text style={styles.seeAllText}>See All</Text>
        </TouchableOpacity>
      </View>
      {renderMatchesSection()}

      {/* Top Ranked Teams Section */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionHeader}>Top Ranked Teams</Text>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/rankings");
          }}
        >
          <Text style={styles.seeAllText}>See All</Text>
        </TouchableOpacity>
      </View>
      {renderTeamsSection()}
    </ScrollView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  contentContainer: { padding: 16, paddingBottom: 32 },
  title: { color: "#fff", fontSize: 32, fontWeight: "bold", marginBottom: 8 },
  subtitle: { color: "#9ca3af", fontSize: 16, marginBottom: 8 },
  lastUpdated: {
    color: "#6b7280",
    fontSize: 12,
    marginBottom: 20,
    fontStyle: "italic",
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    marginTop: 8,
  },
  sectionHeader: { color: "#fff", fontSize: 20, fontWeight: "700" },
  seeAllText: { color: "#3B82F6", fontSize: 14, fontWeight: "600" },

  // Predict Match Button
  predictButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: "#10b981",
    minHeight: 80,
  },
  predictIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  predictEmoji: { fontSize: 24 },
  predictTextContainer: { flex: 1 },
  predictTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 2,
  },
  predictSubtitle: { color: "#10b981", fontSize: 13, fontWeight: "500" },

  // Stats
  statsContainer: { gap: 12, marginBottom: 24 },
  statCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  statText: { color: "#fff", fontSize: 15, fontWeight: "600", flex: 1 },
  horizontalListContent: { paddingRight: 16, gap: 12 },

  // Match Card
  matchCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    marginBottom: 12,
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
  dateBadgeText: { color: "#3B82F6", fontSize: 12, fontWeight: "700" },
  divisionText: { color: "#9ca3af", fontSize: 12, fontWeight: "500" },
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
  matchTeamsContainer: { flex: 1, marginRight: 12 },
  teamName: { color: "#fff", fontSize: 14, fontWeight: "600" },
  vsText: { color: "#6b7280", fontSize: 12, marginVertical: 2 },
  scoreText: { color: "#3B82F6", fontSize: 20, fontWeight: "bold" },

  // Featured Team Card
  featuredCard: {
    width: 180,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  featuredTeamName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  teamMeta: { color: "#9ca3af", fontSize: 12, marginTop: 4 },
  recordText: { color: "#6b7280", fontSize: 12, marginTop: 6 },
  rankBadge: {
    color: "#f59e0b",
    fontSize: 12,
    marginTop: 4,
    fontWeight: "600",
  },
  eloRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 8,
    gap: 6,
  },
  gradeText: { fontSize: 22, fontWeight: "bold" },
  ratingText: { color: "#6b7280", fontSize: 14 },

  // Section States
  sectionLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 12,
  },
  sectionError: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  retrySmall: {
    backgroundColor: "#1F2937",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  retrySmallText: { color: "#3B82F6", fontSize: 14, fontWeight: "600" },
  emptySection: { alignItems: "center", paddingVertical: 24, gap: 8 },
  noDataText: { color: "#6b7280", fontSize: 14, textAlign: "center" },

  // Global States
  loadingText: { color: "#9ca3af", fontSize: 14 },
  errorText: { color: "#EF4444", fontSize: 14, textAlign: "center" },
});
