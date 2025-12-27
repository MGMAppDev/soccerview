// app/_explore.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";

type MatchRow = {
  id: string;

  // Prefer the competition-aware schema (played_at is what we used elsewhere)
  played_at: string | null;

  season: string | null;
  status: string | null;

  home_score: number | null;
  away_score: number | null;

  // Names provided by v_matches_competition_resolved (or gracefully fallback)
  competition_name?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;

  // Fallbacks if your view still exposes older fields
  match_date?: string | null;
  leagues?: { name: string | null } | null;
  home_team?: { name: string | null } | null;
  away_team?: { name: string | null } | null;
};

function formatDate(value: string | null) {
  if (!value) return "TBD";
  // handle both ISO date and datetime
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    // if it's YYYY-MM-DD only
    const parts = value.split("-");
    if (parts.length === 3) {
      const [y, m, day] = parts.map(Number);
      if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(day)) return `${m}/${day}/${y}`;
    }
    return "TBD";
  }
  return d.toLocaleDateString();
}

function scoreText(home: number | null, away: number | null) {
  if (home === null || away === null) return "—";
  return `${home} - ${away}`;
}

export default function ExploreScreen() {
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const subtitle = useMemo(() => {
    if (loading) return "Loading…";
    if (error) return "Error loading matches";
    return `Matches loaded: ${rows.length}`;
  }, [loading, error, rows.length]);

  async function loadMatches(isRefresh = false, isMountedRef?: { current: boolean }) {
    try {
      setError(null);
      isRefresh ? setRefreshing(true) : setLoading(true);

      // Phase 2.3: competition-aware match reads
      const { data, error: qErr } = await supabase
        .from("v_matches_competition_resolved")
        .select(
          `
          id,
          played_at,
          season,
          status,
          home_score,
          away_score,
          competition_name,
          home_team_name,
          away_team_name
        `
        )
        .order("played_at", { ascending: false });

      if (qErr) throw qErr;

      const safeRows = (data as MatchRow[]) ?? [];
      if (!isMountedRef || isMountedRef.current) setRows(safeRows);
    } catch (e: any) {
      if (!isMountedRef || isMountedRef.current) {
        setError(e?.message ?? "Unknown error");
        setRows([]);
      }
    } finally {
      if (!isMountedRef || isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    const isMountedRef = { current: true };
    loadMatches(false, isMountedRef);
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 16, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, opacity: 0.7 }}>Loading matches…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        data={rows}
        keyExtractor={(item) => item.id}
        onRefresh={() => loadMatches(true)}
        refreshing={refreshing}
        ListHeaderComponent={
          <View>
            <Text style={{ fontSize: 22, fontWeight: "900" }}>Matches</Text>
            <Text style={{ marginTop: 6, fontSize: 14, opacity: 0.7 }}>
              Latest match results and fixtures.
            </Text>

            <View
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "rgba(0,0,0,0.10)",
              }}
            >
              <Text style={{ fontSize: 12, opacity: 0.65 }}>Status</Text>
              <Text style={{ marginTop: 6, fontSize: 16, fontWeight: "900" }}>{subtitle}</Text>
            </View>

            {error ? (
              <View
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "rgba(0,0,0,0.12)",
                }}
              >
                <Text style={{ fontWeight: "900" }}>Load error</Text>
                <Text style={{ marginTop: 8, opacity: 0.75, lineHeight: 18 }}>{error}</Text>

                <Pressable
                  onPress={() => loadMatches(false)}
                  style={{
                    marginTop: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "rgba(0,0,0,0.12)",
                    alignSelf: "flex-start",
                  }}
                >
                  <Text style={{ fontWeight: "900" }}>Retry</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={{ height: 14 }} />
          </View>
        }
        ListEmptyComponent={
          !error ? (
            <View
              style={{
                padding: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "rgba(0,0,0,0.10)",
              }}
            >
              <Text style={{ fontWeight: "900" }}>No matches yet</Text>
              <Text style={{ marginTop: 6, opacity: 0.7 }}>
                Your view returned 0 rows. Add match data (or confirm RLS policies) and pull-to-refresh.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          // prefer competition-aware fields; fall back gracefully
          const leagueName = item.competition_name ?? item.leagues?.name ?? "Competition";
          const homeName = item.home_team_name ?? item.home_team?.name ?? "Home";
          const awayName = item.away_team_name ?? item.away_team?.name ?? "Away";

          const date = formatDate(item.played_at ?? item.match_date ?? null);
          const score = scoreText(item.home_score, item.away_score);
          const status = (item.status ?? "").toUpperCase() || "—";

          return (
            <Pressable
              onPress={() => router.push(`/match/${item.id}`)}
              style={{
                paddingVertical: 14,
                paddingHorizontal: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "rgba(0,0,0,0.10)",
                marginBottom: 10,
              }}
            >
              <Text style={{ fontSize: 12, opacity: 0.65 }} numberOfLines={1}>
                {leagueName}
              </Text>

              <Text style={{ marginTop: 6, fontSize: 18, fontWeight: "900" }} numberOfLines={2}>
                {homeName} vs {awayName}
              </Text>

              <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ opacity: 0.8 }}>{date}</Text>
                <Text style={{ fontWeight: "900" }}>{score}</Text>
              </View>

              <View style={{ marginTop: 6, flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ opacity: 0.65 }}>{item.season ?? "—"}</Text>
                <Text style={{ opacity: 0.65 }}>{status}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
