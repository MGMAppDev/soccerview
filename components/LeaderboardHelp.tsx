import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ============================================================
// TYPES
// ============================================================

type LeaderboardHelpProps = {
  visible: boolean;
  onClose: () => void;
};

// ============================================================
// COMPONENT
// ============================================================

export default function LeaderboardHelp({
  visible,
  onClose,
}: LeaderboardHelpProps) {
  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />

        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerEmoji}>🏆</Text>
            <Text style={styles.headerTitle}>How Top Predictors Works</Text>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <Ionicons name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* Intro */}
            <Text style={styles.introText}>
              Compete against other fans by predicting match scores! The most
              accurate predictors climb the leaderboard.
            </Text>

            {/* How It Works */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📋 How It Works</Text>

              <View style={styles.step}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>1</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Make a Prediction</Text>
                  <Text style={styles.stepText}>
                    Select two teams and predict what YOU think the final score
                    will be before the match happens.
                  </Text>
                </View>
              </View>

              <View style={styles.step}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>2</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Watch the Game</Text>
                  <Text style={styles.stepText}>
                    Your prediction is locked in. Watch to see if your soccer
                    instincts were right!
                  </Text>
                </View>
              </View>

              <View style={styles.step}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>3</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Earn Points</Text>
                  <Text style={styles.stepText}>
                    When actual results come in, you'll earn points based on how
                    accurate your prediction was.
                  </Text>
                </View>
              </View>
            </View>

            {/* Points System */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⭐ Points System</Text>

              <View style={styles.pointsTable}>
                <View style={styles.pointsRow}>
                  <View style={styles.pointsIcon}>
                    <Text style={styles.pointsEmoji}>✅</Text>
                  </View>
                  <Text style={styles.pointsLabel}>Correct Winner</Text>
                  <Text style={styles.pointsValue}>+10 pts</Text>
                </View>

                <View style={styles.pointsRow}>
                  <View style={styles.pointsIcon}>
                    <Text style={styles.pointsEmoji}>🤝</Text>
                  </View>
                  <Text style={styles.pointsLabel}>Correct Draw</Text>
                  <Text style={styles.pointsValue}>+15 pts</Text>
                </View>

                <View style={[styles.pointsRow, styles.bonusRow]}>
                  <View style={styles.pointsIcon}>
                    <Text style={styles.pointsEmoji}>🎯</Text>
                  </View>
                  <Text style={styles.pointsLabel}>Exact Score Bonus</Text>
                  <Text style={[styles.pointsValue, styles.bonusValue]}>
                    +25 pts
                  </Text>
                </View>

                <View style={styles.pointsRow}>
                  <View style={styles.pointsIcon}>
                    <Text style={styles.pointsEmoji}>❌</Text>
                  </View>
                  <Text style={styles.pointsLabel}>Wrong Prediction</Text>
                  <Text style={[styles.pointsValue, styles.zeroValue]}>
                    +0 pts
                  </Text>
                </View>
              </View>

              <View style={styles.exampleBox}>
                <Text style={styles.exampleTitle}>💡 Example</Text>
                <Text style={styles.exampleText}>
                  You predict Team A wins 2-1. The actual score is 2-1.
                </Text>
                <Text style={styles.exampleResult}>
                  You earn <Text style={styles.highlightGreen}>10 pts</Text>{" "}
                  (correct winner) +{" "}
                  <Text style={styles.highlightGold}>25 pts</Text> (exact score)
                  = <Text style={styles.highlightTotal}>35 points!</Text>
                </Text>
              </View>
            </View>

            {/* Streaks */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🔥 Streaks</Text>
              <Text style={styles.sectionText}>
                Get consecutive correct predictions to build a streak! Your
                current streak and best streak are displayed on your profile.
                Keep the fire going!
              </Text>
            </View>

            {/* Weekly vs All-Time */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📊 Leaderboards</Text>

              <View style={styles.leaderboardInfo}>
                <View style={styles.leaderboardItem}>
                  <Text style={styles.leaderboardEmoji}>🏆</Text>
                  <Text style={styles.leaderboardTitle}>All-Time</Text>
                  <Text style={styles.leaderboardDesc}>
                    Your total points accumulated since you started. The
                    ultimate measure of prediction mastery!
                  </Text>
                </View>

                <View style={styles.leaderboardItem}>
                  <Text style={styles.leaderboardEmoji}>📅</Text>
                  <Text style={styles.leaderboardTitle}>This Week</Text>
                  <Text style={styles.leaderboardDesc}>
                    Resets every week. Perfect for newer users to compete
                    against everyone on equal footing!
                  </Text>
                </View>
              </View>
            </View>

            {/* Tips */}
            <View style={[styles.section, styles.lastSection]}>
              <Text style={styles.sectionTitle}>💪 Pro Tips</Text>

              <View style={styles.tipsList}>
                <View style={styles.tip}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>
                    Check team stats before predicting - ELO ratings, recent
                    form, and head-to-head history matter!
                  </Text>
                </View>
                <View style={styles.tip}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>
                    Draws are rare but worth 15 points - only predict a draw
                    when teams are evenly matched.
                  </Text>
                </View>
                <View style={styles.tip}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>
                    Exact scores are hard but give massive bonus points. High
                    risk, high reward!
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Footer Button */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.gotItButton} onPress={handleClose}>
              <Text style={styles.gotItButtonText}>Got It!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: "#1F2937",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 12,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: "#4b5563",
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  headerEmoji: {
    fontSize: 28,
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  closeButton: {
    padding: 4,
  },
  content: {
    padding: 20,
  },
  introText: {
    color: "#d1d5db",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  section: {
    marginBottom: 28,
  },
  lastSection: {
    marginBottom: 0,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "bold",
    marginBottom: 16,
  },
  sectionText: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 20,
  },

  // Steps
  step: {
    flexDirection: "row",
    marginBottom: 16,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#3B82F6",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  stepNumberText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  stepText: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 18,
  },

  // Points Table
  pointsTable: {
    backgroundColor: "#111",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
  },
  pointsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  bonusRow: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
  },
  pointsIcon: {
    width: 32,
    alignItems: "center",
  },
  pointsEmoji: {
    fontSize: 18,
  },
  pointsLabel: {
    flex: 1,
    color: "#d1d5db",
    fontSize: 14,
  },
  pointsValue: {
    color: "#10b981",
    fontSize: 14,
    fontWeight: "bold",
  },
  bonusValue: {
    color: "#f59e0b",
  },
  zeroValue: {
    color: "#6b7280",
  },

  // Example Box
  exampleBox: {
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: "#3B82F6",
  },
  exampleTitle: {
    color: "#3B82F6",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  exampleText: {
    color: "#d1d5db",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  exampleResult: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 18,
  },
  highlightGreen: {
    color: "#10b981",
    fontWeight: "bold",
  },
  highlightGold: {
    color: "#f59e0b",
    fontWeight: "bold",
  },
  highlightTotal: {
    color: "#fff",
    fontWeight: "bold",
  },

  // Leaderboard Info
  leaderboardInfo: {
    flexDirection: "row",
    gap: 12,
  },
  leaderboardItem: {
    flex: 1,
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  leaderboardEmoji: {
    fontSize: 28,
    marginBottom: 8,
  },
  leaderboardTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 6,
  },
  leaderboardDesc: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },

  // Tips
  tipsList: {
    gap: 10,
  },
  tip: {
    flexDirection: "row",
  },
  tipBullet: {
    color: "#3B82F6",
    fontSize: 14,
    marginRight: 8,
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 18,
  },

  // Footer
  footer: {
    padding: 20,
    paddingTop: 0,
  },
  gotItButton: {
    backgroundColor: "#3B82F6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  gotItButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
