import { Stack } from "expo-router";
import React from "react";

export default function MatchLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "#000" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: "#000" },
      }}
    />
  );
}
