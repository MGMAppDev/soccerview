import { getDeviceId } from "./deviceId";
import { supabase } from "./supabase";

// ============================================================
// TYPES
// ============================================================

export type UserProfile = {
  id: string;
  device_id: string;
  display_name: string;
  avatar_emoji: string;
  total_predictions: number;
  correct_predictions: number;
  exact_scores: number;
  within_one_goal: number;
  within_two_goals: number;
  total_points: number;
  current_streak: number;
  best_streak: number;
  weekly_points: number;
  weekly_correct: number;
  created_at: string;
  updated_at: string;
};

// Available emoji avatars
export const AVATAR_EMOJIS = [
  "⚽",
  "🥅",
  "🏆",
  "⭐",
  "🔥",
  "💪",
  "🎯",
  "👑",
  "🦁",
  "🐯",
  "🦅",
  "🐺",
  "🦈",
  "🐉",
  "🦄",
  "🐝",
  "😎",
  "🤩",
  "😤",
  "🧠",
  "👀",
  "💀",
  "👻",
  "🤖",
  "🚀",
  "💎",
  "⚡",
  "🌟",
  "❤️",
  "💜",
  "💙",
  "💚",
];

// ============================================================
// PROFILE FUNCTIONS
// ============================================================

/**
 * Get current user's profile, or null if not set up
 */
export async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const deviceId = await getDeviceId();

    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("device_id", deviceId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned (not an error)
      console.error("Error fetching profile:", error);
    }

    return data as UserProfile | null;
  } catch (error) {
    console.error("Error getting user profile:", error);
    return null;
  }
}

/**
 * Create or update user profile with display name and avatar
 */
export async function saveUserProfile(
  displayName: string,
  avatarEmoji: string,
): Promise<UserProfile | null> {
  try {
    const deviceId = await getDeviceId();

    const { data, error } = await supabase
      .from("user_profiles")
      .upsert(
        {
          device_id: deviceId,
          display_name: displayName.trim() || "Anonymous",
          avatar_emoji: avatarEmoji || "⚽",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "device_id",
        },
      )
      .select()
      .single();

    if (error) {
      console.error("Error saving profile:", error);
      return null;
    }

    return data as UserProfile;
  } catch (error) {
    console.error("Error saving user profile:", error);
    return null;
  }
}

/**
 * Increment prediction count for user (called when making a prediction)
 * Note: Points are awarded later when match results come in
 */
export async function incrementPredictionCount(): Promise<void> {
  try {
    const deviceId = await getDeviceId();

    // First ensure profile exists
    const { data: existing } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("device_id", deviceId)
      .single();

    if (!existing) {
      // Create default profile
      await supabase.from("user_profiles").insert({
        device_id: deviceId,
        display_name: "Anonymous",
        avatar_emoji: "⚽",
      });
    }

    // Increment total_predictions
    // Note: We use raw SQL update via RPC for atomic increment
    // For now, we'll just ensure the profile exists - points are awarded via the SQL function
  } catch (error) {
    console.error("Error incrementing prediction count:", error);
  }
}

/**
 * Check if user has set up their profile
 */
export async function hasProfileSetup(): Promise<boolean> {
  const profile = await getUserProfile();
  return profile !== null && profile.display_name !== "Anonymous";
}

/**
 * Get user's rank on the leaderboard
 */
export async function getUserRank(): Promise<number | null> {
  try {
    const deviceId = await getDeviceId();

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("device_id", deviceId)
      .single();

    if (!profile) return null;

    const { data: leaderboard } = await supabase
      .from("leaderboard_all_time")
      .select("id, rank")
      .eq("id", profile.id)
      .single();

    return leaderboard?.rank || null;
  } catch (error) {
    console.error("Error getting user rank:", error);
    return null;
  }
}
