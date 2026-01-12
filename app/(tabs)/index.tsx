import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
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
  home_team: { name: string | null } | null;
  away_team: { name: string | null } | null;
  home_score: number | null;
  away_score: number | null;
  match_time: string | null;
  competition: { name: string | null } | null;
};

type TeamResolvedRow = {
  id: string;
  name: string | null;
  gender: string | null;
  age_group: string | null;
  state: string | null;
  team_ranks_daily: { rating: number | null }[] | null;
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
  if (home === null || away === null) return "-";
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
  const [featuredTeams, setFeaturedTeams] = useState<TeamResolvedRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setError(null);

      // Fetch stats via direct COUNT queries (more robust than RPC)
      const [teamsCount, matchesCount, competitionsCount] = await Promise.all([
        supabase.from("teams").select("id", { count: "exact", head: true }),
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

      // Fetch recent matches with relational joins
      const { data: matchesData, error: matchesError } = await supabase
        .from("matches")
        .select(
          "id, home_team:home_team_id (name), away_team:away_team_id (name), home_score, away_score, match_time, competition:competition_id (name)",
        )
        .order("match_time", { ascending: false, nullsFirst: false })
        .limit(5);

      if (matchesError) {
        console.error("Matches error:", matchesError);
      }
      setRecentMatches((matchesData as unknown as MatchRow[]) ?? []);

      // Fetch featured teams with rankings
      const { data: teamsData, error: teamsError } = await supabase
        .from("teams")
        .select("id, name, gender, age_group, state, team_ranks_daily(rating)")
        .order("rating", {
          ascending: false,
          nullsFirst: false,
          foreignTable: "team_ranks_daily",
        })
        .limit(5);

      if (teamsError) {
        console.error("Teams error:", teamsError);
      }
      setFeaturedTeams((teamsData as unknown as TeamResolvedRow[]) ?? []);
    } catch (err) {
      console.error("Error fetching home data:", err);
      setError("Failed to load data. Pull to refresh.");
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

  // Build match meta string (score and date)
  const getMatchMeta = (item: MatchRow): string => {
    const parts: string[] = [];
    const score = scoreText(item.home_score, item.away_score);
    if (score !== "-") parts.push(score);
    const date = formatDate(item.match_time);
    if (date) parts.push(date);
    return parts.length > 0 ? parts.join(" · ") : "";
  };

  // Build team meta string (state, gender, age)
  const getTeamMeta = (item: TeamResolvedRow): string => {
    const parts: string[] = [];
    if (isValidValue(item.state)) parts.push(item.state!);
    if (isValidValue(item.gender)) parts.push(item.gender!);
    if (isValidValue(item.age_group)) parts.push(item.age_group!);
    return parts.join(" · ");
  };

  // Get team rating from nested array
  const getTeamRating = (item: TeamResolvedRow): number => {
    if (
      Array.isArray(item.team_ranks_daily) &&
      item.team_ranks_daily.length > 0
    ) {
      return item.team_ranks_daily[0]?.rating ?? 1500;
    }
    return 1500;
  };

  const renderMatch = ({ item }: { item: MatchRow }) => {
    const competitionName = item.competition?.name;
    const meta = getMatchMeta(item);

    return (
      <TouchableOpacity
        style={styles.matchCard}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/match/${item.id}`);
        }}
      >
        {competitionName ? (
          <Text style={styles.leagueName}>{competitionName}</Text>
        ) : null}
        <Text style={styles.teamName}>
          {item.home_team?.name ?? "Home"} vs. {item.away_team?.name ?? "Away"}
        </Text>
        {meta ? <Text style={styles.matchMeta}>{meta}</Text> : null}
      </TouchableOpacity>
    );
  };

  const renderFeaturedTeam = ({ item }: { item: TeamResolvedRow }) => {
    const meta = getTeamMeta(item);
    const rating = getTeamRating(item);

    return (
      <TouchableOpacity
        style={styles.featuredCard}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/team/${item.id}`);
        }}
      >
        <Text style={styles.teamName}>{item.name ?? "Unknown Team"}</Text>
        {meta ? <Text style={styles.matchMeta}>{meta}</Text> : null}
        <Text style={styles.ratingText}>ELO: {rating}</Text>
      </TouchableOpacity>
    );
  };

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => void fetchData()}
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
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={{ paddingTop: insets.top }}>
        <Text style={styles.title}>SoccerView</Text>
        <Text style={styles.subtitle}>
          National & State Youth Club Soccer Rankings
        </Text>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Ionicons name="people" size={24} color="#3B82F6" />
          <Text style={styles.statText}>{stats.totalTeams} Teams</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="trophy" size={24} color="#3B82F6" />
          <Text style={styles.statText}>{stats.totalMatches} Matches</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="bar-chart" size={24} color="#3B82F6" />
          <Text style={styles.statText}>
            {stats.totalCompetitions} Competitions
          </Text>
        </View>
      </View>

      <Text style={styles.sectionHeader}>Latest Matches</Text>
      {recentMatches.length > 0 ? (
        <FlatList
          data={recentMatches}
          renderItem={renderMatch}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          scrollEnabled={false}
        />
      ) : (
        <Text style={styles.noDataText}>No recent matches available</Text>
      )}

      <Text style={styles.sectionHeader}>Featured Teams</Text>
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
        <Text style={styles.noDataText}>No featured teams available</Text>
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
  sectionHeader: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
    marginTop: 8,
  },
  statsContainer: {
    gap: 12,
    marginBottom: 20,
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
  leagueName: {
    color: "#6b7280",
    fontSize: 12,
    marginBottom: 6,
    fontWeight: "500",
  },
  teamName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  matchMeta: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 6,
  },
  ratingText: {
    color: "#3B82F6",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
  },
  featuredCard: {
    width: 200,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  noDataText: {
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
    marginTop: 10,
    fontStyle: "italic",
  },
  errorText: {
    color: "#EF4444",
    textAlign: "center",
    fontSize: 16,
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
