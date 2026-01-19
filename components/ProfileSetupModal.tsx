import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { AVATAR_EMOJIS, saveUserProfile } from "../lib/userProfile";

// ============================================================
// TYPES
// ============================================================

type ProfileSetupModalProps = {
  visible: boolean;
  onComplete: (displayName: string, avatarEmoji: string) => void;
  onSkip?: () => void;
};

// ============================================================
// COMPONENT
// ============================================================

export default function ProfileSetupModal({
  visible,
  onComplete,
  onSkip,
}: ProfileSetupModalProps) {
  const [displayName, setDisplayName] = useState("");
  const [selectedEmoji, setSelectedEmoji] = useState("⚽");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!displayName.trim()) {
      setError("Please enter a display name");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    if (displayName.trim().length < 2) {
      setError("Name must be at least 2 characters");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    if (displayName.trim().length > 20) {
      setError("Name must be 20 characters or less");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const profile = await saveUserProfile(displayName.trim(), selectedEmoji);

      if (profile) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onComplete(displayName.trim(), selectedEmoji);
      } else {
        setError("Failed to save profile. Please try again.");
      }
    } catch (err) {
      console.error("Error saving profile:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onSkip) {
      onSkip();
    } else {
      // Default behavior: save as Anonymous
      saveUserProfile("Anonymous", "⚽");
      onComplete("Anonymous", "⚽");
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.overlay}>
          <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.emoji}>🏆</Text>
              <Text style={styles.title}>Join the Leaderboard!</Text>
              <Text style={styles.subtitle}>
                Set up your profile to track your prediction accuracy and
                compete with others
              </Text>
            </View>

            {/* Display Name Input */}
            <View style={styles.inputSection}>
              <Text style={styles.label}>Display Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your name..."
                placeholderTextColor="#6b7280"
                value={displayName}
                onChangeText={(text) => {
                  setDisplayName(text);
                  setError(null);
                }}
                maxLength={20}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {error && <Text style={styles.errorText}>{error}</Text>}
            </View>

            {/* Avatar Emoji Selection */}
            <View style={styles.inputSection}>
              <Text style={styles.label}>Choose Your Avatar</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.emojiScroll}
                contentContainerStyle={styles.emojiScrollContent}
              >
                {AVATAR_EMOJIS.map((emoji) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[
                      styles.emojiButton,
                      selectedEmoji === emoji && styles.emojiButtonSelected,
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedEmoji(emoji);
                    }}
                  >
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Preview */}
            <View style={styles.previewSection}>
              <Text style={styles.previewLabel}>Preview</Text>
              <View style={styles.previewCard}>
                <Text style={styles.previewEmoji}>{selectedEmoji}</Text>
                <Text style={styles.previewName}>
                  {displayName.trim() || "Your Name"}
                </Text>
              </View>
            </View>

            {/* Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    <Text style={styles.primaryButtonText}>Save Profile</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleSkip}
                disabled={saving}
              >
                <Text style={styles.secondaryButtonText}>Skip for now</Text>
              </TouchableOpacity>
            </View>

            {/* Info */}
            <Text style={styles.infoText}>
              You can change your profile anytime from Settings
            </Text>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  container: {
    backgroundColor: "#1F2937",
    borderRadius: 20,
    padding: 24,
    maxHeight: "85%",
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  inputSection: {
    marginBottom: 20,
  },
  label: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 14,
    color: "#fff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  errorText: {
    color: "#ef4444",
    fontSize: 12,
    marginTop: 6,
  },
  emojiScroll: {
    maxHeight: 60,
  },
  emojiScrollContent: {
    paddingRight: 16,
  },
  emojiButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#111",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    borderWidth: 2,
    borderColor: "transparent",
  },
  emojiButtonSelected: {
    borderColor: "#3B82F6",
    backgroundColor: "rgba(59, 130, 246, 0.2)",
  },
  emojiText: {
    fontSize: 24,
  },
  previewSection: {
    alignItems: "center",
    marginBottom: 24,
  },
  previewLabel: {
    color: "#6b7280",
    fontSize: 12,
    marginBottom: 8,
  },
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 12,
  },
  previewEmoji: {
    fontSize: 32,
  },
  previewName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  primaryButton: {
    backgroundColor: "#3B82F6",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "transparent",
  },
  secondaryButtonText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  infoText: {
    color: "#6b7280",
    fontSize: 12,
    textAlign: "center",
    marginTop: 16,
  },
});
