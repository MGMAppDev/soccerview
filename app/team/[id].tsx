import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LineChart } from "react-native-chart-kit";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ============================================================================
// TYPES
// ============================================================================

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
  national_rank: number | null;
  regional_rank: number | null;
  state_rank: number | null;
  gotsport_points: number | null;
  goals_for: number | null;
  goals_against: number | null;
  national_award: string | null;
  regional_award: string | null;
  state_cup_award: string | null;
  logo_url: string | null;
  club_name: string | null;
};

type MatchData = {
  id: string;
  event_id: string | null;
  event_name: string | null;
  match_number: string | null;
  match_date: string | null;
  match_time: string | null;
  home_team_name: string | null;
  home_team_id: string | null;
  home_score: number | null;
  away_team_name: string | null;
  away_team_id: string | null;
  away_score: number | null;
  status: string | null;
  age_group: string | null;
  gender: string | null;
  location: string | null;
  source_type: string | null;
  source_platform: string | null;
};

// NEW: Rank history data point
type RankHistoryPoint = {
  snapshot_date: string;
  national_rank: number | null;
  regional_rank: number | null;
  state_rank: number | null;
  gotsport_points: number | null;
};

type CalculatedStats = {
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winPercentage: string;
  source: "team_elo" | "calculated";
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isValidValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0 && v.trim() !== "??";
}

function formatDate(isoDate: string | null): string {
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

function formatChartDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  } catch {
    return "";
  }
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

function normalizeAgeGroup(age: string | null | undefined): string | null {
  if (!age) return null;
  const trimmed = age.trim();
  const match = trimmed.match(/^(U)0*(\d+)$/i);
  if (match) {
    return `U${parseInt(match[2], 10)}`;
  }
  return trimmed;
}

function formatNumber(num: number | null): string {
  if (num === null || num === undefined) return "—";
  return num.toLocaleString();
}

function getRankFontSize(rank: number | null): number {
  if (rank === null) return 20;
  if (rank >= 10000) return 14;
  if (rank >= 1000) return 16;
  if (rank >= 100) return 18;
  return 20;
}

// ============================================================================
// RANK TIMELINE COMPONENT
// ============================================================================

type RankTimelineProps = {
  rankHistory: RankHistoryPoint[];
  currentRank: number | null;
  teamName: string;
};

function RankTimeline({
  rankHistory,
  currentRank,
  teamName,
}: RankTimelineProps) {
  const [showJourneyHelp, setShowJourneyHelp] = useState(false);

  // Process data for chart - need at least 2 points
  const chartData = useMemo(() => {
    // Filter to only points with national_rank
    const validPoints = rankHistory.filter((p) => p.national_rank !== null);

    // If we have no history but have current rank, show just current
    if (validPoints.length === 0 && currentRank) {
      const today = new Date().toISOString().split("T")[0];
      return {
        labels: [formatChartDate(today)],
        datasets: [{ data: [currentRank] }],
        hasData: false,
      };
    }

    if (validPoints.length < 2) {
      // Need at least 2 points for a line chart
      return {
        labels: validPoints.map((p) => formatChartDate(p.snapshot_date)),
        datasets: [{ data: validPoints.map((p) => p.national_rank as number) }],
        hasData: false,
      };
    }

    // Sort by date ascending
    const sorted = [...validPoints].sort(
      (a, b) =>
        new Date(a.snapshot_date).getTime() -
        new Date(b.snapshot_date).getTime(),
    );

    // Take up to 12 data points for readability
    const sampled =
      sorted.length > 12
        ? sorted.filter(
            (_, i) =>
              i % Math.ceil(sorted.length / 12) === 0 ||
              i === sorted.length - 1,
          )
        : sorted;

    return {
      labels: sampled.map((p) => formatChartDate(p.snapshot_date)),
      datasets: [{ data: sampled.map((p) => p.national_rank as number) }],
      hasData: true,
    };
  }, [rankHistory, currentRank]);

  // Calculate journey stats
  const journeyStats = useMemo(() => {
    const validPoints = rankHistory.filter((p) => p.national_rank !== null);
    if (validPoints.length === 0) {
      return {
        highestRank: currentRank,
        lowestRank: currentRank,
        startRank: currentRank,
        change: 0,
      };
    }

    const ranks = validPoints.map((p) => p.national_rank as number);
    const highestRank = Math.min(...ranks); // Lower number = better rank
    const lowestRank = Math.max(...ranks);
    const startRank = ranks[0];
    const endRank = currentRank || ranks[ranks.length - 1];
    const change = startRank - endRank; // Positive = improved

    return { highestRank, lowestRank, startRank, change };
  }, [rankHistory, currentRank]);

  // If no ranking data at all
  if (!currentRank && rankHistory.length === 0) {
    return null;
  }

  return (
    <View style={journeyStyles.container}>
      <View style={journeyStyles.header}>
        <View style={journeyStyles.titleRow}>
          <Text style={journeyStyles.emoji}>📈</Text>
          <Text style={journeyStyles.title}>My Team's Journey</Text>
        </View>
        <TouchableOpacity
          style={journeyStyles.helpButton}
          onPress={() => setShowJourneyHelp(true)}
        >
          <Ionicons name="help-circle-outline" size={20} color="#6b7280" />
        </TouchableOpacity>
      </View>

      {/* Stats Row */}
      <View style={journeyStyles.statsRow}>
        <View style={journeyStyles.statItem}>
          <Text style={[journeyStyles.statValue, { color: "#22c55e" }]}>
            #{journeyStats.highestRank ?? "—"}
          </Text>
          <Text style={journeyStyles.statLabel}>Season High</Text>
        </View>
        <View style={journeyStyles.statItem}>
          <Text style={[journeyStyles.statValue, { color: "#ef4444" }]}>
            #{journeyStats.lowestRank ?? "—"}
          </Text>
          <Text style={journeyStyles.statLabel}>Season Low</Text>
        </View>
        <View style={journeyStyles.statItem}>
          <Text
            style={[
              journeyStyles.statValue,
              journeyStats.change > 0 && { color: "#22c55e" },
              journeyStats.change < 0 && { color: "#ef4444" },
            ]}
          >
            {journeyStats.change > 0
              ? `↑${journeyStats.change}`
              : journeyStats.change < 0
                ? `↓${Math.abs(journeyStats.change)}`
                : "—"}
          </Text>
          <Text style={journeyStyles.statLabel}>Change</Text>
        </View>
      </View>

      {/* Chart */}
      {chartData.hasData ? (
        <View style={journeyStyles.chartContainer}>
          <LineChart
            data={{
              labels: chartData.labels,
              datasets: chartData.datasets,
            }}
            width={SCREEN_WIDTH - 64}
            height={180}
            chartConfig={{
              backgroundColor: "#111",
              backgroundGradientFrom: "#111",
              backgroundGradientTo: "#111",
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(156, 163, 175, ${opacity})`,
              style: { borderRadius: 12 },
              propsForDots: {
                r: "5",
                strokeWidth: "2",
                stroke: "#3B82F6",
              },
              propsForBackgroundLines: {
                strokeDasharray: "",
                stroke: "rgba(255,255,255,0.1)",
              },
            }}
            bezier
            style={journeyStyles.chart}
            withInnerLines={true}
            withOuterLines={false}
            withVerticalLines={false}
            withHorizontalLines={true}
            withVerticalLabels={true}
            withHorizontalLabels={true}
            fromZero={false}
            yAxisSuffix=""
            yLabelsOffset={8}
            xLabelsOffset={-4}
            segments={4}
          />
          <Text style={journeyStyles.chartNote}>
            Lower rank = better position (Rank #1 is best)
          </Text>
        </View>
      ) : (
        <View style={journeyStyles.noDataContainer}>
          <Ionicons name="time-outline" size={32} color="#4b5563" />
          <Text style={journeyStyles.noDataText}>Rank history coming soon</Text>
          <Text style={journeyStyles.noDataSubtext}>
            Check back in a few days to see your ranking journey
          </Text>
        </View>
      )}

      {/* Help Modal */}
      <Modal
        visible={showJourneyHelp}
        transparent
        animationType="fade"
        onRequestClose={() => setShowJourneyHelp(false)}
      >
        <View style={journeyStyles.modalOverlay}>
          {/* Tap backdrop to close */}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowJourneyHelp(false)}
          />
          {/* Modal content - NOT wrapped in TouchableOpacity */}
          <View style={journeyStyles.modalContent}>
            <View style={journeyStyles.modalHeader}>
              <Text style={journeyStyles.modalTitle}>📈 My Team's Journey</Text>
              <TouchableOpacity onPress={() => setShowJourneyHelp(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={journeyStyles.modalScroll}
              contentContainerStyle={journeyStyles.modalScrollContent}
              showsVerticalScrollIndicator={true}
            >
              <Text style={journeyStyles.modalText}>
                This chart shows how your team's Official National Rank has
                changed over time.
              </Text>
              <Text style={journeyStyles.modalText}>
                • <Text style={{ color: "#22c55e" }}>Season High</Text> - Best
                rank achieved this season
              </Text>
              <Text style={journeyStyles.modalText}>
                • <Text style={{ color: "#ef4444" }}>Season Low</Text> - Lowest
                rank this season
              </Text>
              <Text style={journeyStyles.modalText}>
                • <Text style={{ color: "#3B82F6" }}>Change</Text> - Movement
                since season start
              </Text>
              <Text style={journeyStyles.modalSubtitle}>
                How Rankings Update
              </Text>
              <Text style={journeyStyles.modalText}>
                Official rankings update after each tournament. We capture daily
                snapshots to track your team's progress throughout the season.
              </Text>
              <Text style={journeyStyles.modalSubtitle}>
                Understanding the Chart
              </Text>
              <Text style={journeyStyles.modalText}>
                Lower numbers are better - Rank #1 means you're the top team
                nationally. An upward trend on the chart means your rank number
                is going down (improving!).
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Journey-specific styles
const journeyStyles = StyleSheet.create({
  container: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  emoji: { fontSize: 20 },
  title: { color: "#fff", fontSize: 16, fontWeight: "700" },
  helpButton: { padding: 4 },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  statItem: { alignItems: "center" },
  statValue: { color: "#fff", fontSize: 18, fontWeight: "700" },
  statLabel: { color: "#6b7280", fontSize: 11, marginTop: 4 },
  chartContainer: { marginTop: 8 },
  chart: { borderRadius: 12, marginLeft: -16 },
  chartNote: {
    color: "#6b7280",
    fontSize: 11,
    textAlign: "center",
    marginTop: 8,
  },
  noDataContainer: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  noDataText: { color: "#9ca3af", fontSize: 14, fontWeight: "500" },
  noDataSubtext: { color: "#6b7280", fontSize: 12, textAlign: "center" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#1F2937",
    borderRadius: 20,
    width: "100%",
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  modalScroll: {
    flexGrow: 0,
  },
  modalScrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  modalText: {
    color: "#d1d5db",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
  },
  modalSubtitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 8,
  },
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TeamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [team, setTeam] = useState<TeamData | null>(null);
  const [allMatches, setAllMatches] = useState<MatchData[]>([]);
  const [rankHistory, setRankHistory] = useState<RankHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"recent" | "upcoming">("recent");
  const [showRatingsHelp, setShowRatingsHelp] = useState(false);

  const fetchTeamData = async () => {
    if (!id) {
      setError("No team ID provided");
      setLoading(false);
      return;
    }

    try {
      setError(null);

      // Fetch team info
      const { data: teamData, error: teamError } = await supabase
        .from("team_elo")
        .select("*")
        .eq("id", id)
        .single();

      if (teamError) throw teamError;
      setTeam(teamData as TeamData);

      // Fetch matches
      const { data: homeMatches, error: homeError } = await supabase
        .from("match_results")
        .select("*")
        .eq("home_team_id", id)
        .order("match_date", { ascending: false })
        .limit(50);

      const { data: awayMatches, error: awayError } = await supabase
        .from("match_results")
        .select("*")
        .eq("away_team_id", id)
        .order("match_date", { ascending: false })
        .limit(50);

      if (!homeError && !awayError) {
        const allMatchData = [...(homeMatches || []), ...(awayMatches || [])];
        const uniqueMatches = Array.from(
          new Map(allMatchData.map((m) => [m.id, m])).values(),
        );
        uniqueMatches.sort((a, b) => {
          const dateA = new Date(a.match_date || 0).getTime();
          const dateB = new Date(b.match_date || 0).getTime();
          return dateB - dateA;
        });
        setAllMatches(uniqueMatches as MatchData[]);
      }

      // NEW: Fetch rank history for My Team's Journey
      const { data: historyData, error: historyError } = await supabase
        .from("rank_history")
        .select(
          "snapshot_date, national_rank, regional_rank, state_rank, gotsport_points",
        )
        .eq("team_id", id)
        .order("snapshot_date", { ascending: true })
        .limit(365); // Up to 1 year of history

      if (!historyError && historyData) {
        setRankHistory(historyData as RankHistoryPoint[]);
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

  // Split matches
  const { recentMatches, upcomingMatches } = useMemo(() => {
    const now = new Date();
    const recent: MatchData[] = [];
    const upcoming: MatchData[] = [];

    allMatches.forEach((match) => {
      if (match.match_date) {
        const matchDate = new Date(match.match_date);
        if (match.status === "completed" || matchDate <= now) {
          recent.push(match);
        } else if (match.status === "scheduled" || matchDate > now) {
          upcoming.push(match);
        } else {
          recent.push(match);
        }
      } else {
        recent.push(match);
      }
    });

    upcoming.sort((a, b) => {
      const dateA = new Date(a.match_date || 0);
      const dateB = new Date(b.match_date || 0);
      return dateA.getTime() - dateB.getTime();
    });

    return { recentMatches: recent, upcomingMatches: upcoming };
  }, [allMatches]);

  // Calculate stats
  const calculatedStats = useMemo((): CalculatedStats => {
    const hasTeamEloStats =
      team && team.matches_played !== null && team.matches_played > 0;

    if (hasTeamEloStats) {
      const mp = team.matches_played || 0;
      const w = team.wins || 0;
      const winPct = mp > 0 ? ((w / mp) * 100).toFixed(0) : "0";
      return {
        matchesPlayed: mp,
        wins: w,
        losses: team.losses || 0,
        draws: team.draws || 0,
        winPercentage: `${winPct}%`,
        source: "team_elo",
      };
    }

    let wins = 0;
    let losses = 0;
    let draws = 0;
    let matchesWithScores = 0;

    recentMatches.forEach((match) => {
      if (match.home_score !== null && match.away_score !== null) {
        matchesWithScores++;
        const isHome = match.home_team_id === id;
        const teamScore = isHome ? match.home_score : match.away_score;
        const oppScore = isHome ? match.away_score : match.home_score;

        if (teamScore > oppScore) {
          wins++;
        } else if (teamScore < oppScore) {
          losses++;
        } else {
          draws++;
        }
      }
    });

    const winPct =
      matchesWithScores > 0
        ? ((wins / matchesWithScores) * 100).toFixed(0)
        : "0";

    return {
      matchesPlayed: matchesWithScores,
      wins,
      losses,
      draws,
      winPercentage: `${winPct}%`,
      source: "calculated",
    };
  }, [team, recentMatches, id]);

  const hasAnyBadge = useMemo(() => {
    return (
      team?.national_award || team?.regional_award || team?.state_cup_award
    );
  }, [team]);

  const hasRankingData = useMemo(() => {
    return team?.national_rank !== null && team?.national_rank !== undefined;
  }, [team]);

  const getTeamMeta = (): string => {
    if (!team) return "";
    const parts: string[] = [];
    if (isValidValue(team.state)) parts.push(team.state!);
    if (isValidValue(team.gender)) parts.push(team.gender!);
    const normalizedAge = normalizeAgeGroup(team.age_group);
    if (normalizedAge) parts.push(normalizedAge);
    return parts.join(" · ");
  };

  // Render recent match
  const renderRecentMatch = ({ item }: { item: MatchData }) => {
    const isHome = item.home_team_id === id;
    const opponent = isHome ? item.away_team_name : item.home_team_name;
    const teamScore = isHome ? item.home_score : item.away_score;
    const oppScore = isHome ? item.away_score : item.home_score;

    let result = "—";
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
        : "—";

    const sourceEmoji =
      item.source_type === "league"
        ? "🏆"
        : item.source_type === "tournament"
          ? "⚽"
          : "";

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
          <Text style={styles.matchDateText}>
            {dateStr} {sourceEmoji}
          </Text>
        </View>
        <Text style={styles.matchScoreText}>{scoreStr}</Text>
        <Ionicons name="chevron-forward" size={16} color="#4b5563" />
      </TouchableOpacity>
    );
  };

  // Render upcoming match
  const renderUpcomingMatch = ({ item }: { item: MatchData }) => {
    const isHome = item.home_team_id === id;
    const opponent = isHome ? item.away_team_name : item.home_team_name;
    const dateStr = formatDate(item.match_date);

    return (
      <TouchableOpacity
        style={styles.matchCard}
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/match/${item.id}`);
        }}
      >
        <View style={[styles.resultBadge, { backgroundColor: "#3B82F6" }]}>
          <Ionicons name="calendar-outline" size={16} color="#fff" />
        </View>
        <View style={styles.matchInfo}>
          <Text style={styles.opponentText} numberOfLines={1}>
            {isHome ? "vs" : "@"} {opponent || "Unknown"}
          </Text>
          <Text style={styles.matchDateText}>{dateStr}</Text>
          {item.location && (
            <Text style={styles.matchLocationText} numberOfLines={1}>
              {item.location}
            </Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color="#4b5563" />
      </TouchableOpacity>
    );
  };

  const matchesToShow =
    activeTab === "recent" ? recentMatches : upcomingMatches;

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Team Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading team...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !team) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Team Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
          <Text style={styles.errorText}>{error || "Team not found"}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              setError(null);
              void fetchTeamData();
            }}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const elo = Math.round(team.elo_rating ?? 1500);
  const { grade, color } = getEloGrade(elo);
  const meta = getTeamMeta();

  const goalDiff =
    team.goals_for !== null && team.goals_against !== null
      ? team.goals_for - team.goals_against
      : null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Team Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3B82F6"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Team Card */}
        <View style={styles.teamCard}>
          <Text style={styles.teamName}>{team.team_name ?? "Unknown"}</Text>
          {meta ? <Text style={styles.teamMeta}>{meta}</Text> : null}

          {/* Championship Badges */}
          {hasAnyBadge && (
            <View style={styles.badgesContainer}>
              {team.national_award && (
                <View style={[styles.badge, styles.nationalBadge]}>
                  <Text style={styles.badgeEmoji}>🏆</Text>
                  <Text style={styles.badgeText}>National Champion</Text>
                </View>
              )}
              {team.regional_award && (
                <View style={[styles.badge, styles.regionalBadge]}>
                  <Text style={styles.badgeEmoji}>🥇</Text>
                  <Text style={styles.badgeText}>Regional Winner</Text>
                </View>
              )}
              {team.state_cup_award && (
                <View style={[styles.badge, styles.stateBadge]}>
                  <Text style={styles.badgeEmoji}>🏅</Text>
                  <Text style={styles.badgeText}>State Cup</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Power Rating Card */}
        <View style={styles.powerRatingCard}>
          <View style={styles.powerRatingHeader}>
            <Text style={styles.powerRatingCardTitle}>⚡ Power Rating</Text>
            <TouchableOpacity
              style={styles.helpButton}
              onPress={() => setShowRatingsHelp(true)}
            >
              <Ionicons name="help-circle-outline" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>
          <View style={styles.powerRatingContent}>
            <Text style={[styles.powerRatingLetter, { color }]}>{grade}</Text>
            <Text style={styles.powerRatingValue}>{elo}</Text>
          </View>
          <Text style={styles.powerRatingDesc}>
            Computed strength based on match results
          </Text>
        </View>

        {/* Official Rank Card */}
        {hasRankingData && (
          <View style={styles.officialRankCard}>
            <View style={styles.officialRankHeader}>
              <Text style={styles.officialRankTitle}>🏆 Official Rank</Text>
              <TouchableOpacity
                style={styles.helpButton}
                onPress={() => setShowRatingsHelp(true)}
              >
                <Ionicons
                  name="help-circle-outline"
                  size={20}
                  color="#6b7280"
                />
              </TouchableOpacity>
            </View>

            <View style={styles.ranksRow}>
              {team.national_rank && (
                <View style={styles.rankItem}>
                  <Text
                    style={[
                      styles.rankValue,
                      { fontSize: getRankFontSize(team.national_rank) },
                    ]}
                  >
                    #{formatNumber(team.national_rank)}
                  </Text>
                  <Text style={styles.rankLabel}>National</Text>
                </View>
              )}
              {team.regional_rank && (
                <View style={styles.rankItem}>
                  <Text
                    style={[
                      styles.rankValue,
                      { fontSize: getRankFontSize(team.regional_rank) },
                    ]}
                  >
                    #{formatNumber(team.regional_rank)}
                  </Text>
                  <Text style={styles.rankLabel}>Regional</Text>
                </View>
              )}
              {team.state_rank && (
                <View style={styles.rankItem}>
                  <Text
                    style={[
                      styles.rankValue,
                      { fontSize: getRankFontSize(team.state_rank) },
                    ]}
                  >
                    #{formatNumber(team.state_rank)}
                  </Text>
                  <Text style={styles.rankLabel}>State</Text>
                </View>
              )}
              {team.gotsport_points !== null &&
                team.gotsport_points !== undefined && (
                  <View style={styles.rankItem}>
                    <Text
                      style={[
                        styles.rankValuePoints,
                        {
                          fontSize:
                            team.gotsport_points >= 10000
                              ? 14
                              : team.gotsport_points >= 1000
                                ? 16
                                : 18,
                        },
                      ]}
                    >
                      {formatNumber(team.gotsport_points)}
                    </Text>
                    <Text style={styles.rankLabel}>Rank Pts</Text>
                  </View>
                )}
            </View>

            {(team.goals_for !== null || team.goals_against !== null) && (
              <View style={styles.goalsRow}>
                <View style={styles.goalItem}>
                  <Text style={styles.goalValue}>{team.goals_for ?? "—"}</Text>
                  <Text style={styles.goalLabel}>Goals For</Text>
                </View>
                <View style={styles.goalItem}>
                  <Text style={styles.goalValue}>
                    {team.goals_against ?? "—"}
                  </Text>
                  <Text style={styles.goalLabel}>Goals Against</Text>
                </View>
                <View style={styles.goalItem}>
                  <Text
                    style={[
                      styles.goalValue,
                      goalDiff !== null && goalDiff > 0 && { color: "#22c55e" },
                      goalDiff !== null && goalDiff < 0 && { color: "#ef4444" },
                    ]}
                  >
                    {goalDiff !== null
                      ? goalDiff > 0
                        ? `+${goalDiff}`
                        : goalDiff
                      : "—"}
                  </Text>
                  <Text style={styles.goalLabel}>Differential</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* 📈 MY TEAM'S JOURNEY - NEW SECTION */}
        {hasRankingData && (
          <RankTimeline
            rankHistory={rankHistory}
            currentRank={team.national_rank}
            teamName={team.team_name || "Unknown"}
          />
        )}

        {/* Predict Match Button */}
        <TouchableOpacity
          style={styles.predictButton}
          activeOpacity={0.8}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push(`/predict?teamId=${id}`);
          }}
        >
          <View style={styles.predictIconContainer}>
            <Text style={styles.predictEmoji}>⚔️</Text>
          </View>
          <View style={styles.predictTextContainer}>
            <Text style={styles.predictTitle}>Predict a Match</Text>
            <Text style={styles.predictSubtitle}>Compare against any team</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#10b981" />
        </TouchableOpacity>

        {/* Season Stats */}
        <Text style={styles.sectionTitle}>Season Stats</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {calculatedStats.matchesPlayed}
            </Text>
            <Text style={styles.statLabel}>Matches</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: "#10b981" }]}>
              {calculatedStats.wins}
            </Text>
            <Text style={styles.statLabel}>Wins</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: "#ef4444" }]}>
              {calculatedStats.losses}
            </Text>
            <Text style={styles.statLabel}>Losses</Text>
          </View>
        </View>

        {/* Match History */}
        <Text style={styles.sectionTitle}>Match History</Text>
        <View style={styles.tabsRow}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "recent" && styles.activeTab]}
            onPress={() => setActiveTab("recent")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "recent" && styles.activeTabText,
              ]}
            >
              Recent ({recentMatches.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === "upcoming" && styles.activeTab]}
            onPress={() => setActiveTab("upcoming")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "upcoming" && styles.activeTabText,
              ]}
            >
              Upcoming ({upcomingMatches.length})
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.matchesList}>
          {matchesToShow.length === 0 ? (
            <View style={styles.emptyMatches}>
              <Ionicons name="calendar-outline" size={32} color="#4b5563" />
              <Text style={styles.emptyText}>
                {activeTab === "recent"
                  ? "No recent matches found"
                  : "No upcoming matches scheduled"}
              </Text>
              <Text style={styles.emptySubtext}>
                {activeTab === "recent"
                  ? "Match history will appear here"
                  : "Future games will show here when scheduled"}
              </Text>
            </View>
          ) : (
            matchesToShow.map((match, index) =>
              activeTab === "recent"
                ? renderRecentMatch({ item: match })
                : renderUpcomingMatch({ item: match }),
            )
          )}
        </View>

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Ratings Help Modal */}
      <Modal
        visible={showRatingsHelp}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRatingsHelp(false)}
      >
        <TouchableOpacity
          style={styles.helpModalOverlay}
          activeOpacity={1}
          onPress={() => setShowRatingsHelp(false)}
        >
          <View style={styles.helpModalContent}>
            <View style={styles.helpModalHeader}>
              <Text style={styles.helpModalTitle}>Understanding Ratings</Text>
              <TouchableOpacity onPress={() => setShowRatingsHelp(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <View style={styles.helpSection}>
                <Text style={styles.helpSectionTitle}>🏆 Official Rank</Text>
                <Text style={styles.helpSectionDesc}>
                  The official national ranking used by tournament directors for
                  seeding. Based on results from sanctioned events.
                </Text>
                <View style={styles.helpBulletList}>
                  <Text style={styles.helpBullet}>
                    • Used for tournament bracket seeding
                  </Text>
                  <Text style={styles.helpBullet}>
                    • Updated after each tournament
                  </Text>
                  <Text style={styles.helpBullet}>
                    • National, Regional, and State rankings
                  </Text>
                </View>
              </View>
              <View style={styles.helpSection}>
                <Text style={styles.helpSectionTitle}>⚡ Power Rating</Text>
                <Text style={styles.helpSectionDesc}>
                  Our real-time strength calculation using ELO algorithm.
                  Updates after every match result.
                </Text>
                <View style={styles.helpBulletList}>
                  <Text style={styles.helpBullet}>
                    • Real-time strength indicator
                  </Text>
                  <Text style={styles.helpBullet}>
                    • Accounts for opponent strength
                  </Text>
                  <Text style={styles.helpBullet}>
                    • 1500 is average, higher is better
                  </Text>
                </View>
                <View style={styles.gradeGuide}>
                  <Text style={styles.gradeGuideTitle}>Grade Scale</Text>
                  <Text style={[styles.gradeItem, { color: "#22c55e" }]}>
                    A+ (1650+) - Elite
                  </Text>
                  <Text style={[styles.gradeItem, { color: "#3B82F6" }]}>
                    B (1475-1524) - Above Average
                  </Text>
                  <Text style={[styles.gradeItem, { color: "#f59e0b" }]}>
                    C (1400-1474) - Average
                  </Text>
                  <Text style={[styles.gradeItem, { color: "#ef4444" }]}>
                    D (Below 1400) - Developing
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: { color: "#9ca3af", fontSize: 14, marginTop: 8 },
  errorText: {
    color: "#EF4444",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: "#3B82F6",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: { color: "#fff", fontSize: 14, fontWeight: "600" },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  backButton: { padding: 8 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },

  // Team Card
  teamCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  teamName: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 6,
  },
  teamMeta: { color: "#9ca3af", fontSize: 14, textAlign: "center" },

  // Badges
  badgesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 12,
    gap: 8,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  nationalBadge: {
    backgroundColor: "rgba(255, 215, 0, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.4)",
  },
  regionalBadge: {
    backgroundColor: "rgba(192, 192, 192, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(192, 192, 192, 0.4)",
  },
  stateBadge: {
    backgroundColor: "rgba(205, 127, 50, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(205, 127, 50, 0.4)",
  },
  badgeEmoji: { fontSize: 14 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  // Power Rating Card
  powerRatingCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.3)",
  },
  powerRatingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  powerRatingCardTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  powerRatingContent: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 12,
  },
  powerRatingLetter: { fontSize: 48, fontWeight: "bold" },
  powerRatingValue: { color: "#6b7280", fontSize: 24, fontWeight: "600" },
  powerRatingDesc: {
    color: "#6b7280",
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },
  helpButton: { padding: 4 },

  // Official Rank Card
  officialRankCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  officialRankHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  officialRankTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  ranksRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 8,
  },
  rankItem: {
    flex: 1,
    alignItems: "center",
    minHeight: 50,
    justifyContent: "flex-end",
    paddingBottom: 4,
  },
  rankValue: {
    color: "#3B82F6",
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 4,
  },
  rankValuePoints: {
    color: "#22c55e",
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 4,
  },
  rankLabel: { color: "#6b7280", fontSize: 11 },
  goalsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  goalItem: { alignItems: "center", flex: 1 },
  goalValue: { color: "#fff", fontSize: 18, fontWeight: "600" },
  goalLabel: { color: "#6b7280", fontSize: 10, marginTop: 2 },

  // Predict Button
  predictButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: "#10b981",
  },
  predictIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  predictEmoji: { fontSize: 22 },
  predictTextContainer: { flex: 1 },
  predictTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  predictSubtitle: { color: "#10b981", fontSize: 12, fontWeight: "500" },

  // Section Title
  sectionTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },

  // Stats Grid
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    minWidth: "28%",
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  statValue: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  statLabel: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 4,
    textAlign: "center",
  },

  // Tabs
  tabsRow: {
    flexDirection: "row",
    backgroundColor: "#1F2937",
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  activeTab: { backgroundColor: "#3B82F6" },
  tabText: { color: "#9ca3af", fontSize: 14, fontWeight: "600" },
  activeTabText: { color: "#fff" },

  // Match Cards
  matchesList: { gap: 10 },
  matchCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    marginBottom: 8,
  },
  resultBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  resultText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  matchInfo: { flex: 1 },
  opponentText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  matchDateText: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  matchLocationText: { color: "#9ca3af", fontSize: 11, marginTop: 2 },
  matchScoreText: {
    color: "#9ca3af",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 12,
    marginRight: 8,
    minWidth: 50,
    textAlign: "center",
  },
  emptyMatches: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText: { color: "#6b7280", fontSize: 14 },
  emptySubtext: { color: "#4b5563", fontSize: 12 },

  // Help Modal
  helpModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  helpModalContent: {
    backgroundColor: "#1F2937",
    borderRadius: 20,
    width: "100%",
    maxHeight: "80%",
    overflow: "hidden",
  },
  helpModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  helpModalTitle: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  helpSection: { marginBottom: 24 },
  helpSectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  helpSectionDesc: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
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
