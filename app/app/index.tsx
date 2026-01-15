import { Redirect } from "expo-router";

export default function Index() {
  // This file serves as the entry point
  // The _layout.tsx handles onboarding check and redirects appropriately
  // Default to tabs - _layout.tsx will redirect to onboarding if needed
  return <Redirect href="/(tabs)" />;
}
