import { Stack } from "expo-router";
import React from "react";

export default function MatchLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitleAlign: "center",

        // Dark theme styling
        headerStyle: {
          backgroundColor: "#000",
        },
        headerTintColor: "#fff",
        headerTitleStyle: {
          fontWeight: "600",
        },
      }}
    />
  );
}
