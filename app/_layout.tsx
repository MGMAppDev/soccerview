import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack>
      {/* Tabs navigator: no header, and blank title so iOS back label is NOT "(tabs)" */}
      <Stack.Screen
        name="(tabs)"
        options={{
          headerShown: false,
          title: "",
        }}
      />

      {/* Register route GROUPS (folders), not the leaf dynamic routes.
          The leaf routes are handled by app/match/_layout.tsx and app/team/_layout.tsx. */}
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

      {/* Keep modal if you use it */}
      <Stack.Screen
        name="modal"
        options={{
          presentation: "modal",
          title: "",
        }}
      />
    </Stack>
  );
}
