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

export default function MatchesScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [allMatches, setAllMatches] = useState<MatchRow[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("all");
  const [modalVisible, setModalVisible] = useState(false);

  const searchInputRef = useRef<TextInput>(null);

  const loadMatches = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);

    try {
      // Load ALL matches, filter client-side for responsiveness
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .order("match_date", { ascending: false, nullsFirst: false })
        .limit(2000);

      if (error) {
        console.error("Matches query error:", error);
        setAllMatches([]);
        return;
      }

      setAllMatches((data ?? []) as MatchRow[]);
    } catch (err) {
      console.error("Error loading matches:", err);
      setAllMatches([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMatches({ silent: true });
    setRefreshing(false);
  }, [loadMatches]);

  // Filter matches client-side based on timeframe and search
  const filteredMatches = useMemo(() => {
    const now = new Date();
    const nowStr = now.toISOString().split("T")[0];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

    let filtered = allMatches;

    // Apply timeframe filter
    if (timeframe === "recent") {
      filtered = filtered.filter((m) => {
        const matchDate = m.match_date?.split("T")[0];
        return (
          matchDate && matchDate >= thirtyDaysAgoStr && matchDate <= nowStr
        );
      });
    } else if (timeframe === "upcoming") {
      filtered = filtered.filter((m) => {
        const matchDate = m.match_date?.split("T")[0];
        return matchDate && matchDate > nowStr;
      });
    }

    // Apply search filter
    const q = query.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((m) => {
        const homeName =
          pickFirst(m, ["home_team_name", "homeName", "home_team"]) ?? "";
        const awayName =
          pickFirst(m, ["away_team_name", "awayName", "away_team"]) ?? "";
        const compName =
          pickFirst(m, [
            "competition_name",
            "league_name",
            "competition",
            "league",
          ]) ?? "";
        const location =
          pickFirst(m, ["location", "venue_name", "venue"]) ?? "";

        const searchable =
          `${homeName} ${awayName} ${compName} ${location}`.toLowerCase();
        return searchable.includes(q);
      });
    }

    return filtered;
  }, [allMatches, timeframe, query]);

  const timeframeLabels: Record<Timeframe, string> = {
    all: "All Matches",
    recent: "Recent (30 Days)",
    upcoming: "Upcoming",
  };

  const timeframeIcons: Record<Timeframe, string> = {
    all: "📋",
    recent: "🕐",
    upcoming: "📅",
  };

  // Build match details string (competition, date, location)
  const getMatchDetails = (item: MatchRow): string => {
    const parts: string[] = [];

    const date = toDisplayDate(item.match_date ?? item.played_at ?? item.date);
    if (date) parts.push(date);

    const location = pickFirst(item, ["location", "venue_name", "venue"]);
    if (isValidValue(location)) parts.push(location);

    return parts.join(" · ");
  };

  const renderItem = ({ item }: { item: MatchRow }) => {
    const homeName =
      pickFirst(item, ["home_team_name", "homeName", "home_team"]) ?? "TBD";
    const awayName =
      pickFirst(item, ["away_team_name", "awayName", "away_team"]) ?? "TBD";

    const details = getMatchDetails(item);
    const score = scoreText(item);
    const hasScore = score.length > 0;

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
        activeOpacity={0.7}
      >
        <View style={styles.matchInfo}>
          {details ? (
            <Text style={styles.matchDetails} numberOfLines={1}>
              {details}
            </Text>
          ) : null}
          <Text style={styles.teamName} numberOfLines={1}>
            {homeName}
          </Text>
          <Text style={styles.vsText} numberOfLines={1}>
            vs {awayName}
          </Text>
        </View>
        <View style={styles.scoreContainer}>
          <Text style={hasScore ? styles.score : styles.scorePending}>
            {hasScore ? score : "—"}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color="#4b5563"
          style={styles.chevron}
        />
      </TouchableOpacity>
    );
  };

  const ListHeader = () => (
    <View>
      <View style={styles.filtersContainer}>
        {/* Timeframe selector button */}
        <TouchableOpacity
          style={styles.timeframeSelector}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setModalVisible(true);
          }}
        >
          <Text style={styles.timeframeText}>
            {timeframeIcons[timeframe]} {timeframeLabels[timeframe]}
          </Text>
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
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search matches..."
            placeholderTextColor="#6b7280"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            blurOnSubmit={false}
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
          {filteredMatches.length.toLocaleString()} matches found
        </Text>
      </View>
    </View>
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
          <Text style={styles.loadingText}>Loading matches...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredMatches}
          keyExtractor={(item, index) =>
            item.id ?? item.match_id ?? `match-${index}`
          }
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="football-outline" size={48} color="#374151" />
              <Text style={styles.noDataText}>
                {query
                  ? "No matches match your search"
                  : timeframe === "upcoming"
                    ? "No upcoming matches scheduled"
                    : timeframe === "recent"
                      ? "No recent matches in the last 30 days"
                      : "No matches available yet"}
              </Text>
              {query && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => setQuery("")}
                >
                  <Text style={styles.clearButtonText}>Clear Search</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
            />
          }
          showsVerticalScrollIndicator={false}
          initialNumToRender={20}
          maxToRenderPerBatch={30}
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
                <Text style={styles.timeframeIcon}>{timeframeIcons[tf]}</Text>
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
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    marginBottom: 12,
  },
  timeframeText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
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
    flexGrow: 1,
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
  chevron: {
    marginLeft: 8,
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
  clearButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#1F2937",
    borderRadius: 8,
  },
  clearButtonText: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "600",
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
  timeframeIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  timeframeRowText: {
    color: "#fff",
    fontSize: 15,
    flex: 1,
  },
  timeframeRowTextSelected: {
    color: "#3B82F6",
    fontWeight: "600",
  },
});
