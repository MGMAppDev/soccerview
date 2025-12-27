import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, RefreshControl } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";

type MatchRow = {
  id: string;
  match_date: string | null;
  season: string | null;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  leagues?: { name: string | null } | null;
  home_team?: { name: string | null } | null;
  away_team?: { name: string | null } | null;
};

type TeamResolvedRow = {
  id: string; // effective_team_id (from view) - used for list uniqueness only
  team_id: string; // real teams.id - used for routing
  name: string | null;
  gender: string | null;
  age_group: string | null;
};

function formatDate(isoDate: string | null) {
  if (!isoDate) return "TBD";
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

function scoreText(home: number | null, away: number | null) {
  if (home === null || away === null) return "—";
  return `${home} - ${away}`;
}

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [latestMatches, setLatestMatches] = useState<MatchRow[]>([]);
  const [featuredTeams, setFeaturedTeams] = useState<TeamResolvedRow[]>([]);

  const [countTeams, setCountTeams] = useState<number>(0);
  const [countMatches, setCountMatches] = useState<number>(0);
  const [countSources, setCountSources] = useState<number>(0);

  const subtitle = useMemo(() => {
    if (loading) return "Loading…";
    if (error) return "Error loading home";
    return "Quick snapshot of what’s new.";
  }, [loading, error]);

  const load = useCallback(async (isRefresh = false) => {
    try {
      setError(null);
      isRefresh ? setRefreshing(true) : setLoading(true);

      // Counts (Teams should be de-duped on Home, so count the resolved view)
      const [teamsCountRes, matchesCountRes, sourcesCountRes] = await Promise.all([
        supabase.from("v_teams_resolved").select("*", { count: "exact", head: true }),
        supabase.from("matches").select("*", { count: "exact", head: true }),
        supabase.from("sources").select("*", { count: "exact", head: true }),
      ]);

      setCountTeams(teamsCountRes.count ?? 0);
      setCountMatches(matchesCountRes.count ?? 0);
      setCountSources(sourcesCountRes.count ?? 0);

      // Latest matches (unchanged)
      const { data: matchData, error: matchErr } = await supabase
        .from("matches")
        .select(
          `
          id,
          match_date,
          season,
          status,
          home_score,
          away_score,
          leagues:leagues!matches_league_id_fkey ( name ),
          home_team:teams!matches_home_team_id_fkey ( name ),
          away_team:teams!matches_away_team_id_fkey ( name )
        `
        )
        .order("match_date", { ascending: false })
        .limit(5);

      if (matchErr) throw matchErr;
      setLatestMatches(((matchData as MatchRow[]) ?? []) as MatchRow[]);

      // Featured teams (DE-DUPED): read from the resolved view
      const { data: teamData, error: teamErr } = await supabase
        .from("v_teams_resolved")
        .select("id, team_id, name, gender, age_group")
        .order("name", { ascending: true })
        .limit(6);

      if (teamErr) throw teamErr;
      setFeaturedTeams(((teamData as TeamResolvedRow[]) ?? []) as TeamResolvedRow[]);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
      setLatestMatches([]);
      setFeaturedTeams([]);
      setCountTeams(0);
      setCountMatches(0);
      setCountSources(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 16, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, opacity: 0.7 }}>Loading…</Text>
      </View>
    );
  }

  const card = {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: "#fff",
  } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#fff" }}
      contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      <Text style={{ fontSize: 22, fontWeight: "900" }}>Home</Text>
      <Text style={{ marginTop: 6, fontSize: 14, opacity: 0.7 }}>{subtitle}</Text>

      {error ? (
        <View style={{ marginTop: 12, ...card }}>
          <Text style={{ fontWeight: "900" }}>Load error</Text>
          <Text style={{ marginTop: 8, opacity: 0.75 }}>{error}</Text>
        </View>
      ) : null}

      {/* Data health */}
      <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, ...card }}>
          <Text style={{ fontSize: 12, opacity: 0.65 }}>Teams</Text>
          <Text style={{ marginTop: 6, fontSize: 22, fontWeight: "900" }}>{countTeams}</Text>
        </View>
        <View style={{ flex: 1, ...card }}>
          <Text style={{ fontSize: 12, opacity: 0.65 }}>Matches</Text>
          <Text style={{ marginTop: 6, fontSize: 22, fontWeight: "900" }}>{countMatches}</Text>
        </View>
        <View style={{ flex: 1, ...card }}>
          <Text style={{ fontSize: 12, opacity: 0.65 }}>Sources</Text>
          <Text style={{ marginTop: 6, fontSize: 22, fontWeight: "900" }}>{countSources}</Text>
        </View>
      </View>

      {/* Latest matches */}
      <View style={{ marginTop: 18 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Text style={{ fontSize: 18, fontWeight: "900" }}>Latest Matches</Text>
          <Pressable onPress={() => router.push("/(tabs)/explore")}>
            <Text style={{ fontWeight: "900", opacity: 0.75 }}>See all</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 10 }}>
          {latestMatches.length === 0 ? (
            <View style={{ ...card }}>
              <Text style={{ fontWeight: "900" }}>No matches yet</Text>
              <Text style={{ marginTop: 6, opacity: 0.7 }}>Add matches in Supabase, then pull-to-refresh.</Text>
            </View>
          ) : (
            latestMatches.map((m) => {
              const league = m.leagues?.name ?? "Unknown League";
              const home = m.home_team?.name ?? "Home";
              const away = m.away_team?.name ?? "Away";
              const date = formatDate(m.match_date);
              const score = scoreText(m.home_score, m.away_score);
              const status = (m.status ?? "").toUpperCase() || "—";

              return (
                <Pressable
                  key={m.id}
                  onPress={() => router.push(`/match/${m.id}`)}
                  style={{ ...card, marginBottom: 10 }}
                >
                  <Text style={{ fontSize: 12, opacity: 0.65 }} numberOfLines={1}>
                    {league}
                  </Text>
                  <Text style={{ marginTop: 6, fontSize: 16, fontWeight: "900" }} numberOfLines={2}>
                    {home} vs {away}
                  </Text>
                  <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ opacity: 0.8 }}>{date}</Text>
                    <Text style={{ fontWeight: "900" }}>{score}</Text>
                  </View>
                  <View style={{ marginTop: 6, flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ opacity: 0.65 }}>{m.season ?? "—"}</Text>
                    <Text style={{ opacity: 0.65 }}>{status}</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </View>

      {/* Featured teams (DE-DUPED) */}
      <View style={{ marginTop: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Text style={{ fontSize: 18, fontWeight: "900" }}>Teams</Text>
          <Pressable onPress={() => router.push("/(tabs)/teams")}>
            <Text style={{ fontWeight: "900", opacity: 0.75 }}>Browse</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 10 }}>
          {featuredTeams.length === 0 ? (
            <View style={{ ...card }}>
              <Text style={{ fontWeight: "900" }}>No teams yet</Text>
              <Text style={{ marginTop: 6, opacity: 0.7 }}>Add teams in Supabase, then pull-to-refresh.</Text>
            </View>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {featuredTeams.map((t) => {
                const meta = [t.gender, t.age_group].filter(Boolean).join(" • ");
                return (
                  <Pressable
                    key={t.id}
                    // IMPORTANT: route using team_id (real teams.id), not the view id
                    onPress={() => router.push(`/team/${t.id}`)}
                    style={{ width: "48%", ...card }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: "900" }} numberOfLines={2}>
                      {t.name ?? "Unnamed Team"}
                    </Text>
                    {meta ? <Text style={{ marginTop: 6, opacity: 0.7 }}>{meta}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
