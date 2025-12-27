import { View, Text } from "react-native";
import { Link } from "expo-router";

export default function ModalScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 24, paddingTop: 64 }}>
      <Text style={{ fontSize: 24, fontWeight: "700", color: "#111" }}>
        Modal
      </Text>

      <Link href="/(tabs)" style={{ marginTop: 16 }}>
        <Text style={{ color: "blue" }}>Go back to Home</Text>
      </Link>
    </View>
  );
}
