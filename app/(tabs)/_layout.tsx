import { Tabs } from "expo-router";
import React from "react";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTitle: "SoccerView",
        headerTitleAlign: "center",

        // ✅ Key fix: prevent header from overlaying screen content (cuts off top)
        headerTransparent: false,
        headerShadowVisible: false,
        headerLargeTitle: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="matches" options={{ title: "Matches" }} />
      <Tabs.Screen name="teams" options={{ title: "Teams" }} />
      <Tabs.Screen name="rankings" options={{ title: "Rankings" }} />
    </Tabs>
  );
}
