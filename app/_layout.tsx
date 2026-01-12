import * as SentryBrowser from "@sentry/browser";
import * as SentryNative from "@sentry/react-native";
import { Stack } from "expo-router";
import React from "react";
import { Platform } from "react-native";

const SENTRY_DSN =
  "https://c708a446fcce75c1d57840c9ce4b09d5@o4510681007718400.ingest.us.sentry.io/4510681033932800";

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
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#000" },
      }}
    >
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
