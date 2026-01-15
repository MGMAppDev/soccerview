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

      // Fetch ALL teams to count unique states (using pagination)
      const allTeamStates = await fetchAllRows<{ state: string | null }>(
        "team_elo",
        "state",
      );

      const uniqueStates = new Set(
        allTeamStates
          .map((t) => t.state)
          .filter((s) => s && s.trim().length > 0 && s.trim() !== "??"),
      );

      setStats({
        totalTeams: teamCount,
        totalMatches: matchCount,
        totalStates: uniqueStates.size,
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
        <Text style={styles.teamName} numberOfLines={1}>
          {item.home_team ?? "Home Team"}
        </Text>
        <Text style={styles.vsText}>vs {item.away_team ?? "Away Team"}</Text>
        <Text style={styles.scoreText}>
          {hasScore ? `${item.home_score} - ${item.away_score}` : "vs"}
        </Text>
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
          router.push(`/team/${item.id}`);
        }}
      >
        <Text style={styles.featuredTeamName} numberOfLines={2}>
          {item.team_name ?? "Unknown Team"}
        </Text>
        {meta ? <Text style={styles.teamMeta}>{meta}</Text> : null}
        <Text style={styles.recordText}>{record}</Text>
        <View style={styles.eloRow}>
          <Text style={[styles.gradeText, { color }]}>{grade}</Text>
          <Text style={styles.ratingText}>{elo}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading SoccerView...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={48} color="#374151" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setLoading(true);
            fetchData();
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
      showsVerticalScrollIndicator={false}
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
