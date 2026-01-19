import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

const DEVICE_ID_KEY = "@soccerview_device_id";

/**
 * Get or create a unique device ID for this user.
 * The ID is stored locally and persists across app sessions.
 */
export async function getDeviceId(): Promise<string> {
  try {
    // Check if we already have a device ID
    const existingId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existingId) {
      return existingId;
    }

    // Generate a new UUID
    const newId = Crypto.randomUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
  } catch (error) {
    console.error("Error getting device ID:", error);
    // Fallback: generate a temporary ID (won't persist)
    return `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

/**
 * Clear the device ID (useful for testing or account reset)
 */
export async function clearDeviceId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DEVICE_ID_KEY);
  } catch (error) {
    console.error("Error clearing device ID:", error);
  }
}
