import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import LeaderboardHelp from "../../components/LeaderboardHelp";
import { supabase } from "../../lib/supabase";

// ============================================================
// INLINE DEVICE ID HELPER
// ============================================================

const DEVICE_ID_KEY = "@soccerview_device_id";

async function getDeviceId(): Promise<string> {
  try {
    const existingId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existingId) {
      return existingId;
    }
    // Generate a simple UUID
    const newId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      },
    );
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
  } catch (error) {
    console.error("Error getting device ID:", error);
    return `temp_${Date.now()}`;
  }
}

// ============================================================
// TYPES
// ============================================================

type LeaderboardEntry = {
  id: string;
  display_name: string;
  avatar_emoji: string;
  total_points: number;
  total_predictions: number;
  correct_predictions: number;
  exact_scores: number;
  current_streak: number;
  best_streak: number;
  accuracy_pct: number;
  rank: number;
};

type WeeklyEntry = {
  id: string;
  display_name: string;
  avatar_emoji: string;
  weekly_points: number;
  weekly_correct: number;
  current_streak: number;
  rank: number;
};

type UserStats = {
  display_name: string;
  avatar_emoji: string;
  total_points: number;
  total_predictions: number;
  correct_predictions: number;
  current_streak: number;
  best_streak: number;
  rank: number | null;
};

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function LeaderboardScreen() {
  const [activeTab, setActiveTab] = useState<"all_time" | "weekly">("all_time");
  const [allTimeData, setAllTimeData] = useState<LeaderboardEntry[]>([]);
  const [weeklyData, setWeeklyData] = useState<WeeklyEntry[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const deviceId = await getDeviceId();

      // Fetch all-time leaderboard
      const { data: allTime, error: allTimeError } = await supabase
        .from("leaderboard_all_time")
        .select("*")
        .limit(100);

      if (!allTimeError) {
        setAllTimeData((allTime as LeaderboardEntry[]) || []);
      }

      // Fetch weekly leaderboard
      const { data: weekly, error: weeklyError } = await supabase
        .from("leaderboard_weekly")
        .select("*")
        .limit(50);

      if (!weeklyError) {
        setWeeklyData((weekly as WeeklyEntry[]) || []);
      }

      // Fetch current user's stats
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("device_id", deviceId)
        .single();

      if (profile) {
        // Find user's rank
        const userRank =
          allTime?.find((e: any) => e.id === profile.id)?.rank || null;

        setUserStats({
          display_name: profile.display_name,
          avatar_emoji: profile.avatar_emoji,
          total_points: profile.total_points,
          total_predictions: profile.total_predictions,
          correct_predictions: profile.correct_predictions,
          current_streak: profile.current_streak,
          best_streak: profile.best_streak,
          rank: userRank,
        });
      }
    } catch (err) {
      console.error("Error loading leaderboard:", err);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const renderAllTimeItem = ({ item }: { item: LeaderboardEntry }) => {
    const isTopThree = item.rank <= 3;
    const medalEmoji =
      item.rank === 1
        ? "🥇"
        : item.rank === 2
          ? "🥈"
          : item.rank === 3
            ? "🥉"
            : null;

    return (
      <View style={[styles.leaderboardItem, isTopThree && styles.topThreeItem]}>
        <View style={styles.rankContainer}>
          {medalEmoji ? (
            <Text style={styles.medalEmoji}>{medalEmoji}</Text>
          ) : (
            <Text style={styles.rankText}>#{item.rank}</Text>
          )}
        </View>

        <Text style={styles.avatarEmoji}>{item.avatar_emoji}</Text>

        <View style={styles.userInfo}>
          <Text style={styles.displayName} numberOfLines={1}>
            {item.display_name}
          </Text>
          <Text style={styles.statsText}>
            {item.accuracy_pct}% accuracy • {item.total_predictions} predictions
          </Text>
        </View>

        <View style={styles.pointsContainer}>
          <Text style={styles.pointsText}>
            {item.total_points.toLocaleString()}
          </Text>
          <Text style={styles.pointsLabel}>pts</Text>
        </View>
      </View>
    );
  };

  const renderWeeklyItem = ({ item }: { item: WeeklyEntry }) => {
    const isTopThree = item.rank <= 3;
    const medalEmoji =
      item.rank === 1
        ? "🥇"
        : item.rank === 2
          ? "🥈"
          : item.rank === 3
            ? "🥉"
            : null;

    return (
      <View style={[styles.leaderboardItem, isTopThree && styles.topThreeItem]}>
        <View style={styles.rankContainer}>
          {medalEmoji ? (
            <Text style={styles.medalEmoji}>{medalEmoji}</Text>
          ) : (
            <Text style={styles.rankText}>#{item.rank}</Text>
          )}
        </View>

        <Text style={styles.avatarEmoji}>{item.avatar_emoji}</Text>

        <View style={styles.userInfo}>
          <Text style={styles.displayName} numberOfLines={1}>
            {item.display_name}
          </Text>
          <Text style={styles.statsText}>
            {item.weekly_correct} correct this week
            {item.current_streak > 0 && ` • 🔥${item.current_streak}`}
          </Text>
        </View>

        <View style={styles.pointsContainer}>
          <Text style={styles.pointsText}>
            {item.weekly_points.toLocaleString()}
          </Text>
          <Text style={styles.pointsLabel}>pts</Text>
        </View>
      </View>
    );
  };

  const renderUserCard = () => {
    if (!userStats) {
      return (
        <TouchableOpacity
          style={styles.userCardEmpty}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/predict");
          }}
        >
          <Ionicons name="person-add" size={24} color="#3B82F6" />
          <View style={styles.emptyTextContainer}>
            <Text style={styles.emptyTitle}>Start Predicting!</Text>
            <Text style={styles.emptySubtitle}>
              Make predictions to join the leaderboard
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#6b7280" />
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.userCard}>
        <View style={styles.userCardHeader}>
          <Text style={styles.userCardTitle}>Your Stats</Text>
          {userStats.rank && (
            <View style={styles.rankBadge}>
              <Text style={styles.rankBadgeText}>Rank #{userStats.rank}</Text>
            </View>
          )}
        </View>

        <View style={styles.userCardContent}>
          <Text style={styles.userAvatar}>{userStats.avatar_emoji}</Text>
          <View style={styles.userCardInfo}>
            <Text style={styles.userDisplayName}>{userStats.display_name}</Text>
            <Text style={styles.userPointsText}>
              {userStats.total_points.toLocaleString()} points
            </Text>
          </View>
        </View>

        <View style={styles.userStatsRow}>
          <View style={styles.userStatItem}>
            <Text style={styles.userStatValue}>
              {userStats.total_predictions}
            </Text>
            <Text style={styles.userStatLabel}>Predictions</Text>
          </View>
          <View style={styles.userStatItem}>
            <Text style={styles.userStatValue}>
              {userStats.correct_predictions}
            </Text>
            <Text style={styles.userStatLabel}>Correct</Text>
          </View>
          <View style={styles.userStatItem}>
            <Text style={styles.userStatValue}>
              {userStats.total_predictions > 0
                ? Math.round(
                    (userStats.correct_predictions /
                      userStats.total_predictions) *
                      100,
                  )
                : 0}
              %
            </Text>
            <Text style={styles.userStatLabel}>Accuracy</Text>
          </View>
          <View style={styles.userStatItem}>
            <Text style={styles.userStatValue}>
              {userStats.current_streak > 0
                ? `🔥${userStats.current_streak}`
                : "-"}
            </Text>
            <Text style={styles.userStatLabel}>Streak</Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading leaderboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

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
        <Text style={styles.title}>🏆 Top Predictors</Text>
        <TouchableOpacity
          style={styles.helpButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowHelp(true);
          }}
        >
          <Ionicons name="help-circle-outline" size={26} color="#3B82F6" />
        </TouchableOpacity>
      </View>

      {/* User Stats Card */}
      {renderUserCard()}

      {/* Tab Switcher */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "all_time" && styles.activeTab]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setActiveTab("all_time");
          }}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "all_time" && styles.activeTabText,
            ]}
          >
            All Time
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "weekly" && styles.activeTab]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setActiveTab("weekly");
          }}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "weekly" && styles.activeTabText,
            ]}
          >
            This Week
          </Text>
        </TouchableOpacity>
      </View>

      {/* Leaderboard List */}
      {activeTab === "all_time" ? (
        <FlatList
          data={allTimeData}
          renderItem={renderAllTimeItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🏆</Text>
              <Text style={styles.emptyListTitle}>No predictions yet</Text>
              <Text style={styles.emptyListText}>
                Be the first to make a prediction and claim the top spot!
              </Text>
              <TouchableOpacity
                style={styles.makePredictionButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/predict");
                }}
              >
                <Text style={styles.makePredictionButtonText}>
                  Make a Prediction
                </Text>
              </TouchableOpacity>
            </View>
          }
        />
      ) : (
        <FlatList
          data={weeklyData}
          renderItem={renderWeeklyItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📅</Text>
              <Text style={styles.emptyListTitle}>Fresh week!</Text>
              <Text style={styles.emptyListText}>
                Make predictions this week to appear on the weekly leaderboard.
              </Text>
              <TouchableOpacity
                style={styles.makePredictionButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/predict");
                }}
              >
                <Text style={styles.makePredictionButtonText}>
                  Make a Prediction
                </Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Help Bottom Sheet */}
      <LeaderboardHelp visible={showHelp} onClose={() => setShowHelp(false)} />
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  helpButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
  },

  // User Card
  userCard: {
    margin: 16,
    padding: 16,
    backgroundColor: "#111",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  userCardEmpty: {
    margin: 16,
    padding: 16,
    backgroundColor: "#111",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  emptyTextContainer: {
    flex: 1,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  emptySubtitle: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 2,
  },
  userCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  userCardTitle: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
  },
  rankBadge: {
    backgroundColor: "rgba(59, 130, 246, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  rankBadgeText: {
    color: "#3B82F6",
    fontSize: 13,
    fontWeight: "600",
  },
  userCardContent: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  userAvatar: {
    fontSize: 40,
    marginRight: 12,
  },
  userCardInfo: {
    flex: 1,
  },
  userDisplayName: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  userPointsText: {
    color: "#f59e0b",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 2,
  },
  userStatsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  userStatItem: {
    alignItems: "center",
  },
  userStatValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  userStatLabel: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },

  // Tabs
  tabContainer: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "#1F2937",
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 10,
  },
  activeTab: {
    backgroundColor: "#3B82F6",
  },
  tabText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
  },
  activeTabText: {
    color: "#fff",
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    flexGrow: 1,
  },
  leaderboardItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    backgroundColor: "#111",
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  topThreeItem: {
    borderColor: "rgba(245, 158, 11, 0.3)",
    backgroundColor: "rgba(245, 158, 11, 0.05)",
  },
  rankContainer: {
    width: 40,
    alignItems: "center",
  },
  medalEmoji: {
    fontSize: 24,
  },
  rankText: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "600",
  },
  avatarEmoji: {
    fontSize: 28,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  displayName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  statsText: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 2,
  },
  pointsContainer: {
    alignItems: "flex-end",
  },
  pointsText: {
    color: "#f59e0b",
    fontSize: 18,
    fontWeight: "bold",
  },
  pointsLabel: {
    color: "#6b7280",
    fontSize: 11,
  },

  // Empty State
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 60,
    flex: 1,
    justifyContent: "center",
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyListTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyListText: {
    color: "#9ca3af",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 40,
    marginBottom: 20,
  },
  makePredictionButton: {
    backgroundColor: "#3B82F6",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  makePredictionButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
