// app/team/[id].tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type AnyRow = Record<string, any>;

interface RankData {
  nationalRank?: number;
  nationalRating?: number;
  stateRank?: number;
  stateRating?: number;
  state?: string;
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && `${v}`.trim() !== "") return v;
  }
  return undefined;
}

function toDisplayDate(value: any) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function scoreText(m: AnyRow) {
  const hs = pickFirst(m, ["home_score", "home_goals", "homeTeamScore"]);
  const as = pickFirst(m, ["away_score", "away_goals", "awayTeamScore"]);
  if (hs === undefined || as === undefined) return "";
  return `${hs} - ${as}`;
}

export default function TeamScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const routeId = params?.id ? String(params.id) : "";

  const [loadingTeam, setLoadingTeam] = useState(true);
  const [team, setTeam] = useState<AnyRow | null>(null);

  const [loadingRanks, setLoadingRanks] = useState(true);
  const [ranks, setRanks] = useState<RankData>({});

  const [loadingMatches, setLoadingMatches] = useState(true);
  const [matches, setMatches] = useState<AnyRow[]>([]);

  const loadTeam = useCallback(async () => {
    setLoadingTeam(true);

    if (!routeId) {
      setTeam(null);
      setLoadingTeam(false);
      return;
    }

    // Try routeId as team_id
    const byTeamId = await supabase
      .from("v_teams_resolved")
      .select("id, team_id, canonical_team_id, name, gender, age_group")
      .eq("team_id", routeId)
      .maybeSingle();

    if (!byTeamId.error && byTeamId.data) {
      setTeam(byTeamId.data as AnyRow);
      setLoadingTeam(false);
      return;
    }

    // Fallback to effective id
    const byEffective = await supabase
      .from("v_teams_resolved")
      .select("id, team_id, canonical_team_id, name, gender, age_group")
      .eq("id", routeId)
      .maybeSingle();

    if (!byEffective.error && byEffective.data) {
      setTeam(byEffective.data as AnyRow);
      setLoadingTeam(false);
      return;
    }

    setTeam(null);
    setLoadingTeam(false);
  }, [routeId]);

  const loadRanks = useCallback(async () => {
    setLoadingRanks(true);

    if (!team?.team_id) {
      setRanks({});
      setLoadingRanks(false);
      return;
    }

    const { data, error } = await supabase
      .from("team_ranks_daily")
      .select("scope, rank, rating, state")
      .eq("team_id", team.team_id)
      .order("rank_date", { ascending: false })
      .limit(2); // Latest national + state

    if (error || !data?.length) {
      setRanks({});
      setLoadingRanks(false);
      return;
    }

    const rankData = data.reduce<RankData>((acc, row) => {
      if (row.scope === "national") {
        acc.nationalRank = row.rank;
        acc.nationalRating = row.rating;
      } else if (row.scope === "state") {
        acc.stateRank = row.rank;
        acc.stateRating = row.rating;
        acc.state = row.state;
      }
      return acc;
    }, {});

    setRanks(rankData);
    setLoadingRanks(false);
  }, [team]);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);

    if (!routeId) {
      setMatches([]);
      setLoadingMatches(false);
      return;
    }

    const effectiveId = team?.team_id ?? routeId;

    const { data, error } = await supabase
      .from("v_matches_resolved")
      .select("*")
      .limit(1000);

    if (error) {
      setMatches([]);
      setLoadingMatches(false);
      return;
    }

    const rows = (data ?? []) as AnyRow[];

    const filtered = rows.filter((m) => {
      const he = pickFirst(m, ["home_effective_team_id"]);
      const ae = pickFirst(m, ["away_effective_team_id"]);

      const hr = pickFirst(m, ["home_team_id"]);
      const ar = pickFirst(m, ["away_team_id"]);

      return (
        String(he ?? "") === effectiveId ||
        String(ae ?? "") === effectiveId ||
        String(hr ?? "") === effectiveId ||
        String(ar ?? "") === effectiveId
      );
    });

    setMatches(filtered);
    setLoadingMatches(false);
  }, [routeId, team]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  useEffect(() => {
    if (!loadingTeam) {
      loadRanks();
      loadMatches();
    }
  }, [loadingTeam, loadRanks, loadMatches]);

  const header = useMemo(
    () => ({
      name: team?.name ?? "Unknown Team",
      meta: [team?.gender, team?.age_group].filter(Boolean).join(" • ") || null,
    }),
    [team],
  );

  const now = useMemo(() => new Date(), []);

  const recentMatches = useMemo(() => {
    return matches
      .filter((m) => {
        const dateAny = pickFirst(m, ["match_date", "date", "matchDate"]);
        return dateAny && new Date(dateAny) < now;
      })
      .sort((a, b) => {
        const da = pickFirst(a, ["match_date", "date", "matchDate"]) ?? "";
        const db = pickFirst(b, ["match_date", "date", "matchDate"]) ?? "";
        return new Date(db).getTime() - new Date(da).getTime();
      });
  }, [matches, now]);

  const upcomingMatches = useMemo(() => {
    return matches
      .filter((m) => {
        const dateAny = pickFirst(m, ["match_date", "date", "matchDate"]);
        return dateAny && new Date(dateAny) >= now;
      })
      .sort((a, b) => {
        const da = pickFirst(a, ["match_date", "date", "matchDate"]) ?? "";
        const db = pickFirst(b, ["match_date", "date", "matchDate"]) ?? "";
        return new Date(da).getTime() - new Date(db).getTime();
      });
  }, [matches, now]);

  const renderMatch = ({ item }: { item: AnyRow }) => {
    const matchId = pickFirst(item, ["match_id", "id"]);
    const compKey = pickFirst(item, ["competition", "event_name"]) ?? "Unknown";
    const dateAny = pickFirst(item, ["match_date", "date", "matchDate"]);
    const homeName =
      pickFirst(item, ["home_team_name", "homeName", "home_team"]) ?? "Home";
    const awayName =
      pickFirst(item, ["away_team_name", "awayName", "away_team"]) ?? "Away";

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
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <Text style={{ color: "#9CA3AF", fontSize: 12 }} numberOfLines={1}>
            Competition: {String(compKey)}
          </Text>
          <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
            {toDisplayDate(dateAny)}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: "white", fontSize: 16, fontWeight: "800" }}
              numberOfLines={1}
            >
              {homeName}
            </Text>
            <Text
              style={{ color: "#D1D5DB", fontSize: 13, marginTop: 4 }}
              numberOfLines={1}
            >
              vs {awayName}
            </Text>
          </View>

          <View style={{ alignItems: "flex-end", justifyContent: "center" }}>
            <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
              {scoreText(item)}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: "#0B1220" }}
      edges={["top"]}
    >
      <View style={{ padding: 16 }}>
        <Pressable
          onPress={() => router.back()}
          style={{
            alignSelf: "flex-start",
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: "#111827",
            borderWidth: 1,
            borderColor: "#1F2937",
            marginBottom: 14,
          }}
        >
          <Text style={{ color: "white", fontWeight: "700" }}>Back</Text>
        </Pressable>

        {loadingTeam ? (
          <View style={{ paddingTop: 20 }}>
            <ActivityIndicator />
            <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
              Loading team…
            </Text>
          </View>
        ) : (
          <>
            <Text
              style={{
                color: "white",
                fontSize: 34,
                fontWeight: "900",
                lineHeight: 38,
              }}
            >
              {header.name}
            </Text>
            {header.meta ? (
              <Text style={{ color: "#9CA3AF", marginTop: 6, fontSize: 16 }}>
                {header.meta}
              </Text>
            ) : null}
            {loadingRanks ? (
              <Text style={{ color: "#9CA3AF", marginTop: 8 }}>
                Loading ranks…
              </Text>
            ) : (
              <View style={{ marginTop: 8, gap: 4 }}>
                {ranks.nationalRank ? (
                  <Text style={{ color: "#D1D5DB", fontSize: 14 }}>
                    National Rank: #{ranks.nationalRank} (Rating:{" "}
                    {ranks.nationalRating ?? "—"})
                  </Text>
                ) : null}
                {ranks.stateRank ? (
                  <Text style={{ color: "#D1D5DB", fontSize: 14 }}>
                    {ranks.state ?? "State"} Rank: #{ranks.stateRank} (Rating:{" "}
                    {ranks.stateRating ?? "—"})
                  </Text>
                ) : null}
              </View>
            )}

            <View
              style={{
                marginTop: 18,
                flexDirection: "row",
                alignItems: "baseline",
              }}
            >
              <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>
                Recent Matches
              </Text>
              <Text style={{ color: "#6B7280", marginLeft: 10, fontSize: 12 }}>
                Source: v_matches_resolved
              </Text>
            </View>
          </>
        )}
      </View>

      {loadingMatches ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <ActivityIndicator />
          <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
            Loading matches…
          </Text>
        </View>
      ) : (
        <>
          <FlatList
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
            data={recentMatches}
            keyExtractor={(item, idx) => String(item.id ?? idx)}
            renderItem={renderMatch}
            ListEmptyComponent={
              <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                <Text style={{ color: "#9CA3AF" }}>
                  No recent matches found.
                </Text>
              </View>
            }
          />

          <View style={{ padding: 16 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "baseline",
              }}
            >
              <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>
                Upcoming Matches
              </Text>
              <Text style={{ color: "#6B7280", marginLeft: 10, fontSize: 12 }}>
                Source: v_matches_resolved
              </Text>
            </View>
          </View>

          <FlatList
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
            data={upcomingMatches}
            keyExtractor={(item, idx) => String(item.id ?? idx)}
            renderItem={renderMatch}
            ListEmptyComponent={
              <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                <Text style={{ color: "#9CA3AF" }}>
                  No upcoming matches found.
                </Text>
              </View>
            }
          />
        </>
      )}
    </SafeAreaView>
  );
}
