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
import { supabase } from "../../lib/supabase";

type MatchRow = Record<string, any>;

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
      } catch (e: any) {
        console.error("Error loading match:", e);
        setError(e?.message ?? "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  if (loading) {
    return (
      <>
        <Stack.Screen
          options={{
            title: "Match",
            headerStyle: { backgroundColor: "#000" },
            headerTintColor: "#fff",
          }}
        />
        <View style={styles.centered}>
          <ActivityIndicator color="#3B82F6" size="large" />
          <Text style={styles.loadingText}>Loading match...</Text>
        </View>
      </>
    );
  }

  if (error || !match) {
    return (
      <>
        <Stack.Screen
          options={{
            title: "Match",
            headerStyle: { backgroundColor: "#000" },
            headerTintColor: "#fff",
          }}
        />
        <View style={styles.container}>
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
            <Text style={styles.errorText}>{error || "Match not found"}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => router.back()}
            >
              <Text style={styles.retryButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
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

  const homeTeamId = pickFirst(match, [
    "home_team_id",
    "homeTeamId",
    "home_id",
  ]);
  const awayTeamId = pickFirst(match, [
    "away_team_id",
    "awayTeamId",
    "away_id",
  ]);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Match Details",
          headerStyle: { backgroundColor: "#000" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "600" },
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {showCompetition && (
          <View style={styles.competitionBadge}>
            <Text style={styles.competitionText}>{competition}</Text>
          </View>
        )}

        <View style={styles.scoreCard}>
          <View style={styles.teamScoreSection}>
            <Text style={styles.teamNameLarge} numberOfLines={2}>
              {homeName}
            </Text>
            <Text style={styles.scoreNumber}>{hasScore ? homeScore : "–"}</Text>
          </View>

          <View style={styles.vsContainer}>
            <Text style={styles.vsText}>vs</Text>
          </View>

          <View style={styles.teamScoreSection}>
            <Text style={styles.teamNameLarge} numberOfLines={2}>
              {awayName}
            </Text>
            <Text style={styles.scoreNumber}>{hasScore ? awayScore : "–"}</Text>
          </View>
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
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (homeTeamId) router.push(`/team/${homeTeamId}`);
          }}
          style={styles.teamCard}
          disabled={!homeTeamId}
          activeOpacity={0.7}
        >
          <View style={styles.teamCardContent}>
            <View style={styles.teamBadge}>
              <Text style={styles.teamBadgeText}>H</Text>
            </View>
            <View style={styles.teamCardInfo}>
              <Text style={styles.teamCardName} numberOfLines={1}>
                {homeName}
              </Text>
              <Text style={styles.teamCardLabel}>Home Team</Text>
            </View>
          </View>
          {homeTeamId && (
            <Ionicons name="chevron-forward" size={20} color="#6b7280" />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (awayTeamId) router.push(`/team/${awayTeamId}`);
          }}
          style={styles.teamCard}
          disabled={!awayTeamId}
          activeOpacity={0.7}
        >
          <View style={styles.teamCardContent}>
            <View style={[styles.teamBadge, styles.awayBadge]}>
              <Text style={styles.teamBadgeText}>A</Text>
            </View>
            <View style={styles.teamCardInfo}>
              <Text style={styles.teamCardName} numberOfLines={1}>
                {awayName}
              </Text>
              <Text style={styles.teamCardLabel}>Away Team</Text>
            </View>
          </View>
          {awayTeamId && (
            <Ionicons name="chevron-forward" size={20} color="#6b7280" />
          )}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  contentContainer: { padding: 16, paddingBottom: 40 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  loadingText: { marginTop: 12, color: "#9ca3af", fontSize: 16 },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
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
  retryButtonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  competitionBadge: {
    backgroundColor: "#1F2937",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: "center",
    marginBottom: 16,
  },
  competitionText: { color: "#9ca3af", fontSize: 13, fontWeight: "500" },
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
  teamScoreSection: { flex: 1, alignItems: "center" },
  teamNameLarge: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  scoreNumber: { color: "#3B82F6", fontSize: 36, fontWeight: "bold" },
  vsContainer: { paddingHorizontal: 16 },
  vsText: { color: "#6b7280", fontSize: 14, fontWeight: "500" },
  infoCard: {
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  infoRow: { flexDirection: "row", marginBottom: 12 },
  infoItem: { flex: 1, alignItems: "center" },
  infoLabel: { color: "#6b7280", fontSize: 12, marginTop: 4 },
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
  teamCardContent: { flexDirection: "row", alignItems: "center", flex: 1 },
  teamBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#3B82F6",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  awayBadge: { backgroundColor: "#6366F1" },
  teamBadgeText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  teamCardInfo: { flex: 1 },
  teamCardName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  teamCardLabel: { color: "#6b7280", fontSize: 12, marginTop: 2 },
});
