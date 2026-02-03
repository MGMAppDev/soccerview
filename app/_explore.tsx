// app/_explore.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";

type MatchRow = {
  id: string;

  // Prefer the competition-aware schema (played_at is what we used elsewhere)
  played_at: string | null;

  season: string | null;
  status: string | null;

  home_score: number | null;
  away_score: number | null;

  // Names provided by v_matches_competition_resolved (or gracefully fallback)
  competition_name?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
  age_group?: string | null;
  gender?: string | null;

  // Fallbacks if your view still exposes older fields
  match_date?: string | null;
  leagues?: { name: string | null } | null;
  home_team?: { name: string | null } | null;
  away_team?: { name: string | null } | null;
};

// Format date as badge (e.g., "Jan 17")
function formatDateBadge(value: string | null): string {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function ExploreScreen() {
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const subtitle = useMemo(() => {
    if (loading) return "Loading...";
    if (error) return "Error loading matches";
    return `${rows.length} matches loaded`;
  }, [loading, error, rows.length]);

  async function loadMatches(isRefresh = false, isMountedRef?: { current: boolean }) {
    try {
      setError(null);
      isRefresh ? setRefreshing(true) : setLoading(true);

      // Phase 2.3: competition-aware match reads
      const { data, error: qErr } = await supabase
        .from("v_matches_competition_resolved")
        .select(
          `
          id,
          played_at,
          season,
          status,
          home_score,
          away_score,
          competition_name,
          home_team_name,
          away_team_name,
          age_group,
          gender
        `
        )
        .order("played_at", { ascending: false })
        .limit(50);

      if (qErr) throw qErr;

      const safeRows = (data as MatchRow[]) ?? [];
      if (!isMountedRef || isMountedRef.current) setRows(safeRows);
    } catch (e: any) {
      if (!isMountedRef || isMountedRef.current) {
        setError(e?.message ?? "Unknown error");
        setRows([]);
      }
    } finally {
      if (!isMountedRef || isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    const isMountedRef = { current: true };
    loadMatches(false, isMountedRef);
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Render match card - Standard style matching Home/Matches tabs
  const renderMatchCard = ({ item }: { item: MatchRow }) => {
    // Prefer competition-aware fields; fall back gracefully
    const homeName = item.home_team_name ?? item.home_team?.name ?? "Home";
    const awayName = item.away_team_name ?? item.away_team?.name ?? "Away";
    const eventName = item.competition_name ?? item.leagues?.name ?? null;

    const dateBadge = formatDateBadge(item.played_at ?? item.match_date ?? null);
    const hasScore = item.home_score !== null && item.away_score !== null;

    // Build division text (age_group + gender)
    const divisionParts: string[] = [];
    if (item.age_group) divisionParts.push(item.age_group);
    if (item.gender) divisionParts.push(item.gender);
    const divisionStr = divisionParts.join(" · ");

    return (
      <TouchableOpacity
        style={styles.matchCard}
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/match/${item.id}`);
        }}
      >
        {/* Header row: Date badge + Division */}
        <View style={styles.matchHeaderRow}>
          {dateBadge ? (
            <View style={styles.dateBadge}>
              <Text style={styles.dateBadgeText}>{dateBadge}</Text>
            </View>
          ) : null}
          {divisionStr ? (
            <Text style={styles.divisionText}>{divisionStr}</Text>
          ) : null}
        </View>

        {/* Event name if available - filter out "GotSport" branding */}
        {eventName && eventName !== "GotSport" && (
          <Text style={styles.eventName} numberOfLines={1}>
            {eventName}
          </Text>
        )}

        {/* Main content row: Teams + Score */}
        <View style={styles.matchTeamsRow}>
          {/* Teams column - vertical layout */}
          <View style={styles.matchTeamsContainer}>
            <Text style={styles.teamName}>{homeName}</Text>
            <Text style={styles.vsText}>vs</Text>
            <Text style={styles.teamName}>{awayName}</Text>
          </View>

          {/* Score */}
          {hasScore && (
            <Text style={styles.scoreText}>
              {item.home_score} - {item.away_score}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading matches...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={rows}
        keyExtractor={(item) => item.id}
        onRefresh={() => loadMatches(true)}
        refreshing={refreshing}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Explore</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            {error ? (
              <View style={styles.errorCard}>
                <Ionicons name="cloud-offline-outline" size={24} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => loadMatches(false)}
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="football-outline" size={48} color="#374151" />
              <Text style={styles.emptyText}>No matches found</Text>
            </View>
          ) : null
        }
        renderItem={renderMatchCard}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
    gap: 12,
  },
  loadingText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: 14,
    marginBottom: 16,
  },
  errorCard: {
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  errorText: {
    color: "#EF4444",
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: "#1F2937",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "600",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyText: {
    color: "#6b7280",
    fontSize: 16,
  },

  // Standard Match Card - Matching Home/Matches tabs
  matchCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  matchHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  dateBadge: {
    backgroundColor: "rgba(59, 130, 246, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dateBadgeText: {
    color: "#3B82F6",
    fontSize: 12,
    fontWeight: "700",
  },
  divisionText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "500",
  },
  eventName: {
    color: "#9ca3af",
    fontSize: 11,
    marginBottom: 8,
    fontStyle: "italic",
  },
  matchTeamsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  matchTeamsContainer: {
    flex: 1,
    marginRight: 12,
  },
  teamName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  vsText: {
    color: "#6b7280",
    fontSize: 12,
    marginVertical: 2,
  },
  scoreText: {
    color: "#3B82F6",
    fontSize: 20,
    fontWeight: "bold",
  },
});
