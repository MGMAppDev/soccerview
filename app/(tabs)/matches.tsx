// app/(tabs)/matches.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";

type MatchRow = Record<string, any>;

function toDisplayDate(value: any) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && `${v}`.trim() !== "") return v;
  }
  return undefined;
}

function scoreText(m: MatchRow) {
  const hs = pickFirst(m, ["home_score", "home_goals", "homeTeamScore"]);
  const as = pickFirst(m, ["away_score", "away_goals", "awayTeamScore"]);
  if (hs === undefined || as === undefined) return "";
  return `${hs} - ${as}`;
}

export default function MatchesScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [teamNameById, setTeamNameById] = useState<Record<string, string>>({});

  // ✅ IMPORTANT: Use a ref so updating teamNameById doesn't recreate callbacks and re-trigger match loads
  const teamNameRef = useRef<Record<string, string>>({});
  useEffect(() => {
    teamNameRef.current = teamNameById;
  }, [teamNameById]);

  const hydrateTeamNames = useCallback(async (rows: MatchRow[]) => {
    const ids = new Set<string>();

    for (const r of rows) {
      const homeId = pickFirst(r, ["home_team_id", "homeTeamId", "home_id"]);
      const awayId = pickFirst(r, ["away_team_id", "awayTeamId", "away_id"]);
      if (homeId) ids.add(String(homeId));
      if (awayId) ids.add(String(awayId));
    }

    const all = Array.from(ids);
    if (all.length === 0) return;

    const missing = all.filter((id) => !teamNameRef.current[id]);
    if (missing.length === 0) return;

    const { data, error } = await supabase
      .from("v_teams_resolved")
      .select("*")
      .in("id", missing);

    if (error) return;

    const next: Record<string, string> = {};
    for (const t of data ?? []) {
      const id = String(t.id);
      const name =
        pickFirst(t, ["display_name", "team_name", "name", "short_name"]) ?? `Team ${id}`;
      next[id] = String(name);
    }

    if (Object.keys(next).length > 0) {
      setTeamNameById((prev) => ({ ...prev, ...next }));
    }
  }, []);

  const loadMatches = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);

    const { data, error } = await supabase
      .from("v_matches_competition_resolved")
      .select("*")
      .order("played_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) {
      setMatches([]);
      if (!silent) setLoading(false);
      return;
    }

    const rows = (data ?? []) as MatchRow[];
    setMatches(rows);

    // ✅ Hydrate names without causing reload loops
    hydrateTeamNames(rows);

    if (!silent) setLoading(false);
  }, [hydrateTeamNames]);

  useEffect(() => {
    loadMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMatches({ silent: true });
    setRefreshing(false);
  }, [loadMatches]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return matches;

    return matches.filter((m) => {
      const compName =
        pickFirst(m, ["competition_name", "league_name", "competition", "league"]) ?? "";
      const compKey =
        pickFirst(m, ["competition_key", "competition_id", "league_id"]) ?? "";

      const homeId = pickFirst(m, ["home_team_id", "homeTeamId", "home_id"]);
      const awayId = pickFirst(m, ["away_team_id", "awayTeamId", "away_id"]);

      const homeName =
        pickFirst(m, ["home_team_name", "homeName", "home_team"]) ??
        (homeId ? teamNameById[String(homeId)] : "") ??
        "";
      const awayName =
        pickFirst(m, ["away_team_name", "awayName", "away_team"]) ??
        (awayId ? teamNameById[String(awayId)] : "") ??
        "";

      const haystack = [homeName, awayName, compName, compKey].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [matches, query, teamNameById]);

  const renderItem = ({ item }: { item: MatchRow }) => {
    const matchId = item.id;

    const playedAt = pickFirst(item, ["played_at", "match_date", "date", "playedAt"]);
    const compKey = pickFirst(item, ["competition_key"]) ?? "—";
    const compName =
      pickFirst(item, ["competition_name", "league_name", "competition", "league"]) ??
      `Competition: ${String(compKey)}`;

    const homeId = pickFirst(item, ["home_team_id", "homeTeamId", "home_id"]);
    const awayId = pickFirst(item, ["away_team_id", "awayTeamId", "away_id"]);

    const homeName =
      pickFirst(item, ["home_team_name", "homeName", "home_team"]) ??
      (homeId ? teamNameById[String(homeId)] : undefined) ??
      (homeId ? `Team ${homeId}` : "Home");

    const awayName =
      pickFirst(item, ["away_team_name", "awayName", "away_team"]) ??
      (awayId ? teamNameById[String(awayId)] : undefined) ??
      (awayId ? `Team ${awayId}` : "Away");

    return (
      <Pressable
        onPress={() => matchId && router.push(`/match/${matchId}`)}
        style={{
          backgroundColor: "#111827",
          borderRadius: 16,
          padding: 14,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: "#1F2937",
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={{ color: "#9CA3AF", fontSize: 12 }} numberOfLines={1}>
            {compName}
          </Text>
          <Text style={{ color: "#9CA3AF", fontSize: 12 }}>{toDisplayDate(playedAt)}</Text>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "white", fontSize: 16 }} numberOfLines={1}>
              {homeName}
            </Text>
            <Text style={{ color: "#D1D5DB", fontSize: 13, marginTop: 4 }} numberOfLines={1}>
              vs {awayName}
            </Text>
          </View>

          <View style={{ alignItems: "flex-end", justifyContent: "center" }}>
            <Text style={{ color: "white", fontSize: 18, fontWeight: "700" }}>
              {scoreText(item)}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
        <Text style={{ color: "white", fontSize: 22, fontWeight: "800", marginBottom: 10 }}>
          Matches
        </Text>

        <View
          style={{
            backgroundColor: "#0F172A",
            borderWidth: 1,
            borderColor: "#1F2937",
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search teams / competitions…"
            placeholderTextColor="#6B7280"
            autoCorrect={false}
            autoCapitalize="none"
            style={{ color: "white", fontSize: 16 }}
          />
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
          <Text style={{ color: "#9CA3AF", marginTop: 10 }}>Loading matches…</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          data={filtered}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={{ paddingHorizontal: 16, paddingTop: 24 }}>
              <Text style={{ color: "#9CA3AF" }}>No matches found.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
