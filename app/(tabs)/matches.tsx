// app/(tabs)/matches.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type MatchRow = Record<string, any>;
type Timeframe = "recent" | "upcoming" | "all";

// Helper to check if a value is valid (not null, empty, or "??")
function isValidValue(v: any): boolean {
  if (v === null || v === undefined) return false;
  const str = String(v).trim();
  return str.length > 0 && str !== "??" && str !== "TBD";
}

function toDisplayDate(value: any): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

function pickFirst(obj: any, keys: string[]): any {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && `${v}`.trim() !== "") return v;
  }
  return undefined;
}

function scoreText(m: MatchRow): string {
  const hs = pickFirst(m, ["home_score", "home_goals", "homeTeamScore"]);
  const as = pickFirst(m, ["away_score", "away_goals", "awayTeamScore"]);
  if (hs === undefined || as === undefined) return "";
  return `${hs} - ${as}`;
}

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<MatchRow>);

export default function MatchesScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [teamNameById, setTeamNameById] = useState<Record<string, string>>({});
  const [timeframe, setTimeframe] = useState<Timeframe>("all");
  const [modalVisible, setModalVisible] = useState(false);

  const [scrollY] = useState(new Animated.Value(0));

  // Fade filters as user scrolls down
  const filtersOpacity = scrollY.interpolate({
    inputRange: [0, 150],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  const teamNameRef = useRef<Record<string, string>>({});
  useEffect(() => {
    teamNameRef.current = teamNameById;
  }, [teamNameById]);

  const hydrateTeamNames = useCallback(async (rows: MatchRow[]) => {
    const ids = new Set<string>();

    for (const r of rows) {
      const homeId = pickFirst(r, ["home_team_id", "homeTeamId", "home_id"]);
      const awayId = pickFirst(r, ["away_team_id", "awayTeamId", "away_id"]);
      if (homeId) ids.add(String(homeId));
      if (awayId) ids.add(String(awayId));
    }

    const all = Array.from(ids);
    if (all.length === 0) return;

    const missing = all.filter((id) => !teamNameRef.current[id]);
    if (missing.length === 0) return;

    const { data, error } = await supabase
      .from("v_teams_resolved")
      .select("*")
      .in("id", missing);

    if (error) return;

    const next: Record<string, string> = {};
    for (const t of data ?? []) {
      const id = String(t.id);
      const name =
        pickFirst(t, ["display_name", "team_name", "name", "short_name"]) ??
        `Team ${id}`;
      next[id] = String(name);
    }

    if (Object.keys(next).length > 0) {
      setTeamNameById((prev) => ({ ...prev, ...next }));
    }
  }, []);

  const loadMatches = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (!silent) setLoading(true);

      try {
        let supabaseQuery = supabase
          .from("matches")
          .select("*")
          .order("match_date", { ascending: false, nullsFirst: false })
          .limit(200);

        const now = new Date();
        const nowStr = now.toISOString().split("T")[0];
        if (timeframe === "recent") {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];
          supabaseQuery = supabaseQuery
            .gte("match_date", thirtyDaysAgoStr)
            .lte("match_date", nowStr);
        } else if (timeframe === "upcoming") {
          supabaseQuery = supabaseQuery.gt("match_date", nowStr);
        }

        const { data, error } = await supabaseQuery;

        if (error) {
          console.error("Matches query error:", error);
          setMatches([]);
          return;
        }

        const rows = (data ?? []) as MatchRow[];
        setMatches(rows);
        hydrateTeamNames(rows);
      } catch (err) {
        console.error("Error loading matches:", err);
        setMatches([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [hydrateTeamNames, timeframe],
  );

  useEffect(() => {
    loadMatches();

    const channel = supabase
      .channel("matches_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        () => {
          loadMatches({ silent: true });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [timeframe, loadMatches]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMatches({ silent: true });
    setRefreshing(false);
  }, [loadMatches]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return matches;

    return matches.filter((m) => {
      const compName =
        pickFirst(m, [
          "competition_name",
          "league_name",
          "competition",
          "league",
        ]) ?? "";
      const compKey =
        pickFirst(m, ["competition_key", "competition_id", "league_id"]) ?? "";

      const homeId = pickFirst(m, ["home_team_id", "homeTeamId", "home_id"]);
      const awayId = pickFirst(m, ["away_team_id", "awayTeamId", "away_id"]);

      const homeName =
        pickFirst(m, ["home_team_name", "homeName", "home_team"]) ??
        (homeId ? teamNameById[String(homeId)] : "") ??
        "";
      const awayName =
        pickFirst(m, ["away_team_name", "awayName", "away_team"]) ??
        (awayId ? teamNameById[String(awayId)] : "") ??
        "";

      const searchable =
        `${homeName} ${awayName} ${compName} ${compKey}`.toLowerCase();
      return searchable.includes(q);
    });
  }, [matches, query, teamNameById]);

  const timeframeLabels: Record<Timeframe, string> = {
    all: "All Matches",
    recent: "Recent (30 Days)",
    upcoming: "Upcoming",
  };

  // Build match details string (competition, date, location)
  const getMatchDetails = (item: MatchRow): string => {
    const parts: string[] = [];

    const compName = pickFirst(item, [
      "competition_name",
      "league_name",
      "competition",
      "league",
    ]);
    // Filter out generic source names like "GotSport"
    if (isValidValue(compName) && compName !== "GotSport") parts.push(compName);

    const date = toDisplayDate(item.match_date ?? item.played_at ?? item.date);
    if (date) parts.push(date);

    const location = pickFirst(item, ["location", "venue_name", "venue"]);
    if (isValidValue(location)) parts.push(location);

    return parts.join(" · ");
  };

  const renderItem = ({ item }: { item: MatchRow }) => {
    const homeId = pickFirst(item, ["home_team_id", "homeTeamId", "home_id"]);
    const awayId = pickFirst(item, ["away_team_id", "awayTeamId", "away_id"]);

    const homeName =
      pickFirst(item, ["home_team_name", "homeName", "home_team"]) ??
      (homeId ? teamNameById[String(homeId)] : "") ??
      "TBD";
    const awayName =
      pickFirst(item, ["away_team_name", "awayName", "away_team"]) ??
      (awayId ? teamNameById[String(awayId)] : "") ??
      "TBD";

    const details = getMatchDetails(item);
    const score = scoreText(item);

    return (
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const matchId = item.id ?? item.match_id;
          if (matchId) {
            router.push(`/match/${matchId}`);
          }
        }}
        style={styles.matchItem}
      >
        <View style={styles.matchInfo}>
          {details ? (
            <Text
              style={styles.matchDetails}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {details}
            </Text>
          ) : null}
          <Text style={styles.teamName} numberOfLines={1} ellipsizeMode="tail">
            {homeName}
          </Text>
          <Text style={styles.vsText} numberOfLines={1} ellipsizeMode="tail">
            vs {awayName}
          </Text>
        </View>

        <View style={styles.scoreContainer}>
          {score ? (
            <Text style={styles.score}>{score}</Text>
          ) : (
            <Text style={styles.scorePending}>—</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ListHeaderComponent: contains filters (scrolls with list)
  const ListHeader = () => (
    <Animated.View style={{ opacity: filtersOpacity }}>
      <View style={styles.filtersContainer}>
        {/* Timeframe Selector */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setModalVisible(true);
          }}
          style={styles.timeframeSelector}
        >
          <Text style={styles.chipText}>{timeframeLabels[timeframe]}</Text>
          <Ionicons
            name="chevron-down"
            size={16}
            color="#fff"
            style={{ marginLeft: 6 }}
          />
        </TouchableOpacity>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={18}
            color="#6b7280"
            style={{ marginRight: 8 }}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search teams or competitions..."
            placeholderTextColor="#6b7280"
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.searchInput}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Results count */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsText}>
          {filtered.length} {filtered.length === 1 ? "match" : "matches"} found
        </Text>
      </View>
    </Animated.View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Static Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Matches</Text>
        <Text style={styles.subtitle}>Browse game results and schedules</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      ) : (
        <AnimatedFlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item, idx) => String(item.id ?? item.match_id ?? idx)}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="football-outline" size={48} color="#374151" />
              <Text style={styles.noDataText}>
                {query
                  ? "No matches match your search"
                  : "No matches available yet"}
              </Text>
              {!query && (
                <Text style={styles.emptySubtext}>
                  Pull to refresh or check back later
                </Text>
              )}
            </View>
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
            />
          }
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true },
          )}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Timeframe Selection Modal */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Timeframe</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            {(["all", "recent", "upcoming"] as Timeframe[]).map((tf) => (
              <TouchableOpacity
                key={tf}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setTimeframe(tf);
                  setModalVisible(false);
                }}
                style={[
                  styles.timeframeRow,
                  timeframe === tf && styles.timeframeRowSelected,
                ]}
              >
                <Text
                  style={[
                    styles.timeframeRowText,
                    timeframe === tf && styles.timeframeRowTextSelected,
                  ]}
                >
                  {timeframeLabels[tf]}
                </Text>
                {timeframe === tf && (
                  <Ionicons name="checkmark" size={20} color="#3B82F6" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: "#000",
  },
  title: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "bold",
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: 16,
    marginTop: 4,
  },
  filtersContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: "#000",
  },
  timeframeSelector: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    marginBottom: 12,
  },
  chipText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#1F2937",
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 16,
  },
  resultsHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#000",
  },
  resultsText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "500",
  },
  listContent: {
    paddingBottom: 24,
  },
  matchItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    marginBottom: 10,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  matchInfo: {
    flex: 1,
  },
  matchDetails: {
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
  vsText: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 4,
  },
  scoreContainer: {
    alignItems: "flex-end",
    marginLeft: 12,
  },
  score: {
    color: "#3B82F6",
    fontSize: 20,
    fontWeight: "bold",
  },
  scorePending: {
    color: "#374151",
    fontSize: 20,
    fontWeight: "bold",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  noDataText: {
    color: "#6b7280",
    fontSize: 16,
    textAlign: "center",
    marginTop: 16,
  },
  emptySubtext: {
    color: "#4b5563",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  modalContent: {
    backgroundColor: "#1F2937",
    borderRadius: 16,
    padding: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  timeframeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  timeframeRowSelected: {
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    marginHorizontal: -16,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  timeframeRowText: {
    color: "#fff",
    fontSize: 15,
  },
  timeframeRowTextSelected: {
    color: "#3B82F6",
    fontWeight: "600",
  },
});
