import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type TeamResolvedRow = {
  id: string | null;
  team_id: string;
  name: string | null;
  gender: string | null;
  age_group: string | null;
  state: string | null;
};

export default function TeamsTab() {
  const [teams, setTeams] = useState<TeamResolvedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [selectedAges, setSelectedAges] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);

  const subtitle = useMemo(() => {
    return (t: TeamResolvedRow) => {
      const bits: string[] = [];
      if (t.gender) bits.push(t.gender);
      if (t.age_group) bits.push(t.age_group);
      return bits.join(" • ");
    };
  }, []);

  async function load() {
    try {
      setLoading(true);
      setError(null);

      const { data, error: qErr } = await supabase
        .from("v_teams_resolved")
        .select("id, team_id, name, gender, age_group, state")
        .order("name", { ascending: true })
        .limit(300);

      if (qErr) throw qErr;

      const loadedTeams = (data as TeamResolvedRow[]) ?? [];
      console.log(`DEBUG: Loaded ${loadedTeams.length} teams from Supabase`);
      setTeams(loadedTeams);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const uniqueGenders = useMemo(() => {
    const genders = new Set(teams.map((t) => t.gender).filter(Boolean));
    return Array.from(genders) as string[];
  }, [teams]);

  const uniqueAges = useMemo(() => {
    const ages = new Set(teams.map((t) => t.age_group).filter(Boolean));
    return Array.from(ages).sort() as string[];
  }, [teams]);

  const uniqueStates = useMemo(() => {
    const states = new Set(teams.map((t) => t.state).filter(Boolean));
    return Array.from(states).sort() as string[];
  }, [teams]);

  const filteredTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = teams.filter((t) => t.team_id);
    if (q) {
      list = list.filter((t) => (t.name ?? "").toLowerCase().includes(q));
    }
    if (selectedGenders.length) {
      list = list.filter((t) => t.gender && selectedGenders.includes(t.gender));
    }
    if (selectedAges.length) {
      list = list.filter(
        (t) => t.age_group && selectedAges.includes(t.age_group),
      );
    }
    if (selectedStates.length) {
      list = list.filter((t) => t.state && selectedStates.includes(t.state));
    }
    return list;
  }, [teams, searchQuery, selectedGenders, selectedAges, selectedStates]);

  const toggleFilter = (type: "gender" | "age" | "state", value: string) => {
    if (type === "gender") {
      setSelectedGenders((prev) =>
        prev.includes(value)
          ? prev.filter((v) => v !== value)
          : [...prev, value],
      );
    } else if (type === "age") {
      setSelectedAges((prev) =>
        prev.includes(value)
          ? prev.filter((v) => v !== value)
          : [...prev, value],
      );
    } else if (type === "state") {
      setSelectedStates((prev) =>
        prev.includes(value)
          ? prev.filter((v) => v !== value)
          : [...prev, value],
      );
    }
  };

  const cardStyle = {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    marginBottom: 10,
  } as const;

  const chipStyle = (selected: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: selected ? "#3B82F6" : "#1F2937",
    marginRight: 8,
  });

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0b0b0b" }}>
        <View
          style={{
            flex: 1,
            padding: 16,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ActivityIndicator />
          <Text style={{ marginTop: 10, opacity: 0.7, color: "#bdbdbd" }}>
            Loading teams…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0b0b0b" }}>
        <View style={{ flex: 1, padding: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: "900", color: "white" }}>
            Teams
          </Text>
          <Text style={{ marginTop: 10, opacity: 0.7, color: "#bdbdbd" }}>
            {error}
          </Text>
          <Pressable onPress={load} style={{ marginTop: 14 }}>
            <Text
              style={{
                fontWeight: "900",
                textDecorationLine: "underline",
                color: "white",
              }}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b0b0b" }}>
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "900", color: "white" }}>
          Teams
        </Text>
        <Text style={{ marginTop: 6, opacity: 0.65, color: "#bdbdbd" }}>
          Filter, search, and tap a team to open the profile.
        </Text>

        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search teams by name…"
          placeholderTextColor="#888"
          style={{
            borderWidth: 1,
            borderColor: "#2b2b2b",
            backgroundColor: "#121212",
            color: "white",
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 12,
            marginTop: 14,
            marginBottom: 10,
          }}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
        />

        <View style={{ marginBottom: 12 }}>
          <Text
            style={{
              color: "white",
              fontSize: 16,
              fontWeight: "700",
              marginBottom: 6,
            }}
          >
            Gender
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {uniqueGenders.map((g) => (
              <Pressable
                key={g}
                onPress={() => toggleFilter("gender", g)}
                style={chipStyle(selectedGenders.includes(g))}
              >
                <Text style={{ color: "white" }}>{g}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={{ marginBottom: 12 }}>
          <Text
            style={{
              color: "white",
              fontSize: 16,
              fontWeight: "700",
              marginBottom: 6,
            }}
          >
            Age Group
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {uniqueAges.map((a) => (
              <Pressable
                key={a}
                onPress={() => toggleFilter("age", a)}
                style={chipStyle(selectedAges.includes(a))}
              >
                <Text style={{ color: "white" }}>{a}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={{ marginBottom: 12 }}>
          <Text
            style={{
              color: "white",
              fontSize: 16,
              fontWeight: "700",
              marginBottom: 6,
            }}
          >
            State
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {uniqueStates.map((s) => (
              <Pressable
                key={s}
                onPress={() => toggleFilter("state", s)}
                style={chipStyle(selectedStates.includes(s))}
              >
                <Text style={{ color: "white" }}>{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <FlatList
          data={filteredTeams}
          keyExtractor={(item) => item.team_id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                const routeId = item.id ?? item.team_id;
                console.log(
                  `DEBUG: Navigating to team with routeId: ${routeId}`,
                );
                router.push(`/team/${routeId}`);
              }}
              style={cardStyle}
            >
              <Text
                style={{ fontSize: 16, fontWeight: "900", color: "white" }}
                numberOfLines={2}
              >
                {item.name ?? "Unnamed Team"}
              </Text>

              {subtitle(item) ? (
                <Text style={{ marginTop: 6, opacity: 0.7, color: "#bdbdbd" }}>
                  {subtitle(item)}
                </Text>
              ) : (
                <Text style={{ marginTop: 6, opacity: 0.6, color: "#bdbdbd" }}>
                  -
                </Text>
              )}
            </Pressable>
          )}
          ListEmptyComponent={() => (
            <Text style={{ marginTop: 10, opacity: 0.7, color: "#bdbdbd" }}>
              {searchQuery ? "No matching teams found." : "No teams found."}
            </Text>
          )}
        />
      </View>
    </SafeAreaView>
  );
}
