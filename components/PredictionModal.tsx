import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { submitUserPrediction } from "../lib/userPredictions";

type TeamInfo = {
  name: string;
  state?: string;
  ageGroup?: string;
  gender?: string;
};

type PredictionModalProps = {
  visible: boolean;
  onClose: () => void;
  teamA: TeamInfo;
  teamB: TeamInfo;
  onPredictionSubmitted?: () => void;
};

export default function PredictionModal({
  visible,
  onClose,
  teamA,
  teamB,
  onPredictionSubmitted,
}: PredictionModalProps) {
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setScoreA(0);
    setScoreB(0);
    setSubmitted(false);
    setError(null);
    onClose();
  };

  const adjustScore = (team: "A" | "B", delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (team === "A") {
      setScoreA((prev) => Math.max(0, Math.min(15, prev + delta)));
    } else {
      setScoreB((prev) => Math.max(0, Math.min(15, prev + delta)));
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await submitUserPrediction({
        teamAName: teamA.name,
        teamBName: teamB.name,
        teamAState: teamA.state,
        teamBState: teamB.state,
        ageGroup: teamA.ageGroup,
        gender: teamA.gender,
        predictedScoreA: scoreA,
        predictedScoreB: scoreB,
      });

      if (result) {
        setSubmitted(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (onPredictionSubmitted) {
          onPredictionSubmitted();
        }
        setTimeout(() => {
          handleClose();
        }, 2000);
      } else {
        setError("Failed to submit prediction. Please try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err) {
      console.error("Error submitting prediction:", err);
      setError("Something went wrong. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  // FIXED: Use shorter display name for outcome text
  const getShortName = (fullName: string): string => {
    // Try to get first 2-3 meaningful words
    const words = fullName.split(" ").filter((w) => w.length > 0);
    if (words.length <= 2) return fullName;
    // Take first 2 words, skip common suffixes like "FC", "SC", "Soccer Club"
    const skipWords = ["fc", "sc", "soccer", "club", "academy", "united"];
    const meaningful = words.filter(
      (w) => !skipWords.includes(w.toLowerCase()),
    );
    return meaningful.slice(0, 2).join(" ");
  };

  const getOutcomeText = () => {
    if (scoreA > scoreB) {
      return `${getShortName(teamA.name)} wins`;
    } else if (scoreB > scoreA) {
      return `${getShortName(teamB.name)} wins`;
    } else {
      return "Draw";
    }
  };

  const getPotentialPoints = () => {
    if (scoreA === scoreB) {
      return { winner: 15, exact: 25, total: 40 };
    }
    return { winner: 10, exact: 25, total: 35 };
  };

  const potentialPoints = getPotentialPoints();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerEmoji}>🎯</Text>
            <Text style={styles.headerTitle}>Your Prediction</Text>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <Ionicons name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            What do YOU think the final score will be?
          </Text>

          {/* Scrollable content for long team names */}
          <ScrollView
            style={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Score Selection */}
            <View style={styles.scoreContainer}>
              {/* Team A */}
              <View style={styles.teamColumn}>
                {/* FIXED: Show full team name with scroll capability */}
                <View style={styles.teamNameContainer}>
                  <Text style={styles.teamName} numberOfLines={3}>
                    {teamA.name}
                  </Text>
                </View>
                {/* FIXED: Show correct state for THIS team */}
                {teamA.state && (
                  <Text style={styles.teamState}>{teamA.state}</Text>
                )}
                <View style={styles.scoreSelector}>
                  <TouchableOpacity
                    style={[
                      styles.scoreButton,
                      scoreA === 0 && styles.scoreButtonDisabled,
                    ]}
                    onPress={() => adjustScore("A", -1)}
                    disabled={scoreA === 0}
                  >
                    <Ionicons
                      name="remove"
                      size={24}
                      color={scoreA === 0 ? "#4b5563" : "#fff"}
                    />
                  </TouchableOpacity>
                  <View style={styles.scoreDisplay}>
                    <Text style={styles.scoreText}>{scoreA}</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.scoreButton,
                      scoreA === 15 && styles.scoreButtonDisabled,
                    ]}
                    onPress={() => adjustScore("A", 1)}
                    disabled={scoreA === 15}
                  >
                    <Ionicons
                      name="add"
                      size={24}
                      color={scoreA === 15 ? "#4b5563" : "#fff"}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* VS */}
              <View style={styles.vsContainer}>
                <Text style={styles.vsText}>vs</Text>
              </View>

              {/* Team B */}
              <View style={styles.teamColumn}>
                {/* FIXED: Show full team name with scroll capability */}
                <View style={styles.teamNameContainer}>
                  <Text style={styles.teamName} numberOfLines={3}>
                    {teamB.name}
                  </Text>
                </View>
                {/* FIXED: Show correct state for THIS team (not teamA.state!) */}
                {teamB.state && (
                  <Text style={styles.teamState}>{teamB.state}</Text>
                )}
                <View style={styles.scoreSelector}>
                  <TouchableOpacity
                    style={[
                      styles.scoreButton,
                      scoreB === 0 && styles.scoreButtonDisabled,
                    ]}
                    onPress={() => adjustScore("B", -1)}
                    disabled={scoreB === 0}
                  >
                    <Ionicons
                      name="remove"
                      size={24}
                      color={scoreB === 0 ? "#4b5563" : "#fff"}
                    />
                  </TouchableOpacity>
                  <View style={styles.scoreDisplay}>
                    <Text style={styles.scoreText}>{scoreB}</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.scoreButton,
                      scoreB === 15 && styles.scoreButtonDisabled,
                    ]}
                    onPress={() => adjustScore("B", 1)}
                    disabled={scoreB === 15}
                  >
                    <Ionicons
                      name="add"
                      size={24}
                      color={scoreB === 15 ? "#4b5563" : "#fff"}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Summary Card */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Your Prediction:</Text>
                <Text style={styles.summaryValue}>
                  {scoreA} - {scoreB}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Outcome:</Text>
                <Text style={styles.summaryOutcome}>{getOutcomeText()}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.pointsPreview}>
                <Text style={styles.pointsPreviewTitle}>Potential Points:</Text>
                <View style={styles.pointsBreakdown}>
                  <View style={styles.pointsItem}>
                    <Text style={styles.pointsItemLabel}>
                      {scoreA === scoreB ? "Draw correct" : "Winner correct"}
                    </Text>
                    <Text style={styles.pointsItemValue}>
                      +{potentialPoints.winner} pts
                    </Text>
                  </View>
                  <View style={styles.pointsItem}>
                    <Text style={styles.pointsItemLabel}>
                      Exact score bonus
                    </Text>
                    <Text style={[styles.pointsItemValue, styles.bonusPoints]}>
                      +{potentialPoints.exact} pts
                    </Text>
                  </View>
                  <View style={[styles.pointsItem, styles.totalRow]}>
                    <Text style={styles.totalLabel}>Max possible:</Text>
                    <Text style={styles.totalValue}>
                      {potentialPoints.total} pts
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Error */}
          {error && (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={16} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Success / Submit */}
          {submitted ? (
            <View style={styles.successContainer}>
              <Ionicons name="checkmark-circle" size={48} color="#10b981" />
              <Text style={styles.successTitle}>Prediction Submitted!</Text>
              <Text style={styles.successText}>
                Good luck! You will earn points when results come in.
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.submitButton,
                submitting && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="send" size={20} color="#fff" />
                  <Text style={styles.submitButtonText}>
                    Lock In Prediction
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {!submitted && (
            <Text style={styles.infoText}>
              Predictions are final and cannot be changed
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  container: {
    backgroundColor: "#1F2937",
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 16,
    maxHeight: "90%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  headerEmoji: {
    fontSize: 28,
    marginRight: 10,
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
  },
  closeButton: {
    padding: 4,
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: 14,
    marginBottom: 20,
  },
  scrollContent: {
    flexGrow: 0,
  },
  scoreContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  teamColumn: {
    flex: 1,
    alignItems: "center",
  },
  // FIXED: Container for team name allows proper height
  teamNameContainer: {
    minHeight: 48,
    maxHeight: 72,
    justifyContent: "center",
    marginBottom: 4,
  },
  teamName: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
  },
  teamState: {
    color: "#6b7280",
    fontSize: 11,
    marginBottom: 12,
  },
  scoreSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scoreButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#374151",
    justifyContent: "center",
    alignItems: "center",
  },
  scoreButtonDisabled: {
    opacity: 0.5,
  },
  scoreDisplay: {
    width: 50,
    height: 50,
    borderRadius: 10,
    backgroundColor: "#111",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#3B82F6",
  },
  scoreText: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
  },
  vsContainer: {
    paddingHorizontal: 8,
    paddingTop: 30,
  },
  vsText: {
    color: "#6b7280",
    fontSize: 16,
    fontWeight: "600",
  },
  summaryCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  summaryLabel: {
    color: "#9ca3af",
    fontSize: 14,
  },
  summaryValue: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  summaryOutcome: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginVertical: 12,
  },
  pointsPreview: {},
  pointsPreviewTitle: {
    color: "#9ca3af",
    fontSize: 12,
    marginBottom: 8,
  },
  pointsBreakdown: {
    gap: 6,
  },
  pointsItem: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  pointsItemLabel: {
    color: "#6b7280",
    fontSize: 13,
  },
  pointsItemValue: {
    color: "#10b981",
    fontSize: 13,
    fontWeight: "600",
  },
  bonusPoints: {
    color: "#f59e0b",
  },
  totalRow: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  totalLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  totalValue: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 13,
    flex: 1,
  },
  successContainer: {
    alignItems: "center",
    paddingVertical: 20,
  },
  successTitle: {
    color: "#10b981",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 12,
  },
  successText: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 6,
    textAlign: "center",
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3B82F6",
    paddingVertical: 16,
    borderRadius: 12,
    gap: 10,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  infoText: {
    color: "#6b7280",
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
  },
});
