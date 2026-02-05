import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LineChart as ChartKitLineChart } from "react-native-chart-kit";
import { LineChart } from "react-native-gifted-charts";
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
  elo_national_rank: number | null;  // ELO-based national rank (SoccerView)
  elo_state_rank: number | null;     // ELO-based state rank (SoccerView)
  matches_played: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  state: string | null;
  gender: string | null;
  age_group: string | null;
  national_rank: number | null;      // GotSport national rank
  regional_rank: number | null;
  state_rank: number | null;         // GotSport state rank
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
  match_date: string | null;
  match_time: string | null;
  home_team_name: string | null;
  home_team_id: string | null;
  home_score: number | null;
  away_team_name: string | null;
  away_team_id: string | null;
  away_score: number | null;
  league_id: string | null;
  tournament_id: string | null;
  location: string | null;
  source_type: string | null; // 'league' | 'tournament' | null - computed from league_id/tournament_id
};

// Rank history data point - includes both SoccerView and GotSport data
type RankHistoryPoint = {
  snapshot_date: string;
  // SoccerView data
  elo_rating: number | null;           // ELO rating (power score)
  elo_national_rank: number | null;    // SoccerView national rank position
  elo_state_rank: number | null;       // SoccerView state rank position
  // GotSport data
  national_rank: number | null;        // GotSport national rank
  state_rank: number | null;           // GotSport state rank
};

type CalculatedStats = {
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winPercentage: string;
  source: "app_team_profile" | "calculated";
};

// Event group for league/tournament grouping
type EventGroup = {
  eventId: string;
  eventName: string;
  eventType: "league" | "tournament";
  matches: MatchData[];
  wins: number;
  losses: number;
  draws: number;
  dateRange: string;
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

function formatDateRange(dates: string[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort();
  const first = new Date(sorted[0]);
  const last = new Date(sorted[sorted.length - 1]);

  const formatShort = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Check if same day
  if (sorted[0] === sorted[sorted.length - 1]) {
    return formatShort(first);
  }

  // Check if same month
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return `${first.toLocaleDateString("en-US", { month: "short" })} ${first.getDate()}-${last.getDate()}`;
  }

  return `${formatShort(first)} - ${formatShort(last)}`;
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

/**
 * Format rank for Y-axis display
 * Works for any rank scale (national thousands, state hundreds, etc.)
 */
function formatRankLabel(rank: number): string {
  if (rank >= 10000) return `#${(rank / 1000).toFixed(0)}k`;
  if (rank >= 1000) return `#${(rank / 1000).toFixed(1)}k`;
  return `#${Math.round(rank)}`;
}

// ============================================================================
// REUSABLE RANK LINE CHART COMPONENT (using react-native-gifted-charts)
// ============================================================================
// Features:
// 1. Inverted Y-axis: #1 (best) at TOP, higher numbers (worse) at BOTTOM
// 2. Dynamic range based on team's actual rank history
// 3. Proper Y-axis labels showing rank values
// 4. Centered layout

type RankLineChartProps = {
  labels: string[];           // X-axis labels (dates)
  ranks: number[];            // Positive rank values (e.g., [3689, 3700, 3650])
  color: string;              // Line color (e.g., "#3B82F6")
  fillColor?: string;         // Optional area fill color
  width?: number;             // Chart width
  height?: number;            // Chart height
};

function RankLineChart({
  labels,
  ranks,
  color,
  fillColor,
  width = SCREEN_WIDTH - 64,
  height = 150,
}: RankLineChartProps) {
  if (ranks.length < 2) return null;

  // Calculate range from actual data
  const minRank = Math.min(...ranks);  // Best rank (lowest number)
  const maxRank = Math.max(...ranks);  // Worst rank (highest number)

  // Smart padding: proportional to the actual values, not the range
  // Top padding: 10% of best rank (small, keeps actual best visible)
  // Bottom padding: 10% of worst rank (ensures line doesn't clip)
  const topPadding = Math.max(Math.ceil(minRank * 0.1), 1);
  const bottomPadding = Math.max(Math.ceil(maxRank * 0.1), 5);

  const displayMin = Math.max(1, minRank - topPadding);   // Best rank (TOP)
  const displayMax = maxRank + bottomPadding;              // Worst rank (BOTTOM)
  const displayRange = displayMax - displayMin || 1;

  // Normalize to 0-100: 100 = best (top), 0 = worst (bottom)
  const normalize = (rank: number) => {
    return ((displayMax - rank) / displayRange) * 100;
  };

  const chartData = ranks.map((rank, i) => ({
    value: normalize(rank),
    label: labels[i],
    dataPointColor: color,
  }));

  // Y-axis labels (gifted-charts: index 0 = bottom, last = top)
  const yAxisLabels = [
    formatRankLabel(displayMax),                           // Bottom (worst)
    formatRankLabel(displayMax - displayRange / 3),        // 33%
    formatRankLabel(displayMax - (2 * displayRange) / 3),  // 66%
    formatRankLabel(displayMin),                           // Top (best)
  ];

  // Calculate spacing - leave room for Y-axis labels and X-axis label overflow
  const yAxisWidth = 55;
  const edgePadding = 25; // Space for first/last X-axis labels (e.g., "10/24")
  const chartWidth = width - yAxisWidth - edgePadding; // Account for label overflow
  const spacing = Math.max((chartWidth - edgePadding * 2) / Math.max(ranks.length - 1, 1), 30);

  return (
    <View style={{ alignItems: "center", width: "100%" }}>
      <LineChart
        data={chartData}
        width={chartWidth}
        height={height}
        spacing={spacing}
        initialSpacing={edgePadding}
        endSpacing={edgePadding}

        // Y-axis configuration
        yAxisLabelTexts={yAxisLabels}
        yAxisTextStyle={{ color: "#6b7280", fontSize: 10 }}
        yAxisColor="transparent"
        yAxisThickness={0}
        yAxisLabelWidth={55}
        noOfSections={3}
        maxValue={100}
        mostNegativeValue={0}
        stepValue={100 / 3}

        // X-axis configuration
        xAxisColor="transparent"
        xAxisThickness={0}
        xAxisLabelTextStyle={{ color: "#6b7280", fontSize: 9 }}
        rotateLabel={false}

        // Line styling
        color={color}
        thickness={2}
        curved
        curveType={0}

        // Data points
        dataPointsColor={color}
        dataPointsRadius={4}

        // Area fill (subtle gradient)
        areaChart={!!fillColor}
        startFillColor={fillColor || color}
        endFillColor="transparent"
        startOpacity={0.15}
        endOpacity={0}

        // Grid lines
        rulesType="solid"
        rulesColor="rgba(255,255,255,0.05)"
        rulesThickness={1}

        // Background
        backgroundColor="transparent"

        // Rendering options
        isAnimated={false}
        hideDataPoints={false}
        showVerticalLines={false}
      />
    </View>
  );
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
          <Ionicons name="help-circle-outline" size={18} color="#6b7280" />
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
  // Season stats from real-time matches_v2 query (universal fix for stats consistency)
  const [seasonStats, setSeasonStats] = useState<{
    matchesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"recent" | "upcoming">("recent");
  const [showRatingsHelp, setShowRatingsHelp] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  // Rating Journey filters - two dimensions
  const [journeySource, setJourneySource] = useState<"sv" | "gs" | "both">("both"); // SoccerView | GotSport | Both
  const [journeyScope, setJourneyScope] = useState<"national" | "state">("national"); // National | State

  const fetchTeamData = async () => {
    if (!id) {
      setError("No team ID provided");
      setLoading(false);
      return;
    }

    try {
      setError(null);

      // Fetch team info from V2 view
      const { data: teamData, error: teamError } = await supabase
        .from("app_team_profile")
        .select("*")
        .eq("id", id)
        .single();

      if (teamError) throw teamError;
      // Map display_name to team_name for UI compatibility
      const mappedTeam = {
        ...teamData,
        team_name: teamData.display_name,
      };
      setTeam(mappedTeam as TeamData);

      // Fetch matches from V2 with team name joins
      // NOTE: matches_v2 doesn't have 'status' column - use match_date and scores to determine state
      const matchQuery = `
        id, match_date, match_time, home_score, away_score,
        home_team_id, away_team_id, league_id, tournament_id,
        home_team:teams_v2!matches_v2_home_team_id_fkey(display_name),
        away_team:teams_v2!matches_v2_away_team_id_fkey(display_name),
        league:leagues(name),
        tournament:tournaments(name)
      `;

      const { data: homeMatches, error: homeError } = await supabase
        .from("matches_v2")
        .select(matchQuery)
        .eq("home_team_id", id)
        .is("deleted_at", null)
        .order("match_date", { ascending: false })
        .limit(50);

      const { data: awayMatches, error: awayError } = await supabase
        .from("matches_v2")
        .select(matchQuery)
        .eq("away_team_id", id)
        .is("deleted_at", null)
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
        // Map joined data to flat structure for UI compatibility
        const mappedMatches = uniqueMatches.map((m: any) => ({
          ...m,
          home_team_name: m.home_team?.display_name || "Unknown",
          away_team_name: m.away_team?.display_name || "Unknown",
          event_name: m.league?.name || m.tournament?.name || null,
          event_id: m.league_id || m.tournament_id || null,
          source_type: m.league_id ? "league" : m.tournament_id ? "tournament" : null,
        }));
        setAllMatches(mappedMatches as MatchData[]);
      }

      // Calculate season boundaries (Aug 1 - Jul 31)
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth(); // 0-indexed (July = 6)
      const seasonStartYear = currentMonth < 7 ? currentDate.getFullYear() - 1 : currentDate.getFullYear();
      const seasonStart = `${seasonStartYear}-08-01`;

      // UNIVERSAL FIX: Fetch season stats directly from matches_v2 (real-time, not pre-computed)
      // This ensures Season Stats always matches the actual match data in the database
      // Uses lightweight query (no joins) for performance with high-match teams
      const { data: homeStats } = await supabase
        .from("matches_v2")
        .select("home_score, away_score")
        .eq("home_team_id", id)
        .is("deleted_at", null)
        .not("home_score", "is", null)
        .not("away_score", "is", null)
        .gte("match_date", seasonStart);

      const { data: awayStats } = await supabase
        .from("matches_v2")
        .select("home_score, away_score")
        .eq("away_team_id", id)
        .is("deleted_at", null)
        .not("home_score", "is", null)
        .not("away_score", "is", null)
        .gte("match_date", seasonStart);

      // Calculate stats from real match data
      let statsWins = 0, statsLosses = 0, statsDraws = 0;

      // Process home matches
      (homeStats || []).forEach((m: any) => {
        if (m.home_score > m.away_score) statsWins++;
        else if (m.home_score < m.away_score) statsLosses++;
        else statsDraws++;
      });

      // Process away matches
      (awayStats || []).forEach((m: any) => {
        if (m.away_score > m.home_score) statsWins++;
        else if (m.away_score < m.home_score) statsLosses++;
        else statsDraws++;
      });

      setSeasonStats({
        matchesPlayed: (homeStats?.length || 0) + (awayStats?.length || 0),
        wins: statsWins,
        losses: statsLosses,
        draws: statsDraws,
      });

      // UNIVERSAL FIX: Fetch ELO directly from teams_v2 (real-time, not from materialized view)
      // This ensures Power Rating always reflects the latest ELO calculation
      // The materialized view can be stale if refresh fails or is delayed
      const { data: eloData } = await supabase
        .from("teams_v2")
        .select("elo_rating, elo_national_rank, elo_state_rank")
        .eq("id", id)
        .single();

      if (eloData) {
        // Override view data with real-time ELO from teams_v2
        setTeam((prev) => prev ? {
          ...prev,
          elo_rating: eloData.elo_rating,
          elo_national_rank: eloData.elo_national_rank,
          elo_state_rank: eloData.elo_state_rank,
        } : prev);
      }

      // Fetch rank history from V2 for My Team's Journey
      // UNIVERSAL: Fetch current season data, let chart filter to valid entries

      const { data: historyData, error: historyError } = await supabase
        .from("rank_history_v2")
        .select("snapshot_date, national_rank, state_rank, elo_rating, elo_national_rank, elo_state_rank")
        .eq("team_id", id)
        .gte("snapshot_date", seasonStart) // Current season only
        .order("snapshot_date", { ascending: true });

      if (!historyError && historyData) {
        setRankHistory(historyData as RankHistoryPoint[]);
      } else if (historyError) {
        // Columns might not exist yet - try without them
        const { data: fallbackData } = await supabase
          .from("rank_history_v2")
          .select("snapshot_date, national_rank, state_rank, elo_rating")
          .eq("team_id", id)
          .gte("snapshot_date", seasonStart)
          .order("snapshot_date", { ascending: true });

        if (fallbackData) {
          const mapped = fallbackData.map((h: any) => ({
            ...h,
            elo_national_rank: null,
            elo_state_rank: null,
          }));
          setRankHistory(mapped as RankHistoryPoint[]);
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

  // Split matches into recent (played) and upcoming (scheduled)
  // Determine by: if match has scores OR date is in past -> recent; else -> upcoming
  const { recentMatches, upcomingMatches } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Compare dates only, not times
    const recent: MatchData[] = [];
    const upcoming: MatchData[] = [];

    allMatches.forEach((match) => {
      const hasScores = match.home_score !== null && match.away_score !== null &&
                        (match.home_score > 0 || match.away_score > 0);

      if (match.match_date) {
        const matchDate = new Date(match.match_date);
        matchDate.setHours(0, 0, 0, 0);

        // If match has real scores OR date is in the past -> it's a recent/played match
        if (hasScores || matchDate < now) {
          recent.push(match);
        } else {
          // Future date with no scores -> upcoming
          upcoming.push(match);
        }
      } else {
        // No date -> put in recent
        recent.push(match);
      }
    });

    // Sort upcoming by date ascending (soonest first)
    upcoming.sort((a, b) => {
      const dateA = new Date(a.match_date || 0);
      const dateB = new Date(b.match_date || 0);
      return dateA.getTime() - dateB.getTime();
    });

    return { recentMatches: recent, upcomingMatches: upcoming };
  }, [allMatches]);

  // Calculate stats - UNIVERSAL FIX: Always use real-time data from matches_v2
  // This ensures Season Stats always matches the actual match data displayed in Match History
  // Never trust pre-computed values from app_team_profile which may be stale
  const calculatedStats = useMemo((): CalculatedStats => {
    // Primary source: seasonStats from direct matches_v2 query (full season, real-time)
    if (seasonStats && seasonStats.matchesPlayed > 0) {
      const winPct = seasonStats.matchesPlayed > 0
        ? ((seasonStats.wins / seasonStats.matchesPlayed) * 100).toFixed(0)
        : "0";
      return {
        matchesPlayed: seasonStats.matchesPlayed,
        wins: seasonStats.wins,
        losses: seasonStats.losses,
        draws: seasonStats.draws,
        winPercentage: `${winPct}%`,
        source: "calculated", // From real-time matches_v2 query
      };
    }

    // Fallback: Calculate from recentMatches (for initial render before seasonStats loads)
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
  }, [seasonStats, recentMatches, id]);

  const hasAnyBadge = useMemo(() => {
    return (
      team?.national_award || team?.regional_award || team?.state_cup_award
    );
  }, [team]);

  const hasRankingData = useMemo(() => {
    return team?.national_rank !== null && team?.national_rank !== undefined;
  }, [team]);

  // Group matches by event (leagues and tournaments)
  const { leagueGroups, tournamentGroups } = useMemo(() => {
    const leagues: Map<string, EventGroup> = new Map();
    const tournaments: Map<string, EventGroup> = new Map();

    recentMatches.forEach((match) => {
      const eventId = match.event_id;
      const eventName = match.event_name;
      const isLeague = match.source_type === "league";

      if (!eventId || !eventName) return;

      const targetMap = isLeague ? leagues : tournaments;
      const eventType = isLeague ? "league" : "tournament";

      if (!targetMap.has(eventId)) {
        targetMap.set(eventId, {
          eventId,
          eventName,
          eventType,
          matches: [],
          wins: 0,
          losses: 0,
          draws: 0,
          dateRange: "",
        });
      }

      const group = targetMap.get(eventId)!;
      group.matches.push(match);

      // Calculate result for this team
      if (match.home_score !== null && match.away_score !== null) {
        const isHome = match.home_team_id === id;
        const teamScore = isHome ? match.home_score : match.away_score;
        const oppScore = isHome ? match.away_score : match.home_score;

        if (teamScore > oppScore) group.wins++;
        else if (teamScore < oppScore) group.losses++;
        else group.draws++;
      }
    });

    // Calculate date ranges
    const processGroups = (groups: Map<string, EventGroup>): EventGroup[] => {
      return Array.from(groups.values()).map((group) => {
        const dates = group.matches
          .filter((m) => m.match_date)
          .map((m) => m.match_date!);
        group.dateRange = formatDateRange(dates);
        return group;
      }).sort((a, b) => {
        // Sort by most recent match date
        const aDate = a.matches[0]?.match_date || "";
        const bDate = b.matches[0]?.match_date || "";
        return bDate.localeCompare(aDate);
      });
    };

    return {
      leagueGroups: processGroups(leagues),
      tournamentGroups: processGroups(tournaments),
    };
  }, [recentMatches, id]);

  const getTeamMeta = (): string => {
    if (!team) return "";
    const parts: string[] = [];
    if (isValidValue(team.state)) parts.push(team.state!);
    if (isValidValue(team.gender)) {
      // Convert M/F to Boys/Girls for display
      const g = team.gender!.toUpperCase();
      if (g === "M" || g === "MALE") parts.push("Boys");
      else if (g === "F" || g === "FEMALE") parts.push("Girls");
      else parts.push(team.gender!);
    }
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
        ? "⚽"
        : item.source_type === "tournament"
          ? "🏆"
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

  // Render event card (league or tournament)
  // Layout: 2 lines max - Line 1: Icon + Event name, Line 2: Record + Date + Matches
  const renderEventCard = (group: EventGroup) => {
    const isLeague = group.eventType === "league";
    const icon = isLeague ? "⚽" : "🏆";
    const recordStr = `${group.wins}W-${group.losses}L-${group.draws}D`;
    // Color theme: leagues = blue, tournaments = amber/gold
    const themeColor = isLeague ? "#3B82F6" : "#f59e0b";
    const isExpanded = expandedEvents.has(group.eventId);

    // Toggle expansion
    const handlePress = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setExpandedEvents((prev) => {
        const next = new Set(prev);
        if (next.has(group.eventId)) {
          next.delete(group.eventId);
        } else {
          next.add(group.eventId);
        }
        return next;
      });
    };

    // Sort matches newest to oldest for expanded view
    const sortedMatches = [...group.matches].sort((a, b) => {
      const dateA = a.match_date ? new Date(a.match_date).getTime() : 0;
      const dateB = b.match_date ? new Date(b.match_date).getTime() : 0;
      return dateB - dateA; // newest first
    });

    // Render a single match row within the expanded card
    const renderExpandedMatch = (match: MatchData, isLast: boolean) => {
      const isHome = match.home_team_id === id;
      const teamScore = isHome ? match.home_score : match.away_score;
      const opponentScore = isHome ? match.away_score : match.home_score;
      const opponentName = isHome ? match.away_team_name : match.home_team_name;
      const hasScores = match.home_score !== null && match.away_score !== null;

      // Determine result
      let resultIcon = "⏳"; // scheduled
      let resultColor = "#6b7280";
      if (hasScores) {
        if (teamScore! > opponentScore!) {
          resultIcon = "✓";
          resultColor = "#10B981"; // win - green
        } else if (teamScore! < opponentScore!) {
          resultIcon = "✗";
          resultColor = "#EF4444"; // loss - red
        } else {
          resultIcon = "−";
          resultColor = "#f59e0b"; // draw - amber
        }
      }

      // Format date
      const matchDate = match.match_date
        ? new Date(match.match_date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : "";

      return (
        <TouchableOpacity
          key={match.id}
          style={[
            styles.expandedMatchRow,
            isLast && { borderBottomWidth: 0 },
          ]}
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(`/match/${match.id}`);
          }}
        >
          <Text style={[styles.expandedMatchResult, { color: resultColor }]}>
            {resultIcon}
          </Text>
          <Text style={styles.expandedMatchDate}>{matchDate}</Text>
          <Text style={styles.expandedMatchVs}>vs</Text>
          <Text style={styles.expandedMatchOpponent}>{opponentName ?? "TBD"}</Text>
          <Text style={styles.expandedMatchScore}>
            {hasScores ? `${teamScore}-${opponentScore}` : "—"}
          </Text>
        </TouchableOpacity>
      );
    };

    return (
      <View key={group.eventId}>
        <TouchableOpacity
          style={[
            styles.eventCard,
            isExpanded && styles.eventCardExpanded,
          ]}
          activeOpacity={0.7}
          onPress={handlePress}
        >
          <Ionicons
            name={isExpanded ? "chevron-down" : "chevron-forward"}
            size={18}
            color="#4b5563"
            style={styles.eventChevron}
          />
          <View style={styles.eventIcon}>
            <Text style={{ fontSize: 22 }}>{icon}</Text>
          </View>
          <View style={styles.eventInfo}>
            {/* Line 1: Event name - NEVER truncate (Principle 4) */}
            <Text style={styles.eventName}>{group.eventName}</Text>
            {/* Line 2: Record badge + date + match count - all inline */}
            <View style={styles.eventMetaRow}>
              <View style={[
                styles.eventRecordInline,
                {
                  backgroundColor: isLeague ? "rgba(59, 130, 246, 0.15)" : "rgba(245, 158, 11, 0.15)",
                }
              ]}>
                <Text style={[styles.eventRecordTextInline, { color: themeColor }]}>{recordStr}</Text>
              </View>
              <Text style={styles.eventMeta}>
                {group.dateRange} · {group.matches.length} matches
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Expanded matches list */}
        {isExpanded && (
          <View style={styles.expandedMatchesContainer}>
            {sortedMatches.map((match, idx) => renderExpandedMatch(match, idx === sortedMatches.length - 1))}
          </View>
        )}
      </View>
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

        {/* Season Stats - Prominent position right under team name */}
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
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: "#6b7280" }]}>
              {calculatedStats.draws}
            </Text>
            <Text style={styles.statLabel}>Draws</Text>
          </View>
        </View>

        {/* Power Rating Card */}
        <View style={styles.powerRatingCard}>
          <View style={styles.powerRatingHeader}>
            <View style={styles.powerRatingTitleRow}>
              <Image
                source={require("../../assets/images/icon.png")}
                style={styles.powerRatingLogo}
              />
              <View>
                <Text style={styles.powerRatingCardTitle}>SoccerView Power Rating</Text>
                <Text style={styles.powerRatingSubtitle}>ELO-based national rankings</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.helpButton}
              onPress={() => setShowRatingsHelp(true)}
            >
              <Ionicons name="help-circle-outline" size={18} color="#6b7280" />
            </TouchableOpacity>
          </View>
          <View style={styles.powerRatingContent}>
            <Text style={[styles.powerRatingGrade, { color }]}>{grade}</Text>
            <View style={styles.powerRatingStats}>
              <View style={styles.powerRatingStat}>
                <Text style={styles.powerRatingStatValue}>{formatNumber(elo)}</Text>
                <Text style={styles.powerRatingStatLabel}>Rating</Text>
              </View>
              <View style={styles.powerRatingStatDivider} />
              <View style={styles.powerRatingStat}>
                <Text style={styles.powerRatingStatValue}>
                  {team.elo_national_rank ? `#${formatNumber(team.elo_national_rank)}` : "—"}
                </Text>
                <Text style={styles.powerRatingStatLabel}>National</Text>
              </View>
              <View style={styles.powerRatingStatDivider} />
              <View style={styles.powerRatingStat}>
                <Text style={styles.powerRatingStatValue}>
                  {team.elo_state_rank ? `#${formatNumber(team.elo_state_rank)}` : "—"}
                </Text>
                <Text style={styles.powerRatingStatLabel}>State</Text>
              </View>
            </View>
          </View>
        </View>

        {/* GotSport Rankings Card (Combined with Ranking Journey) */}
        {hasRankingData && (
          <View style={styles.gotsportCard}>
            {/* Header */}
            <View style={styles.gotsportHeader}>
              <View style={styles.gotsportTitleRow}>
                <View style={styles.iconContainer}>
                  <Text style={styles.gotsportIcon}>🏆</Text>
                </View>
                <View>
                  <Text style={styles.gotsportTitle}>GotSport Rankings</Text>
                  <Text style={styles.gotsportSubtitle}>Points-based national rankings</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.helpButton}
                onPress={() => setShowRatingsHelp(true)}
              >
                <Ionicons name="help-circle-outline" size={18} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {/* National & State Ranks - Centered */}
            <View style={styles.gotsportRanksRow}>
              <View style={styles.gotsportRankItem}>
                <Text style={styles.gotsportRankValue}>
                  #{formatNumber(team.national_rank)}
                </Text>
                <Text style={styles.gotsportRankLabel}>National</Text>
              </View>
              {team.state_rank && (
                <View style={styles.gotsportRankItem}>
                  <Text style={styles.gotsportStateValue}>
                    #{formatNumber(team.state_rank)}
                  </Text>
                  <Text style={styles.gotsportRankLabel}>State</Text>
                </View>
              )}
            </View>

          </View>
        )}

        {/* Ranking Journey Card - World-class dual-filter design */}
        {(rankHistory.length > 0 || team.elo_rating) && (
          <View style={styles.rankingJourneyCard}>
            {/* Header */}
            <View style={styles.rankingJourneyHeader}>
              <View style={styles.rankingJourneyTitleRow}>
                <View style={styles.rankingJourneyIconWrap}>
                  <Ionicons name="trending-up" size={20} color="#fff" />
                </View>
                <View>
                  <Text style={styles.rankingJourneyTitle}>Ranking Journey</Text>
                  <Text style={styles.rankingJourneySubtitle}>
                    Track your team's rank over time
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.helpButton}
                onPress={() => setShowRatingsHelp(true)}
              >
                <Ionicons name="help-circle-outline" size={18} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {/* Source Selector - Clean text-only segmented control */}
            <View style={styles.sourceSelector}>
              <Text style={styles.filterLabel}>Source</Text>
              <View style={styles.sourceSegment}>
                <TouchableOpacity
                  style={[styles.sourceSegmentBtn, journeySource === "sv" && styles.sourceSegmentBtnActiveSV]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setJourneySource("sv");
                  }}
                >
                  <Text style={[
                    styles.sourceSegmentText,
                    journeySource === "sv" ? styles.sourceSegmentTextActive : { color: "#3B82F6" }
                  ]}>
                    SoccerView
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sourceSegmentBtn, journeySource === "gs" && styles.sourceSegmentBtnActiveGS]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setJourneySource("gs");
                  }}
                >
                  <Text style={[
                    styles.sourceSegmentText,
                    journeySource === "gs" ? styles.sourceSegmentTextActive : { color: "#f59e0b" }
                  ]}>
                    GotSport
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sourceSegmentBtn, journeySource === "both" && styles.sourceSegmentBtnActiveBoth]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setJourneySource("both");
                  }}
                >
                  <Text style={[
                    styles.sourceSegmentText,
                    journeySource === "both" ? styles.sourceSegmentTextActive : { color: "#10b981" }
                  ]}>
                    Compare
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Scope Selector - Secondary (National / State) */}
            <View style={styles.scopeSelector}>
              <Text style={styles.filterLabel}>Scope</Text>
              <View style={styles.scopeToggle}>
                <TouchableOpacity
                  style={[styles.scopeBtn, journeyScope === "national" && styles.scopeBtnActive]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setJourneyScope("national");
                  }}
                >
                  <Ionicons name="globe-outline" size={14} color={journeyScope === "national" ? "#fff" : "#6b7280"} />
                  <Text style={[styles.scopeBtnText, journeyScope === "national" && styles.scopeBtnTextActive]}>
                    National
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.scopeBtn, journeyScope === "state" && styles.scopeBtnActive]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setJourneyScope("state");
                  }}
                >
                  <Ionicons name="location-outline" size={14} color={journeyScope === "state" ? "#fff" : "#6b7280"} />
                  <Text style={[styles.scopeBtnText, journeyScope === "state" && styles.scopeBtnTextActive]}>
                    State
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Current Selection Badge */}
            <View style={styles.selectionBadge}>
              <Text style={styles.selectionBadgeText}>
                {journeySource === "sv" ? "SoccerView" : journeySource === "gs" ? "GotSport" : "Compare"} · {journeyScope === "national" ? "National" : "State"} Rank
              </Text>
            </View>

            {/* Stats & Chart based on selection */}
            {(() => {
              // Get rank based on source and scope
              const getSVRank = (h: RankHistoryPoint) => journeyScope === "national" ? h.elo_national_rank : h.elo_state_rank;
              const getGSRank = (h: RankHistoryPoint) => journeyScope === "national" ? h.national_rank : h.state_rank;

              // Filter valid points - use actual rank data if available, fall back to ELO
              const svRankPoints = rankHistory.filter((p) => getSVRank(p) !== null);
              const svEloPoints = rankHistory.filter((p) => p.elo_rating !== null);
              const gsPoints = rankHistory.filter((p) => getGSRank(p) !== null);

              // SoccerView: Use actual rank history if available
              const hasSVRankHistory = svRankPoints.length >= 2;
              const svRanks = svRankPoints.map((p) => getSVRank(p) as number);
              const svCurrentRank = journeyScope === "national" ? team?.elo_national_rank : team?.elo_state_rank;
              const svBestRank = svRanks.length > 0 ? Math.min(...svRanks) : null;

              // GotSport: Direct rank history
              const gsRanks = gsPoints.map((p) => getGSRank(p) as number);
              const gsCurrent = gsRanks.length > 0 ? gsRanks[gsRanks.length - 1] : (journeyScope === "national" ? team?.national_rank : team?.state_rank);
              const gsBest = gsRanks.length > 0 ? Math.min(...gsRanks) : null;

              return (
                <>
                  {/* Stats Row */}
                  <View style={styles.rankingStatsRow}>
                    {journeySource === "sv" && (
                      <View style={styles.rankingStat}>
                        <Text style={[styles.rankingStatValue, { color: "#3B82F6" }]}>
                          {svCurrentRank ? `#${formatNumber(svCurrentRank)}` : "—"}
                        </Text>
                        <Text style={styles.rankingStatLabel}>
                          {journeyScope === "national" ? "National Rank" : "State Rank"}
                        </Text>
                      </View>
                    )}
                    {journeySource === "gs" && (
                      <>
                        <View style={styles.rankingStat}>
                          <Text style={[styles.rankingStatValue, { color: "#f59e0b" }]}>
                            {gsCurrent ? `#${formatNumber(gsCurrent)}` : "—"}
                          </Text>
                          <Text style={styles.rankingStatLabel}>Current</Text>
                        </View>
                        {gsBest && gsPoints.length >= 2 && (
                          <View style={styles.rankingStat}>
                            <Text style={[styles.rankingStatValue, { color: "#22c55e" }]}>
                              #{formatNumber(gsBest)}
                            </Text>
                            <Text style={styles.rankingStatLabel}>Best</Text>
                          </View>
                        )}
                      </>
                    )}
                    {journeySource === "both" && (
                      <>
                        <View style={styles.rankingStat}>
                          <Text style={[styles.rankingStatValue, { color: "#3B82F6" }]}>
                            {svCurrentRank ? `#${formatNumber(svCurrentRank)}` : "—"}
                          </Text>
                          <Text style={styles.rankingStatLabel}>SoccerView</Text>
                        </View>
                        <View style={styles.rankingStat}>
                          <Text style={[styles.rankingStatValue, { color: "#f59e0b" }]}>
                            {gsCurrent ? `#${formatNumber(gsCurrent)}` : "—"}
                          </Text>
                          <Text style={styles.rankingStatLabel}>GotSport</Text>
                        </View>
                      </>
                    )}
                  </View>

                  {/* Chart */}
                  {(() => {
                    const hasGSData = gsPoints.length >= 2;
                    const maxPoints = 8;
                    const source = journeySource; // Capture for TypeScript

                    // SoccerView chart - shows RANK history (lower rank = better)
                    if (source === "sv") {
                      // Check if we have valid rank history data (from daily captures)
                      const hasSVRankData = svRankPoints.length >= 2;

                      if (!hasSVRankData) {
                        return (
                          <View style={styles.rankingChartPlaceholder}>
                            <Ionicons name="analytics-outline" size={32} color="#3B82F6" />
                            <Text style={styles.rankingChartPlaceholderTitle}>Rank History</Text>
                            <Text style={styles.rankingChartPlaceholderText}>
                              Building rank history...{"\n"}Check back in a few days
                            </Text>
                          </View>
                        );
                      }

                      // Sort by date and take only RECENT data (last maxPoints entries)
                      // This excludes old/bad data that skews the range
                      const sorted = [...svRankPoints].sort((a, b) =>
                        new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
                      );
                      const sampled = sorted.slice(-maxPoints);

                      // Filter out null ranks and pair with labels
                      const validData = sampled
                        .map((p) => {
                          const d = new Date(p.snapshot_date);
                          const rank = getSVRank(p);
                          return {
                            label: `${d.getMonth() + 1}/${d.getDate()}`,
                            rank: rank && rank > 0 ? rank : null,
                          };
                        })
                        .filter((item): item is { label: string; rank: number } => item.rank !== null);

                      if (validData.length < 2) {
                        return (
                          <View style={styles.rankingChartPlaceholder}>
                            <Ionicons name="analytics-outline" size={32} color="#3B82F6" />
                            <Text style={styles.rankingChartPlaceholderTitle}>Rank History</Text>
                            <Text style={styles.rankingChartPlaceholderText}>
                              Building rank history...{"\n"}Check back in a few days
                            </Text>
                          </View>
                        );
                      }

                      const labels = validData.map((item) => item.label);
                      const ranks = validData.map((item) => item.rank);

                      return (
                        <View style={styles.rankingChartContainer}>
                          <RankLineChart
                            labels={labels}
                            ranks={ranks}
                            color="#3B82F6"
                            fillColor="#3B82F6"
                          />
                          <Text style={styles.rankingChartNote}>
                            Up = better rank · #1 is best
                          </Text>
                        </View>
                      );
                    }

                    // GotSport chart
                    if (source === "gs") {
                      if (!hasGSData) {
                        return (
                          <View style={styles.rankingChartPlaceholder}>
                            <Text style={styles.rankingChartPlaceholderEmoji}>🏆</Text>
                            <Text style={styles.rankingChartPlaceholderTitle}>GotSport Rankings</Text>
                            <Text style={styles.rankingChartPlaceholderText}>
                              {gsPoints.length} day{gsPoints.length !== 1 ? "s" : ""} of data{"\n"}Need 2+ days for chart
                            </Text>
                          </View>
                        );
                      }
                      // Sort by date and take only RECENT data (last maxPoints entries)
                      const sorted = [...gsPoints].sort((a, b) =>
                        new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
                      );
                      const sampled = sorted.slice(-maxPoints);

                      // Filter out null ranks and pair with labels
                      const validData = sampled
                        .map((p) => {
                          const d = new Date(p.snapshot_date);
                          const rank = getGSRank(p);
                          return {
                            label: `${d.getMonth() + 1}/${d.getDate()}`,
                            rank: rank && rank > 0 ? rank : null,
                          };
                        })
                        .filter((item): item is { label: string; rank: number } => item.rank !== null);

                      if (validData.length < 2) {
                        return (
                          <View style={styles.rankingChartPlaceholder}>
                            <Text style={styles.rankingChartPlaceholderEmoji}>🏆</Text>
                            <Text style={styles.rankingChartPlaceholderTitle}>GotSport Rankings</Text>
                            <Text style={styles.rankingChartPlaceholderText}>
                              Need more GotSport data{"\n"}Check back in a few days
                            </Text>
                          </View>
                        );
                      }

                      const labels = validData.map((item) => item.label);
                      const ranks = validData.map((item) => item.rank);

                      return (
                        <View style={styles.rankingChartContainer}>
                          <RankLineChart
                            labels={labels}
                            ranks={ranks}
                            color="#f59e0b"
                            fillColor="#f59e0b"
                          />
                          <Text style={styles.rankingChartNote}>
                            Up = better rank · #1 is best
                          </Text>
                        </View>
                      );
                    }

                    // Compare - Using ChartKitLineChart (react-native-chart-kit)
                    // gifted-charts had issues with multiple lines - chart-kit works reliably
                    if (!hasSVRankHistory && !hasGSData) {
                      return (
                        <View style={styles.rankingChartPlaceholder}>
                          <Ionicons name="git-compare" size={32} color="#10b981" />
                          <Text style={styles.rankingChartPlaceholderTitle}>Comparison View</Text>
                          <Text style={styles.rankingChartPlaceholderText}>
                            Need more data for comparison{"\n"}Check back soon!
                          </Text>
                        </View>
                      );
                    }

                    // Combine all dates from both sources
                    const allDates = [...new Set([
                      ...svRankPoints.map(p => p.snapshot_date),
                      ...gsPoints.map(p => p.snapshot_date)
                    ])].sort();

                    // Sample ~7 points
                    const sampleStep = Math.max(1, Math.floor(allDates.length / 7));
                    const sampledDates = allDates.filter((_, i) => i % sampleStep === 0 || i === allDates.length - 1);

                    // Build date labels
                    const dateLabels = sampledDates.map(d => {
                      const date = new Date(d);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    });

                    // Get min/max for Y-axis (INVERTED - lower rank = higher on chart)
                    const allRanks = [
                      ...svRankPoints.map(p => getSVRank(p)).filter((r): r is number => r != null),
                      ...gsPoints.map(p => getGSRank(p)).filter((r): r is number => r != null)
                    ];

                    if (allRanks.length === 0) {
                      return (
                        <View style={styles.rankingChartPlaceholder}>
                          <Ionicons name="git-compare" size={32} color="#10b981" />
                          <Text style={styles.rankingChartPlaceholderTitle}>Comparison View</Text>
                          <Text style={styles.rankingChartPlaceholderText}>Not enough data yet</Text>
                        </View>
                      );
                    }

                    const minRank = Math.min(...allRanks);
                    const maxRank = Math.max(...allRanks);
                    const padding = Math.max(50, (maxRank - minRank) * 0.1);
                    const displayMin = Math.max(1, minRank - padding);
                    const displayMax = maxRank + padding;

                    // Normalize function (INVERTS so rank #1 is at top)
                    const normalize = (rank: number) => displayMax - rank + displayMin;

                    // Build SV data (forward-fill)
                    let lastSV: number | null = null;
                    const svNormalizedData = sampledDates.map(d => {
                      const point = svRankPoints.find(p => p.snapshot_date <= d);
                      // Find the latest point up to this date
                      const matchingPoints = svRankPoints.filter(p => p.snapshot_date <= d);
                      const latestPoint = matchingPoints.length > 0 ? matchingPoints[matchingPoints.length - 1] : null;
                      if (latestPoint && getSVRank(latestPoint)) lastSV = getSVRank(latestPoint);
                      return lastSV ? normalize(lastSV) : normalize(displayMax);
                    });

                    // Build GS data (forward-fill from FIRST available value)
                    const firstGSPoint = gsPoints.find(p => getGSRank(p) != null);
                    const firstGSRank = firstGSPoint ? getGSRank(firstGSPoint) : null;
                    let lastGS = firstGSRank;
                    const gsNormalizedData = sampledDates.map(d => {
                      const matchingPoints = gsPoints.filter(p => p.snapshot_date <= d);
                      const latestPoint = matchingPoints.length > 0 ? matchingPoints[matchingPoints.length - 1] : null;
                      if (latestPoint && getGSRank(latestPoint)) lastGS = getGSRank(latestPoint);
                      return lastGS ? normalize(lastGS) : normalize(displayMax);
                    });

                    // Format Y labels back to rank display
                    const formatCompareYLabel = (normalizedValue: string) => {
                      const val = parseFloat(normalizedValue);
                      const rank = displayMax - val + displayMin;
                      if (rank >= 1000) return `#${(rank / 1000).toFixed(1)}k`;
                      return `#${Math.round(rank)}`;
                    };

                    const compareChartWidth = SCREEN_WIDTH - 48;

                    return (
                      <View style={styles.rankingChartContainer}>
                        <ChartKitLineChart
                          data={{
                            labels: dateLabels,
                            datasets: [
                              {
                                data: svNormalizedData,
                                color: () => "#3B82F6",
                                strokeWidth: 2.5,
                              },
                              {
                                data: gsNormalizedData,
                                color: () => "#f59e0b",
                                strokeWidth: 3,
                              },
                            ],
                          }}
                          width={compareChartWidth}
                          height={180}
                          chartConfig={{
                            backgroundColor: "transparent",
                            backgroundGradientFrom: "#1a1a2e",
                            backgroundGradientTo: "#1a1a2e",
                            decimalPlaces: 0,
                            color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
                            labelColor: () => "#6b7280",
                            propsForDots: {
                              r: "4",
                            },
                            propsForBackgroundLines: {
                              stroke: "transparent",
                            },
                          }}
                          bezier
                          withHorizontalLabels={true}
                          withVerticalLabels={true}
                          withDots={true}
                          withShadow={false}
                          fromZero={false}
                          formatYLabel={formatCompareYLabel}
                          style={{ borderRadius: 8 }}
                        />
                        <Text style={styles.compareChartNote}>
                          Up = better rank · GotSport line flat until data available
                        </Text>
                      </View>
                    );
                  })()}
                </>
              );
            })()}
          </View>
        )}

        {/* League Standings Card - Only show if team has league matches */}
        {leagueGroups.length > 0 && (
          <TouchableOpacity
            style={styles.leagueStandingsCard}
            activeOpacity={0.8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push(`/league/${leagueGroups[0].eventId}`);
            }}
          >
            <View style={styles.leagueStandingsIcon}>
              <View style={styles.leagueStandingsBarChart}>
                <View style={[styles.leagueStandingsBar, { height: 10 }]} />
                <View style={[styles.leagueStandingsBar, { height: 16 }]} />
                <View style={[styles.leagueStandingsBar, { height: 12 }]} />
              </View>
            </View>
            <View style={styles.leagueStandingsContent}>
              <Text style={styles.leagueStandingsTitle}>League Standings</Text>
              <Text style={styles.leagueStandingsLeagueName}>{leagueGroups[0].eventName}</Text>
              <Text style={styles.leagueStandingsSubtitle}>See where this team ranks in their league</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#4b5563" />
          </TouchableOpacity>
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

        {activeTab === "recent" ? (
          <View style={styles.matchesList}>
            {recentMatches.length === 0 ? (
              <View style={styles.emptyMatches}>
                <Ionicons name="calendar-outline" size={32} color="#4b5563" />
                <Text style={styles.emptyText}>No recent matches found</Text>
                <Text style={styles.emptySubtext}>Match history will appear here</Text>
              </View>
            ) : (
              <>
                {/* Leagues Section */}
                {leagueGroups.length > 0 && (
                  <>
                    <View style={styles.eventSectionHeader}>
                      <Ionicons name="stats-chart" size={18} color="#3B82F6" />
                      <Text style={styles.eventSectionTitle}>Leagues</Text>
                    </View>
                    {leagueGroups.map(renderEventCard)}
                  </>
                )}

                {/* Tournaments Section */}
                {tournamentGroups.length > 0 && (
                  <>
                    <View style={styles.eventSectionHeader}>
                      <Text style={styles.eventSectionIcon}>🏆</Text>
                      <Text style={styles.tournamentSectionTitle}>Tournaments</Text>
                    </View>
                    {tournamentGroups.map(renderEventCard)}
                  </>
                )}

                {/* Ungrouped matches (no event) */}
                {leagueGroups.length === 0 && tournamentGroups.length === 0 && (
                  recentMatches.map((match) => renderRecentMatch({ item: match }))
                )}
              </>
            )}
          </View>
        ) : (
          <View style={styles.matchesList}>
            {upcomingMatches.length === 0 ? (
              <View style={styles.emptyMatches}>
                <Ionicons name="calendar-outline" size={32} color="#4b5563" />
                <Text style={styles.emptyText}>No upcoming matches scheduled</Text>
                <Text style={styles.emptySubtext}>Future games will show here when scheduled</Text>
              </View>
            ) : (
              upcomingMatches.map((match) => renderUpcomingMatch({ item: match }))
            )}
          </View>
        )}

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
    borderWidth: 2,
    borderColor: "rgba(59, 130, 246, 0.6)",
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  powerRatingHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  powerRatingTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  powerRatingLogo: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  powerRatingCardTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  powerRatingSubtitle: {
    color: "#3B82F6",
    fontSize: 11,
    marginTop: 2,
  },
  powerRatingContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  powerRatingGrade: { fontSize: 32, fontWeight: "bold" },
  powerRatingStats: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  powerRatingStat: {
    alignItems: "center",
  },
  powerRatingStatValue: {
    color: "#3B82F6",
    fontSize: 16,
    fontWeight: "700",
  },
  powerRatingStatLabel: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 2,
  },
  powerRatingStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  helpButton: { padding: 4 },

  // GotSport Rankings Card (Combined)
  gotsportCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "rgba(245, 158, 11, 0.6)",
    shadowColor: "#f59e0b",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  gotsportHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  gotsportTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconContainer: {
    width: 28,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },
  gotsportIcon: { fontSize: 22 },
  barChartIcon: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    width: 22,
    height: 22,
    justifyContent: "center",
    shadowColor: "#f59e0b",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  barChartBar: {
    width: 6,
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "#f59e0b",
    borderRadius: 2,
  },
  gotsportTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  gotsportSubtitle: {
    color: "#f59e0b",
    fontSize: 11,
    marginTop: 2,
  },
  gotsportRanksRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 48,
    marginBottom: 20,
  },
  gotsportRankItem: {
    alignItems: "center",
  },
  gotsportRankValue: {
    color: "#f59e0b",
    fontSize: 24,
    fontWeight: "bold",
  },
  gotsportRankLabel: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  gotsportStateValue: {
    color: "#f59e0b",
    fontSize: 24,
    fontWeight: "bold",
  },

  // Ranking Journey Section (inside GotSport card)
  journeySection: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingTop: 16,
  },
  journeySectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  journeyTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  journeyIcon: { fontSize: 18 },
  journeyTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  journeySubtitleText: { color: "#6b7280", fontSize: 11, marginTop: 1 },
  journeyStatsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 16,
  },
  journeyStat: {
    alignItems: "center",
  },
  journeyStatValue: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  journeyStatLabel: {
    color: "#6b7280",
    fontSize: 10,
    marginTop: 2,
  },
  journeyChartContainer: {
    marginTop: 8,
    alignItems: "center",
  },
  journeyChart: {
    borderRadius: 12,
    marginLeft: -16,
  },
  journeyChartPlaceholder: {
    height: 60,
    justifyContent: "center",
  },
  journeyChartLine: {
    height: 4,
    backgroundColor: "#f59e0b",
    borderRadius: 2,
    marginVertical: 16,
  },
  journeyChartNote: {
    color: "#6b7280",
    fontSize: 10,
    textAlign: "center",
    marginTop: 8,
  },

  // Journey Card (standalone)
  journeyCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "rgba(59, 130, 246, 0.4)",
  },

  // Journey Toggle Buttons
  journeyToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
    gap: 4,
  },
  journeyToggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
  },
  journeyToggleBtnActive: {
    backgroundColor: "#3B82F6",
  },
  journeyToggleBtnActiveGold: {
    backgroundColor: "#f59e0b",
  },
  journeyToggleText: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "600",
  },
  journeyToggleTextActive: {
    color: "#000",
  },
  journeyToggleTextActiveGold: {
    color: "#000",
  },
  journeyToggleBtnActiveBoth: {
    backgroundColor: "#10b981",
  },
  journeyToggleTextActiveBoth: {
    color: "#000",
  },
  journeySubtitleBoth: {
    color: "#10b981",
    fontSize: 11,
    marginTop: 2,
  },

  // Overlay Legend
  overlayLegend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    marginTop: 8,
    marginBottom: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: "#9ca3af",
    fontSize: 11,
  },

  // ============================================================================
  // RANKING JOURNEY CARD - World-class dual-filter design
  // ============================================================================
  rankingJourneyCard: {
    backgroundColor: "#0a0a0a",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "rgba(139, 92, 246, 0.35)",
    shadowColor: "#8b5cf6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  rankingJourneyHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  rankingJourneyTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rankingJourneyIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(59, 130, 246, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  rankingJourneyTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  rankingJourneySubtitle: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },

  // Source Selector (Segmented Control)
  sourceSelector: {
    marginBottom: 16,
  },
  filterLabel: {
    color: "#6b7280",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  sourceSegment: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  sourceSegmentBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  sourceSegmentBtnActiveSV: {
    backgroundColor: "#3B82F6",
  },
  sourceSegmentBtnActiveGS: {
    backgroundColor: "#f59e0b",
  },
  sourceSegmentBtnActiveBoth: {
    backgroundColor: "#10b981",
  },
  sourceSegmentText: {
    fontSize: 12,
    fontWeight: "600",
  },
  sourceSegmentTextActive: {
    color: "#fff",
  },

  // Scope Selector (Secondary)
  scopeSelector: {
    marginBottom: 16,
  },
  scopeToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 10,
    padding: 4,
  },
  scopeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  scopeBtnActive: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  scopeBtnText: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "600",
  },
  scopeBtnTextActive: {
    color: "#fff",
  },

  // Selection Badge
  selectionBadge: {
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  selectionBadgeText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "500",
  },

  // Ranking Stats Row
  rankingStatsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  rankingStat: {
    alignItems: "center",
  },
  rankingStatValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  rankingStatLabel: {
    color: "#6b7280",
    fontSize: 10,
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Ranking Chart
  rankingChartContainer: {
    alignItems: "center",
    width: "100%",
  },
  rankingChart: {
    borderRadius: 12,
    marginLeft: -16,
  },
  rankingChartPlaceholder: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  rankingChartPlaceholderEmoji: {
    fontSize: 32,
  },
  rankingChartPlaceholderTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 8,
  },
  rankingChartPlaceholderText: {
    color: "#6b7280",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
  rankingChartNote: {
    color: "#6b7280",
    fontSize: 11,
    textAlign: "center",
    marginTop: 12,
  },

  // Comparison Legend
  comparisonLegend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    marginTop: 12,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendLine: {
    width: 16,
    height: 3,
    borderRadius: 2,
  },
  legendLabel: {
    color: "#9ca3af",
    fontSize: 12,
  },

  // Compare Chart
  compareChartNote: {
    color: "#6b7280",
    fontSize: 11,
    textAlign: "center",
    marginTop: 8,
  },

  // Legacy styles (kept for compatibility)
  goalItem: { alignItems: "center", flex: 1 },
  goalValue: { color: "#fff", fontSize: 18, fontWeight: "600" },
  goalLabel: { color: "#6b7280", fontSize: 10, marginTop: 2 },

  // League Standings Card
  leagueStandingsCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "rgba(59, 130, 246, 0.4)",
  },
  leagueStandingsIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  leagueStandingsBarChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    width: 24,
    height: 20,
    justifyContent: "center",
  },
  leagueStandingsBar: {
    width: 6,
    backgroundColor: "#3B82F6",
    borderRadius: 2,
  },
  leagueStandingsContent: {
    flex: 1,
  },
  leagueStandingsTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  leagueStandingsLeagueName: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  leagueStandingsSubtitle: {
    color: "#6b7280",
    fontSize: 12,
  },

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
    justifyContent: "space-between",
    marginBottom: 24,
  },
  statBox: {
    width: "23%",
    backgroundColor: "#111",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  statValue: { color: "#fff", fontSize: 22, fontWeight: "bold" },
  statLabel: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 4,
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

  // Event Section (Leagues/Tournaments)
  eventSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    marginBottom: 12,
    gap: 8,
  },
  eventSectionIcon: { fontSize: 18 },
  eventSectionTitle: {
    color: "#3B82F6",
    fontSize: 16,
    fontWeight: "700",
  },
  tournamentSectionTitle: {
    color: "#f59e0b",
    fontSize: 16,
    fontWeight: "700",
  },

  // Event Card (League/Tournament) - 2-line layout: Name on line 1, Record+Meta on line 2
  eventCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 10,
  },
  eventChevron: {
    marginRight: 6,
    marginTop: 4,
  },
  eventIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.05)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  eventInfo: {
    flex: 1,
  },
  eventName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
    lineHeight: 20,
  },
  eventMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  eventMeta: {
    color: "#6b7280",
    fontSize: 12,
  },
  eventRecordInline: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  eventRecordTextInline: {
    fontSize: 11,
    fontWeight: "700",
  },
  // Legacy styles kept for compatibility
  eventRecord: {
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  eventRecordText: {
    color: "#3B82F6",
    fontSize: 12,
    fontWeight: "700",
  },
  // Expanded card style (removes bottom margin when expanded)
  eventCardExpanded: {
    marginBottom: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  // Expanded matches container
  expandedMatchesContainer: {
    backgroundColor: "#0a0a0a",
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: "rgba(255,255,255,0.08)",
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  expandedMatchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  expandedMatchResult: {
    width: 20,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  expandedMatchDate: {
    width: 50,
    color: "#6b7280",
    fontSize: 12,
    marginLeft: 4,
  },
  expandedMatchVs: {
    color: "#4b5563",
    fontSize: 11,
    marginHorizontal: 6,
  },
  expandedMatchOpponent: {
    flex: 1,
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  expandedMatchScore: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "600",
    minWidth: 40,
    textAlign: "right",
  },

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
