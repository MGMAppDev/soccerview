import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SentryBrowser from "@sentry/browser";
import * as SentryNative from "@sentry/react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";

const SENTRY_DSN =
  "https://c708a446fcce75c1d57840c9ce4b09d5@o4510681007718400.ingest.us.sentry.io/4510681033932800";

const ONBOARDING_KEY = "soccerview_onboarding_complete";

// Initialize Sentry based on platform
if (Platform.OS === "web") {
  SentryBrowser.init({
    dsn: SENTRY_DSN,
    debug: __DEV__,
    tracesSampleRate: 1.0,
  });
} else {
  SentryNative.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: true,
    debug: __DEV__,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    integrations: [
      SentryNative.mobileReplayIntegration(),
      SentryNative.feedbackIntegration(),
    ],
  });
}

// Export a unified Sentry capture function for use in other files
export const captureException = (error: unknown) => {
  if (Platform.OS === "web") {
    SentryBrowser.captureException(error);
  } else {
    SentryNative.captureException(error);
  }
};

export default function RootLayout() {
  const [isLoading, setIsLoading] = useState(true);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const inOnboarding = segments[0] === "onboarding";

    if (!hasCompletedOnboarding && !inOnboarding) {
      // User hasn't completed onboarding, redirect to onboarding
      router.replace("/onboarding");
    } else if (hasCompletedOnboarding && inOnboarding) {
      // User completed onboarding but somehow on onboarding screen, go to tabs
      router.replace("/(tabs)");
    }
  }, [isLoading, hasCompletedOnboarding, segments]);

  const checkOnboardingStatus = async () => {
    try {
      const value = await AsyncStorage.getItem(ONBOARDING_KEY);
      setHasCompletedOnboarding(value === "true");
    } catch (error) {
      console.error("Error checking onboarding status:", error);
      // Default to showing onboarding if there's an error
      setHasCompletedOnboarding(false);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#000",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#000" },
      }}
    >
      {/* Onboarding screen */}
      <Stack.Screen
        name="onboarding"
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />

      {/* Tabs navigator */}
      <Stack.Screen
        name="(tabs)"
        options={{
          headerShown: false,
        }}
      />

      {/* Detail screens */}
      <Stack.Screen
        name="match"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="team"
        options={{
          headerShown: false,
        }}
      />

      {/* Modal */}
      <Stack.Screen
        name="modal"
        options={{
          presentation: "modal",
        }}
      />
    </Stack>
  );
}
