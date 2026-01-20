import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

// ============================================================
// TYPES - Updated for match_results table
// ============================================================

type MatchRow = {
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

type TeamInfo = {
  id: string;
  team_name: string;
  elo_rating: number | null;
  national_rank: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  goals_for: number | null;
  goals_against: number | null;
} | null;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function isValidValue(v: any): boolean {
  if (v === null || v === undefined) return false;
  const str = String(v).trim();
  return str.length > 0 && str !== "??" && str !== "TBD";
}

function formatDate(value: any): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: any): string {
  if (!value) return "";
  // If it's a time string like "14:30:00", format it
  if (typeof value === "string" && value.includes(":")) {
    const parts = value.split(":");
    const hours = parseInt(parts[0], 10);
    const mins = parts[1];
    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    return `${hour12}:${mins} ${ampm}`;
  }
  // If it's a date string, extract time
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Get match type badge (no platform branding)
function getMatchTypeBadge(
  sourceType: string | null,
): { emoji: string; label: string } | null {
  if (!sourceType) return null;
  const type = sourceType.toLowerCase();
  if (type === "league") return { emoji: "🏆", label: "League Match" };
  if (type === "tournament") return { emoji: "⚽", label: "Tournament" };
  return null;
}

// Determine actual match status based on data
function getMatchStatus(match: MatchRow): "completed" | "upcoming" | "live" {
  const hasScore = match.home_score !== null && match.away_score !== null;

  // If we have scores, match is completed
  if (hasScore) return "completed";

  // Check date
  if (match.match_date) {
    const matchDate = new Date(match.match_date);
    const now = new Date();
    if (matchDate > now) return "upcoming";
  }

  // Default based on status field
  if (match.status === "scheduled") return "upcoming";
  if (match.status === "live") return "live";

  return "upcoming";
}

// Get team initials for badge
function getInitials(name: string): string {
  const words = name.split(" ").filter((w) => w.length > 0);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// Get ELO grade
function getEloGrade(elo: number): { grade: string; color: string } {
  if (elo >= 1650) return { grade: "A+", color: "#22c55e" };
  if (elo >= 1600) return { grade: "A", color: "#22c55e" };
  if (elo >= 1550) return { grade: "A-", color: "#4ade80" };
  if (elo >= 1525) return { grade: "B+", color: "#3B82F6" };
  if (elo >= 1500) return { grade: "B", color: "#3B82F6" };
  if (elo >= 1475) return { grade: "B-", color: "#60a5fa" };
  if (elo >= 1450) return { grade: "C+", color: "#f59e0b" };
  if (elo >= 1425) return { grade: "C", color: "#f59e0b" };
  return { grade: "C-", color: "#fbbf24" };
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [homeTeamInfo, setHomeTeamInfo] = useState<TeamInfo>(null);
  const [awayTeamInfo, setAwayTeamInfo] = useState<TeamInfo>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);

        // Query match_results table
        const { data, error: qErr } = await supabase
          .from("match_results")
          .select("*")
          .eq("id", id)
          .single();

        if (qErr) throw qErr;
        setMatch(data as MatchRow);

        // Try to get home team info - first by FK, then by name search
        if (data?.home_team_id) {
          // Direct FK lookup
          const { data: homeData } = await supabase
            .from("team_elo")
            .select(
              "id, team_name, elo_rating, national_rank, wins, losses, draws, goals_for, goals_against",
            )
            .eq("id", data.home_team_id)
            .single();
          if (homeData) setHomeTeamInfo(homeData as TeamInfo);
        } else if (data?.home_team_name) {
          // Fallback: search by team name (exact match first)
          let { data: homeData } = await supabase
            .from("team_elo")
            .select(
              "id, team_name, elo_rating, national_rank, wins, losses, draws, goals_for, goals_against",
            )
            .ilike("team_name", data.home_team_name)
            .limit(1)
            .maybeSingle();

          // If no exact match, try partial match with first 20 chars
          if (!homeData && data.home_team_name.length > 10) {
            const searchTerm = data.home_team_name.substring(0, 20);
            const { data: partialMatch } = await supabase
              .from("team_elo")
              .select(
                "id, team_name, elo_rating, national_rank, wins, losses, draws, goals_for, goals_against",
              )
              .ilike("team_name", `${searchTerm}%`)
              .limit(1)
              .maybeSingle();
            homeData = partialMatch;
          }

          if (homeData) setHomeTeamInfo(homeData as TeamInfo);
        }

        // Try to get away team info - first by FK, then by name search
        if (data?.away_team_id) {
          // Direct FK lookup
          const { data: awayData } = await supabase
            .from("team_elo")
            .select(
              "id, team_name, elo_rating, national_rank, wins, losses, draws, goals_for, goals_against",
            )
            .eq("id", data.away_team_id)
            .single();
          if (awayData) setAwayTeamInfo(awayData as TeamInfo);
        } else if (data?.away_team_name) {
          // Fallback: search by team name (exact match first)
          let { data: awayData } = await supabase
            .from("team_elo")
            .select(
              "id, team_name, elo_rating, national_rank, wins, losses, draws, goals_for, goals_against",
            )
            .ilike("team_name", data.away_team_name)
            .limit(1)
            .maybeSingle();

          // If no exact match, try partial match with first 20 chars
          if (!awayData && data.away_team_name.length > 10) {
            const searchTerm = data.away_team_name.substring(0, 20);
            const { data: partialMatch } = await supabase
              .from("team_elo")
              .select(
                "id, team_name, elo_rating, national_rank, wins, losses, draws, goals_for, goals_against",
              )
              .ilike("team_name", `${searchTerm}%`)
              .limit(1)
              .maybeSingle();
            awayData = partialMatch;
          }

          if (awayData) setAwayTeamInfo(awayData as TeamInfo);
        }
      } catch (e: any) {
        console.error("Error loading match:", e);
        setError(e?.message ?? "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  // Loading state
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
          <Text style={styles.headerTitle}>Match Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color="#3B82F6" size="large" />
          <Text style={styles.loadingText}>Loading match...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error || !match) {
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
          <Text style={styles.headerTitle}>Match Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
          <Text style={styles.errorText}>{error || "Match not found"}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => router.back()}
          >
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Extract data from match_results schema
  const homeName = match.home_team_name ?? "Home Team";
  const awayName = match.away_team_name ?? "Away Team";
  const homeScore = match.home_score;
  const awayScore = match.away_score;
  const hasScore = homeScore !== null && awayScore !== null;

  // FIXED: Better date handling - use actual date if available
  const dateStr = formatDate(match.match_date);
  const timeStr = formatTime(match.match_time);
  const location = match.location;
  const matchTypeBadge = getMatchTypeBadge(match.source_type);

  // FIXED: Determine actual status based on scores/date, not just status field
  const matchStatus = getMatchStatus(match);

  const navigateToTeam = (teamInfo: TeamInfo) => {
    if (teamInfo?.id) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push(`/team/${teamInfo.id}`);
    }
  };

  const navigateToPredict = () => {
    if (homeTeamInfo?.id) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push(`/predict?teamId=${homeTeamInfo.id}`);
    }
  };

  // Calculate comparison data for Tale of the Tape
  const canShowComparison = homeTeamInfo && awayTeamInfo;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
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
        <Text style={styles.headerTitle}>Match Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Match Type Badge (no platform branding) */}
        {matchTypeBadge && (
          <View style={styles.eventRow}>
            <View style={styles.sourceBadge}>
              <Text style={styles.sourceBadgeText}>
                {matchTypeBadge.emoji} {matchTypeBadge.label}
              </Text>
            </View>
          </View>
        )}

        {/* Score Card - TEAMS ARE TAPPABLE HERE */}
        <View style={styles.scoreCard}>
          <TouchableOpacity
            style={styles.teamScoreSection}
            onPress={() => navigateToTeam(homeTeamInfo)}
            disabled={!homeTeamInfo}
            activeOpacity={0.7}
          >
            <View style={[styles.teamBadgeLarge, styles.homeBadge]}>
              <Text style={styles.teamBadgeLargeText}>
                {getInitials(homeName)}
              </Text>
            </View>
            <Text
              style={[
                styles.teamNameLarge,
                homeTeamInfo && styles.teamNameClickable,
              ]}
              numberOfLines={2}
            >
              {homeName}
            </Text>
            {homeTeamInfo?.national_rank && (
              <Text style={styles.teamRankSmall}>
                🏆 #{homeTeamInfo.national_rank}
              </Text>
            )}
            {hasScore && <Text style={styles.scoreNumber}>{homeScore}</Text>}
            {homeTeamInfo && (
              <Text style={styles.tapToView}>Tap for details</Text>
            )}
          </TouchableOpacity>

          <View style={styles.vsContainer}>
            <Text style={styles.vsText}>vs</Text>
            {/* FIXED: Show proper status badge based on actual match state */}
            {matchStatus === "upcoming" && (
              <View style={styles.upcomingBadge}>
                <Text style={styles.upcomingBadgeText}>Upcoming</Text>
              </View>
            )}
            {matchStatus === "completed" && !hasScore && (
              <View style={styles.completedBadge}>
                <Text style={styles.completedBadgeText}>Final</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.teamScoreSection}
            onPress={() => navigateToTeam(awayTeamInfo)}
            disabled={!awayTeamInfo}
            activeOpacity={0.7}
          >
            <View style={[styles.teamBadgeLarge, styles.awayBadge]}>
              <Text style={styles.teamBadgeLargeText}>
                {getInitials(awayName)}
              </Text>
            </View>
            <Text
              style={[
                styles.teamNameLarge,
                awayTeamInfo && styles.teamNameClickable,
              ]}
              numberOfLines={2}
            >
              {awayName}
            </Text>
            {awayTeamInfo?.national_rank && (
              <Text style={styles.teamRankSmall}>
                🏆 #{awayTeamInfo.national_rank}
              </Text>
            )}
            {hasScore && <Text style={styles.scoreNumber}>{awayScore}</Text>}
            {awayTeamInfo && (
              <Text style={styles.tapToView}>Tap for details</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Match Info Card - FIXED: Shows date, time, location, division */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Ionicons name="calendar-outline" size={20} color="#3B82F6" />
              <Text style={styles.infoLabel}>Date</Text>
              <Text style={styles.infoValue}>{dateStr || "Date not set"}</Text>
            </View>
            {timeStr ? (
              <View style={styles.infoItem}>
                <Ionicons name="time-outline" size={20} color="#3B82F6" />
                <Text style={styles.infoLabel}>Time</Text>
                <Text style={styles.infoValue}>{timeStr}</Text>
              </View>
            ) : null}
          </View>

          {/* Location row */}
          {location && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={18} color="#10b981" />
              <Text style={styles.locationText} numberOfLines={2}>
                {location}
              </Text>
            </View>
          )}

          {/* Division info */}
          <View style={styles.infoRow}>
            {match.age_group && (
              <View style={styles.infoItem}>
                <Ionicons name="people-outline" size={20} color="#f59e0b" />
                <Text style={styles.infoLabel}>Age Group</Text>
                <Text style={styles.infoValue}>{match.age_group}</Text>
              </View>
            )}
            {match.gender && (
              <View style={styles.infoItem}>
                <Ionicons name="football-outline" size={20} color="#f59e0b" />
                <Text style={styles.infoLabel}>Division</Text>
                <Text style={styles.infoValue}>{match.gender}</Text>
              </View>
            )}
          </View>
        </View>

        {/* TALE OF THE TAPE - Team Comparison */}
        {canShowComparison && (
          <View style={styles.comparisonCard}>
            <Text style={styles.comparisonTitle}>⚔️ Tale of the Tape</Text>

            {/* Power Rating Comparison */}
            <View style={styles.comparisonRow}>
              <Text style={styles.comparisonValueLeft}>
                {Math.round(homeTeamInfo.elo_rating || 1500)}
              </Text>
              <Text style={styles.comparisonLabel}>Power Rating</Text>
              <Text style={styles.comparisonValueRight}>
                {Math.round(awayTeamInfo.elo_rating || 1500)}
              </Text>
            </View>

            {/* Record Comparison */}
            <View style={styles.comparisonRow}>
              <Text style={styles.comparisonValueLeft}>
                {homeTeamInfo.wins ?? 0}-{homeTeamInfo.losses ?? 0}-
                {homeTeamInfo.draws ?? 0}
              </Text>
              <Text style={styles.comparisonLabel}>Record (W-L-D)</Text>
              <Text style={styles.comparisonValueRight}>
                {awayTeamInfo.wins ?? 0}-{awayTeamInfo.losses ?? 0}-
                {awayTeamInfo.draws ?? 0}
              </Text>
            </View>

            {/* Official Rank Comparison */}
            {(homeTeamInfo.national_rank || awayTeamInfo.national_rank) && (
              <View style={styles.comparisonRow}>
                <Text style={styles.comparisonValueLeft}>
                  {homeTeamInfo.national_rank
                    ? `#${homeTeamInfo.national_rank}`
                    : "—"}
                </Text>
                <Text style={styles.comparisonLabel}>Official Rank</Text>
                <Text style={styles.comparisonValueRight}>
                  {awayTeamInfo.national_rank
                    ? `#${awayTeamInfo.national_rank}`
                    : "—"}
                </Text>
              </View>
            )}

            {/* Goal Differential */}
            {(homeTeamInfo.goals_for !== null ||
              awayTeamInfo.goals_for !== null) && (
              <View style={styles.comparisonRow}>
                <Text
                  style={[
                    styles.comparisonValueLeft,
                    {
                      color:
                        (homeTeamInfo.goals_for || 0) -
                          (homeTeamInfo.goals_against || 0) >=
                        0
                          ? "#22c55e"
                          : "#ef4444",
                    },
                  ]}
                >
                  {(homeTeamInfo.goals_for || 0) -
                    (homeTeamInfo.goals_against || 0) >=
                  0
                    ? "+"
                    : ""}
                  {(homeTeamInfo.goals_for || 0) -
                    (homeTeamInfo.goals_against || 0)}
                </Text>
                <Text style={styles.comparisonLabel}>Goal Diff</Text>
                <Text
                  style={[
                    styles.comparisonValueRight,
                    {
                      color:
                        (awayTeamInfo.goals_for || 0) -
                          (awayTeamInfo.goals_against || 0) >=
                        0
                          ? "#22c55e"
                          : "#ef4444",
                    },
                  ]}
                >
                  {(awayTeamInfo.goals_for || 0) -
                    (awayTeamInfo.goals_against || 0) >=
                  0
                    ? "+"
                    : ""}
                  {(awayTeamInfo.goals_for || 0) -
                    (awayTeamInfo.goals_against || 0)}
                </Text>
              </View>
            )}

            {/* Predict Button */}
            <TouchableOpacity
              style={styles.predictMatchButton}
              onPress={navigateToPredict}
            >
              <Ionicons name="analytics" size={20} color="#fff" />
              <Text style={styles.predictMatchButtonText}>
                Get AI Prediction
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* REMOVED: Redundant Teams Section - teams are already tappable in the score card above */}
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================

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
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#9ca3af",
    fontSize: 16,
  },
  errorText: {
    color: "#EF4444",
    fontSize: 16,
    textAlign: "center",
    marginTop: 12,
    marginBottom: 20,
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

  // Event Row
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    flexWrap: "wrap",
    gap: 8,
  },
  sourceBadge: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  sourceBadgeText: {
    color: "#3B82F6",
    fontSize: 12,
    fontWeight: "600",
  },

  // Score Card
  scoreCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  teamScoreSection: {
    flex: 1,
    alignItems: "center",
  },
  teamBadgeLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  teamBadgeLargeText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  homeBadge: {
    backgroundColor: "#3B82F6",
  },
  awayBadge: {
    backgroundColor: "#6366F1",
  },
  teamNameLarge: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  teamNameClickable: {
    color: "#3B82F6",
  },
  teamRankSmall: {
    color: "#f59e0b",
    fontSize: 11,
    marginBottom: 4,
  },
  scoreNumber: {
    color: "#3B82F6",
    fontSize: 36,
    fontWeight: "bold",
    marginTop: 4,
  },
  tapToView: {
    color: "#6b7280",
    fontSize: 10,
    marginTop: 4,
  },
  vsContainer: {
    paddingHorizontal: 16,
    paddingTop: 60,
    alignItems: "center",
  },
  vsText: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "500",
  },
  upcomingBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  upcomingBadgeText: {
    color: "#f59e0b",
    fontSize: 10,
    fontWeight: "600",
  },
  completedBadge: {
    backgroundColor: "rgba(34, 197, 94, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  completedBadgeText: {
    color: "#22c55e",
    fontSize: 10,
    fontWeight: "600",
  },

  // Info Card
  infoCard: {
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  infoItem: {
    flex: 1,
    alignItems: "center",
  },
  infoLabel: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 4,
  },
  infoValue: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 2,
    textAlign: "center",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  locationText: {
    color: "#10b981",
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },

  // Comparison Card (Tale of the Tape)
  comparisonCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  comparisonTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  comparisonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  comparisonValueLeft: {
    flex: 1,
    color: "#3B82F6",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  comparisonLabel: {
    flex: 1.2,
    color: "#9ca3af",
    fontSize: 12,
    textAlign: "center",
  },
  comparisonValueRight: {
    flex: 1,
    color: "#6366F1",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  predictMatchButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#10b981",
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 16,
    gap: 8,
  },
  predictMatchButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
