import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type TeamData = {
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

type MatchData = {
  id: string;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  match_date: string | null;
  location: string | null;
};

function isValidValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0 && v.trim() !== "??";
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

export default function TeamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [team, setTeam] = useState<TeamData | null>(null);
  const [matches, setMatches] = useState<MatchData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTeamData = async () => {
    if (!id) {
      setError("No team ID provided");
      setLoading(false);
      return;
    }

    try {
      setError(null);

      // Fetch team info from team_elo
      const { data: teamData, error: teamError } = await supabase
        .from("team_elo")
        .select("*")
        .eq("id", id)
        .single();

      if (teamError) throw teamError;
      setTeam(teamData as TeamData);

      // Fetch recent matches for this team
      const teamName = teamData?.team_name;
      if (teamName) {
        const { data: matchData, error: matchError } = await supabase
          .from("matches")
          .select("*")
          .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
          .order("match_date", { ascending: false })
          .limit(20);

        if (!matchError) {
          setMatches((matchData as MatchData[]) || []);
        }
      }
    } catch (err: any) {
      console.error("Error fetching team:", err);
      setError(err.message || "Failed to load team");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTeamData();
  }, [id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTeamData();
    setRefreshing(false);
  };

  const getTeamMeta = (): string => {
    if (!team) return "";
    const parts: string[] = [];
    if (isValidValue(team.state)) parts.push(team.state!);
    if (isValidValue(team.gender)) parts.push(team.gender!);
    if (isValidValue(team.age_group)) parts.push(team.age_group!);
    return parts.join(" · ");
  };

  const getWinPercentage = (): string => {
    if (!team || !team.matches_played || team.matches_played === 0) return "0%";
    const winPct = ((team.wins || 0) / team.matches_played) * 100;
    return `${winPct.toFixed(1)}%`;
  };

  const renderMatch = ({ item }: { item: MatchData }) => {
    const isHome = item.home_team === team?.team_name;
    const opponent = isHome ? item.away_team : item.home_team;
    const teamScore = isHome ? item.home_score : item.away_score;
    const oppScore = isHome ? item.away_score : item.home_score;

    let result = "–";
    let resultColor = "#6b7280";
    if (teamScore !== null && oppScore !== null) {
      if (teamScore > oppScore) {
        result = "W";
        resultColor = "#10b981";
      } else if (teamScore < oppScore) {
        result = "L";
        resultColor = "#ef4444";
      } else {
        result = "D";
        resultColor = "#f59e0b";
      }
    }

    const dateStr = formatDate(item.match_date);
    const scoreStr =
      teamScore !== null && oppScore !== null
        ? `${teamScore} - ${oppScore}`
        : "–";

    return (
      <TouchableOpacity
        style={styles.matchCard}
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/match/${item.id}`);
        }}
      >
        <View style={[styles.resultBadge, { backgroundColor: resultColor }]}>
          <Text style={styles.resultText}>{result}</Text>
        </View>
        <View style={styles.matchInfo}>
          <Text style={styles.opponentText} numberOfLines={1}>
            {isHome ? "vs" : "@"} {opponent || "Unknown"}
          </Text>
          <Text style={styles.matchDateText}>{dateStr}</Text>
        </View>
        <Text style={styles.matchScoreText}>{scoreStr}</Text>
        <Ionicons name="chevron-forward" size={16} color="#4b5563" />
      </TouchableOpacity>
    );
  };

  // Loading state
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading team...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error || !team) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#374151" />
          <Text style={styles.errorText}>{error || "Team not found"}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              void fetchTeamData();
            }}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const meta = getTeamMeta();
  const record = `${team.wins ?? 0}-${team.losses ?? 0}-${team.draws ?? 0}`;
  const elo = Math.round(team.elo_rating ?? 1500);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header with back button */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Team Details
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3B82F6"
          />
        }
      >
        {/* Team Name Card */}
        <View style={styles.teamCard}>
          <Text style={styles.teamName}>
            {team.team_name || "Unknown Team"}
          </Text>
          {meta ? <Text style={styles.teamMeta}>{meta}</Text> : null}

          {/* ELO Rating */}
          <View style={styles.eloSection}>
            <Text style={styles.eloValue}>{elo}</Text>
            <Text style={styles.eloLabel}>ELO Rating</Text>
          </View>
        </View>

        {/* Stats Grid */}
        <Text style={styles.sectionTitle}>Season Stats</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{record}</Text>
            <Text style={styles.statLabel}>Record (W-L-D)</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{team.matches_played ?? 0}</Text>
            <Text style={styles.statLabel}>Games Played</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: "#10b981" }]}>
              {team.wins ?? 0}
            </Text>
            <Text style={styles.statLabel}>Wins</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: "#ef4444" }]}>
              {team.losses ?? 0}
            </Text>
            <Text style={styles.statLabel}>Losses</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: "#f59e0b" }]}>
              {team.draws ?? 0}
            </Text>
            <Text style={styles.statLabel}>Draws</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{getWinPercentage()}</Text>
            <Text style={styles.statLabel}>Win Rate</Text>
          </View>
        </View>

        {/* Recent Matches */}
        <Text style={styles.sectionTitle}>Recent Matches</Text>
        {matches.length > 0 ? (
          <FlatList
            data={matches}
            renderItem={renderMatch}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            contentContainerStyle={styles.matchesList}
          />
        ) : (
          <View style={styles.emptyMatches}>
            <Ionicons name="football-outline" size={32} color="#374151" />
            <Text style={styles.emptyText}>No matches found</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1F2937",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  teamCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
  },
  teamName: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  teamMeta: {
    color: "#9ca3af",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  eloSection: {
    alignItems: "center",
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    width: "100%",
  },
  eloValue: {
    color: "#3B82F6",
    fontSize: 48,
    fontWeight: "bold",
  },
  eloLabel: {
    color: "#6b7280",
    fontSize: 14,
    marginTop: 4,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 24,
  },
  statBox: {
    width: "30%",
    flexGrow: 1,
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  statValue: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  statLabel: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 4,
    textAlign: "center",
  },
  matchesList: {
    gap: 10,
  },
  matchCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  resultBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  resultText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  matchInfo: {
    flex: 1,
  },
  opponentText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  matchDateText: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  matchScoreText: {
    color: "#9ca3af",
    fontSize: 16,
    fontWeight: "600",
    marginRight: 8,
  },
  emptyMatches: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    color: "#6b7280",
    fontSize: 14,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 12,
  },
  errorText: {
    color: "#EF4444",
    fontSize: 16,
    marginTop: 12,
    marginBottom: 16,
    textAlign: "center",
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
