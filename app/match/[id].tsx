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

type MatchRow = Record<string, any>;
type TeamInfo = { id: string; team_name: string } | null;

function isValidValue(v: any): boolean {
  if (v === null || v === undefined) return false;
  const str = String(v).trim();
  return str.length > 0 && str !== "??" && str !== "TBD";
}

function pickFirst(obj: any, keys: string[]): any {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && `${v}`.trim() !== "") return v;
  }
  return undefined;
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
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

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

        // Query matches table directly
        const { data, error: qErr } = await supabase
          .from("matches")
          .select("*")
          .eq("id", id)
          .single();

        if (qErr) throw qErr;
        setMatch(data ?? null);

        // Look up team IDs by team name from team_elo table
        const homeName = pickFirst(data, [
          "home_team",
          "home_team_name",
          "homeName",
          "home_name",
        ]);
        const awayName = pickFirst(data, [
          "away_team",
          "away_team_name",
          "awayName",
          "away_name",
        ]);

        if (homeName) {
          const { data: homeData } = await supabase
            .from("team_elo")
            .select("id, team_name")
            .eq("team_name", homeName)
            .single();
          if (homeData) setHomeTeamInfo(homeData as TeamInfo);
        }

        if (awayName) {
          const { data: awayData } = await supabase
            .from("team_elo")
            .select("id, team_name")
            .eq("team_name", awayName)
            .single();
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
        {/* Hide the default Expo Router header */}
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
        {/* Hide the default Expo Router header */}
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

  // Get team names from multiple possible column names
  const homeName =
    pickFirst(match, [
      "home_team",
      "home_team_name",
      "homeName",
      "home_name",
    ]) ?? "Home Team";

  const awayName =
    pickFirst(match, [
      "away_team",
      "away_team_name",
      "awayName",
      "away_name",
    ]) ?? "Away Team";

  const homeScore = pickFirst(match, [
    "home_score",
    "home_goals",
    "homeTeamScore",
  ]);
  const awayScore = pickFirst(match, [
    "away_score",
    "away_goals",
    "awayTeamScore",
  ]);
  const hasScore = homeScore !== null && awayScore !== null;

  const date = formatDate(match.match_date ?? match.played_at ?? match.date);
  const time = formatTime(match.match_date ?? match.played_at ?? match.date);

  const competition = pickFirst(match, [
    "competition_name",
    "league_name",
    "competition",
    "league",
  ]);
  const showCompetition =
    isValidValue(competition) && competition !== "GotSport";

  const location = pickFirst(match, ["location", "venue_name", "venue"]);

  const navigateToTeam = (teamInfo: TeamInfo) => {
    if (teamInfo?.id) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push(`/team/${teamInfo.id}`);
    }
  };

  // Get team initials for badge
  const getInitials = (name: string): string => {
    const words = name.split(" ").filter((w) => w.length > 0);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Hide the default Expo Router header */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* Consistent Header with Back Button */}
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
        {showCompetition && (
          <View style={styles.competitionBadge}>
            <Text style={styles.competitionText}>{competition}</Text>
          </View>
        )}

        <View style={styles.scoreCard}>
          <TouchableOpacity
            style={styles.teamScoreSection}
            onPress={() => navigateToTeam(homeTeamInfo)}
            disabled={!homeTeamInfo}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.teamNameLarge,
                homeTeamInfo && styles.teamNameClickable,
              ]}
              numberOfLines={2}
            >
              {homeName}
            </Text>
            <Text style={styles.scoreNumber}>{hasScore ? homeScore : "—"}</Text>
            {homeTeamInfo && (
              <Text style={styles.tapToView}>Tap to view team</Text>
            )}
          </TouchableOpacity>

          <View style={styles.vsContainer}>
            <Text style={styles.vsText}>vs</Text>
          </View>

          <TouchableOpacity
            style={styles.teamScoreSection}
            onPress={() => navigateToTeam(awayTeamInfo)}
            disabled={!awayTeamInfo}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.teamNameLarge,
                awayTeamInfo && styles.teamNameClickable,
              ]}
              numberOfLines={2}
            >
              {awayName}
            </Text>
            <Text style={styles.scoreNumber}>{hasScore ? awayScore : "—"}</Text>
            {awayTeamInfo && (
              <Text style={styles.tapToView}>Tap to view team</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Ionicons name="calendar-outline" size={18} color="#6b7280" />
              <Text style={styles.infoLabel}>Date</Text>
              <Text style={styles.infoValue}>{date || "TBD"}</Text>
            </View>
            {time && (
              <View style={styles.infoItem}>
                <Ionicons name="time-outline" size={18} color="#6b7280" />
                <Text style={styles.infoLabel}>Time</Text>
                <Text style={styles.infoValue}>{time}</Text>
              </View>
            )}
          </View>
          {isValidValue(location) && (
            <View style={styles.infoRow}>
              <View style={styles.infoItem}>
                <Ionicons name="location-outline" size={18} color="#6b7280" />
                <Text style={styles.infoLabel}>Location</Text>
                <Text style={styles.infoValue}>{location}</Text>
              </View>
            </View>
          )}
        </View>

        <Text style={styles.sectionHeader}>Teams</Text>

        <TouchableOpacity
          onPress={() => navigateToTeam(homeTeamInfo)}
          style={[styles.teamCard, !homeTeamInfo && styles.teamCardDisabled]}
          disabled={!homeTeamInfo}
          activeOpacity={0.7}
        >
          <View style={styles.teamCardContent}>
            <View style={styles.teamBadge}>
              <Text style={styles.teamBadgeText}>{getInitials(homeName)}</Text>
            </View>
            <View style={styles.teamCardInfo}>
              <Text style={styles.teamCardName} numberOfLines={1}>
                {homeName}
              </Text>
              <Text style={styles.teamCardLabel}>Home Team</Text>
            </View>
          </View>
          {homeTeamInfo ? (
            <Ionicons name="chevron-forward" size={20} color="#3B82F6" />
          ) : (
            <Text style={styles.noDataLabel}>No profile</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigateToTeam(awayTeamInfo)}
          style={[styles.teamCard, !awayTeamInfo && styles.teamCardDisabled]}
          disabled={!awayTeamInfo}
          activeOpacity={0.7}
        >
          <View style={styles.teamCardContent}>
            <View style={[styles.teamBadge, styles.awayBadge]}>
              <Text style={styles.teamBadgeText}>{getInitials(awayName)}</Text>
            </View>
            <View style={styles.teamCardInfo}>
              <Text style={styles.teamCardName} numberOfLines={1}>
                {awayName}
              </Text>
              <Text style={styles.teamCardLabel}>Away Team</Text>
            </View>
          </View>
          {awayTeamInfo ? (
            <Ionicons name="chevron-forward" size={20} color="#6366F1" />
          ) : (
            <Text style={styles.noDataLabel}>No profile</Text>
          )}
        </TouchableOpacity>
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
  competitionBadge: {
    backgroundColor: "#1F2937",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: "center",
    marginBottom: 16,
  },
  competitionText: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "500",
  },
  scoreCard: {
    flexDirection: "row",
    alignItems: "center",
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
  teamNameLarge: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  teamNameClickable: {
    color: "#3B82F6",
  },
  tapToView: {
    color: "#6b7280",
    fontSize: 10,
    marginTop: 4,
  },
  scoreNumber: {
    color: "#3B82F6",
    fontSize: 36,
    fontWeight: "bold",
  },
  vsContainer: {
    paddingHorizontal: 16,
  },
  vsText: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "500",
  },
  infoCard: {
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
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
  sectionHeader: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  teamCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  teamCardDisabled: {
    opacity: 0.6,
  },
  teamCardContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  teamBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#3B82F6",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  awayBadge: {
    backgroundColor: "#6366F1",
  },
  teamBadgeText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  teamCardInfo: {
    flex: 1,
  },
  teamCardName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  teamCardLabel: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  noDataLabel: {
    color: "#6b7280",
    fontSize: 12,
  },
});
