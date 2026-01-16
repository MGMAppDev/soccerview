import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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

// UPDATED: Added GotSport fields for championship badges
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
  // GotSport fields (v7)
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
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  match_date: string | null;
  location: string | null;
};

// Calculated stats from actual match data
type CalculatedStats = {
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winPercentage: string;
  source: "team_elo" | "calculated";
};

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

// Convert ELO to letter grade
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

// Normalize age group display
function normalizeAgeGroup(age: string | null | undefined): string | null {
  if (!age) return null;
  const trimmed = age.trim();
  const match = trimmed.match(/^(U)0*(\d+)$/i);
  if (match) {
    return `U${parseInt(match[2], 10)}`;
  }
  return trimmed;
}

// Format large numbers with commas
function formatNumber(num: number | null): string {
  if (num === null || num === undefined) return "—";
  return num.toLocaleString();
}

export default function TeamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [team, setTeam] = useState<TeamData | null>(null);
  const [allMatches, setAllMatches] = useState<MatchData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"recent" | "upcoming">("recent");

  const fetchTeamData = async () => {
    if (!id) {
      setError("No team ID provided");
      setLoading(false);
      return;
    }

    try {
      setError(null);

      // Fetch team info from team_elo (including all GotSport fields)
      const { data: teamData, error: teamError } = await supabase
        .from("team_elo")
        .select("*")
        .eq("id", id)
        .single();

      if (teamError) throw teamError;
      setTeam(teamData as TeamData);

      // FIXED: Fetch matches using separate queries to avoid special character issues
      const teamName = teamData?.team_name;
      if (teamName) {
        // Query for home matches
        const { data: homeMatches, error: homeError } = await supabase
          .from("matches")
          .select("*")
          .eq("home_team", teamName)
          .order("match_date", { ascending: false })
          .limit(50);

        // Query for away matches
        const { data: awayMatches, error: awayError } = await supabase
          .from("matches")
          .select("*")
          .eq("away_team", teamName)
          .order("match_date", { ascending: false })
          .limit(50);

        if (!homeError && !awayError) {
          // Combine and deduplicate matches
          const allMatchData = [...(homeMatches || []), ...(awayMatches || [])];
          const uniqueMatches = Array.from(
            new Map(allMatchData.map((m) => [m.id, m])).values(),
          );
          // Sort by date descending
          uniqueMatches.sort((a, b) => {
            const dateA = new Date(a.match_date || 0).getTime();
            const dateB = new Date(b.match_date || 0).getTime();
            return dateB - dateA;
          });
          setAllMatches(uniqueMatches as MatchData[]);
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

  // Split matches into recent (past) and upcoming (future)
  const { recentMatches, upcomingMatches } = useMemo(() => {
    const now = new Date();
    const recent: MatchData[] = [];
    const upcoming: MatchData[] = [];

    allMatches.forEach((match) => {
      if (match.match_date) {
        const matchDate = new Date(match.match_date);
        if (matchDate <= now) {
          recent.push(match);
        } else {
          upcoming.push(match);
        }
      } else {
        // No date - put in recent
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

  // FIXED: Calculate stats from actual match data when team_elo stats are missing/zero
  const calculatedStats = useMemo((): CalculatedStats => {
    // Check if team_elo has valid stats (matches_played > 0)
    const hasTeamEloStats =
      team && team.matches_played !== null && team.matches_played > 0;

    if (hasTeamEloStats) {
      // Use team_elo stats - these are the authoritative stats
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

    // Calculate from actual matches with scores
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let matchesWithScores = 0;

    recentMatches.forEach((match) => {
      // Only count matches that have BOTH scores recorded
      if (match.home_score !== null && match.away_score !== null) {
        matchesWithScores++;
        const isHome = match.home_team === team?.team_name;
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
  }, [team, recentMatches]);

  // Check if team has any championship badges
  const hasAnyBadge = useMemo(() => {
    return (
      team?.national_award || team?.regional_award || team?.state_cup_award
    );
  }, [team]);

  // Check if team has GotSport ranking data
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

  const renderRecentMatch = ({ item }: { item: MatchData }) => {
    const isHome = item.home_team === team?.team_name;
    const opponent = isHome ? item.away_team : item.home_team;
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

  const renderUpcomingMatch = ({ item }: { item: MatchData }) => {
    const isHome = item.home_team === team?.team_name;
    const opponent = isHome ? item.away_team : item.home_team;
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

  // Goal differential
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

          {/* 🏆 CHAMPIONSHIP BADGES - NEW! */}
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

          <View style={styles.eloSection}>
            <View style={styles.eloGradeContainer}>
              <Text style={[styles.eloGrade, { color }]}>{grade}</Text>
              <Text style={styles.eloValue}>{elo}</Text>
            </View>
            <Text style={styles.eloLabel}>Team Rating</Text>
          </View>
        </View>

        {/* 📊 NATIONAL RANKING CARD - NEW! (Only shows if team has ranking data) */}
        {hasRankingData && (
          <View style={styles.rankingCard}>
            <View style={styles.rankingHeader}>
              <Text style={styles.rankingTitle}>🏆 Official Rankings</Text>
            </View>
            <View style={styles.rankingGrid}>
              {team.national_rank && (
                <View style={styles.rankItem}>
                  <Text style={styles.rankValue}>#{team.national_rank}</Text>
                  <Text style={styles.rankLabel}>National</Text>
                </View>
              )}
              {team.regional_rank && (
                <View style={styles.rankItem}>
                  <Text style={styles.rankValue}>#{team.regional_rank}</Text>
                  <Text style={styles.rankLabel}>Regional</Text>
                </View>
              )}
              {team.state_rank && (
                <View style={styles.rankItem}>
                  <Text style={styles.rankValue}>#{team.state_rank}</Text>
                  <Text style={styles.rankLabel}>State</Text>
                </View>
              )}
              {team.gotsport_points && (
                <View style={styles.rankItem}>
                  <Text style={styles.rankValuePoints}>
                    {formatNumber(team.gotsport_points)}
                  </Text>
                  <Text style={styles.rankLabel}>Points</Text>
                </View>
              )}
            </View>
            {/* Goals For/Against row */}
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

        {/* ⚔️ PREDICT MATCH BUTTON */}
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
            <Text style={styles.predictTitle}>Predict Match</Text>
            <Text style={styles.predictSubtitle}>
              See how this team would fare vs any opponent
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#10b981" />
        </TouchableOpacity>

        {/* Season Stats */}
        <Text style={styles.sectionTitle}>Season Stats</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {calculatedStats.wins}-{calculatedStats.losses}-
              {calculatedStats.draws}
            </Text>
            <Text style={styles.statLabel}>Record (W-L-D)</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {calculatedStats.matchesPlayed}
            </Text>
            <Text style={styles.statLabel}>Games Played</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: "#22c55e" }]}>
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
            <Text style={[styles.statValue, { color: "#f59e0b" }]}>
              {calculatedStats.draws}
            </Text>
            <Text style={styles.statLabel}>Draws</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {calculatedStats.winPercentage}
            </Text>
            <Text style={styles.statLabel}>Win Rate</Text>
          </View>
        </View>
        {calculatedStats.source === "calculated" &&
          calculatedStats.matchesPlayed === 0 &&
          recentMatches.length > 0 && (
            <Text style={styles.statsNote}>
              Scores pending for {recentMatches.length} match
              {recentMatches.length > 1 ? "es" : ""}
            </Text>
          )}

        {/* Matches Section */}
        <View style={styles.tabsHeader}>
          <Text style={styles.sectionTitle}>Matches</Text>
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={[styles.tab, activeTab === "recent" && styles.activeTab]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveTab("recent");
              }}
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
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveTab("upcoming");
              }}
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
        </View>

        {/* Matches List */}
        {matchesToShow.length > 0 ? (
          <FlatList
            data={matchesToShow}
            renderItem={
              activeTab === "recent" ? renderRecentMatch : renderUpcomingMatch
            }
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            contentContainerStyle={styles.matchesList}
          />
        ) : (
          <View style={styles.emptyMatches}>
            <Ionicons
              name={
                activeTab === "recent" ? "football-outline" : "calendar-outline"
              }
              size={32}
              color="#374151"
            />
            <Text style={styles.emptyText}>
              {activeTab === "recent"
                ? "No recent matches found"
                : "No upcoming matches scheduled"}
            </Text>
            {activeTab === "upcoming" && (
              <Text style={styles.emptySubtext}>
                Check back later for schedule updates
              </Text>
            )}
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
    marginBottom: 16,
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
    marginBottom: 12,
  },
  // 🏆 CHAMPIONSHIP BADGES STYLES - NEW!
  badgesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
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
  badgeEmoji: {
    fontSize: 14,
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  // 📊 RANKING CARD STYLES - NEW!
  rankingCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  rankingHeader: {
    marginBottom: 12,
  },
  rankingTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  rankingGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 8,
  },
  rankItem: {
    alignItems: "center",
  },
  rankValue: {
    color: "#3B82F6",
    fontSize: 24,
    fontWeight: "bold",
  },
  rankValuePoints: {
    color: "#22c55e",
    fontSize: 20,
    fontWeight: "bold",
  },
  rankLabel: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 4,
  },
  goalsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  goalItem: {
    alignItems: "center",
  },
  goalValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  goalLabel: {
    color: "#6b7280",
    fontSize: 10,
    marginTop: 2,
  },
  eloSection: {
    alignItems: "center",
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    width: "100%",
  },
  eloGradeContainer: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
  },
  eloGrade: {
    fontSize: 48,
    fontWeight: "bold",
  },
  eloValue: {
    color: "#6b7280",
    fontSize: 24,
    fontWeight: "600",
  },
  eloLabel: {
    color: "#6b7280",
    fontSize: 14,
    marginTop: 4,
  },
  // ⚔️ Predict Match Button Styles
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
  predictEmoji: {
    fontSize: 22,
  },
  predictTextContainer: {
    flex: 1,
  },
  predictTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  predictSubtitle: {
    color: "#10b981",
    fontSize: 12,
    fontWeight: "500",
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
    marginBottom: 12,
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
  statsNote: {
    color: "#4b5563",
    fontSize: 11,
    fontStyle: "italic",
    textAlign: "center",
    marginBottom: 24,
  },
  tabsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  tabsContainer: {
    flexDirection: "row",
    backgroundColor: "#1F2937",
    borderRadius: 8,
    padding: 2,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  activeTab: {
    backgroundColor: "#3B82F6",
  },
  tabText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "600",
  },
  activeTabText: {
    color: "#fff",
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
  matchLocationText: {
    color: "#9ca3af",
    fontSize: 11,
    marginTop: 2,
  },
  matchScoreText: {
    color: "#9ca3af",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 12,
    marginRight: 8,
    minWidth: 50,
    textAlign: "center",
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
  emptySubtext: {
    color: "#4b5563",
    fontSize: 12,
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
