/**
 * MatchCard - Shared component for consistent match card display across all tabs
 *
 * This single source of truth ensures ALL match cards look identical everywhere.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

// Standard match data interface
export interface MatchCardData {
  id: string;
  match_date: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  age_group?: string | null;
  gender?: string | null;
  event_name?: string | null;
}

interface MatchCardProps {
  match: MatchCardData;
  onPress?: () => void;
}

function formatDateBadge(isoDate: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function MatchCard({ match, onPress }: MatchCardProps) {
  const dateBadge = formatDateBadge(match.match_date);
  const hasScore = match.home_score !== null && match.away_score !== null;

  // Build division text (age_group + gender)
  const divisionParts: string[] = [];
  if (match.age_group) divisionParts.push(match.age_group);
  if (match.gender) divisionParts.push(match.gender);
  const divisionStr = divisionParts.join(" · ");

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onPress) {
      onPress();
    } else {
      router.push(`/match/${match.id}`);
    }
  };

  return (
    <TouchableOpacity
      style={styles.matchCard}
      activeOpacity={0.7}
      onPress={handlePress}
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
      {match.event_name && match.event_name !== "GotSport" && (
        <Text style={styles.eventName} numberOfLines={1}>
          {match.event_name}
        </Text>
      )}

      {/* Main content row: Teams + Score */}
      <View style={styles.matchTeamsRow}>
        {/* Teams column - vertical layout */}
        <View style={styles.matchTeamsContainer}>
          <Text style={styles.teamName}>
            {match.home_team_name ?? "Home Team"}
          </Text>
          <Text style={styles.vsText}>vs</Text>
          <Text style={styles.teamName}>
            {match.away_team_name ?? "Away Team"}
          </Text>
        </View>

        {/* Score */}
        {hasScore && (
          <Text style={styles.scoreText}>
            {match.home_score} - {match.away_score}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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

export default MatchCard;
