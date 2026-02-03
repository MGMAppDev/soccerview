/**
 * SkeletonLoader - Industry-standard loading placeholders
 *
 * Provides skeleton UI components for perceived performance optimization.
 * Used by Twitter/X, Instagram, and other major apps.
 *
 * Features:
 * - Shimmer animation for visual feedback
 * - Configurable shapes (team cards, match cards, etc.)
 * - Dark theme compatible
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, ViewStyle } from "react-native";

// Shimmer animation configuration
const SHIMMER_DURATION = 1200;

interface SkeletonBoxProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * Basic skeleton box with shimmer animation
 */
export function SkeletonBox({
  width,
  height,
  borderRadius = 4,
  style,
}: SkeletonBoxProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: SHIMMER_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: SHIMMER_DURATION,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [shimmerAnim]);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.6],
  });

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: "#374151",
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * Skeleton placeholder for a team card
 */
export function TeamCardSkeleton() {
  return (
    <View style={styles.teamCard}>
      <View style={styles.teamCardContent}>
        <View style={styles.teamCardInfo}>
          {/* Team name */}
          <SkeletonBox width="70%" height={18} borderRadius={4} />
          {/* Meta info (state, gender, age) */}
          <SkeletonBox
            width="40%"
            height={14}
            borderRadius={4}
            style={{ marginTop: 8 }}
          />
          {/* Record */}
          <SkeletonBox
            width="30%"
            height={12}
            borderRadius={4}
            style={{ marginTop: 8 }}
          />
        </View>
        {/* ELO grade */}
        <View style={styles.teamCardElo}>
          <SkeletonBox width={40} height={32} borderRadius={4} />
          <SkeletonBox
            width={30}
            height={12}
            borderRadius={4}
            style={{ marginTop: 4 }}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Skeleton placeholder for a match card
 */
export function MatchCardSkeleton() {
  return (
    <View style={styles.matchCard}>
      {/* Date badge */}
      <View style={styles.matchCardHeader}>
        <SkeletonBox width={50} height={24} borderRadius={6} />
        <SkeletonBox
          width="50%"
          height={14}
          borderRadius={4}
          style={{ marginLeft: 12 }}
        />
      </View>
      {/* Teams */}
      <View style={styles.matchCardTeams}>
        <SkeletonBox width="60%" height={16} borderRadius={4} />
        <SkeletonBox
          width="60%"
          height={16}
          borderRadius={4}
          style={{ marginTop: 8 }}
        />
      </View>
      {/* Score */}
      <View style={styles.matchCardScore}>
        <SkeletonBox width={40} height={20} borderRadius={4} />
      </View>
    </View>
  );
}

/**
 * Multiple team card skeletons for list loading state
 */
export function TeamListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <View style={styles.listContainer}>
      {Array.from({ length: count }).map((_, i) => (
        <TeamCardSkeleton key={i} />
      ))}
    </View>
  );
}

/**
 * Multiple match card skeletons for list loading state
 */
export function MatchListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View style={styles.listContainer}>
      {Array.from({ length: count }).map((_, i) => (
        <MatchCardSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  listContainer: {
    paddingHorizontal: 16,
  },
  teamCard: {
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  teamCardContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  teamCardInfo: {
    flex: 1,
    marginRight: 12,
  },
  teamCardElo: {
    alignItems: "center",
    minWidth: 60,
  },
  matchCard: {
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  matchCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  matchCardTeams: {
    flex: 1,
  },
  matchCardScore: {
    position: "absolute",
    right: 16,
    top: "50%",
  },
});
