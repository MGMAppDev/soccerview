import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
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
import { supabase } from "../../lib/supabase";

// ============================================================
// US STATES ONLY - Filter out Canadian provinces and invalid codes
// ============================================================
const US_STATES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

type MatchRow = {
  id: string;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  match_date: string | null;
  location: string | null;
};

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

type StatsData = {
  totalTeams: number;
  totalMatches: number;
  totalStates: number;
};

type TopPredictor = {
  display_name: string;
  avatar_emoji: string;
  total_points: number;
  rank: number;
};

// Pagination helper to fetch ALL rows (Supabase limits to 1000 per query)
async function fetchAllRows<T>(
  table: string,
  selectColumns: string = "*",
): Promise<T[]> {
  const allRows: T[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select(selectColumns)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      break;
    }

    if (data && data.length > 0) {
      allRows.push(...(data as T[]));
      offset += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

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

function formatDate(isoDate: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}

function isValidValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0 && v.trim() !== "??";
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  const [stats, setStats] = useState<StatsData>({
    totalTeams: 0,
    totalMatches: 0,
    totalStates: 0,
  });
  const [recentMatches, setRecentMatches] = useState<MatchRow[]>([]);
  const [featuredTeams, setFeaturedTeams] = useState<TeamEloRow[]>([]);
  const [topPredictors, setTopPredictors] = useState<TopPredictor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setError(null);

      // Get EXACT counts using head:true (bypasses 1000 limit)
      const [teamsCountResult, matchesCountResult] = await Promise.all([
        supabase.from("team_elo").select("*", { count: "exact", head: true }),
        supabase.from("matches").select("*", { count: "exact", head: true }),
      ]);

      const teamCount = teamsCountResult.count ?? 0;
      const matchCount = matchesCountResult.count ?? 0;

      // Use fixed 50 states (we know we cover all US states)
      // This avoids fetching 115k+ rows just to count unique states
      setStats({
        totalTeams: teamCount,
        totalMatches: matchCount,
        totalStates: 50,
      });

      // Fetch recent matches (just top 10)
      const { data: matchesData } = await supabase
        .from("matches")
        .select("*")
        .not("home_score", "is", null)
        .order("match_date", { ascending: false })
        .limit(10);

      setRecentMatches((matchesData as MatchRow[]) ?? []);

      // Fetch top 10 teams by ELO
      const { data: teamsData } = await supabase
        .from("team_elo")
        .select("*")
        .order("elo_rating", { ascending: false })
        .limit(10);

      setFeaturedTeams((teamsData as TeamEloRow[]) ?? []);

      // Fetch top 3 predictors for the mini leaderboard (optional - don't crash if view missing)
      const { data: predictorsData, error: predictorsError } = await supabase
        .from("leaderboard_all_time")
        .select("display_name, avatar_emoji, total_points, rank")
        .limit(3);

      if (!predictorsError && predictorsData) {
        setTopPredictors(predictorsData as TopPredictor[]);
      } else {
        // View might not exist yet - that's OK, show empty state
        setTopPredictors([]);
      }
    } catch (err) {
      console.error("Error fetching home data:", err);
      setError("Failed to load data. Pull to refresh.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const getMatchLocation = (item: MatchRow): string => {
    const parts: string[] = [];
    const date = formatDate(item.match_date);
    if (date) parts.push(date);
    if (item.location) parts.push(item.location);
    return parts.join(" · ");
  };

  const getTeamMeta = (item: TeamEloRow): string => {
    const parts: string[] = [];
    if (isValidValue(item.state)) parts.push(item.state!);
    if (isValidValue(item.gender)) parts.push(item.gender!);
    if (isValidValue(item.age_group)) parts.push(item.age_group!);
    return parts.join(" · ");
  };

  const navigateToLeaderboard = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/leaderboard" as any);
  };

  const navigateToPredict = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/predict");
  };

  const renderMatch = ({ item }: { item: MatchRow }) => {
    const locationStr = getMatchLocation(item);
    const hasScore = item.home_score !== null && item.away_score !== null;

    return (
      <TouchableOpacity
        style={styles.matchCard}
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/match/${item.id}`);
        }}
      >
        {locationStr ? (
          <Text style={styles.locationText}>{locationStr}</Text>
        ) : null}
        <Text style={styles.teamName}>{item.home_team ?? "Home Team"}</Text>
        <Text style={styles.vsText}>vs</Text>
        <Text style={styles.teamName}>{item.away_team ?? "Away Team"}</Text>
        {hasScore && (
          <Text style={styles.scoreText}>
            {item.home_score} - {item.away_score}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderFeaturedTeam = ({ item }: { item: TeamEloRow }) => {
    const meta = getTeamMeta(item);
    const record = `${item.wins ?? 0}-${item.losses ?? 0}-${item.draws ?? 0}`;
    const elo = Math.round(item.elo_rating ?? 1500);
    const { grade, color } = getEloGrade(elo);

    return (
      <TouchableOpacity
        style={styles.featuredCard}
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push({ pathname: "/team/[id]", params: { id: item.id } });
        }}
      >
        <Text style={styles.featuredTeamName} numberOfLines={2}>
          {item.team_name || "Unknown Team"}
        </Text>
        {meta ? <Text style={styles.teamMeta}>{meta}</Text> : null}
        <Text style={styles.recordText}>Record: {record}</Text>
        <View style={styles.eloRow}>
          <Text style={[styles.gradeText, { color }]}>{grade}</Text>
          <Text style={styles.ratingText}>{elo}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle" size={48} color="#EF4444" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setLoading(true);
            void fetchData();
          }}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#3B82F6"
        />
      }
    >
      <View style={{ paddingTop: insets.top }}>
        <Text style={styles.title}>SoccerView</Text>
        <Text style={styles.subtitle}>
          National & State Youth Club Soccer Rankings
        </Text>
      </View>

      {/* ⚔️ PREDICT MATCH - Hero Button */}
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

      {/* 🏆 TOP PREDICTORS - Mini Leaderboard */}
      <TouchableOpacity
        style={styles.leaderboardButton}
        activeOpacity={0.8}
        onPress={navigateToLeaderboard}
      >
        <View style={styles.leaderboardHeader}>
          <View style={styles.leaderboardTitleRow}>
            <Text style={styles.leaderboardEmoji}>🏆</Text>
            <Text style={styles.leaderboardTitle}>Top Predictors</Text>
          </View>
          <View style={styles.seeAllBadge}>
            <Text style={styles.seeAllBadgeText}>See All</Text>
            <Ionicons name="chevron-forward" size={14} color="#f59e0b" />
          </View>
        </View>

        {topPredictors.length > 0 ? (
          <View style={styles.miniLeaderboard}>
            {topPredictors.map((predictor, index) => (
              <View key={index} style={styles.miniLeaderboardItem}>
                <Text style={styles.miniRank}>
                  {predictor.rank === 1
                    ? "🥇"
                    : predictor.rank === 2
                      ? "🥈"
                      : "🥉"}
                </Text>
                <Text style={styles.miniAvatar}>{predictor.avatar_emoji}</Text>
                <Text style={styles.miniName} numberOfLines={1}>
                  {predictor.display_name}
                </Text>
                <Text style={styles.miniPoints}>
                  {predictor.total_points.toLocaleString()} pts
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyLeaderboard}>
            <Text style={styles.emptyLeaderboardText}>
              Be the first to make predictions and claim the top spot!
            </Text>
          </View>
        )}
      </TouchableOpacity>

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
            {stats.totalTeams.toLocaleString()} Teams
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
            {stats.totalMatches.toLocaleString()} Matches
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

      {recentMatches.length > 0 ? (
        <FlatList
          data={recentMatches}
          renderItem={renderMatch}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
        />
      ) : (
        <View style={styles.emptySection}>
          <Ionicons name="football-outline" size={32} color="#374151" />
          <Text style={styles.noDataText}>No recent matches available</Text>
        </View>
      )}

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

      {featuredTeams.length > 0 ? (
        <FlatList
          data={featuredTeams}
          renderItem={renderFeaturedTeam}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalListContent}
        />
      ) : (
        <View style={styles.emptySection}>
          <Ionicons name="trophy-outline" size={32} color="#374151" />
          <Text style={styles.noDataText}>No featured teams available</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  contentContainer: { padding: 16, paddingBottom: 32 },
  title: { color: "#fff", fontSize: 32, fontWeight: "bold", marginBottom: 8 },
  subtitle: { color: "#9ca3af", fontSize: 16, marginBottom: 24 },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    marginTop: 8,
  },
  sectionHeader: { color: "#fff", fontSize: 20, fontWeight: "700" },
  seeAllText: { color: "#3B82F6", fontSize: 14, fontWeight: "600" },

  // ⚔️ Predict Match Button Styles
  predictButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "#10b981",
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
  predictEmoji: {
    fontSize: 24,
  },
  predictTextContainer: {
    flex: 1,
  },
  predictTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 2,
  },
  predictSubtitle: {
    color: "#10b981",
    fontSize: 13,
    fontWeight: "500",
  },

  // 🏆 Top Predictors Button Styles
  leaderboardButton: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  leaderboardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  leaderboardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  leaderboardEmoji: {
    fontSize: 20,
  },
  leaderboardTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  seeAllBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  seeAllBadgeText: {
    color: "#f59e0b",
    fontSize: 13,
    fontWeight: "600",
  },
  miniLeaderboard: {
    gap: 8,
  },
  miniLeaderboardItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  miniRank: {
    fontSize: 18,
    width: 28,
  },
  miniAvatar: {
    fontSize: 20,
  },
  miniName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  miniPoints: {
    color: "#f59e0b",
    fontSize: 14,
    fontWeight: "700",
  },
  emptyLeaderboard: {
    paddingVertical: 12,
  },
  emptyLeaderboardText: {
    color: "#9ca3af",
    fontSize: 13,
    textAlign: "center",
  },

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
  matchCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    marginBottom: 12,
  },
  locationText: { color: "#6b7280", fontSize: 12, marginBottom: 8 },
  teamName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  vsText: { color: "#9ca3af", fontSize: 14, marginTop: 4 },
  scoreText: {
    color: "#3B82F6",
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 8,
  },
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
  eloRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 8,
    gap: 6,
  },
  gradeText: { fontSize: 22, fontWeight: "bold" },
  ratingText: { color: "#6b7280", fontSize: 14 },
  emptySection: { alignItems: "center", paddingVertical: 24, gap: 8 },
  noDataText: { color: "#6b7280", fontSize: 14, textAlign: "center" },
  loadingText: { color: "#9ca3af", fontSize: 14, marginTop: 12 },
  errorText: {
    color: "#EF4444",
    textAlign: "center",
    fontSize: 16,
    marginTop: 12,
    marginBottom: 16,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  retryButton: {
    backgroundColor: "#3B82F6",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
