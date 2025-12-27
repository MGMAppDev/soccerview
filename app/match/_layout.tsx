import { Stack } from "expo-router";
import React from "react";

export default function MatchLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitleAlign: "center",
        headerLargeTitle: false,

        // ✅ removes "(tabs)" label on iOS back button
        headerBackTitleVisible: false,
        headerBackTitle: "",

        // ✅ prevents long-press back menu showing route names
        headerBackButtonMenuEnabled: false,
      }}
    />
  );
}
