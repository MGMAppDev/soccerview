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
  totalCompetitions: number;
};

function formatDate(isoDate: string | null): string {
  if (!isoDate) return "";
  try {
    const datePart = isoDate.split("T")[0];
    const [y, m, d] = datePart.split("-").map(Number);
    if (!y || !m || !d) return "";
    return `${m}/${d}/${y}`;
  } catch {
    return "";
  }
}

function scoreText(home: number | null, away: number | null): string {
  if (home === null || away === null) return "vs";
  return `${home} - ${away}`;
}

// Helper to check if a value is valid (not null, empty, or "??")
function isValidValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0 && v.trim() !== "??";
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  const [stats, setStats] = useState<StatsData>({
    totalTeams: 0,
    totalMatches: 0,
    totalCompetitions: 0,
  });
  const [recentMatches, setRecentMatches] = useState<MatchRow[]>([]);
  const [featuredTeams, setFeaturedTeams] = useState<TeamEloRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setError(null);

      // Fetch stats - use team_elo for accurate team count
      const [teamsCount, matchesCount, competitionsCount] = await Promise.all([
        supabase.from("team_elo").select("id", { count: "exact", head: true }),
        supabase.from("matches").select("id", { count: "exact", head: true }),
        supabase
          .from("competitions")
          .select("id", { count: "exact", head: true }),
      ]);

      setStats({
        totalTeams: teamsCount.count ?? 0,
        totalMatches: matchesCount.count ?? 0,
        totalCompetitions: competitionsCount.count ?? 0,
      });

      // Fetch recent matches - use text columns directly (no joins)
      const { data: matchesData, error: matchesError } = await supabase
        .from("matches")
        .select(
          "id, home_team, away_team, home_score, away_score, match_date, location",
        )
        .not("home_score", "is", null)
        .order("match_date", { ascending: false, nullsFirst: false })
        .limit(5);

      if (matchesError) {
        console.error("Matches error:", matchesError);
      }
      setRecentMatches((matchesData as MatchRow[]) ?? []);

      // Fetch featured teams from team_elo (top rated)
      const { data: teamsData, error: teamsError } = await supabase
        .from("team_elo")
        .select(
          "id, team_name, elo_rating, matches_played, wins, losses, draws, state, gender, age_group",
        )
        .order("elo_rating", { ascending: false })
        .limit(10);

      if (teamsError) {
        console.error("Teams error:", teamsError);
      }
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

  // Build match location string - FIXED encoding
  const getMatchLocation = (item: MatchRow): string => {
    const parts: string[] = [];
    const date = formatDate(item.match_date);
    if (date) parts.push(date);
    if (item.location) parts.push(item.location);
    return parts.length > 0 ? parts.join(" · ") : "";
  };

  // Build team meta string (state, gender, age) - FIXED encoding
  const getTeamMeta = (item: TeamEloRow): string => {
    const parts: string[] = [];
    if (isValidValue(item.state)) parts.push(item.state!);
    if (isValidValue(item.gender)) parts.push(item.gender!);
    if (isValidValue(item.age_group)) parts.push(item.age_group!);
    return parts.join(" · ");
  };

  const renderMatch = ({ item }: { item: MatchRow }) => {
    const locationStr = getMatchLocation(item);
    const score = scoreText(item.home_score, item.away_score);

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
        <Text style={styles.scoreText}>{score}</Text>
      </TouchableOpacity>
    );
  };

  const renderFeaturedTeam = ({ item }: { item: TeamEloRow }) => {
    const meta = getTeamMeta(item);
    const record = `${item.wins ?? 0}-${item.losses ?? 0}-${item.draws ?? 0}`;

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
          <Text style={styles.ratingText}>
            {Math.round(item.elo_rating ?? 1500)}
          </Text>
          <Text style={styles.eloLabel}>ELO</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // Loading state
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading SoccerView...</Text>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={48} color="#374151" />
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
            {stats.totalTeams.toLocaleString()} Teams
          </Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color="#6b7280"
            style={styles.statArrow}
          />
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
          <Ionicons
            name="chevron-forward"
            size={16}
            color="#6b7280"
            style={styles.statArrow}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.statCard}
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/rankings");
          }}
        >
          <Ionicons name="trophy" size={24} color="#f59e0b" />
          <Text style={styles.statText}>
            {stats.totalCompetitions} Competitions
          </Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color="#6b7280"
            style={styles.statArrow}
          />
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

      {recentMatches.length > 0 ? (
        <FlatList
          data={recentMatches}
          renderItem={renderMatch}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          scrollEnabled={false}
        />
      ) : (
        <View style={styles.emptySection}>
          <Ionicons name="football-outline" size={32} color="#374151" />
          <Text style={styles.noDataText}>No recent matches available</Text>
        </View>
      )}

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
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: 16,
    marginBottom: 24,
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    marginTop: 8,
  },
  sectionHeader: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  seeAllText: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "600",
  },
  statsContainer: {
    gap: 12,
    marginBottom: 24,
  },
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
  statText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  statArrow: {
    marginLeft: "auto",
  },
  listContent: {
    gap: 12,
  },
  horizontalListContent: {
    paddingRight: 16,
    gap: 12,
  },
  matchCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  locationText: {
    color: "#6b7280",
    fontSize: 12,
    marginBottom: 8,
    fontWeight: "500",
  },
  teamName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  vsText: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 4,
  },
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
  teamMeta: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 4,
  },
  recordText: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 6,
  },
  eloRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 8,
    gap: 4,
  },
  ratingText: {
    color: "#3B82F6",
    fontSize: 18,
    fontWeight: "700",
  },
  eloLabel: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "500",
  },
  emptySection: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  noDataText: {
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
    fontStyle: "italic",
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
  retryButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
});
